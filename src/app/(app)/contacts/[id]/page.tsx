import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Extend default 10s up to 60s so the Apify LinkedIn scrape (typically
// 10-30s) can finish before Vercel kills the function. Applies to all
// server actions invoked from this page.
export const maxDuration = 60;
import {
  STAGE_LABEL,
  STAGE_BADGE_CLASS,
  type PipelineStage,
} from "@/lib/pipeline";
import { TavilyButton } from "./TavilyButton";
import { LinkedInButton } from "./LinkedInButton";
import { ContactCompleteness } from "./ContactCompleteness";
import { CompanyRefreshButton } from "./CompanyRefreshButton";
import { DraftPanel } from "./DraftPanel";
import { EmailThread } from "./EmailThread";
import { ResearchNotes } from "./ResearchNotes";
import { EditContact } from "./EditContact";
import { summarizeTavilyPayload } from "@/lib/tavily-summary";
import { summarizeLinkedInPayload } from "@/lib/linkedin-summary";
import { TAVILY_ENABLED } from "@/lib/tavily";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ContactDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: contact, error } = await supabase
    .from("contacts")
    .select(
      `id, name, title, email, linkedin_url, current_stage, notes,
       research_notes, draft_subject, draft_body, created_at, updated_at,
       company:companies(id, name, domain, industry, size_range, linkedin_url)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 ring-1 ring-red-200">
        <p className="text-sm text-red-900">
          Couldn&apos;t load contact: {error.message}
        </p>
      </div>
    );
  }
  if (!contact) {
    notFound();
  }

  const company = Array.isArray(contact.company)
    ? (contact.company[0] ?? null)
    : (contact.company ?? null);
  const stage = contact.current_stage as PipelineStage;

  // Most recent LinkedIn + Tavily artifacts for display (Apollo hidden).
  // Tavily fetch is skipped when sidelined to save a round-trip.
  const [
    { data: latestLinkedin },
    { data: latestTavily },
  ] = await Promise.all([
    supabase
      .from("research_artifacts")
      .select("id, payload, created_at")
      .eq("contact_id", id)
      .eq("source", "linkedin")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    TAVILY_ENABLED
      ? supabase
          .from("research_artifacts")
          .select("id, payload, created_at")
          .eq("contact_id", id)
          .eq("source", "tavily")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null as null }),
  ]);

  // Check if Outlook is connected for this user
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("outlook_email, outlook_access_token")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };
  const outlookConnected = !!(profile?.outlook_access_token);

  // Interactions timeline
  const { data: interactions } = await supabase
    .from("interactions")
    .select("id, type, subject, body, occurred_at")
    .eq("contact_id", id)
    .order("occurred_at", { ascending: false })
    .limit(20);

  // Any open applications at this contact's company? Links the networking side
  // to the job tracker. Tolerates migration 008 being unapplied (error → none).
  let openApplications: { id: string; role_title: string; status: string }[] = [];
  if (company?.id) {
    const { data: apps } = await supabase
      .from("applications")
      .select("id, role_title, status")
      .eq("company_id", company.id)
      .not("status", "in", "(rejected,withdrawn,ghosted)")
      .order("status");
    openApplications = apps ?? [];
  }

  return (
    <div className="space-y-6">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div>
        <Link
          href="/contacts"
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          ← Pipeline
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {contact.name}
            </h1>
            <p className="mt-1 text-slate-600">
              {contact.title ?? <span className="italic">No title yet</span>}
              {company && (
                <>
                  {" "}
                  ·{" "}
                  <span className="font-medium text-slate-700">
                    {company.name}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STAGE_BADGE_CLASS[stage]}`}
            >
              {STAGE_LABEL[stage]}
            </span>
            <EditContact
              initial={{
                contactId: contact.id,
                name: contact.name,
                title: contact.title ?? "",
                email: contact.email ?? "",
                linkedinUrl: contact.linkedin_url ?? "",
                company: company?.name ?? "",
                stage: contact.current_stage,
                notes: contact.notes ?? "",
              }}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="text-slate-600 hover:text-slate-900"
            >
              ✉ {contact.email}
            </a>
          )}
          {contact.linkedin_url && (
            <a
              href={contact.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-600 hover:text-slate-900"
            >
              LinkedIn ↗
            </a>
          )}
        </div>
        {openApplications.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {openApplications.map((app) => (
              <Link
                key={app.id}
                href="/applications"
                className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 transition-colors duration-150 hover:bg-indigo-100"
                title="You have an active application at this company"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 5.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 13.489c-2.883 0-5.647-.508-8.207-1.44a2.164 2.164 0 01-.673-.38m16.5 0v-4.25c0-1.094-.787-2.036-1.872-2.18a48.11 48.11 0 00-3.413-.387m0 0V4.5A2.25 2.25 0 0013.5 2.25h-3A2.25 2.25 0 008.25 4.5v.75m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
                Application: {app.role_title}
              </Link>
            ))}
          </div>
        )}
        <ContactCompleteness
          contactId={contact.id}
          hasEmail={!!contact.email}
          hasLinkedin={!!contact.linkedin_url}
        />
      </div>

      {/* ── Research panel ───────────────────────────────────────────── */}
      <section className="rounded-lg bg-white p-6 ring-1 ring-slate-200">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-slate-900">
            Research
          </h2>
          <div className="flex items-start gap-3">
            <LinkedInButton
              contactId={contact.id}
              disabled={!contact.linkedin_url}
            />
            {TAVILY_ENABLED && <TavilyButton contactId={contact.id} />}
          </div>
        </div>

        {/* LinkedIn (Apify) first — highest signal, structured data */}
        {latestLinkedin ? (
          <LinkedInDataBlock
            payload={latestLinkedin.payload}
            fetchedAt={latestLinkedin.created_at}
          />
        ) : (
          contact.linkedin_url && (
            <p className="mt-3 text-sm text-slate-500">
              No LinkedIn scrape yet. Click <strong>Pull LinkedIn</strong>{" "}
              for the full profile (~$0.004 per scrape, 10–30s wait).
            </p>
          )
        )}

        {/* Web research (Tavily) — sidelined, gate keeps the block reachable */}
        {TAVILY_ENABLED && latestTavily && (
          <TavilyDataBlock
            payload={latestTavily.payload}
            fetchedAt={latestTavily.created_at}
          />
        )}

        {!contact.linkedin_url && (
          <p className="mt-3 text-sm text-slate-500">
            Add a LinkedIn URL to enable LinkedIn / Apollo enrichment.
          </p>
        )}

        {/* User's own research notes (always editable) */}
        <ResearchNotes
          contactId={contact.id}
          initial={contact.research_notes ?? ""}
        />
      </section>

      {/* ── Draft outreach ──────────────────────────────────────────── */}
      <DraftPanel
        contactId={contact.id}
        hasResearch={!!latestLinkedin || (TAVILY_ENABLED && !!latestTavily)}
        initialSubject={contact.draft_subject ?? ""}
        initialBody={contact.draft_body ?? ""}
        outlookConnected={outlookConnected}
        hasEmail={!!contact.email}
      />

      {/* ── Company panel ───────────────────────────────────────────── */}
      {company && (
        <section className="rounded-lg bg-white p-6 ring-1 ring-slate-200">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-slate-900">
              {company.name}
            </h2>
            {(!company.industry || !company.size_range) && (
              <CompanyRefreshButton contactId={contact.id} />
            )}
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {company.industry && (
              <CompanyField label="Industry" value={company.industry} />
            )}
            {company.domain && (
              <CompanyField label="Domain" value={company.domain} />
            )}
            {company.size_range && (
              <CompanyField
                label="Employees (est.)"
                value={company.size_range}
              />
            )}
            {company.linkedin_url && (
              <CompanyField
                label="LinkedIn"
                value={
                  <a
                    href={company.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-700 hover:text-slate-900 underline underline-offset-2"
                  >
                    Open ↗
                  </a>
                }
              />
            )}
          </dl>
          {!company.industry && !company.domain && !company.size_range && (
            <p className="mt-3 text-sm text-slate-500">
              No details yet. Fill in from Apollo, or enrich the contact.
            </p>
          )}
        </section>
      )}

      {/* ── Notes ───────────────────────────────────────────────────── */}
      {contact.notes && (
        <section className="rounded-lg bg-white p-6 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Notes</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
            {contact.notes}
          </p>
        </section>
      )}

      {/* ── Email thread ─────────────────────────────────────────────── */}
      <EmailThread
        contactId={contact.id}
        interactions={interactions ?? []}
        outlookConnected={outlookConnected}
        hasEmail={!!contact.email}
      />
    </div>
  );
}

function CompanyField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-slate-900">{value}</dd>
    </div>
  );
}

function LinkedInDataBlock({
  payload,
  fetchedAt,
}: {
  payload: unknown;
  fetchedAt: string;
}) {
  const summary = summarizeLinkedInPayload(payload);
  const fetchedDate = new Date(fetchedAt).toLocaleDateString();

  return (
    <div className="mt-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        LinkedIn · scraped {fetchedDate}
      </p>

      {summary ? (
        <pre className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-4 font-sans text-sm text-slate-800 ring-1 ring-slate-200">
          {summary}
        </pre>
      ) : (
        <p className="mt-1 text-sm text-slate-500">
          Apify returned no usable profile (last checked {fetchedDate}).
        </p>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer select-none text-xs text-slate-500 hover:text-slate-700">
          Show raw LinkedIn payload
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-slate-800 p-3 text-xs leading-relaxed text-slate-100">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function TavilyDataBlock({
  payload,
  fetchedAt,
}: {
  payload: unknown;
  fetchedAt: string;
}) {
  const summary = summarizeTavilyPayload(payload);
  const fetchedDate = new Date(fetchedAt).toLocaleDateString();

  return (
    <div className="mt-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        Web · Tavily · fetched {fetchedDate}
      </p>

      {summary ? (
        <pre className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-4 font-sans text-sm text-slate-800 ring-1 ring-slate-200">
          {summary}
        </pre>
      ) : (
        <p className="mt-1 text-sm text-slate-500">
          Tavily returned no useful results.
        </p>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer select-none text-xs text-slate-500 hover:text-slate-700">
          Show raw Tavily payload
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-slate-800 p-3 text-xs leading-relaxed text-slate-100">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>
    </div>
  );
}
