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
      />

      {/* ── Company panel ───────────────────────────────────────────── */}
      {company && (
        <section className="rounded-lg bg-white p-6 ring-1 ring-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            {company.name}
          </h2>
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
              Enrich the contact to populate company details.
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
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
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
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>
    </div>
  );
}
