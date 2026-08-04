"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from "@/lib/applications";
import {
  guardUrl,
  sourceFromHost,
  fetchPostingHtml,
  jobPostingFromJsonLd,
  htmlToText,
  THIN_CONTENT_CHARS,
  type JobPostingFields,
} from "@/lib/job-posting";
import {
  parseJobPosting,
  classifyLetterParagraphs,
  generateCoverLetter,
  refineCoverLetter,
} from "@/lib/claude";
import {
  extractParagraphs,
  templateExampleText,
  applyContent,
} from "@/lib/docx-template";
import type {
  CoverLetterContent,
  LetterClassification,
  CoverLetterContext,
} from "@/lib/cover-letter-types";

export type ActionResult = { error: string | null };

/**
 * Result of reading a posting from a URL or pasted text. Read-only: neither
 * producer writes to the DB. `needs_paste` signals the URL couldn't be read
 * and the UI should offer the paste-the-description fallback.
 */
export type ReadPostingResult =
  | {
      ok: true;
      fields: {
        company_name: string | null;
        role_title: string | null;
        location: string | null;
        deadline: string | null;
      };
      source: string | null;
    }
  | { ok: false; reason: string };

function isStatus(v: unknown): v is ApplicationStatus {
  return (
    typeof v === "string" &&
    (APPLICATION_STATUSES as readonly string[]).includes(v)
  );
}

/** YYYY-MM-DD or null; blank strings become null. */
function parseDate(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parseText(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

/**
 * Create an application. Links company_id when the typed company name matches
 * one of the user's existing companies (case-insensitive), so the tab can show
 * "people you know here" and the contact page can show "active application".
 */
export async function createApplication(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const companyName = parseText(formData.get("company_name"));
  const roleTitle = parseText(formData.get("role_title"));
  if (!companyName) return { error: "Company is required." };
  if (!roleTitle) return { error: "Role is required." };

  const statusRaw = formData.get("status");
  const status: ApplicationStatus = isStatus(statusRaw)
    ? statusRaw
    : "interested";

  // Match an existing company by name (case-insensitive) to link the row.
  const { data: match } = await supabase
    .from("companies")
    .select("id")
    .ilike("name", companyName)
    .limit(1)
    .maybeSingle();

  const appliedAt = parseDate(formData.get("applied_at"));

  const { data: inserted, error } = await supabase
    .from("applications")
    .insert({
      owner_id: user.id,
      company_id: match?.id ?? null,
      company_name: companyName,
      role_title: roleTitle,
      location: parseText(formData.get("location")),
      posting_url: parseText(formData.get("posting_url")),
      source: parseText(formData.get("source")),
      status,
      // Applying now? stamp the date if the user didn't pick one.
      applied_at:
        appliedAt ??
        (status !== "interested"
          ? new Date().toISOString().slice(0, 10)
          : null),
      deadline: parseDate(formData.get("deadline")),
      notes: parseText(formData.get("notes")),
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // The status-change trigger only fires on UPDATE, so seed the first
  // timeline event here for the creation status.
  if (inserted) {
    await supabase.from("application_events").insert({
      owner_id: user.id,
      application_id: inserted.id,
      status,
    });
  }

  revalidatePath("/applications");
  return { error: null };
}

/**
 * Change an application's status. The DB trigger stamps status_changed_at,
 * logs the timeline event, and back-fills heard_back_at on first response —
 * so this action just writes the new status.
 */
export async function setApplicationStatus(
  applicationId: string,
  status: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  if (!isStatus(status)) return { error: "Unknown status." };

  const { error } = await supabase
    .from("applications")
    .update({ status })
    .eq("id", applicationId);
  if (error) return { error: error.message };

  revalidatePath("/applications");
  return { error: null };
}

/** Patch editable fields (dates, url, location, notes). */
export async function updateApplication(
  applicationId: string,
  patch: {
    applied_at?: string | null;
    deadline?: string | null;
    heard_back_at?: string | null;
    posting_url?: string | null;
    location?: string | null;
    notes?: string | null;
  },
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === "applied_at" || k === "deadline" || k === "heard_back_at") {
      clean[k] = v ? String(v).slice(0, 10) : null;
    } else {
      clean[k] = v === "" ? null : v;
    }
  }
  if (Object.keys(clean).length === 0) return { error: null };

  const { error } = await supabase
    .from("applications")
    .update(clean)
    .eq("id", applicationId);
  if (error) return { error: error.message };

  revalidatePath("/applications");
  return { error: null };
}

/** Add a freeform note (or dated milestone) to an application's timeline. */
export async function addApplicationEvent(
  applicationId: string,
  note: string,
  occurredAt?: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const trimmed = note.trim();
  if (!trimmed) return { error: "Note can't be empty." };

  const occurred =
    occurredAt && /^\d{4}-\d{2}-\d{2}$/.test(occurredAt) ? occurredAt : null;

  const { error } = await supabase.from("application_events").insert({
    owner_id: user.id,
    application_id: applicationId,
    note: trimmed,
    ...(occurred ? { occurred_at: occurred } : {}),
  });
  if (error) return { error: error.message };

  revalidatePath("/applications");
  return { error: null };
}

/**
 * Read a job posting from its URL and pull out company / role / location /
 * deadline for review before saving. Read-only: no DB write, no revalidate.
 * Prefers embedded JSON-LD (deterministic) and only calls Claude when the
 * JSON-LD is incomplete. Any fetch failure maps to `needs_paste` so the UI
 * can offer the paste-the-description fallback.
 */
export async function readPostingFromUrl(
  url: string,
): Promise<ReadPostingResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: "Not signed in." };

    const guard = guardUrl(url);
    if (!guard.ok) {
      return {
        ok: false,
        reason: "That doesn't look like a job posting URL.",
      };
    }

    const host = guard.url.hostname;
    const today = new Date().toISOString().slice(0, 10);

    let html: string;
    try {
      html = await fetchPostingHtml(guard.url);
    } catch {
      return { ok: false, reason: "needs_paste" };
    }

    const jsonld = jobPostingFromJsonLd(html);

    let fields: JobPostingFields;
    if (jsonld && jsonld.company_name && jsonld.role_title) {
      // JSON-LD gave us the essentials — skip the Claude call entirely.
      fields = jsonld;
    } else {
      const text = htmlToText(html);
      if (text.length < THIN_CONTENT_CHARS) {
        return { ok: false, reason: "needs_paste" };
      }
      const parsed = await parseJobPosting(text, host, today);
      // Merge: a non-null JSON-LD value always wins over the parsed one.
      fields = {
        company_name: jsonld?.company_name ?? parsed.company_name,
        role_title: jsonld?.role_title ?? parsed.role_title,
        location: jsonld?.location ?? parsed.location,
        deadline: jsonld?.deadline ?? parsed.deadline,
      };
    }

    return { ok: true, fields, source: sourceFromHost(host) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Read a job posting from pasted description text (the fallback when a URL
 * can't be fetched). Read-only: no DB write, no revalidate. `url` is optional
 * and only used to derive the source label.
 */
export async function readPostingFromText(
  text: string,
  url?: string,
): Promise<ReadPostingResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: "Not signed in." };

    let host = "";
    if (url) {
      try {
        host = new URL(url).hostname;
      } catch {
        host = "";
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const parsed = await parseJobPosting(text, host, today);
    const source = url && host ? sourceFromHost(host) : null;

    return { ok: true, fields: parsed, source };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteApplication(
  applicationId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // application_events cascade-delete via the FK.
  const { error } = await supabase
    .from("applications")
    .delete()
    .eq("id", applicationId);
  if (error) return { error: error.message };

  revalidatePath("/applications");
  return { error: null };
}

// ── Cover-letter generation ────────────────────────────────────────────
// Shared logic for generate/refine/download/save/coverLetterDownloadUrl.
// Only saveCoverLetter writes to the DB and calls revalidatePath — the rest
// are read-only round-trips against Storage + Claude.

export type CoverLetterResult =
  | {
      ok: true;
      content: CoverLetterContent;
      classification: LetterClassification;
    }
  | { ok: false; reason: string };

type ApplicationLetterRow = {
  company_name: string;
  role_title: string;
  location: string | null;
  posting_url: string | null;
};

/**
 * True when an error looks like migration 009 hasn't been applied yet:
 * an undefined `cover_letter*` column, or a missing storage bucket.
 */
function isNotSetUpError(message: string): boolean {
  return (
    (/cover_letter/i.test(message) &&
      /column|schema cache|does not exist|could not find/i.test(message)) ||
    /bucket not found/i.test(message)
  );
}

/** Map a caught error to a CoverLetterResult-shaped failure reason. */
function coverLetterErrorReason(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return isNotSetUpError(message) ? "not_set_up" : message;
}

/**
 * Download the user's cover-letter template as raw bytes. Distinguishes
 * "migration not applied" (bucket missing) from "user hasn't uploaded a
 * template yet" (object missing) so the UI can show the right message.
 */
async function loadTemplateBytes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }> {
  const { data, error } = await supabase.storage
    .from("cover-letter-templates")
    .download(`${userId}/template.docx`);
  if (error || !data) {
    const message = error?.message ?? "";
    if (/bucket not found/i.test(message)) {
      return { ok: false, reason: "not_set_up" };
    }
    return { ok: false, reason: "no_template" };
  }
  return { ok: true, bytes: new Uint8Array(await data.arrayBuffer()) };
}

/**
 * Resolve the job description text for an application: the pasted text if
 * given, else fetched from posting_url via the same guard/fetch/clean chain
 * as the Add Application autofill. Any fetch failure or missing URL routes
 * to the paste fallback rather than failing the whole action.
 */
async function resolveJobDescription(
  postingUrl: string | null,
  pastedJd?: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: "needs_paste" }> {
  if (pastedJd && pastedJd.trim()) return { ok: true, text: pastedJd.trim() };
  if (!postingUrl) return { ok: false, reason: "needs_paste" };
  const guard = guardUrl(postingUrl);
  if (!guard.ok) return { ok: false, reason: "needs_paste" };
  try {
    const html = await fetchPostingHtml(guard.url);
    const text = htmlToText(html);
    if (!text) return { ok: false, reason: "needs_paste" };
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "needs_paste" };
  }
}

async function loadApplicationRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  applicationId: string,
): Promise<ApplicationLetterRow> {
  const { data, error } = await supabase
    .from("applications")
    .select("company_name, role_title, location, posting_url")
    .eq("id", applicationId)
    .single();
  if (error) throw error;
  return data as ApplicationLetterRow;
}

async function loadResumeText(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("resume_text")
    .eq("id", userId)
    .maybeSingle();
  return (data?.resume_text as string | null) ?? null;
}

/**
 * Generate a cover letter for an application from the user's uploaded
 * template. Read-only: no DB write, no revalidate — the caller downloads or
 * explicitly saves. `pastedJd` supplies the job description when the
 * posting URL can't be fetched.
 */
export async function generateCoverLetterForApplication(
  applicationId: string,
  pastedJd?: string,
): Promise<CoverLetterResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: "Not signed in." };

    const template = await loadTemplateBytes(supabase, user.id);
    if (!template.ok) return template;

    const row = await loadApplicationRow(supabase, applicationId);

    const jd = await resolveJobDescription(row.posting_url, pastedJd);
    if (!jd.ok) return jd;

    const resumeText = await loadResumeText(supabase, user.id);

    const ctx: CoverLetterContext = {
      templateText: templateExampleText(template.bytes),
      resumeText,
      jobDescription: jd.text,
      companyName: row.company_name,
      roleTitle: row.role_title,
      location: row.location,
      today: new Date().toISOString().slice(0, 10),
    };

    const paragraphs = extractParagraphs(template.bytes);
    const classification = await classifyLetterParagraphs(paragraphs);
    if (classification.bodyStart < 0) {
      return { ok: false, reason: "unreadable_template" };
    }

    const content = await generateCoverLetter(ctx);
    return { ok: true, content, classification };
  } catch (e) {
    return { ok: false, reason: coverLetterErrorReason(e) };
  }
}

/**
 * Apply a chat instruction to the current letter content. Read-only: no DB
 * write, no revalidate. If the job description can no longer be resolved
 * (e.g. the posting page changed), refinement still proceeds with an empty
 * JD rather than blocking the chat — company/role context is enough for
 * most edits.
 */
export async function refineCoverLetterContent(
  applicationId: string,
  current: CoverLetterContent,
  instruction: string,
): Promise<
  { ok: true; content: CoverLetterContent } | { ok: false; reason: string }
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: "Not signed in." };

    const row = await loadApplicationRow(supabase, applicationId);

    const template = await loadTemplateBytes(supabase, user.id);
    const templateText = template.ok
      ? templateExampleText(template.bytes)
      : "";

    const jd = await resolveJobDescription(row.posting_url);
    const jobDescription = jd.ok ? jd.text : "";

    const resumeText = await loadResumeText(supabase, user.id);

    const ctx: CoverLetterContext = {
      templateText,
      resumeText,
      jobDescription,
      companyName: row.company_name,
      roleTitle: row.role_title,
      location: row.location,
      today: new Date().toISOString().slice(0, 10),
    };

    const content = await refineCoverLetter(current, instruction, ctx);
    return { ok: true, content };
  } catch (e) {
    return { ok: false, reason: coverLetterErrorReason(e) };
  }
}

/**
 * Render `content` onto the template's own formatting and return it as
 * base64 for a client-side download. Read-only: no DB write, no revalidate.
 */
export async function downloadCoverLetter(
  applicationId: string,
  content: CoverLetterContent,
  classification: LetterClassification,
): Promise<
  { ok: true; base64: string; filename: string } | { ok: false; reason: string }
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: "Not signed in." };

    const template = await loadTemplateBytes(supabase, user.id);
    if (!template.ok) return template;

    const { data: app, error: appError } = await supabase
      .from("applications")
      .select("company_name")
      .eq("id", applicationId)
      .single();
    if (appError) throw appError;
    const companyName = (app as { company_name: string }).company_name;

    const out = applyContent(template.bytes, classification, content);
    return {
      ok: true,
      base64: Buffer.from(out).toString("base64"),
      filename: `${companyName}-cover-letter.docx`,
    };
  } catch (e) {
    return { ok: false, reason: coverLetterErrorReason(e) };
  }
}

/**
 * Render `content` onto the template and persist it to the `cover-letters`
 * bucket + stamp `cover_letter_name`/`cover_letter_at` on the application.
 * The only cover-letter action that writes the DB — revalidates afterward.
 */
export async function saveCoverLetter(
  applicationId: string,
  content: CoverLetterContent,
  classification: LetterClassification,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: "Not signed in." };

    const template = await loadTemplateBytes(supabase, user.id);
    if (!template.ok) return template;

    const { data: app, error: appError } = await supabase
      .from("applications")
      .select("company_name")
      .eq("id", applicationId)
      .single();
    if (appError) throw appError;
    const companyName = (app as { company_name: string }).company_name;

    const out = applyContent(template.bytes, classification, content);
    const filename = `${companyName}-cover-letter.docx`;

    const { error: uploadError } = await supabase.storage
      .from("cover-letters")
      .upload(`${user.id}/${applicationId}.docx`, out, {
        upsert: true,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    if (uploadError) throw uploadError;

    const { error: updateError } = await supabase
      .from("applications")
      .update({
        cover_letter_name: filename,
        cover_letter_at: new Date().toISOString(),
      })
      .eq("id", applicationId);
    if (updateError) throw updateError;

    revalidatePath("/applications");
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: coverLetterErrorReason(e) };
  }
}

/**
 * Short-lived signed URL to re-download a previously saved letter. Read-only:
 * no DB write, no revalidate.
 */
export async function coverLetterDownloadUrl(
  applicationId: string,
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: "Not signed in." };

    const { data, error } = await supabase.storage
      .from("cover-letters")
      .createSignedUrl(`${user.id}/${applicationId}.docx`, 60);
    if (error) throw error;

    return { ok: true, url: data.signedUrl };
  } catch (e) {
    return { ok: false, reason: coverLetterErrorReason(e) };
  }
}
