// Unit checks for the cover-letter domain logic. Run: npx tsx test-cover-letter.mts
import {
  validateClassification,
  validateCoverLetterContent,
} from "./src/lib/cover-letter-types";

let fails = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${JSON.stringify(got)}${ok ? "" : " want " + JSON.stringify(want)}`);
}

// validateClassification: unknown role -> "letterhead" (safest = untouched)
check(
  "classify: unknown role -> letterhead",
  validateClassification({ roles: ["date", "wat", "body"], bodyStart: 2, bodyEnd: 2 }, 3).roles,
  ["date", "letterhead", "body"],
);
// wrong length -> pad/truncate to paragraphCount with "letterhead"
check(
  "classify: pads to count",
  validateClassification({ roles: ["date"], bodyStart: 0, bodyEnd: 0 }, 3).roles.length,
  3,
);
// malformed -> all letterhead, body range clamped
check(
  "classify: malformed -> safe default",
  validateClassification("nonsense", 2),
  { roles: ["letterhead", "letterhead"], bodyStart: -1, bodyEnd: -1 },
);
// bodyStart/End clamped into range
check(
  "classify: clamps body range",
  (() => { const c = validateClassification({ roles: ["body","body"], bodyStart: -5, bodyEnd: 99 }, 2); return [c.bodyStart, c.bodyEnd]; })(),
  [0, 1],
);

// validateCoverLetterContent: body always >= 1 paragraph
check(
  "content: empty body -> one empty paragraph",
  validateCoverLetterContent({ date: "", recipient: [], salutation: "", body: [] }).body.length,
  1,
);
check(
  "content: coerces non-strings",
  validateCoverLetterContent({ date: 5, recipient: "x", salutation: null, body: ["a", 2] }),
  { date: "", recipient: [], salutation: "", body: ["a"] },
);
check(
  "content: malformed -> safe default",
  validateCoverLetterContent("nope"),
  { date: "", recipient: [], salutation: "", body: [""] },
);

process.exit(fails ? 1 : 0);
