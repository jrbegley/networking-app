// Unit checks for the job-application domain logic (no DB, no network).
// Run: npx tsx test-applications.mts

const {
  isOpen,
  isAwaitingResponse,
  statusOrder,
  daysSince,
  waitLevel,
  APPLICATION_STATUSES,
} = await import("./src/lib/applications");

let fails = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${label}: ${JSON.stringify(got)}${ok ? "" : " want " + JSON.stringify(want)}`,
  );
}

// Dates relative to today so the aging thresholds are exercised deterministically.
const iso = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

check("open: applied", isOpen("applied"), true);
check("open: interview", isOpen("interview"), true);
check("closed: rejected", isOpen("rejected"), false);
check("closed: offer", isOpen("offer"), false);
check("closed: ghosted", isOpen("ghosted"), false);

check("awaiting: applied", isAwaitingResponse("applied"), true);
check("awaiting: OA", isAwaitingResponse("online_assessment"), true);
check("not awaiting: interview", isAwaitingResponse("interview"), false);
check("not awaiting: interested", isAwaitingResponse("interested"), false);

check("order: interested < applied", statusOrder("interested") < statusOrder("applied"), true);
check("order: applied < offer", statusOrder("applied") < statusOrder("offer"), true);
check("statuses count", APPLICATION_STATUSES.length, 10);

check("daysSince null", daysSince(null), null);
check("daysSince 5d", daysSince(iso(5)), 5);
check("daysSince future clamps null", daysSince(iso(-3)), null);

// Waiting only flags while awaiting a response and not yet heard back.
check("wait none: fresh applied", waitLevel("applied", iso(2), null), "none");
check("wait warm: applied 8d", waitLevel("applied", iso(8), null), "warm");
check("wait overdue: applied 15d", waitLevel("applied", iso(15), null), "overdue");
check("wait none: heard back", waitLevel("applied", iso(20), iso(1)), "none");
check("wait none: in interview", waitLevel("interview", iso(20), null), "none");
check("wait none: no applied date", waitLevel("applied", null, null), "none");

process.exit(fails ? 1 : 0);
