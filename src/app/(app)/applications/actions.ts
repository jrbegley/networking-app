"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from "@/lib/applications";

export type ActionResult = { error: string | null };

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
