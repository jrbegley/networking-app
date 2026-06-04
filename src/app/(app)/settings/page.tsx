import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "./SettingsForm";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Layout already redirects unauthed users, so user is non-null here in
  // practice — keep a defensive read anyway.
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, bio, resume_text, outreach_goal, linkedin_url",
    )
    .eq("id", user?.id ?? "")
    .maybeSingle();

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Settings
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        Tell Claude who you are. This information gets injected into every
        outreach draft, so the AI can find real common ground with each
        recipient and write in your voice. Nothing here is ever sent to a
        recipient verbatim — it&apos;s context for the drafting only.
      </p>

      <div className="mt-8">
        <SettingsForm
          initial={{
            displayName: profile?.display_name ?? "",
            bio: profile?.bio ?? "",
            resumeText: profile?.resume_text ?? "",
            outreachGoal: profile?.outreach_goal ?? "",
            linkedinUrl: profile?.linkedin_url ?? "",
          }}
        />
      </div>
    </div>
  );
}
