"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  enrichPersonByLinkedInUrl,
  type ApolloPerson,
} from "@/lib/apollo";

export type ProfileFormState = {
  error: string | null;
  saved: boolean;
};

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
