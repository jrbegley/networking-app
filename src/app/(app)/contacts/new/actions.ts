"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/pipeline";
import {
  scrapeLinkedInProfile,
  type LinkedInProfile,
} from "@/lib/apify";

// Server actions in this file may call Apify (10-30s). This config is
// read at the route segment level so we need it here too.
export const maxDuration = 60;

function isValidStage(value: string): value is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(value);
}

export type CreateContactState = {
  error: string | null;
  success: { contactId: string; name: string } | null;
};

// ── Preview action ──────────────────────────────────────────────────────

export type PreviewResult = {
  person: LinkedInProfile | null;
  /** Full profile payload — carried through a hidden form field and saved
   *  as a research_artifact on contact insert. No second API call. */
  payload: LinkedInProfile | null;
  error: string | null;
};

/**
 * Scrape a LinkedIn URL via Apify and return the profile for pre-filling
 * the Add Contact form. Costs $0.004 per call. No DB cache available yet
 * (no contact_id to cache against) — we persist it at save time instead.
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
    return { person: null, payload: null, error: "Paste a LinkedIn URL first." };
  }
  if (!url.startsWith("http")) {
    return {
      person: null,
      payload: null,
      error: "URL should start with http:// or https://",
    };
  }

  try {
    const profile = await scrapeLinkedInProfile(url);
    if (!profile) {
      return {
        person: null,
        payload: null,
        error: "Apify returned no profile for that URL. Fill in manually.",
      };
    }
    return { person: profile, payload: profile, error: null };
  } catch (e) {
    return {
      person: null,
      payload: null,
      error: e instanceof Error ? e.message : "LinkedIn lookup failed.",
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

  // Parse the optional LinkedIn payload carried through the hidden field.
  // Failure here must NOT block the save.
  let linkedinPayload: LinkedInProfile | null = null;
  if (apolloPayloadRaw) {
    try {
      linkedinPayload = JSON.parse(apolloPayloadRaw) as LinkedInProfile;
    } catch {
      linkedinPayload = null;
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
      source: linkedinPayload ? "linkedin_lookup" : "manual",
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

  // ── Persist LinkedIn artifact (best effort — don't fail the save) ───────
  if (linkedinPayload) {
    await supabase.from("research_artifacts").insert({
      owner_id: user.id,
      contact_id: contact.id,
      source: "linkedin",
      payload: linkedinPayload,
    });
  }

  revalidatePath("/dashboard");
  revalidatePath("/contacts");

  return {
    error: null,
    success: { contactId: contact.id, name: contact.name },
  };
}
