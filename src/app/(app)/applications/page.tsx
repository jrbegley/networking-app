import { createClient } from "@/lib/supabase/server";
import { ApplicationsView, type ApplicationRow } from "./ApplicationsView";
import type { ApplicationStatus } from "@/lib/applications";

const APP_FIELDS =
  "id, company_id, company_name, role_title, location, posting_url, source, status, status_changed_at, applied_at, deadline, heard_back_at, notes, referral_contact_id";

export default async function ApplicationsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // layout already redirects; keeps types happy

  const { data, error } = await supabase
    .from("applications")
    .select(APP_FIELDS)
    .order("status")
    .order("applied_at", { ascending: false, nullsFirst: false });

  // Migration 008 not applied yet: show a setup note instead of an error page.
  if (error && /applications/i.test(error.message) && /exist|relation|schema|column/i.test(error.message)) {
    return <NotSetUp />;
  }
  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 ring-1 ring-red-200">
        <p className="text-sm text-red-900">
          Couldn&apos;t load applications: {error.message}
        </p>
      </div>
    );
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const applicationIds = rows.map((r) => r.id as string);

  // resume_tex_name arrives with migration 010. Separate query so an
  // unapplied migration can't break the page; falls back to "no .tex".
  const { data: texRow, error: texError } = await supabase
    .from("profiles")
    .select("resume_tex_name")
    .eq("id", user.id)
    .maybeSingle();
  const hasResumeTex = texError ? false : !!(texRow as { resume_tex_name: string | null } | null)?.resume_tex_name;

  // Timeline events for the inline drawers, oldest → newest is handled in the
  // view; fetch all for the loaded applications in one query.
  const eventsByApp = new Map<string, TimelineEvent[]>();
  if (applicationIds.length > 0) {
    const { data: events } = await supabase
      .from("application_events")
      .select("id, application_id, status, note, occurred_at, created_at")
      .in("application_id", applicationIds)
      .order("occurred_at", { ascending: true })
      .order("created_at", { ascending: true });
    for (const e of (events ?? []) as Record<string, unknown>[]) {
      const appId = e.application_id as string;
      if (!eventsByApp.has(appId)) eventsByApp.set(appId, []);
      eventsByApp.get(appId)!.push({
        id: e.id as string,
        status: (e.status as ApplicationStatus | null) ?? null,
        note: (e.note as string | null) ?? null,
        occurred_at: e.occurred_at as string,
      });
    }
  }

  // "People you know here" — count contacts per company_id so the row can show
  // a badge linking the networking side to the application.
  const { data: contactRows } = await supabase
    .from("contacts")
    .select("id, company_id")
    .not("company_id", "is", null);
  const contactsByCompany = new Map<string, number>();
  for (const c of (contactRows ?? []) as { company_id: string | null }[]) {
    if (!c.company_id) continue;
    contactsByCompany.set(
      c.company_id,
      (contactsByCompany.get(c.company_id) ?? 0) + 1,
    );
  }

  const applications: ApplicationRow[] = rows.map((r) => {
    const companyId = (r.company_id as string | null) ?? null;
    return {
      id: r.id as string,
      companyId,
      companyName: r.company_name as string,
      roleTitle: r.role_title as string,
      location: (r.location as string | null) ?? null,
      postingUrl: (r.posting_url as string | null) ?? null,
      source: (r.source as string | null) ?? null,
      status: r.status as ApplicationStatus,
      statusChangedAt: (r.status_changed_at as string | null) ?? null,
      appliedAt: (r.applied_at as string | null) ?? null,
      deadline: (r.deadline as string | null) ?? null,
      heardBackAt: (r.heard_back_at as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      contactsAtCompany: companyId
        ? (contactsByCompany.get(companyId) ?? 0)
        : 0,
      events: eventsByApp.get(r.id as string) ?? [],
    };
  });

  return (
    <ApplicationsView applications={applications} hasResumeTex={hasResumeTex} />
  );
}

export type TimelineEvent = {
  id: string;
  status: ApplicationStatus | null;
  note: string | null;
  occurred_at: string;
};

function NotSetUp() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Applications
      </h1>
      <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8">
        <h2 className="text-base font-medium text-slate-900">
          One step to turn this on
        </h2>
        <p className="mt-2 max-w-prose text-sm text-slate-600">
          The application tracker needs its database tables. Paste{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">
            supabase/migrations/008_applications.sql
          </code>{" "}
          into the Supabase SQL editor and run it, then refresh this page.
        </p>
      </div>
    </div>
  );
}
