import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "./SettingsForm";
import { OutlookSection } from "./OutlookSection";
import { CadenceSection } from "./CadenceSection";
import { CoverLetterTemplateSection } from "./CoverLetterTemplateSection";
import type { CadenceRule } from "@/lib/cadence";

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

  type ProfileRow = {
    display_name: string | null;
    bio: string | null;
    resume_text: string | null;
    outreach_goal: string | null;
    linkedin_url: string | null;
    resume_pdf_name: string | null;
    resume_pdf_uploaded_at: string | null;
    outlook_email: string | null;
    outlook_access_token: string | null;
    cover_letter_template_name?: string | null;
    cover_letter_template_at?: string | null;
  };

  const PROFILE_FIELDS =
    "display_name, bio, resume_text, outreach_goal, linkedin_url, resume_pdf_name, resume_pdf_uploaded_at, outlook_email, outlook_access_token";

  // cover_letter_template_name/at arrive with migration 009. Until it's
  // applied, fall back to a query without them so the page still renders.
  let profile: ProfileRow | null = null;
  const first = await supabase
    .from("profiles")
    .select(`${PROFILE_FIELDS}, cover_letter_template_name, cover_letter_template_at`)
    .eq("id", user?.id ?? "")
    .maybeSingle();

  if (first.error && /cover_letter/i.test(first.error.message)) {
    const second = await supabase
      .from("profiles")
      .select(PROFILE_FIELDS)
      .eq("id", user?.id ?? "")
      .maybeSingle();
    profile = second.data as ProfileRow | null;
  } else {
    profile = first.data as ProfileRow | null;
  }

  const outlookEmail = profile?.outlook_email ?? null;
  const outlookConnected = !!(profile?.outlook_access_token);

  const { data: ruleRows } = await supabase
    .from("cadence_rules")
    .select("id, name, trigger_stage, wait_days, enabled")
    .order("created_at", { ascending: true });
  const cadenceRules = (ruleRows ?? []) as CadenceRule[];

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

      {/* Follow-up cadence rules */}
      <CadenceSection rules={cadenceRules} />

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

      {/* Cover-letter template */}
      <CoverLetterTemplateSection
        initial={{
          templateName: profile?.cover_letter_template_name ?? null,
          templateUploadedAt: profile?.cover_letter_template_at ?? null,
        }}
      />
    </div>
  );
}
