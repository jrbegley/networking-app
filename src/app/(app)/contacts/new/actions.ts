"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const PIPELINE_STAGES = [
  "identified",
  "researched",
  "drafted",
  "sent",
  "replied",
  "meeting_scheduled",
  "meeting_held",
  "nurture",
  "dormant",
] as const;

type PipelineStage = (typeof PIPELINE_STAGES)[number];

function isValidStage(value: string): value is PipelineStage {
  return (PIPELINE_STAGES as readonly string[]).includes(value);
}

export type CreateContactState = {
  error: string | null;
  success: { contactId: string; name: string } | null;
};

/**
 * Server action that creates a contact and (if a company name was provided)
 * either finds or creates the matching company.
 *
 * RLS handles the per-user isolation — we just need to set owner_id on every
 * insert. If the user isn't authenticated, the action returns an error
 * (the (app) layout would normally redirect them, but defense in depth).
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

  if (!name) {
    return { error: "Name is required.", success: null };
  }
  if (!isValidStage(stageRaw)) {
    return { error: "Invalid pipeline stage.", success: null };
  }
  const stage: PipelineStage = stageRaw;

  // Light validation on optional URL/email so we surface obvious typos early
  if (email && !email.includes("@")) {
    return { error: "Email looks invalid.", success: null };
  }
  if (linkedinUrl && !linkedinUrl.startsWith("http")) {
    return {
      error: "LinkedIn URL should start with http:// or https://",
      success: null,
    };
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
      source: "manual",
      notes,
    })
    .select("id, name")
    .single();

  if (contactErr) {
    // Unique-violation on (owner_id, linkedin_url) is the most common collision
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

  // Make sure any list views re-fetch with the new row
  revalidatePath("/dashboard");
  revalidatePath("/contacts");

  return {
    error: null,
    success: { contactId: contact.id, name: contact.name },
  };
}
