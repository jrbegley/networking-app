"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { syncAllInboxes } from "./actions";
import {
  STAGE_LABEL,
  STAGE_BADGE_CLASS,
  PIPELINE_STAGES,
  stageOrder,
  type PipelineStage,
} from "@/lib/pipeline";

export type ContactRow = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
  current_stage: PipelineStage;
  company: { id: string; name: string; industry: string | null } | null;
};

type GroupBy = "company" | "stage" | "industry";

const NO_GROUP_LABEL: Record<GroupBy, string> = {
  company: "No company",
  stage: "Unknown",
  industry: "No industry",
};

export function PipelineView({
  contacts,
  outlookConnected,
}: {
  contacts: ContactRow[];
  outlookConnected: boolean;
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>("company");
  const [syncing, startSync] = useTransition();
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  function handleSyncAll() {
    setSyncStatus(null);
    startSync(async () => {
      const r = await syncAllInboxes();
      if (r.error) {
        setSyncStatus(`Error: ${r.error}`);
      } else if (r.newCount === 0 && r.sentCount === 0) {
        setSyncStatus(`Checked ${r.contactsChecked} contacts. Nothing new.`);
      } else {
        const parts = [];
        if (r.newCount > 0) parts.push(`${r.newCount} received`);
        if (r.sentCount > 0) parts.push(`${r.sentCount} sent`);
        const stages = r.advanced > 0 ? `, ${r.advanced} stage update${r.advanced === 1 ? "" : "s"}` : "";
        setSyncStatus(`Logged ${parts.join(", ")}${stages}.`);
      }
    });
  }

  const groups = buildGroups(contacts, groupBy);

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Pipeline
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {contacts.length} contact{contacts.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {outlookConnected && (
            <button
              type="button"
              onClick={handleSyncAll}
              disabled={syncing}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm transition-colors duration-150 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
              {syncing ? "Syncing…" : "Sync inbox"}
            </button>
          )}
          <Link
            href="/contacts/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add contact
          </Link>
        </div>
      </div>

      {syncStatus && (
        <p className={`mt-2 text-sm ${syncStatus.startsWith("Error") ? "text-red-600" : "text-slate-500"}`}>
          {syncStatus}
        </p>
      )}

      {/* Group-by toggle */}
      <div className="mt-4 flex items-center gap-2">
        <span className="text-xs text-slate-500">Group by</span>
        <div className="flex rounded-md border border-slate-200 bg-white shadow-sm">
          {(["company", "stage", "industry"] as GroupBy[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setGroupBy(mode)}
              className={`cursor-pointer px-3 py-1.5 text-xs font-medium capitalize transition-colors duration-150 first:rounded-l-md last:rounded-r-md focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                groupBy === mode
                  ? "bg-indigo-600 text-white"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Groups */}
      {contacts.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="mt-6 space-y-6">
          {groups.map(({ key, label, contacts: groupContacts }) => (
            <ContactGroup
              key={key}
              label={label}
              contacts={groupContacts}
              groupBy={groupBy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Grouping logic ─────────────────────────────────────────────────────

type Group = { key: string; label: string; contacts: ContactRow[] };

function buildGroups(contacts: ContactRow[], groupBy: GroupBy): Group[] {
  const map = new Map<string, Group>();

  for (const c of contacts) {
    let key: string;
    let label: string;

    if (groupBy === "company") {
      key = c.company?.id ?? "__none__";
      label = c.company?.name ?? NO_GROUP_LABEL.company;
    } else if (groupBy === "stage") {
      key = c.current_stage;
      label = STAGE_LABEL[c.current_stage];
    } else {
      key = c.company?.industry ?? "__none__";
      label = c.company?.industry ?? NO_GROUP_LABEL.industry;
    }

    if (!map.has(key)) map.set(key, { key, label, contacts: [] });
    map.get(key)!.contacts.push(c);
  }

  // Sort within each group
  for (const g of map.values()) {
    if (groupBy === "stage") {
      // Within a stage group, sort by company then name
      g.contacts.sort((a, b) => {
        const co = (a.company?.name ?? "").localeCompare(b.company?.name ?? "");
        return co !== 0 ? co : a.name.localeCompare(b.name);
      });
    } else {
      // Within company/industry groups, sort by stage then name
      g.contacts.sort((a, b) => {
        const s = stageOrder(a.current_stage) - stageOrder(b.current_stage);
        return s !== 0 ? s : a.name.localeCompare(b.name);
      });
    }
  }

  // Sort the groups themselves
  const groups = [...map.values()];

  if (groupBy === "stage") {
    // Follow pipeline order
    groups.sort(
      (a, b) =>
        stageOrder(a.key as PipelineStage) -
        stageOrder(b.key as PipelineStage),
    );
  } else {
    // Alphabetical, __none__ last
    groups.sort((a, b) => {
      if (a.key === "__none__") return 1;
      if (b.key === "__none__") return -1;
      return a.label.localeCompare(b.label);
    });
  }

  return groups;
}

// ── Subcomponents ──────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
      <h2 className="text-base font-medium text-slate-900">No contacts yet</h2>
      <p className="mt-1 text-sm text-slate-500">
        Add someone you&apos;re networking with to start tracking them.
      </p>
      <Link
        href="/contacts/new"
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add first contact
      </Link>
    </div>
  );
}

function ContactGroup({
  label,
  contacts,
  groupBy,
}: {
  label: string;
  contacts: ContactRow[];
  groupBy: GroupBy;
}) {
  return (
    <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <header className="flex items-baseline justify-between border-b border-slate-100 bg-slate-50/50 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{label}</h2>
        <span className="text-xs font-medium text-slate-400">
          {contacts.length} {contacts.length === 1 ? "person" : "people"}
        </span>
      </header>
      <ul className="divide-y divide-slate-100">
        {contacts.map((c) => (
          <ContactItem key={c.id} contact={c} groupBy={groupBy} />
        ))}
      </ul>
    </section>
  );
}

function ContactItem({
  contact,
  groupBy,
}: {
  contact: ContactRow;
  groupBy: GroupBy;
}) {
  return (
    <li>
      <Link
        href={`/contacts/${contact.id}`}
        className="flex items-center justify-between gap-4 px-5 py-3 transition-colors duration-150 hover:bg-indigo-50/40"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">
            {contact.name}
          </p>
          <p className="truncate text-xs text-slate-500">
            {contact.title ?? ""}
            {contact.title && contact.company && groupBy !== "company"
              ? " · "
              : ""}
            {groupBy !== "company" && contact.company ? contact.company.name : ""}
          </p>
        </div>
        {/* When grouped by stage, the stage badge is redundant — show company instead */}
        {groupBy === "stage" ? (
          contact.company ? (
            <span className="shrink-0 text-xs text-slate-500">
              {contact.company.name}
            </span>
          ) : null
        ) : (
          <StageBadge stage={contact.current_stage} />
        )}
      </Link>
    </li>
  );
}

function StageBadge({ stage }: { stage: PipelineStage }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STAGE_BADGE_CLASS[stage]}`}
    >
      {STAGE_LABEL[stage]}
    </span>
  );
}
