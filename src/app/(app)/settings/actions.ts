"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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
