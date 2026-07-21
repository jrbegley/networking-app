/**
 * Shared job-application metadata, used by the applications list + timeline.
 * Single source of truth for status order, labels, badge colors, and the
 * "how long have I been waiting to hear back" aging logic.
 *
 * Parallels pipeline.ts (which does the same for networking-contact stages).
 */

export const APPLICATION_STATUSES = [
  "interested",
  "applied",
  "online_assessment",
  "phone_screen",
  "interview",
  "final_round",
  "offer",
  "rejected",
  "withdrawn",
  "ghosted",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  interested: "Interested",
  applied: "Applied",
  online_assessment: "Online assessment",
  phone_screen: "Phone screen",
  interview: "Interview",
  final_round: "Final round",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  ghosted: "Ghosted",
};

/**
 * Tailwind badge class per status. Color tracks progress:
 * - slate before you apply
 * - amber while you're waiting on them (applied / OA)
 * - blue → violet as you advance through rounds
 * - emerald for an offer
 * - red / zinc for the terminal negatives
 */
export const STATUS_BADGE_CLASS: Record<ApplicationStatus, string> = {
  interested: "bg-slate-100 text-slate-700 ring-slate-200",
  applied: "bg-amber-100 text-amber-800 ring-amber-200",
  online_assessment: "bg-yellow-100 text-yellow-800 ring-yellow-200",
  phone_screen: "bg-sky-100 text-sky-800 ring-sky-200",
  interview: "bg-blue-100 text-blue-800 ring-blue-200",
  final_round: "bg-violet-100 text-violet-800 ring-violet-200",
  offer: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  rejected: "bg-red-100 text-red-700 ring-red-200",
  withdrawn: "bg-zinc-100 text-zinc-600 ring-zinc-200",
  ghosted: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};

export function statusOrder(status: ApplicationStatus): number {
  return APPLICATION_STATUSES.indexOf(status);
}

// Statuses that are still live — the application could still turn into an
// offer. Everything else is closed (won or lost).
const CLOSED_STATUSES: ReadonlySet<ApplicationStatus> = new Set([
  "offer",
  "rejected",
  "withdrawn",
  "ghosted",
] as ApplicationStatus[]);

export function isOpen(status: ApplicationStatus): boolean {
  return !CLOSED_STATUSES.has(status);
}

// You're "awaiting a response" after you've applied but before anyone has
// engaged. Once you're in a round, the clock is about scheduling, not silence.
const AWAITING_STATUSES: ReadonlySet<ApplicationStatus> = new Set([
  "applied",
  "online_assessment",
] as ApplicationStatus[]);

export function isAwaitingResponse(status: ApplicationStatus): boolean {
  return AWAITING_STATUSES.has(status);
}

/** Whole days between a YYYY-MM-DD date and today (local). Null-safe. */
export function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const then = Date.parse(dateStr);
  if (!Number.isFinite(then)) return null;
  const ms = Date.now() - then;
  if (ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

export type WaitLevel = "none" | "warm" | "overdue";

/**
 * How loudly to flag an application you haven't heard back on. Only applies
 * while awaiting a response and not yet heard back. Warmer thresholds than
 * the networking pipeline — job applications reasonably take longer.
 */
export function waitLevel(
  status: ApplicationStatus,
  appliedAt: string | null,
  heardBackAt: string | null,
): WaitLevel {
  if (heardBackAt || !isAwaitingResponse(status)) return "none";
  const days = daysSince(appliedAt);
  if (days === null) return "none";
  if (days >= 14) return "overdue";
  if (days >= 7) return "warm";
  return "none";
}
