import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "./SettingsForm";
import { OutlookSection } from "./OutlookSection";
import { CadenceSection } from "./CadenceSection";
import { ResumeTexSection } from "./ResumeTexSection";
import { isCompiler } from "@/lib/resume-optimizer-types";
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
  };

  const PROFILE_FIELDS =
    "display_name, bio, resume_text, outreach_goal, linkedin_url, resume_pdf_name, resume_pdf_uploaded_at, outlook_email, outlook_access_token";

  const { data: profileData } = await supabase
    .from("profiles")
    .select(PROFILE_FIELDS)
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const profile = profileData as ProfileRow | null;

  const outlookEmail = profile?.outlook_email ?? null;
  const outlookConnected = !!(profile?.outlook_access_token);

  const { data: ruleRows } = await supabase
    .from("cadence_rules")
    .select("id, name, trigger_stage, wait_days, enabled")
    .order("created_at", { ascending: true });
  const cadenceRules = (ruleRows ?? []) as CadenceRule[];

  // resume_tex_* arrive with migration 010. Queried separately so the page
  // still renders (with a "not set up" note) before it's applied.
  const { data: texRow, error: texError } = await supabase
    .from("profiles")
    .select("resume_tex_name, resume_tex_at, resume_tex_compiler, resume_tex_pages")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const texNotSetUp = !!texError && /resume_tex/i.test(texError.message);
  const tex = (texRow ?? null) as {
    resume_tex_name: string | null;
    resume_tex_at: string | null;
    resume_tex_compiler: string | null;
    resume_tex_pages: number | null;
  } | null;

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

      {/* LaTeX resume for the optimizer */}
      <ResumeTexSection
        initial={{
          name: tex?.resume_tex_name ?? null,
          savedAt: tex?.resume_tex_at ?? null,
          compiler: isCompiler(tex?.resume_tex_compiler) ? tex.resume_tex_compiler : "pdflatex",
          pages: tex?.resume_tex_pages ?? null,
          notSetUp: texNotSetUp,
        }}
      />
    </div>
  );
}
