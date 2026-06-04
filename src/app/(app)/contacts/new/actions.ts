"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/pipeline";
import {
  enrichPersonByLinkedInUrl,
  type ApolloMatchResponse,
  type ApolloPerson,
} from "@/lib/apollo";

function isValidStage(value: string): value is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(value);
}

export type CreateContactState = {
  error: string | null;
  success: { contactId: string; name: string } | null;
};

// ── Preview action (called directly from client, not via form action) ──────

export type PreviewResult = {
  person: ApolloPerson | null;
  /** Full Apollo response — round-tripped through a hidden form field so we
   *  can save it as a research_artifact on the eventual contact insert,
   *  WITHOUT making a second API call. */
  payload: ApolloMatchResponse | null;
  error: string | null;
};

/**
 * Look up a LinkedIn URL via Apollo without saving anything.
 * Burns one Apollo credit per call (no DB cache available — no contact yet).
 * Caller must be authenticated.
 */
export async function previewLinkedIn(
  linkedinUrl: string,
): Promise<PreviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { person: null, payload: null, error: "Not signed in." };
  }

  const url = linkedinUrl.trim();
  if (!url) {
    return {
      person: null,
      payload: null,
      error: "Paste a LinkedIn URL first.",
    };
  }
  if (!url.startsWith("http")) {
    return {
      person: null,
      payload: null,
      error: "URL should start with http:// or https://",
    };
  }

  try {
    const response = await enrichPersonByLinkedInUrl(url);
    if (!response.person) {
      return {
        person: null,
        payload: response,
        error:
          "Apollo couldn't find a match for that URL. You can still fill in manually.",
      };
    }
    return { person: response.person, payload: response, error: null };
  } catch (e) {
    return {
      person: null,
      payload: null,
      error: e instanceof Error ? e.message : "Lookup failed.",
    };
  }
}

// ── Create action ──────────────────────────────────────────────────────────

/**
 * Create a contact. If an apollo_payload hidden field is present, also
 * persist it as a research_artifact tied to the new contact and enrich
 * the linked company with the Apollo organization data.
 *
 * RLS handles per-user isolation — we just set owner_id on every insert.
 */
export async function createContact(
  _prevState: CreateContactState,
  formData: FormData,
): Promise<CreateContactState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in.", success: null };
  }

  // ── Parse & validate ────────────────────────────────────────────────────
  const name = String(formData.get("name") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim() || null;
  const companyName = String(formData.get("company") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const linkedinUrl =
    String(formData.get("linkedin_url") ?? "").trim() || null;
  const stageRaw = String(formData.get("stage") ?? "identified");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const apolloPayloadRaw = String(formData.get("apollo_payload") ?? "");

  if (!name) {
    return { error: "Name is required.", success: null };
  }
  if (!isValidStage(stageRaw)) {
    return { error: "Invalid pipeline stage.", success: null };
  }
  const stage: PipelineStage = stageRaw;

  if (email && !email.includes("@")) {
    return { error: "Email looks invalid.", success: null };
  }
  if (linkedinUrl && !linkedinUrl.startsWith("http")) {
    return {
      error: "LinkedIn URL should start with http:// or https://",
      success: null,
    };
  }

  // Parse the optional Apollo payload — failure here should NOT block the
  // save; we just won't have the artifact for this contact.
  let apolloPayload: ApolloMatchResponse | null = null;
  if (apolloPayloadRaw) {
    try {
      apolloPayload = JSON.parse(apolloPayloadRaw) as ApolloMatchResponse;
    } catch {
      apolloPayload = null;
    }
  }

  // ── Resolve company (find or create) ────────────────────────────────────
  let companyId: string | null = null;
  if (companyName) {
    const { data: existing, error: findErr } = await supabase
      .from("companies")
      .select("id")
      .eq("owner_id", user.id)
      .eq("name", companyName)
      .maybeSingle();

    if (findErr) {
      return {
        error: `Couldn't look up company: ${findErr.message}`,
        success: null,
      };
    }

    if (existing) {
      companyId = existing.id;
    } else {
      const { data: created, error: insertErr } = await supabase
        .from("companies")
        .insert({ owner_id: user.id, name: companyName })
        .select("id")
        .single();

      if (insertErr) {
        return {
          error: `Couldn't create company: ${insertErr.message}`,
          success: null,
        };
      }
      companyId = created.id;
    }
  }

  // ── Insert contact ──────────────────────────────────────────────────────
  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .insert({
      owner_id: user.id,
      company_id: companyId,
      name,
      title,
      email,
      linkedin_url: linkedinUrl,
      current_stage: stage,
      source: apolloPayload ? "apollo_lookup" : "manual",
      notes,
    })
    .select("id, name")
    .single();

  if (contactErr) {
    if (contactErr.code === "23505") {
      return {
        error:
          "You already have a contact with that LinkedIn URL. Open that contact instead.",
        success: null,
      };
    }
    return {
      error: `Couldn't save contact: ${contactErr.message}`,
      success: null,
    };
  }

  // ── Persist Apollo artifact and enrich company (best effort) ───────────
  if (apolloPayload) {
    // Best effort — we don't fail the save if either of these fails.
    await supabase.from("research_artifacts").insert({
      owner_id: user.id,
      contact_id: contact.id,
      source: "apollo",
      payload: apolloPayload,
    });

    if (companyId && apolloPayload.person?.organization) {
      const org = apolloPayload.person.organization;
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
          .eq("id", companyId);
      }
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/contacts");

  return {
    error: null,
    success: { contactId: contact.id, name: contact.name },
  };
}
