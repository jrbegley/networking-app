"use server";

import { createClient } from "@/lib/supabase/server";
import { enrichPersonByLinkedInUrl } from "@/lib/apollo";
import {
  searchTavily,
  extractTavily,
  type TavilyResearchPayload,
  type TavilyNamedSearch,
} from "@/lib/tavily";
import { scrapeLinkedInProfile } from "@/lib/apify";
import { isApolloShellResponse } from "@/lib/apollo-summary";
import {
  draftOutreachEmail,
  refineOutreachEmail,
  type Draft,
  type DraftContext,
} from "@/lib/claude";
import { revalidatePath } from "next/cache";
import { createOutlookDraft } from "@/lib/graph";

// NB: maxDuration lives on page.tsx — server-action files can only export
// async functions, not constants.

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

// ── LinkedIn enrichment via Apify (HarvestAPI) ─────────────────────────

export type LinkedInEnrichState = {
  error: string | null;
  cached: boolean;
  message: string | null;
};

// LinkedIn profile data changes slowly; 90-day cache cuts cost ~12x at
// our volume vs. re-scraping monthly.
const LINKEDIN_CACHE_FRESH_DAYS = 90;

export async function enrichWithLinkedin(
  _prevState: LinkedInEnrichState,
  formData: FormData,
): Promise<LinkedInEnrichState> {
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
    .select("id, linkedin_url, email, title, current_stage, company_id, name")
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
      error: "Add a LinkedIn URL to this contact first.",
      cached: false,
      message: null,
    };
  }

  // Cache check
  const cutoff = new Date(
    Date.now() - LINKEDIN_CACHE_FRESH_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: cached } = await supabase
    .from("research_artifacts")
    .select("id, created_at")
    .eq("contact_id", contactId)
    .eq("source", "linkedin")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached) {
    return {
      error: null,
      cached: true,
      message: `Using cached LinkedIn data (fetched ${new Date(cached.created_at).toLocaleDateString()}). No credit burned.`,
    };
  }

  let profile;
  try {
    profile = await scrapeLinkedInProfile(contact.linkedin_url);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "LinkedIn scrape failed.",
      cached: false,
      message: null,
    };
  }

  if (!profile) {
    // Save a negative-cache so we don't keep burning credits on bad URLs
    await supabase.from("research_artifacts").insert({
      owner_id: user.id,
      contact_id: contactId,
      source: "linkedin",
      payload: { empty: true },
    });
    return {
      error: "Apify returned no profile for that URL.",
      cached: false,
      message: null,
    };
  }

  const { error: artifactErr } = await supabase
    .from("research_artifacts")
    .insert({
      owner_id: user.id,
      contact_id: contactId,
      source: "linkedin",
      payload: profile,
    });
  if (artifactErr) {
    return {
      error: `Couldn't save LinkedIn data: ${artifactErr.message}`,
      cached: false,
      message: null,
    };
  }

  // Backfill / update contact fields from the scraped profile.
  // HarvestAPI fields: experience[0].position = title, experience[0].companyName = company
  const exp = Array.isArray((profile as Record<string, unknown>)["experience"])
    ? ((profile as Record<string, unknown>)["experience"] as Record<string, unknown>[])
    : [];
  const currentJob = exp[0] ?? null;

  const scrapedTitle =
    (typeof currentJob?.["position"] === "string" ? currentJob["position"] : null) ??
    profile.headline ??
    null;
  const scrapedCompany =
    typeof currentJob?.["companyName"] === "string"
      ? (currentJob["companyName"] as string).trim()
      : null;

  const contactUpdate: Record<string, unknown> = {};
  if (!contact.title && scrapedTitle) contactUpdate.title = scrapedTitle;
  if (contact.current_stage === "identified") {
    contactUpdate.current_stage = "researched";
  }

  // ── Auto-update company from LinkedIn ─────────────────────────────────
  // Always sync the company when LinkedIn returns one — even if we already
  // have a company_id, the scraped data is more authoritative.
  if (scrapedCompany) {
    const { data: existingCompany } = await supabase
      .from("companies")
      .select("id")
      .eq("owner_id", user.id)
      .eq("name", scrapedCompany)
      .maybeSingle();

    let companyId: string;
    if (existingCompany) {
      companyId = existingCompany.id;
    } else {
      const { data: newCompany } = await supabase
        .from("companies")
        .insert({ owner_id: user.id, name: scrapedCompany })
        .select("id")
        .single();
      companyId = newCompany?.id;
    }
    if (companyId && companyId !== contact.company_id) {
      contactUpdate.company_id = companyId;
    }
  }

  if (Object.keys(contactUpdate).length > 0) {
    await supabase.from("contacts").update(contactUpdate).eq("id", contactId);
  }

  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/contacts");

  return {
    error: null,
    cached: false,
    message: "LinkedIn profile saved.",
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
      `id, name, title, linkedin_url, current_stage,
       company:companies(name, domain)`,
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
    : ((contact.company as { name: string; domain: string | null } | null) ??
      null);

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

  // Goal: surface coffee-chat-worthy material, not "verify identity."
  // Two queries:
  //   personQuery — what the person has authored / spoken about publicly
  //   firmQuery   — recent firm news/initiatives
  // The person query stays in "general" topic (catches podcasts, transcripts,
  // talks). The firm query uses news topic + recency window.

  const NOISY_DOMAINS = [
    "rocketreach.co",
    "zoominfo.com",
    "signalhire.com",
    "contactout.com",
    "apollo.io",
    "wikipedia.org",
    "imdb.com",
  ];

  const firmQuery = company?.name
    ? `"${company.name}" (announces OR launches OR raises OR acquires OR partners OR report OR initiative)`
    : null;

  if (!firmQuery) {
    return {
      error: "Add a company to this contact before running web research.",
      cached: false,
      message: null,
    };
  }

  // Extract the firm's /about page when we have a domain — often surfaces
  // strategy language worth referencing in outreach.
  const aboutUrl = company?.domain
    ? `https://${company.domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/about`
    : null;

  const [firmSettled, extractSettled] = await Promise.allSettled([
    searchTavily(firmQuery, {
      excludeDomains: NOISY_DOMAINS,
      maxResults: 7,
      topic: "news",
      days: 180,
    }),
    aboutUrl ? extractTavily([aboutUrl]) : Promise.resolve(null),
  ]);

  const firmResult =
    firmSettled.status === "fulfilled" ? firmSettled.value : null;
  const extractResult =
    extractSettled.status === "fulfilled" ? extractSettled.value : null;
  const firstErr =
    firmSettled.status === "rejected" ? String(firmSettled.reason) : null;

  if (!firmResult && !extractResult) {
    return {
      error: firstErr ?? "Tavily call failed.",
      cached: false,
      message: null,
    };
  }

  const searches: TavilyNamedSearch[] = [
    { label: "firm", query: firmQuery, result: firmResult },
  ];

  const payload: TavilyResearchPayload = {
    query: firmQuery,
    searches,
    extract: extractResult,
  };

  const { error: artifactErr } = await supabase
    .from("research_artifacts")
    .insert({
      owner_id: user.id,
      contact_id: contactId,
      source: "tavily",
      payload,
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

  // Compose a status message that reflects what actually came back
  const extractCount = extractResult?.results?.length ?? 0;
  const firmCount = firmResult?.results?.length ?? 0;
  const bits: string[] = [];
  if (firmCount > 0 && company?.name) {
    bits.push(`${firmCount} results on ${company.name}`);
  }
  if (extractCount > 0) {
    bits.push(`extracted ${extractCount} page${extractCount === 1 ? "" : "s"}`);
  }
  const msg =
    bits.length > 0
      ? `Saved: ${bits.join(", ")}.`
      : "Saved. Tavily found no useful data.";

  return { error: null, cached: false, message: msg };
}

// ── Edit contact ──────────────────────────────────────────────────────

export type EditContactState = {
  error: string | null;
  saved: boolean;
};

export async function editContact(
  _prevState: EditContactState,
  formData: FormData,
): Promise<EditContactState> {
  const contactId = String(formData.get("contactId") ?? "");
  if (!contactId) return { error: "Missing contact id.", saved: false };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", saved: false };

  const name = String(formData.get("name") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const linkedinUrl = String(formData.get("linkedin_url") ?? "").trim() || null;
  const companyName = String(formData.get("company") ?? "").trim();
  const stage = String(formData.get("stage") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!name) return { error: "Name is required.", saved: false };

  // Resolve company
  let companyId: string | null = null;
  if (companyName) {
    const { data: existing } = await supabase
      .from("companies")
      .select("id")
      .eq("owner_id", user.id)
      .eq("name", companyName)
      .maybeSingle();

    if (existing) {
      companyId = existing.id;
    } else {
      const { data: created } = await supabase
        .from("companies")
        .insert({ owner_id: user.id, name: companyName })
        .select("id")
        .single();
      companyId = created?.id ?? null;
    }
  }

  const { error } = await supabase
    .from("contacts")
    .update({
      name,
      title,
      email,
      linkedin_url: linkedinUrl,
      company_id: companyId,
      current_stage: stage || undefined,
      notes,
    })
    .eq("id", contactId);

  if (error) return { error: error.message, saved: false };

  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return { error: null, saved: true };
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

export type DraftResult = {
  error: string | null;
  draft: Draft | null;
};

export type SaveDraftResult = {
  error: string | null;
  saved: boolean;
};

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

/**
 * Load everything the drafter needs for a contact: contact fields, the latest
 * LinkedIn + Apollo artifacts, and the sender's profile. Shared by generate
 * and refine. Tavily is intentionally excluded — its firm research was
 * producing hallucinated specifics in the email body.
 */
async function loadDraftContext(
  supabase: SupabaseServer,
  userId: string,
  contactId: string,
): Promise<
  | { error: string; context: null; currentStage: null }
  | { error: null; context: DraftContext; currentStage: string }
> {
  const [contactRes, linkedinRes, apolloRes, profileRes] = await Promise.all([
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
      .eq("source", "linkedin")
      .order("created_at", { ascending: false })
      .limit(1)
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
      .from("profiles")
      .select("bio, resume_text, outreach_goal, linkedin_url")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  if (contactRes.error) {
    return {
      error: `Couldn't load contact: ${contactRes.error.message}`,
      context: null,
      currentStage: null,
    };
  }
  const contact = contactRes.data;
  if (!contact) {
    return { error: "Contact not found.", context: null, currentStage: null };
  }

  const company = Array.isArray(contact.company)
    ? (contact.company[0] ?? null)
    : ((contact.company as { name: string; industry: string | null } | null) ??
      null);
  const profile = profileRes.data;

  return {
    error: null,
    currentStage: contact.current_stage,
    context: {
      contactName: contact.name,
      contactTitle: contact.title,
      companyName: company?.name ?? null,
      companyIndustry: company?.industry ?? null,
      linkedinUrl: contact.linkedin_url,
      linkedinPayload: linkedinRes.data?.payload ?? null,
      apolloPayload: apolloRes.data?.payload ?? null,
      tavilyPayload: null,
      userNotes: contact.notes,
      researchNotes: contact.research_notes ?? null,
      sender: {
        bio: profile?.bio ?? null,
        resumeText: profile?.resume_text ?? null,
        outreachGoal: profile?.outreach_goal ?? null,
        linkedinUrl: profile?.linkedin_url ?? null,
      },
    },
  };
}

/** Persist the single current draft on the contact row. */
async function persistDraft(
  supabase: SupabaseServer,
  contactId: string,
  draft: Draft,
): Promise<void> {
  await supabase
    .from("contacts")
    .update({
      draft_subject: draft.subject,
      draft_body: draft.body,
      draft_updated_at: new Date().toISOString(),
    })
    .eq("id", contactId);
}

/**
 * Generate a Claude-drafted outreach email for a contact, using cached
 * research (no fresh Apollo call). Persists the result as the contact's
 * current draft and advances researched -> drafted.
 */
export async function generateDraftForContact(
  contactId: string,
): Promise<DraftResult> {
  if (!contactId) return { error: "Missing contact id.", draft: null };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", draft: null };

  const loaded = await loadDraftContext(supabase, user.id, contactId);
  if (!loaded.context) return { error: loaded.error, draft: null };

  let draft: Draft;
  try {
    draft = await draftOutreachEmail(loaded.context);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Drafting failed.",
      draft: null,
    };
  }

  await persistDraft(supabase, contactId, draft);

  if (loaded.currentStage === "researched") {
    await supabase
      .from("contacts")
      .update({ current_stage: "drafted" })
      .eq("id", contactId);
  }
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/contacts");

  return { error: null, draft };
}

/**
 * Revise the contact's current draft per a free-form instruction. Operates on
 * the subject/body currently in the editor (which may have unsaved manual
 * edits) and persists the revised result.
 */
export async function refineDraftForContact(
  contactId: string,
  instruction: string,
  currentSubject: string,
  currentBody: string,
): Promise<DraftResult> {
  if (!contactId) return { error: "Missing contact id.", draft: null };
  if (!instruction.trim()) {
    return { error: "Tell Claude what to change.", draft: null };
  }
  if (!currentBody.trim()) {
    return { error: "Generate a draft first.", draft: null };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", draft: null };

  const loaded = await loadDraftContext(supabase, user.id, contactId);
  if (!loaded.context) return { error: loaded.error, draft: null };

  let draft: Draft;
  try {
    draft = await refineOutreachEmail({
      ...loaded.context,
      currentSubject,
      currentBody,
      instruction,
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Refine failed.",
      draft: null,
    };
  }

  await persistDraft(supabase, contactId, draft);
  revalidatePath(`/contacts/${contactId}`);

  return { error: null, draft };
}

// ── Outlook send ──────────────────────────────────────────────────────

export type OutlookDraftResult = {
  error: string | null;
  webLink: string | null;
};

/**
 * Push the contact's current draft into the connected Outlook Drafts folder
 * via Microsoft Graph. Does NOT send — the user reviews and sends from
 * Outlook. Logs an interaction row and advances the stage to 'sent' only
 * after the user actually sends (not tracked yet; for now we advance to
 * 'drafted' already; stage advancement here is intentionally deferred).
 */
export async function sendToOutlookDrafts(
  contactId: string,
  subject: string,
  body: string,
): Promise<OutlookDraftResult> {
  if (!contactId) return { error: "Missing contact id.", webLink: null };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", webLink: null };

  // Load contact to get recipient info
  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select("name, email")
    .eq("id", contactId)
    .maybeSingle();

  if (contactErr || !contact) {
    return { error: "Couldn't load contact.", webLink: null };
  }
  if (!contact.email) {
    return {
      error: "This contact has no email address. Add one before sending.",
      webLink: null,
    };
  }

  const result = await createOutlookDraft(user.id, subject, body, {
    name: contact.name,
    email: contact.email,
  });

  if (result.error) return { error: result.error, webLink: null };

  // Log an interaction row so the timeline knows a draft was pushed
  await supabase.from("interactions").insert({
    owner_id: user.id,
    contact_id: contactId,
    type: "email_sent",
    subject,
    body,
    outlook_message_id: result.messageId ?? null,
    occurred_at: new Date().toISOString(),
  });

  revalidatePath(`/contacts/${contactId}`);
  return { error: null, webLink: result.webLink };
}

/** Save a manually edited draft (subject + body) as the contact's current draft. */
export async function saveDraftForContact(
  contactId: string,
  subject: string,
  body: string,
): Promise<SaveDraftResult> {
  if (!contactId) return { error: "Missing contact id.", saved: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", saved: false };

  const { error } = await supabase
    .from("contacts")
    .update({
      draft_subject: subject.trim() || null,
      draft_body: body,
      draft_updated_at: new Date().toISOString(),
    })
    .eq("id", contactId);

  if (error) return { error: error.message, saved: false };

  revalidatePath(`/contacts/${contactId}`);
  return { error: null, saved: true };
}
