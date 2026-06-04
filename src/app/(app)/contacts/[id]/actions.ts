"use server";

import { createClient } from "@/lib/supabase/server";
import { enrichPersonByLinkedInUrl } from "@/lib/apollo";
import { searchTavily } from "@/lib/tavily";
import { isApolloShellResponse } from "@/lib/apollo-summary";
import { draftOutreachEmail, type Draft } from "@/lib/claude";
import { revalidatePath } from "next/cache";

export type EnrichState = {
  error: string | null;
  cached: boolean;
  message: string | null;
};

const CACHE_FRESH_DAYS = 30;

/**
 * Enrich a contact with Apollo data. Cache-first to protect the free-tier
 * credit budget — if we have a recent research_artifact for this contact,
 * we use it instead of hitting Apollo.
 *
 * On a fresh enrichment we also:
 *   - upsert apollo data into the linked company (if any)
 *   - fill contact.email / contact.title only if currently null
 *   - advance stage 'identified' -> 'researched' automatically
 */
export async function enrichContact(
  _prevState: EnrichState,
  formData: FormData,
): Promise<EnrichState> {
  const contactId = String(formData.get("contactId") ?? "");
  if (!contactId) {
    return { error: "Missing contact id.", cached: false, message: null };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in.", cached: false, message: null };
  }

  // Fetch contact (RLS scopes to current user; missing -> error)
  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select(
      "id, linkedin_url, email, title, current_stage, company_id",
    )
    .eq("id", contactId)
    .maybeSingle();

  if (contactErr) {
    return {
      error: `Couldn't load contact: ${contactErr.message}`,
      cached: false,
      message: null,
    };
  }
  if (!contact) {
    return { error: "Contact not found.", cached: false, message: null };
  }
  if (!contact.linkedin_url) {
    return {
      error: "Add a LinkedIn URL to this contact before enriching.",
      cached: false,
      message: null,
    };
  }

  // Cache check — has Apollo already enriched this contact recently?
  const cutoff = new Date(
    Date.now() - CACHE_FRESH_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: cached } = await supabase
    .from("research_artifacts")
    .select("id, payload, created_at")
    .eq("contact_id", contactId)
    .eq("source", "apollo")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached) {
    return {
      error: null,
      cached: true,
      message: `Using cached Apollo data (fetched ${new Date(cached.created_at).toLocaleDateString()}). No credit burned.`,
    };
  }

  // Cache miss — call Apollo
  let response;
  try {
    response = await enrichPersonByLinkedInUrl(contact.linkedin_url);
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Apollo call failed.",
      cached: false,
      message: null,
    };
  }

  const person = response.person;
  if (!person) {
    // Still cache the negative response so we don't keep re-querying
    await supabase.from("research_artifacts").insert({
      owner_id: user.id,
      contact_id: contactId,
      source: "apollo",
      payload: response,
    });
    return {
      error: "Apollo couldn't find a match for that LinkedIn URL.",
      cached: false,
      message: null,
    };
  }

  // Persist raw artifact
  const { error: artifactErr } = await supabase
    .from("research_artifacts")
    .insert({
      owner_id: user.id,
      contact_id: contactId,
      source: "apollo",
      payload: response,
    });
  if (artifactErr) {
    return {
      error: `Couldn't save Apollo result: ${artifactErr.message}`,
      cached: false,
      message: null,
    };
  }

  // Backfill contact fields if currently empty
  const contactUpdate: Record<string, unknown> = {};
  if (!contact.email && person.email) contactUpdate.email = person.email;
  if (!contact.title && person.title) contactUpdate.title = person.title;
  // Only advance stage if Apollo actually returned useful data (not a free-tier shell)
  if (
    contact.current_stage === "identified" &&
    !isApolloShellResponse(response)
  ) {
    contactUpdate.current_stage = "researched";
  }
  if (Object.keys(contactUpdate).length > 0) {
    await supabase.from("contacts").update(contactUpdate).eq("id", contactId);
  }

  // Enrich linked company with Apollo organization data
  if (contact.company_id && person.organization) {
    const org = person.organization;
    const companyUpdate: Record<string, unknown> = {};
    if (org.primary_domain) companyUpdate.domain = org.primary_domain;
    if (org.industry) companyUpdate.industry = org.industry;
    if (org.linkedin_url) companyUpdate.linkedin_url = org.linkedin_url;
    if (org.id) companyUpdate.apollo_id = org.id;
    if (org.estimated_num_employees) {
      companyUpdate.size_range = String(org.estimated_num_employees);
    }
    if (Object.keys(companyUpdate).length > 0) {
      await supabase
        .from("companies")
        .update(companyUpdate)
        .eq("id", contact.company_id);
    }
  }

  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/contacts");
  revalidatePath("/dashboard");

  return {
    error: null,
    cached: false,
    message: "Apollo enrichment saved.",
  };
}

// ── Tavily web research ────────────────────────────────────────────────

export type TavilyState = {
  error: string | null;
  cached: boolean;
  message: string | null;
};

const TAVILY_CACHE_FRESH_DAYS = 14; // web changes faster than Apollo data

/**
 * Search the web via Tavily for the contact. Builds a query from the
 * contact's name + company (if known). Cache-first: 14-day window.
 *
 * Result is saved as a research_artifact with source='tavily'.
 */
export async function researchWithTavily(
  _prevState: TavilyState,
  formData: FormData,
): Promise<TavilyState> {
  const contactId = String(formData.get("contactId") ?? "");
  if (!contactId) {
    return { error: "Missing contact id.", cached: false, message: null };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in.", cached: false, message: null };
  }

  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select(
      `id, name, title, current_stage,
       company:companies(name)`,
    )
    .eq("id", contactId)
    .maybeSingle();

  if (contactErr) {
    return {
      error: `Couldn't load contact: ${contactErr.message}`,
      cached: false,
      message: null,
    };
  }
  if (!contact) {
    return { error: "Contact not found.", cached: false, message: null };
  }

  const company = Array.isArray(contact.company)
    ? (contact.company[0] ?? null)
    : ((contact.company as { name: string } | null) ?? null);

  // Cache check
  const cutoff = new Date(
    Date.now() - TAVILY_CACHE_FRESH_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: cached } = await supabase
    .from("research_artifacts")
    .select("id, created_at")
    .eq("contact_id", contactId)
    .eq("source", "tavily")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached) {
    return {
      error: null,
      cached: true,
      message: `Using cached web research (fetched ${new Date(cached.created_at).toLocaleDateString()}).`,
    };
  }

  // Build the query
  const query = company?.name
    ? `${contact.name} ${company.name}`
    : contact.name;

  let response;
  try {
    response = await searchTavily(query);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Tavily call failed.",
      cached: false,
      message: null,
    };
  }

  const { error: artifactErr } = await supabase
    .from("research_artifacts")
    .insert({
      owner_id: user.id,
      contact_id: contactId,
      source: "tavily",
      payload: response,
    });
  if (artifactErr) {
    return {
      error: `Couldn't save Tavily result: ${artifactErr.message}`,
      cached: false,
      message: null,
    };
  }

  // Advance stage to researched on real web data
  if (contact.current_stage === "identified") {
    await supabase
      .from("contacts")
      .update({ current_stage: "researched" })
      .eq("id", contactId);
  }

  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/contacts");

  return {
    error: null,
    cached: false,
    message: "Web research saved.",
  };
}

// ── Research notes ─────────────────────────────────────────────────────

export type ResearchNotesState = {
  error: string | null;
  saved: boolean;
};

/**
 * Save the contact's user-supplied research notes. These are free-form,
 * meant to supplement Apollo / Tavily / etc. The drafting prompt treats
 * them as authoritative first-hand observations.
 */
export async function saveResearchNotes(
  _prevState: ResearchNotesState,
  formData: FormData,
): Promise<ResearchNotesState> {
  const contactId = String(formData.get("contactId") ?? "");
  if (!contactId) return { error: "Missing contact id.", saved: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", saved: false };

  const notes = String(formData.get("research_notes") ?? "").trim() || null;

  const { error } = await supabase
    .from("contacts")
    .update({ research_notes: notes })
    .eq("id", contactId);

  if (error) return { error: error.message, saved: false };

  revalidatePath(`/contacts/${contactId}`);
  return { error: null, saved: true };
}

// ── Email drafting ─────────────────────────────────────────────────────

export type DraftState = {
  error: string | null;
  draft: Draft | null;
};

/**
 * Generate a Claude-drafted outreach email for a contact, using whatever
 * research we already have on file (no Apollo call here — purely uses
 * cached artifacts).
 *
 * Draft is NOT persisted in this version. User sees it; we'll persist
 * (and let them edit / push to Outlook Drafts) in a follow-up.
 */
export async function draftEmail(
  _prevState: DraftState,
  formData: FormData,
): Promise<DraftState> {
  const contactId = String(formData.get("contactId") ?? "");
  if (!contactId) {
    return { error: "Missing contact id.", draft: null };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in.", draft: null };
  }

  // Parallel fetches: contact, latest Apollo, latest Tavily, sender profile
  const [contactRes, apolloRes, tavilyRes, profileRes] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        `id, name, title, linkedin_url, notes, research_notes, current_stage,
         company:companies(name, industry)`,
      )
      .eq("id", contactId)
      .maybeSingle(),
    supabase
      .from("research_artifacts")
      .select("payload")
      .eq("contact_id", contactId)
      .eq("source", "apollo")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("research_artifacts")
      .select("payload")
      .eq("contact_id", contactId)
      .eq("source", "tavily")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("bio, resume_text, outreach_goal, linkedin_url")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  if (contactRes.error) {
    return {
      error: `Couldn't load contact: ${contactRes.error.message}`,
      draft: null,
    };
  }
  const contact = contactRes.error ? null : contactRes.data;
  if (!contact) {
    return { error: "Contact not found.", draft: null };
  }

  const latestApollo = apolloRes.data;
  const latestTavily = tavilyRes.data;
  const profile = profileRes.data;

  const company = Array.isArray(contact.company)
    ? (contact.company[0] ?? null)
    : ((contact.company as { name: string; industry: string | null } | null) ??
      null);

  let draft: Draft;
  try {
    draft = await draftOutreachEmail({
      contactName: contact.name,
      contactTitle: contact.title,
      companyName: company?.name ?? null,
      companyIndustry: company?.industry ?? null,
      linkedinUrl: contact.linkedin_url,
      apolloPayload: latestApollo?.payload ?? null,
      tavilyPayload: latestTavily?.payload ?? null,
      userNotes: contact.notes,
      researchNotes: contact.research_notes ?? null,
      sender: {
        bio: profile?.bio ?? null,
        resumeText: profile?.resume_text ?? null,
        outreachGoal: profile?.outreach_goal ?? null,
        linkedinUrl: profile?.linkedin_url ?? null,
      },
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Drafting failed.",
      draft: null,
    };
  }

  // Auto-advance researched -> drafted so the stage reflects reality
  if (contact.current_stage === "researched") {
    await supabase
      .from("contacts")
      .update({ current_stage: "drafted" })
      .eq("id", contactId);
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath("/contacts");
  }

  return { error: null, draft };
}
