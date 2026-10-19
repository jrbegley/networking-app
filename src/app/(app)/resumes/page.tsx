import { createClient } from "@/lib/supabase/server";
import { ResumesView, type TailoredResumeRow, type PickerApplication } from "./ResumesView";
import type { Change, Keyword } from "@/lib/resume-optimizer-types";

export default async function ResumesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("tailored_resumes")
    .select("id, application_id, company_name, role_title, compiler, keywords, changes, page_warning, created_at")
    .order("created_at", { ascending: false });

  if (error && /tailored_resumes/i.test(error.message) && /exist|relation|schema|column/i.test(error.message)) {
    return <NotSetUp />;
  }
  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 ring-1 ring-red-200">
        <p className="text-sm text-red-900">Couldn&apos;t load resumes: {error.message}</p>
      </div>
    );
  }

  const rows: TailoredResumeRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    applicationId: (r.application_id as string | null) ?? null,
    companyName: r.company_name as string,
    roleTitle: r.role_title as string,
    compiler: r.compiler as string,
    keywords: (r.keywords as Keyword[]) ?? [],
    changes: (r.changes as Change[]) ?? [],
    pageWarning: !!r.page_warning,
    createdAt: r.created_at as string,
  }));

  const { data: apps } = await supabase
    .from("applications")
    .select("id, company_name, role_title, status")
    .order("created_at", { ascending: false });
  const applications: PickerApplication[] = ((apps ?? []) as Record<string, unknown>[]).map((a) => ({
    id: a.id as string,
    companyName: a.company_name as string,
    roleTitle: a.role_title as string,
    status: a.status as string,
  }));

  const { data: texRow, error: texError } = await supabase
    .from("profiles")
    .select("resume_tex_name")
    .eq("id", user.id)
    .maybeSingle();
  const hasResumeTex = texError ? false : !!(texRow as { resume_tex_name: string | null } | null)?.resume_tex_name;

  return <ResumesView rows={rows} applications={applications} hasResumeTex={hasResumeTex} />;
}

function NotSetUp() {
  return (
    <div className="max-w-2xl space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Resumes</h1>
      <div className="rounded-lg bg-white p-6 ring-1 ring-slate-200">
        <p className="text-sm text-slate-700">
          The resume database isn&apos;t set up yet. Paste{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">supabase/migrations/010_resume_optimizer.sql</code>{" "}
          into the Supabase SQL editor and run it, then reload.
        </p>
      </div>
    </div>
  );
}
