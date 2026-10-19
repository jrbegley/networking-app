// Unit checks for the resume optimizer's pure logic. Run: npx tsx test-resume-optimizer.mts
import { readFileSync } from "node:fs";
import {
  isCompiler,
  validateSegmentCandidates,
  validateKeywords,
  validateRewrites,
  type Change,
  type Keyword,
} from "./src/lib/resume-optimizer-types";
import {
  locateSegments,
  validateRewrite,
  spliceSegments,
  plainTextOf,
  markPresent,
  pdfPageCount,
  coverage,
} from "./src/lib/latex-resume";

let fails = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${JSON.stringify(got)}${ok ? "" : " want " + JSON.stringify(want)}`);
}

const source = readFileSync("test-fixtures/resume.tex", "utf8");

// ── isCompiler ──────────────────────────────────────────────────────────
check("isCompiler: accepts xelatex", isCompiler("xelatex"), true);
check("isCompiler: rejects latexmk", isCompiler("latexmk"), false);

// ── validators never throw ─────────────────────────────────────────────
check("validateSegmentCandidates: garbage -> []", validateSegmentCandidates("x"), []);
check("validateSegmentCandidates: null -> []", validateSegmentCandidates(null), []);
check(
  "validateSegmentCandidates: coerces + dedupes ids, drops empty text",
  validateSegmentCandidates({
    segments: [
      { id: 1, section: "Experience", entry: "Acme", text: "a" },
      { id: "1", section: "Experience", entry: "Acme", text: "dup id" },
      { id: "2", section: 5, entry: null, text: "" },
      { id: "3", text: "b" },
    ],
  }),
  [
    { id: "1", section: "Experience", entry: "Acme", text: "a" },
    { id: "3", section: "", entry: "", text: "b" },
  ],
);
check("validateKeywords: garbage -> []", validateKeywords([1, 2]), []);
check(
  "validateKeywords: clamps weight, defaults category, caps at 25",
  (() => {
    const many = Array.from({ length: 30 }, (_, i) => ({ term: `k${i}`, category: "nope", weight: 9 }));
    const out = validateKeywords({ keywords: many });
    return [out.length, out[0]];
  })(),
  [25, { term: "k0", category: "skill", weight: 3 }],
);
check(
  "validateKeywords: drops empty/duplicate terms (case-insensitive)",
  validateKeywords({ keywords: [{ term: "SQL", category: "tool", weight: 2 }, { term: "sql", category: "tool", weight: 1 }, { term: " ", category: "tool", weight: 1 }] }),
  [{ term: "SQL", category: "tool", weight: 2 }],
);
check("validateRewrites: garbage -> []", validateRewrites(undefined, ["a"]), []);
check(
  "validateRewrites: drops unknown ids and non-string text; keywords coerced",
  validateRewrites({ rewrites: [{ id: "a", text: "x", keywords: ["k", 2] }, { id: "zz", text: "y" }, { id: "b", text: 7 }] }, ["a", "b"]),
  [{ id: "a", text: "x", keywords: ["k"] }],
);

// ── locateSegments ──────────────────────────────────────────────────────
const candidates = [
  { id: "s1", section: "Experience", entry: "Acme Corp", text: "Built a REST API in Python and Flask that served 1,200 requests per minute with 99.9\\% uptime" },
  { id: "s2", section: "Experience", entry: "Acme Corp", text: "Wrote unit tests with pytest, raising coverage from 40\\% to 85\\%" },
  { id: "dup", section: "Experience", entry: "Acme Corp", text: "Collaborated with 3 teammates using Git and Jira" },
  { id: "missing", section: "Experience", entry: "Acme Corp", text: "This sentence is not in the resume" },
  { id: "p1", section: "Projects", entry: "Budget Tracker", text: "Designed a PostgreSQL schema and a Node.js backend for tracking \\$2,000 of monthly spending" },
  { id: "overlap", section: "Projects", entry: "Budget Tracker", text: "a PostgreSQL schema" },
];
const segments = locateSegments(source, candidates);
check("locateSegments: keeps verbatim-unique, drops dup/missing/overlap", segments.map((s) => s.id), ["s1", "s2", "p1"]);
check("locateSegments: offsets slice back to text", segments.every((s) => source.slice(s.start, s.end) === s.text), true);
check("locateSegments: sorted by start", segments.every((s, i) => i === 0 || s.start > segments[i - 1].end), true);

// ── validateRewrite ─────────────────────────────────────────────────────
const orig = "Built a REST API in Python and Flask that served 1,200 requests per minute with 99.9\\% uptime";
check("validateRewrite: clean rephrase ok", validateRewrite(orig, "Developed a Python/Flask REST API handling 1,200 requests per minute at 99.9\\% uptime"), { ok: true });
check("validateRewrite: dropped number", validateRewrite(orig, "Developed a Python/Flask REST API handling heavy traffic at 99.9\\% uptime").ok, false);
check("validateRewrite: unbalanced braces", validateRewrite(orig, "Built a \\textbf{REST API in Python and Flask that served 1,200 requests per minute with 99.9\\% uptime").ok, false);
check("validateRewrite: new command", validateRewrite(orig, "Built a \\textbf{REST API} in Python and Flask that served 1,200 requests per minute with 99.9\\% uptime").ok, false);
check("validateRewrite: blank line", validateRewrite(orig, "Built a REST API in Python\n\nand Flask that served 1,200 requests per minute with 99.9\\% uptime").ok, false);
check("validateRewrite: added \\item", validateRewrite(orig, "\\item Built a REST API in Python and Flask that served 1,200 requests per minute with 99.9\\% uptime").ok, false);
check("validateRewrite: too long", validateRewrite(orig, orig + " and additionally wrote extensive documentation for every endpoint, module, and deployment step").ok, false);
check("validateRewrite: too short", validateRewrite(orig, "Built API, 1,200 rpm, 99.9\\%").ok, false);
check("validateRewrite: empty", validateRewrite(orig, "   ").ok, false);
check(
  "validateRewrite: keeps existing command",
  validateRewrite("Designed a \\textbf{PostgreSQL} schema for 3 teams", "Architected a \\textbf{PostgreSQL} schema used by 3 teams"),
  { ok: true },
);

// ── spliceSegments ──────────────────────────────────────────────────────
const changes: Change[] = segments.map((segment) => ({
  segment,
  rewrite: segment.id === "s1"
    ? { id: "s1", text: "Developed a Python/Flask REST API handling 1,200 requests per minute at 99.9\\% uptime", keywords: ["Flask"] }
    : segment.id === "p1"
      ? { id: "p1", text: "Modeled a PostgreSQL schema and built a Node.js backend tracking \\$2,000 of monthly spending", keywords: ["Node.js"] }
      : null,
  accepted: true,
  droppedReason: null,
}));
const spliced = spliceSegments(source, changes);
check("spliceSegments: both rewrites land", [spliced.includes("Developed a Python/Flask"), spliced.includes("Modeled a PostgreSQL")], [true, true]);
check("spliceSegments: originals gone", [spliced.includes("Built a REST API"), spliced.includes("Designed a PostgreSQL")], [false, false]);
check(
  "spliceSegments: outside bytes identical",
  (() => {
    const s1 = segments.find((s) => s.id === "s1")!;
    const p1 = segments.find((s) => s.id === "p1")!;
    const r1 = changes.find((c) => c.segment.id === "s1")!.rewrite!.text;
    const want = source.slice(0, s1.start) + r1 + source.slice(s1.end, p1.start) + changes.find((c) => c.segment.id === "p1")!.rewrite!.text + source.slice(p1.end);
    return spliced === want;
  })(),
  true,
);
check(
  "spliceSegments: unaccepted change is skipped",
  spliceSegments(source, changes.map((c) => ({ ...c, accepted: false }))) === source,
  true,
);

// ── plainTextOf / markPresent ───────────────────────────────────────────
const plain = plainTextOf(source);
check("plainTextOf: strips commands, keeps words", [plain.includes("\\resumeItem"), plain.includes("Jordan Example"), plain.includes("PostgreSQL")], [false, true, true]);
check("plainTextOf: unescapes percent/dollar", [plain.includes("99.9%"), plain.includes("$2,000")], [true, true]);
check("plainTextOf: drops comments", plainTextOf("real % a comment\nline").includes("comment"), false);
const kws: Omit<Keyword, "present">[] = [
  { term: "C++", category: "skill", weight: 3 },
  { term: "node.js", category: "tool", weight: 2 },
  { term: "Kubernetes", category: "tool", weight: 3 },
  { term: "Java", category: "skill", weight: 2 }, // must NOT match "JavaScript"
  { term: "C", category: "skill", weight: 1 },    // must NOT match "C++"
];
check(
  "markPresent: whole-word, case-insensitive, symbol-safe",
  markPresent(kws, plain).map((k) => k.present),
  [true, true, false, false, false],
);

// ── pdfPageCount ────────────────────────────────────────────────────────
const onePage = "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n%%EOF";
const twoPage = "%PDF-1.4\n2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj\n3 0 obj << /Type/Page /Parent 2 0 R >> endobj\n4 0 obj << /Type /Page /Parent 2 0 R >> endobj\n%%EOF";
const enc = new TextEncoder();
check("pdfPageCount: one page", pdfPageCount(enc.encode(onePage)), 1);
check("pdfPageCount: two pages", pdfPageCount(enc.encode(twoPage)), 2);
check("pdfPageCount: falls back to /Count", pdfPageCount(enc.encode("%PDF-1.4\n<< /Type /Pages /Count 3 >>")), 3);
check("pdfPageCount: never below 1", pdfPageCount(enc.encode("not a pdf")), 1);

// ── coverage ────────────────────────────────────────────────────────────
const presentKws: Keyword[] = [
  { term: "Python", category: "skill", weight: 3, present: true },
  { term: "Flask", category: "tool", weight: 2, present: false },
  { term: "Node.js", category: "tool", weight: 2, present: true },
  { term: "Kubernetes", category: "tool", weight: 3, present: false },
];
check("coverage: matched/incorporated/missing", coverage(presentKws, changes), { matched: 2, incorporated: 1, missing: 1, total: 4 });
check(
  "coverage: reverted rewrite doesn't count as incorporated",
  coverage(presentKws, changes.map((c) => ({ ...c, accepted: false }))),
  { matched: 2, incorporated: 0, missing: 2, total: 4 },
);

// ── compileLatex live smoke (LIVE_TESTS=1 only) ─────────────────────────
if (process.env.LIVE_TESTS === "1") {
  const { compileLatex } = await import("./src/lib/latex-compile");
  const res = await compileLatex(source, "pdflatex");
  check("compileLatex(live): ok", res.ok, true);
  if (res.ok) {
    check("compileLatex(live): pdf magic", String.fromCharCode(...res.pdf.slice(0, 4)), "%PDF");
    check("compileLatex(live): fixture is one page", pdfPageCount(res.pdf), 1);
  } else {
    console.log(res.log);
  }
  const bad = await compileLatex("\\documentclass{article}\\begin{document}\\undefinedmacro\\end{document}", "pdflatex");
  check("compileLatex(live): broken source -> log", [bad.ok, !bad.ok && bad.log.length > 0], [false, true]);
}

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
