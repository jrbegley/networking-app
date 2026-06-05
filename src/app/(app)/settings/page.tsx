import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "./SettingsForm";
import { OutlookSection } from "./OutlookSection";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, bio, resume_text, outreach_goal, linkedin_url, resume_pdf_name, resume_pdf_uploaded_at, outlook_email, outlook_access_token",
    )
    .eq("id", user?.id ?? "")
    .maybeSingle();

  const outlookEmail = profile?.outlook_email ?? null;
  const outlookConnected = !!(profile?.outlook_access_token);

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Settings
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Tell Claude who you are. This information gets injected into every
          outreach draft, so the AI can find real common ground with each
          recipient and write in your voice. Nothing here is ever sent to a
          recipient verbatim — it&apos;s context for the drafting only.
        </p>
      </div>

      {/* Outlook connection */}
      <OutlookSection
        connected={outlookConnected}
        email={outlookEmail}
        flashConnected={sp.outlook_connected === "1"}
        flashError={sp.outlook_error ?? null}
      />

      {/* Profile / Claude context */}
      <SettingsForm
        initial={{
          displayName: profile?.display_name ?? "",
          bio: profile?.bio ?? "",
          resumeText: profile?.resume_text ?? "",
          outreachGoal: profile?.outreach_goal ?? "",
          linkedinUrl: profile?.linkedin_url ?? "",
          resumePdfName: profile?.resume_pdf_name ?? null,
          resumePdfUploadedAt: profile?.resume_pdf_uploaded_at ?? null,
        }}
      />
    </div>
  );
}
