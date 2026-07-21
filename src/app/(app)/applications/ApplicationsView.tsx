"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  APPLICATION_STATUSES,
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
  statusOrder,
  isOpen,
  daysSince,
  waitLevel,
  type ApplicationStatus,
} from "@/lib/applications";
import {
  setApplicationStatus,
  updateApplication,
  addApplicationEvent,
  deleteApplication,
} from "./actions";
import { AddApplicationDialog } from "./AddApplicationDialog";
import type { TimelineEvent } from "./page";

export type ApplicationRow = {
  id: string;
  companyId: string | null;
  companyName: string;
  roleTitle: string;
  location: string | null;
  postingUrl: string | null;
  source: string | null;
  status: ApplicationStatus;
  statusChangedAt: string | null;
  appliedAt: string | null;
  deadline: string | null;
  heardBackAt: string | null;
  notes: string | null;
  contactsAtCompany: number;
  events: TimelineEvent[];
};

type Filter = "open" | "active" | "closed" | "all";
type SortKey = "status" | "company" | "applied" | "wait" | "deadline";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "active", label: "Interviewing" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

// Statuses that mean "actively in a round" for the Interviewing filter.
const ACTIVE_STATUSES: ReadonlySet<ApplicationStatus> = new Set([
  "phone_screen",
  "interview",
  "final_round",
] as ApplicationStatus[]);

export function ApplicationsView({
  applications,
}: {
  applications: ApplicationRow[];
}) {
  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "applied",
    dir: -1,
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const stats = useMemo(() => summarize(applications), [applications]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = applications.filter((a) => {
      if (filter === "open" && !isOpen(a.status)) return false;
      if (filter === "active" && !ACTIVE_STATUSES.has(a.status)) return false;
      if (filter === "closed" && isOpen(a.status)) return false;
      if (
        q &&
        !a.companyName.toLowerCase().includes(q) &&
        !a.roleTitle.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
    list = sortApplications(list, sort.key, sort.dir);
    return list;
  }, [applications, filter, query, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 },
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Applications
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {applications.length} application
            {applications.length === 1 ? "" : "s"} tracked
          </p>
        </div>
        <AddApplicationDialog />
      </div>

      {/* Summary strip */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Open" value={stats.open} tone="indigo" />
        <StatCard
          label="Awaiting reply"
          value={stats.awaiting}
          tone={stats.overdue > 0 ? "amber" : "slate"}
          hint={stats.overdue > 0 ? `${stats.overdue} overdue` : undefined}
        />
        <StatCard label="Interviewing" value={stats.interviewing} tone="blue" />
        <StatCard label="Offers" value={stats.offers} tone="emerald" />
      </div>

      {/* Controls */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border border-slate-200 bg-white shadow-sm">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`cursor-pointer px-3 py-1.5 text-xs font-medium transition-colors duration-150 first:rounded-l-md last:rounded-r-md focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                filter === f.key
                  ? "bg-indigo-600 text-white"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search company or role…"
          className="w-56 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      {/* Table */}
      {applications.length === 0 ? (
        <EmptyState />
      ) : visible.length === 0 ? (
        <p className="mt-8 rounded-md bg-slate-100 px-4 py-6 text-center text-sm text-slate-500">
          No applications match this filter.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-xs font-medium text-slate-500">
                <SortHeader
                  label="Company / Role"
                  active={sort.key === "company"}
                  dir={sort.dir}
                  onClick={() => toggleSort("company")}
                />
                <SortHeader
                  label="Status"
                  active={sort.key === "status"}
                  dir={sort.dir}
                  onClick={() => toggleSort("status")}
                />
                <SortHeader
                  label="Applied"
                  active={sort.key === "applied"}
                  dir={sort.dir}
                  onClick={() => toggleSort("applied")}
                />
                <th className="px-4 py-2.5 font-medium">Heard back</th>
                <SortHeader
                  label="Waiting"
                  active={sort.key === "wait"}
                  dir={sort.dir}
                  onClick={() => toggleSort("wait")}
                />
                <SortHeader
                  label="Deadline"
                  active={sort.key === "deadline"}
                  dir={sort.dir}
                  onClick={() => toggleSort("deadline")}
                />
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((app) => (
                <ApplicationRowView
                  key={app.id}
                  app={app}
                  expanded={expandedId === app.id}
                  onToggle={() =>
                    setExpandedId((id) => (id === app.id ? null : app.id))
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Summary ────────────────────────────────────────────────────────────

function summarize(apps: ApplicationRow[]) {
  let open = 0,
    awaiting = 0,
    overdue = 0,
    interviewing = 0,
    offers = 0;
  for (const a of apps) {
    if (isOpen(a.status)) open++;
    if (a.status === "offer") offers++;
    if (ACTIVE_STATUSES.has(a.status)) interviewing++;
    const lvl = waitLevel(a.status, a.appliedAt, a.heardBackAt);
    if (lvl !== "none") awaiting++;
    if (lvl === "overdue") overdue++;
  }
  return { open, awaiting, overdue, interviewing, offers };
}

function sortApplications(
  list: ApplicationRow[],
  key: SortKey,
  dir: 1 | -1,
): ApplicationRow[] {
  const sorted = [...list];
  sorted.sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "status":
        cmp = statusOrder(a.status) - statusOrder(b.status);
        break;
      case "company":
        cmp = a.companyName.localeCompare(b.companyName);
        break;
      case "applied":
        cmp = cmpNullableDate(a.appliedAt, b.appliedAt);
        break;
      case "deadline":
        cmp = cmpNullableDate(a.deadline, b.deadline);
        break;
      case "wait": {
        const aw = a.heardBackAt ? -1 : (daysSince(a.appliedAt) ?? -1);
        const bw = b.heardBackAt ? -1 : (daysSince(b.appliedAt) ?? -1);
        cmp = aw - bw;
        break;
      }
    }
    if (cmp === 0) cmp = a.companyName.localeCompare(b.companyName);
    return cmp * dir;
  });
  return sorted;
}

// Nulls sort last regardless of direction feels wrong for dates; here we treat
// missing dates as the oldest so they cluster at the "ascending" end.
function cmpNullableDate(a: string | null, b: string | null): number {
  const av = a ? Date.parse(a) : -Infinity;
  const bv = b ? Date.parse(b) : -Infinity;
  return av - bv;
}

// ── Row ────────────────────────────────────────────────────────────────

function ApplicationRowView({
  app,
  expanded,
  onToggle,
}: {
  app: ApplicationRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleStatus(next: string) {
    setError(null);
    startTransition(async () => {
      const r = await setApplicationStatus(app.id, next);
      if (r.error) setError(r.error);
    });
  }

  const wait = waitLevel(app.status, app.appliedAt, app.heardBackAt);
  const waitDays = app.heardBackAt ? null : daysSince(app.appliedAt);
  const deadlineDays = daysSince(app.deadline);

  return (
    <>
      <tr
        className={`cursor-pointer align-top transition-colors duration-150 hover:bg-indigo-50/40 ${
          expanded ? "bg-indigo-50/40" : ""
        }`}
        onClick={onToggle}
      >
        {/* Company / role */}
        <td className="px-4 py-3">
          <div className="flex items-start gap-2">
            <Chevron open={expanded} />
            <div className="min-w-0">
              <p className="font-medium text-slate-900">{app.companyName}</p>
              <p className="truncate text-xs text-slate-500">
                {app.roleTitle}
                {app.location ? ` · ${app.location}` : ""}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {app.postingUrl && (
                  <a
                    href={app.postingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
                  >
                    <LinkIcon />
                    Posting
                  </a>
                )}
                {app.contactsAtCompany > 0 && app.companyId && (
                  <Link
                    href="/contacts"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100"
                    title="You have contacts at this company"
                  >
                    <PeopleIcon />
                    {app.contactsAtCompany} contact
                    {app.contactsAtCompany === 1 ? "" : "s"}
                  </Link>
                )}
              </div>
            </div>
          </div>
        </td>

        {/* Status dropdown */}
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <StatusSelect
            value={app.status}
            pending={pending}
            onChange={handleStatus}
          />
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </td>

        {/* Applied */}
        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
          {formatDate(app.appliedAt)}
        </td>

        {/* Heard back */}
        <td className="whitespace-nowrap px-4 py-3">
          {app.heardBackAt ? (
            <span className="text-emerald-700">
              {formatDate(app.heardBackAt)}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>

        {/* Waiting */}
        <td className="whitespace-nowrap px-4 py-3">
          {app.heardBackAt ? (
            <span className="text-slate-400">—</span>
          ) : waitDays === null ? (
            <span className="text-slate-400">—</span>
          ) : (
            <span
              className={`font-medium ${
                wait === "overdue"
                  ? "text-red-600"
                  : wait === "warm"
                    ? "text-amber-600"
                    : "text-slate-500"
              }`}
            >
              {waitDays}d
            </span>
          )}
        </td>

        {/* Deadline */}
        <td className="whitespace-nowrap px-4 py-3">
          {app.deadline ? (
            <span
              className={
                deadlineDays !== null && deadlineDays >= 0
                  ? "text-slate-600"
                  : "text-slate-600"
              }
            >
              {formatDate(app.deadline)}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>

        <td className="px-4 py-3 text-right text-xs text-slate-400">
          {app.events.length > 0 ? `${app.events.length}` : ""}
        </td>
      </tr>

      {expanded && (
        <tr className="bg-slate-50/40">
          <td colSpan={7} className="px-4 pb-5 pt-1">
            <ApplicationDrawer app={app} />
          </td>
        </tr>
      )}
    </>
  );
}

function StatusSelect({
  value,
  pending,
  onChange,
}: {
  value: ApplicationStatus;
  pending: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className={`cursor-pointer rounded-full py-0.5 pl-2.5 pr-6 text-xs font-medium ring-1 ring-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 ${STATUS_BADGE_CLASS[value]}`}
      >
        {APPLICATION_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
    </span>
  );
}

// ── Drawer: timeline + editable fields ───────────────────────────────────

function ApplicationDrawer({ app }: { app: ApplicationRow }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  function patch(field: string, value: string) {
    setError(null);
    startTransition(async () => {
      const r = await updateApplication(app.id, { [field]: value || null });
      if (r.error) setError(r.error);
    });
  }

  function handleAddNote() {
    const trimmed = note.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const r = await addApplicationEvent(app.id, trimmed);
      if (r.error) setError(r.error);
      else setNote("");
    });
  }

  function handleDelete() {
    if (!confirm(`Delete the ${app.companyName} application?`)) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteApplication(app.id);
      if (r.error) setError(r.error);
    });
  }

  // Newest first in the drawer.
  const events = [...app.events].reverse();

  return (
    <div className="grid grid-cols-1 gap-6 rounded-lg border border-slate-200 bg-white p-4 lg:grid-cols-2">
      {/* Left: editable fields */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Details
        </h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <DateField
            label="Applied"
            value={app.appliedAt}
            onCommit={(v) => patch("applied_at", v)}
          />
          <DateField
            label="Heard back"
            value={app.heardBackAt}
            onCommit={(v) => patch("heard_back_at", v)}
          />
          <DateField
            label="Deadline / next date"
            value={app.deadline}
            onCommit={(v) => patch("deadline", v)}
          />
          <TextField
            label="Location"
            value={app.location}
            placeholder="Chicago, IL"
            onCommit={(v) => patch("location", v)}
          />
        </div>
        <div className="mt-3">
          <TextField
            label="Posting URL"
            value={app.postingUrl}
            placeholder="https://…"
            onCommit={(v) => patch("posting_url", v)}
          />
        </div>
        <div className="mt-3">
          <label className="block text-xs font-medium text-slate-500">
            Notes
          </label>
          <textarea
            defaultValue={app.notes ?? ""}
            rows={2}
            placeholder="Recruiter name, comp, referral…"
            onBlur={(e) => {
              if ((e.target.value.trim() || null) !== app.notes)
                patch("notes", e.target.value);
            }}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="mt-4 cursor-pointer rounded-md px-2 py-1 text-xs text-slate-400 transition-colors duration-150 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          Delete application
        </button>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      {/* Right: timeline */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Timeline
        </h3>
        <div className="mt-3 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddNote();
              }
            }}
            placeholder="Add a note or milestone…"
            className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            type="button"
            onClick={handleAddNote}
            disabled={pending || !note.trim()}
            className="cursor-pointer rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {events.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">No events yet.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {events.map((ev) => (
              <li key={ev.id} className="flex gap-3">
                <div className="mt-1.5 flex flex-col items-center">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      ev.status ? "bg-indigo-500" : "bg-slate-300"
                    }`}
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-700">
                    {ev.status ? (
                      <span className="font-medium text-slate-900">
                        {STATUS_LABEL[ev.status]}
                      </span>
                    ) : (
                      ev.note
                    )}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatDate(ev.occurred_at)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ── Small field editors (commit on blur) ─────────────────────────────────

function DateField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string | null;
  onCommit: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500">{label}</label>
      <input
        type="date"
        defaultValue={value ?? ""}
        onChange={(e) => onCommit(e.target.value)}
        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string | null;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500">{label}</label>
      <input
        type="text"
        defaultValue={value ?? ""}
        placeholder={placeholder}
        onBlur={(e) => {
          if ((e.target.value.trim() || null) !== value) onCommit(e.target.value);
        }}
        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>
  );
}

// ── Bits ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "indigo" | "amber" | "blue" | "emerald" | "slate";
  hint?: string;
}) {
  const toneClass: Record<string, string> = {
    indigo: "text-indigo-700",
    amber: "text-amber-700",
    blue: "text-blue-700",
    emerald: "text-emerald-700",
    slate: "text-slate-700",
  };
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass[tone]}`}>{value}</p>
      {hint && <p className="text-xs font-medium text-amber-600">{hint}</p>}
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
}) {
  return (
    <th className="px-4 py-2.5 font-medium">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex cursor-pointer items-center gap-1 hover:text-slate-900"
      >
        {label}
        <span className={`text-[10px] ${active ? "text-slate-700" : "text-transparent"}`}>
          {dir === 1 ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150 ${
        open ? "rotate-90" : ""
      }`}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function LinkIcon() {
  return (
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
        d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
      />
    </svg>
  );
}

function PeopleIcon() {
  return (
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
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
      />
    </svg>
  );
}

function EmptyState() {
  return (
    <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
      <h2 className="text-base font-medium text-slate-900">
        No applications yet
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Add a role you&apos;re applying to and track it from first interest to
        offer.
      </p>
    </div>
  );
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
