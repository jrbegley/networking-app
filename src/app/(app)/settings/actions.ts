"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  enrichPersonByLinkedInUrl,
  type ApolloPerson,
} from "@/lib/apollo";
import { disconnectOutlook } from "@/lib/graph";

export type ProfileFormState = {
  error: string | null;
  saved: boolean;
};

// ── Cadence rules ──────────────────────────────────────────────────────

export type CadenceActionResult = { error: string | null };

export async function addCadenceRule(
  triggerStage: string,
  waitDays: number,
): Promise<CadenceActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  if (!Number.isInteger(waitDays) || waitDays < 1 || waitDays > 365) {
    return { error: "Wait must be between 1 and 365 days." };
  }

  const { error } = await supabase.from("cadence_rules").insert({
    owner_id: user.id,
    name: `After ${triggerStage}, wait ${waitDays} day${waitDays === 1 ? "" : "s"}`,
    trigger_stage: triggerStage,
    wait_days: waitDays,
    enabled: true,
  });
  if (error) return { error: error.message };

  revalidatePath("/settings");
  revalidatePath("/contacts");
  return { error: null };
}

export async function setCadenceRuleEnabled(
  ruleId: string,
  enabled: boolean,
): Promise<CadenceActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("cadence_rules")
    .update({ enabled })
    .eq("id", ruleId);
  if (error) return { error: error.message };

  revalidatePath("/settings");
  revalidatePath("/contacts");
  return { error: null };
}

export async function deleteCadenceRule(
  ruleId: string,
): Promise<CadenceActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("cadence_rules")
    .delete()
    .eq("id", ruleId);
  if (error) return { error: error.message };

  revalidatePath("/settings");
  revalidatePath("/contacts");
  return { error: null };
}

export type RecordResumeState = {
  error: string | null;
  saved: boolean;
};

/**
 * Called right after a client-side resume upload to Supabase Storage
 * succeeds. Updates the profile with the filename and timestamp so the
 * settings UI can show "Current resume: <name>".
 *
 * Also persists the parsed resume text when provided, so the user doesn't
 * have to remember to hit Save separately — otherwise the PDF metadata
 * saves but the actual text the drafter needs is left only in the textarea
 * and never reaches the DB.
 */
export async function recordResumeUpload(
  filename: string,
  resumeText?: string,
): Promise<RecordResumeState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", saved: false };

  const update: Record<string, unknown> = {
    resume_pdf_name: filename,
    resume_pdf_uploaded_at: new Date().toISOString(),
  };
  // Only overwrite resume_text when we actually parsed something — a failed
  // parse shouldn't wipe text the user already had.
  if (resumeText && resumeText.trim()) {
    update.resume_text = resumeText.trim();
  }

  const { error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", user.id);

  if (error) return { error: error.message, saved: false };

  revalidatePath("/settings");
  return { error: null, saved: true };
}

/**
 * Issue a short-lived signed URL for the user's resume PDF so they can
 * download/view it from the settings page. Signed URLs respect RLS so we
 * couldn't accidentally hand out another user's file even if we tried.
 */
export async function getResumeDownloadUrl(): Promise<{
  url: string | null;
  error: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { url: null, error: "Not signed in." };

  const path = `${user.id}/resume.pdf`;
  const { data, error } = await supabase.storage
    .from("resumes")
    .createSignedUrl(path, 60);

  if (error) return { url: null, error: error.message };
  return { url: data.signedUrl, error: null };
}

/**
 * Delete the user's resume PDF and clear the metadata columns.
 */
export async function deleteResume(): Promise<RecordResumeState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", saved: false };

  const path = `${user.id}/resume.pdf`;
  await supabase.storage.from("resumes").remove([path]);

  const { error } = await supabase
    .from("profiles")
    .update({
      resume_pdf_name: null,
      resume_pdf_uploaded_at: null,
    })
    .eq("id", user.id);

  if (error) return { error: error.message, saved: false };

  revalidatePath("/settings");
  return { error: null, saved: true };
}

export type RecordCoverLetterTemplateState = {
  error: string | null;
  saved: boolean;
};

/**
 * Called right after a client-side cover-letter template upload to
 * Supabase Storage succeeds. Updates the profile with the filename and
 * timestamp so the settings UI can show "Current template: <name>".
 */
export async function recordCoverLetterTemplate(
  filename: string,
): Promise<RecordCoverLetterTemplateState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", saved: false };

  const { error } = await supabase
    .from("profiles")
    .update({
      cover_letter_template_name: filename,
      cover_letter_template_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) return { error: error.message, saved: false };

  revalidatePath("/settings");
  return { error: null, saved: true };
}

/**
 * Issue a short-lived signed URL for the user's cover-letter template so
 * they can view/download it from the settings page. Signed URLs respect
 * RLS so we couldn't accidentally hand out another user's file even if we
 * tried.
 */
export async function coverLetterTemplateUrl(): Promise<{
  url: string | null;
  error: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { url: null, error: "Not signed in." };

  const path = `${user.id}/template.docx`;
  const { data, error } = await supabase.storage
    .from("cover-letter-templates")
    .createSignedUrl(path, 60);

  if (error) return { url: null, error: error.message };
  return { url: data.signedUrl, error: null };
}

/**
 * Delete the user's cover-letter template and clear the metadata columns.
 */
export async function clearCoverLetterTemplate(): Promise<RecordCoverLetterTemplateState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", saved: false };

  const path = `${user.id}/template.docx`;
  await supabase.storage.from("cover-letter-templates").remove([path]);

  const { error } = await supabase
    .from("profiles")
    .update({
      cover_letter_template_name: null,
      cover_letter_template_at: null,
    })
    .eq("id", user.id);

  if (error) return { error: error.message, saved: false };

  revalidatePath("/settings");
  return { error: null, saved: true };
}

/**
 * Update the signed-in user's profile background fields.
 * RLS already restricts them to their own row, but we also scope by id
 * defensively.
 */
export async function saveProfile(
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in.", saved: false };
  }

  const displayName =
    String(formData.get("display_name") ?? "").trim() || null;
  const bio = String(formData.get("bio") ?? "").trim() || null;
  const resumeText = String(formData.get("resume_text") ?? "").trim() || null;
  const outreachGoal =
    String(formData.get("outreach_goal") ?? "").trim() || null;
  const linkedinUrlRaw = String(formData.get("linkedin_url") ?? "").trim();
  const linkedinUrl = linkedinUrlRaw || null;

  if (linkedinUrl && !linkedinUrl.startsWith("http")) {
    return {
      error: "LinkedIn URL should start with http:// or https://",
      saved: false,
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      bio,
      resume_text: resumeText,
      outreach_goal: outreachGoal,
      linkedin_url: linkedinUrl,
    })
    .eq("id", user.id);

  if (error) {
    return { error: `Couldn't save: ${error.message}`, saved: false };
  }

  revalidatePath("/settings");
  return { error: null, saved: true };
}

// ── Scan-my-LinkedIn ───────────────────────────────────────────────────────

export type ScanLinkedInResult = {
  error: string | null;
  bio: string | null;
  resumeText: string | null;
};

/**
 * Look up the signed-in user's OWN LinkedIn URL via Apollo and return
 * suggested values for the bio + resume_text fields. Does NOT save —
 * the user reviews the suggestions and saves manually so they keep control
 * over what gets stored.
 *
 * Burns one Apollo credit per call.
 */
export async function scanMyLinkedIn(
  linkedinUrl: string,
): Promise<ScanLinkedInResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in.", bio: null, resumeText: null };
  }

  const url = linkedinUrl.trim();
  if (!url) {
    return {
      error: "Paste your LinkedIn URL first.",
      bio: null,
      resumeText: null,
    };
  }
  if (!url.startsWith("http")) {
    return {
      error: "URL should start with http:// or https://",
      bio: null,
      resumeText: null,
    };
  }

  let response;
  try {
    response = await enrichPersonByLinkedInUrl(url);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Lookup failed.",
      bio: null,
      resumeText: null,
    };
  }

  const person = response.person;
  if (!person) {
    return {
      error: "Apollo couldn't find a match for that URL.",
      bio: null,
      resumeText: null,
    };
  }

  return {
    error: null,
    bio: buildBioFromApollo(person),
    resumeText: buildResumeFromApollo(person),
  };
}

function buildBioFromApollo(p: ApolloPerson): string | null {
  const parts: string[] = [];
  if (p.title && p.organization?.name) {
    parts.push(`${p.title} at ${p.organization.name}.`);
  } else if (p.title) {
    parts.push(`${p.title}.`);
  }
  const loc = [p.city, p.state, p.country].filter(Boolean).join(", ");
  if (loc) parts.push(`Based in ${loc}.`);
  return parts.length > 0 ? parts.join(" ") : null;
}

function buildResumeFromApollo(p: ApolloPerson): string | null {
  const lines: string[] = [];

  // Current role first (if not already in employment_history)
  if (p.title && p.organization?.name) {
    lines.push(`EXPERIENCE`);
    lines.push(`- ${p.title} at ${p.organization.name} (current)`);
    if (p.organization.industry) {
      lines.push(`  Industry: ${p.organization.industry}`);
    }
  }

  if (p.employment_history && p.employment_history.length > 0) {
    if (lines.length === 0) lines.push(`EXPERIENCE`);
    for (const job of p.employment_history) {
      const title = job.title ?? "";
      const org = job.organization_name ?? "";
      const start = job.start_date ?? "";
      const end = job.end_date ?? "present";
      if (title && org) {
        lines.push(`- ${title} at ${org} (${start} – ${end})`);
      }
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

// ── Outlook disconnect ─────────────────────────────────────────────────

export type DisconnectOutlookResult = {
  error: string | null;
};

export async function disconnectOutlookAction(): Promise<DisconnectOutlookResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  try {
    await disconnectOutlook(user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Disconnect failed." };
  }

  revalidatePath("/settings");
  return { error: null };
}
