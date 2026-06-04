import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  STAGE_LABEL,
  STAGE_BADGE_CLASS,
  type PipelineStage,
} from "@/lib/pipeline";
import { EnrichButton } from "./EnrichButton";
import { DraftPanel } from "./DraftPanel";
import { ResearchNotes } from "./ResearchNotes";
import { summarizeApolloPayload } from "@/lib/apollo-summary";

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
       research_notes, created_at, updated_at,
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

  // Most recent Apollo artifact (if any) for display
  const { data: latestApollo } = await supabase
    .from("research_artifacts")
    .select("id, payload, created_at")
    .eq("contact_id", id)
    .eq("source", "apollo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

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
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STAGE_BADGE_CLASS[stage]}`}
          >
            {STAGE_LABEL[stage]}
          </span>
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
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">
            Research
          </h2>
          <EnrichButton
            contactId={contact.id}
            disabled={!contact.linkedin_url}
          />
        </div>
        {!contact.linkedin_url && (
          <p className="mt-3 text-sm text-slate-500">
            Add a LinkedIn URL to enable Apollo enrichment. You can still
            add your own research notes below.
          </p>
        )}

        {/* Apollo (auto) research */}
        {latestApollo ? (
          <ApolloDataBlock
            payload={latestApollo.payload}
            fetchedAt={latestApollo.created_at}
          />
        ) : (
          contact.linkedin_url && (
            <p className="mt-3 text-sm text-slate-500">
              No auto-research yet. Click <strong>Enrich with Apollo</strong>{" "}
              above to pull background.
            </p>
          )
        )}

        {/* User's own research notes (always editable) */}
        <ResearchNotes
          contactId={contact.id}
          initial={contact.research_notes ?? ""}
        />
      </section>

      {/* ── Draft outreach ──────────────────────────────────────────── */}
      <DraftPanel contactId={contact.id} hasResearch={!!latestApollo} />

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

      {/* ── Timeline ────────────────────────────────────────────────── */}
      <section className="rounded-lg bg-white p-6 ring-1 ring-slate-200">
        <h2 className="text-base font-semibold text-slate-900">Timeline</h2>
        {interactions && interactions.length > 0 ? (
          <ul className="mt-3 divide-y divide-slate-100">
            {interactions.map((i) => (
              <li key={i.id} className="py-3">
                <p className="text-xs text-slate-500">
                  {new Date(i.occurred_at).toLocaleString()} · {i.type}
                </p>
                {i.subject && (
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {i.subject}
                  </p>
                )}
                {i.body && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                    {i.body}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            No interactions yet. Drafts and meeting notes will show up here.
          </p>
        )}
      </section>
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

/**
 * Render the full Apollo summary the model also sees. If Apollo found no
 * match, we say so explicitly so the user knows enrichment ran and came
 * back empty (vs. never having been tried).
 */
function ApolloDataBlock({
  payload,
  fetchedAt,
}: {
  payload: unknown;
  fetchedAt: string;
}) {
  const summary = summarizeApolloPayload(payload);

  if (!summary) {
    return (
      <p className="mt-3 text-sm text-slate-500">
        Apollo found no match for this LinkedIn URL (last checked{" "}
        {new Date(fetchedAt).toLocaleDateString()}).
      </p>
    );
  }

  return (
    <div className="mt-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        Apollo · fetched {new Date(fetchedAt).toLocaleDateString()}
      </p>
      <pre className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-4 font-sans text-sm text-slate-800 ring-1 ring-slate-200">
        {summary}
      </pre>
    </div>
  );
}
