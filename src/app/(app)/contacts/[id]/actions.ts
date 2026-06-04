"use server";

import { createClient } from "@/lib/supabase/server";
import { enrichPersonByLinkedInUrl } from "@/lib/apollo";
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
  if (contact.current_stage === "identified") {
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
