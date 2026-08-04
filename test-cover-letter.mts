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

import { readFileSync } from "node:fs";
import { extractParagraphs, templateExampleText, applyContent } from "./src/lib/docx-template";
import PizZip from "pizzip";

const fixture = new Uint8Array(readFileSync("test-fixtures/template.docx"));

const paras = extractParagraphs(fixture);
check("extract: paragraph count", paras.length, 9);
check("extract: salutation text", paras[4].text, "Dear Hiring Manager,");

check("exampleText contains body", /first body paragraph/.test(templateExampleText(fixture)), true);

const cls = { roles: ["letterhead","date","recipient","recipient","salutation","body","body","closing","signature"], bodyStart: 5, bodyEnd: 6 } as const;
const content = { date: "2026-08-03", recipient: ["Talent Team", "Globex Inc"], salutation: "Dear Globex team,", body: ["New para one.", "New para two.", "New para three."] };
const out = applyContent(fixture, cls as any, content);

const outZip = new PizZip(out);
const outDoc = outZip.file("word/document.xml").asText();
const inZip = new PizZip(fixture);

// margins (sectPr) preserved byte-for-byte
check("apply: sectPr unchanged", /<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/.test(outDoc), true);
// header part unchanged
check("apply: header unchanged", outZip.file("word/header1.xml").asText(), inZip.file("word/header1.xml").asText());
// new body present
check("apply: body para one present", outDoc.includes("New para one."), true);
check("apply: body para three present (cloned)", outDoc.includes("New para three."), true);
// letterhead + signature preserved
check("apply: letterhead kept", outDoc.includes("Jane Applicant"), true);
check("apply: closing kept", outDoc.includes("Sincerely,"), true);
// salutation replaced
check("apply: salutation replaced", outDoc.includes("Dear Globex team,"), true);
check("apply: old salutation gone", outDoc.includes("Dear Hiring Manager,"), false);
// output re-extracts cleanly: letterhead+date+2 recipient+salutation+3 body+closing+signature = 10
check("apply: re-extract count", extractParagraphs(out).length, 10);

process.exit(fails ? 1 : 0);
