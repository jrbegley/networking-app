import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  STAGE_LABEL,
  STAGE_BADGE_CLASS,
  stageOrder,
  type PipelineStage,
} from "@/lib/pipeline";

type ContactRow = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
  current_stage: PipelineStage;
  company: { id: string; name: string } | null;
};

const NO_COMPANY_KEY = "__no_company__";
const NO_COMPANY_LABEL = "No company";

export default async function ContactsPage() {
  const supabase = await createClient();

  // RLS scopes this to the current user automatically.
  const { data, error } = await supabase
    .from("contacts")
    .select(
      "id, name, title, email, linkedin_url, current_stage, company:companies(id, name)",
    )
    .order("current_stage")
    .order("name");

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 ring-1 ring-red-200">
        <p className="text-sm text-red-900">
          Couldn&apos;t load contacts: {error.message}
        </p>
      </div>
    );
  }

  // Supabase types a nested join as an array when it can't prove
  // single-row. Coerce to single since contacts.company_id is a FK
  // pointing at exactly one row.
  const contacts: ContactRow[] = (data ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    title: c.title as string | null,
    email: c.email as string | null,
    linkedin_url: c.linkedin_url as string | null,
    current_stage: c.current_stage as PipelineStage,
    company: Array.isArray(c.company)
      ? (c.company[0] ?? null)
      : ((c.company as ContactRow["company"]) ?? null),
  }));

  // ── Group by company ──────────────────────────────────────────────────
  // Map keyed by company id (or NO_COMPANY_KEY). We iterate twice — once
  // to bucket, once to sort within. O(n log n) overall, fine at our scale.
  const groups = new Map<
    string,
    { label: string; contacts: ContactRow[] }
  >();

  for (const c of contacts) {
    const key = c.company?.id ?? NO_COMPANY_KEY;
    const label = c.company?.name ?? NO_COMPANY_LABEL;
    if (!groups.has(key)) {
      groups.set(key, { label, contacts: [] });
    }
    groups.get(key)!.contacts.push(c);
  }

  // Sort within each group by stage then name. Server returned them in
  // stage order already, but if we change the query later, this keeps the
  // UI guarantee local.
  for (const g of groups.values()) {
    g.contacts.sort((a, b) => {
      const s = stageOrder(a.current_stage) - stageOrder(b.current_stage);
      return s !== 0 ? s : a.name.localeCompare(b.name);
    });
  }

  // Sort groups: real companies first by name, "No company" last.
  const sortedGroups = [...groups.entries()].sort(([keyA, a], [keyB, b]) => {
    if (keyA === NO_COMPANY_KEY) return 1;
    if (keyB === NO_COMPANY_KEY) return -1;
    return a.label.localeCompare(b.label);
  });

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Pipeline
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {contacts.length} contact{contacts.length === 1 ? "" : "s"},
            grouped by company.
          </p>
        </div>
        <Link
          href="/contacts/new"
          className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
        >
          + Add contact
        </Link>
      </div>

      {contacts.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="mt-8 space-y-6">
          {sortedGroups.map(([key, group]) => (
            <CompanyGroup
              key={key}
              label={group.label}
              contacts={group.contacts}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
      <h2 className="text-base font-medium text-slate-900">
        No contacts yet
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Add someone you&apos;re networking with to start tracking them.
      </p>
      <Link
        href="/contacts/new"
        className="mt-4 inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
      >
        + Add first contact
      </Link>
    </div>
  );
}

function CompanyGroup({
  label,
  contacts,
}: {
  label: string;
  contacts: ContactRow[];
}) {
  return (
    <section className="overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
      <header className="flex items-baseline justify-between border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{label}</h2>
        <span className="text-xs text-slate-500">
          {contacts.length} {contacts.length === 1 ? "person" : "people"}
        </span>
      </header>
      <ul className="divide-y divide-slate-100">
        {contacts.map((c) => (
          <ContactRow key={c.id} contact={c} />
        ))}
      </ul>
    </section>
  );
}

function ContactRow({ contact }: { contact: ContactRow }) {
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-slate-50">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">
          {contact.name}
        </p>
        {contact.title && (
          <p className="truncate text-xs text-slate-500">{contact.title}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {contact.linkedin_url && (
          <a
            href={contact.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-500 hover:text-slate-900"
            title="Open LinkedIn"
          >
            LinkedIn ↗
          </a>
        )}
        <StageBadge stage={contact.current_stage} />
      </div>
    </li>
  );
}

function StageBadge({ stage }: { stage: PipelineStage }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STAGE_BADGE_CLASS[stage]}`}
    >
      {STAGE_LABEL[stage]}
    </span>
  );
}
