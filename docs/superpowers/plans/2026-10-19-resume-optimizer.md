# Resume Optimizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tailor the user's stored LaTeX resume to a job listing (keyword-aware bullet rephrasing), compile it to PDF through a hosted LaTeX service, review it bullet-by-bullet, and keep every saved result in a new **Resumes** tab.

**Architecture:** Claude segments the `.tex` into exact rewritable substrings → code verifies each is verbatim-unique → Claude rewrites segments against extracted job keywords → code validates each rewrite against hard edit rules → code splices → `compileLatex` POSTs to a LaTeX-on-HTTP service. All LaTeX/PDF logic lives in pure modules tested with `npx tsx`; server actions in `src/app/(app)/resumes/actions.ts` orchestrate; the Add Application dialog hands off to a shared `ResumeOptimizerPanel` after creating the row; a `/resumes` page lists saved `tailored_resumes` rows.

**Tech Stack:** Next.js 15 (App Router, server actions), React 19, Supabase (Postgres + Storage, RLS), `@anthropic-ai/sdk` via the existing `src/lib/claude.ts`, Tailwind 4, `npx tsx` test scripts. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-resume-optimizer-design.md`

## Global Constraints

- No new npm dependencies.
- Pure modules (`src/lib/latex-resume.ts`, `src/lib/resume-optimizer-types.ts`) import nothing from `next`, `@supabase/*`, or `@anthropic-ai/sdk`.
- `src/lib/latex-compile.ts` is the only file that references the compile service. Env var `LATEX_COMPILE_URL`, default `https://latex.ytotech.com/builds/sync`.
- Compilers: exactly `"pdflatex" | "xelatex" | "lualatex"`; default `"pdflatex"`.
- Edit rules (every accepted rewrite): balanced braces; no blank lines; no added `\item`/`\begin`/`\end`/`\section`/`\subsection`/`\\`; command set ⊆ original's; every number/%/currency/year token of the original present; length within ±15%.
- The Applications page's rendered table/drawer is unchanged. Only `AddApplicationDialog` (checkbox + handoff) and `createApplication` (returns `id`) change there.
- Migration `010_resume_optimizer.sql` is idempotent and is applied by the user in the Supabase SQL editor; the app shows a "not set up" note when it's missing (pattern from migrations 007–009).
- Tests: `npx tsx test-resume-optimizer.mts` — no network, no DB, no framework. Live compile smoke test only when `LIVE_TESTS=1`.
- Server action error shape: `{ ok: false; reason: string; log?: string }`. Reasons: `not_set_up`, `no_resume_tex`, `needs_paste`, `no_segments`, `compile_failed`, else the raw message.
- Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Existing suites must still pass: `npx tsx test-cover-letter.mts`, `npx tsx test-job-posting.mts`, `npx tsx test-context.mts`; and `npm run lint` + `npx tsc --noEmit` must be clean.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `supabase/migrations/010_resume_optimizer.sql` | profile columns, `tailored_resumes` table, bucket + RLS | 1 |
| `src/lib/resume-optimizer-types.ts` | types + never-throw validators for Claude responses | 1 |
| `src/lib/latex-resume.ts` | segment location, rewrite validation, splice, plain-text, keyword presence, PDF page count, coverage | 1 |
| `test-fixtures/resume.tex`, `test-resume-optimizer.mts` | fixture + unit tests | 1, 2 |
| `src/lib/latex-compile.ts` | `compileLatex` HTTP client | 2 |
| `.env.example` | `LATEX_COMPILE_URL` + privacy note | 2 |
| `src/lib/claude.ts` | `segmentResumeTex`, `extractJobKeywords`, `rewriteResumeSegments` | 2 |
| `src/lib/job-description.ts` | `resolveJobDescription` (moved out of the server-action file) | 3 |
| `src/app/(app)/applications/actions.ts` | `createApplication` returns `id`; import `resolveJobDescription` | 3 |
| `src/app/(app)/resumes/actions.ts` | optimize / refine / recompile / save / delete / signed URL | 3 |
| `src/app/(app)/settings/actions.ts` | `saveResumeTex`, `clearResumeTex`, `resumeTexSource` | 3 |
| `src/app/(app)/settings/ResumeTexSection.tsx`, `settings/page.tsx` | Settings UI | 4 |
| `src/app/(app)/resumes/ResumeOptimizerPanel.tsx` | shared review panel | 5 |
| `src/app/(app)/applications/AddApplicationDialog.tsx`, `ApplicationsView.tsx`, `applications/page.tsx` | checkbox + handoff; `hasResumeTex` prop | 5 |
| `src/app/(app)/NavLinks.tsx`, `resumes/page.tsx`, `resumes/ResumesView.tsx` | Resumes tab | 6 |

Task dependencies: 1 → 2 → 3 → (4 ∥ 5) → 6 → 7.

---

### Task 1: Migration, types, and the pure LaTeX module

**Files:**
- Create: `supabase/migrations/010_resume_optimizer.sql`
- Create: `src/lib/resume-optimizer-types.ts`
- Create: `src/lib/latex-resume.ts`
- Create: `test-fixtures/resume.tex`
- Create: `test-resume-optimizer.mts`

**Interfaces:**
- Produces (used by Tasks 2–6):
  - `Compiler`, `COMPILERS`, `isCompiler(v): v is Compiler`
  - `SegmentCandidate = { id; section; entry; text }`, `Segment = SegmentCandidate & { start; end }`
  - `Keyword = { term; category; weight; present }`, `KeywordCategory`, `Rewrite = { id; text; keywords }`
  - `Change = { segment; rewrite; accepted; droppedReason }`, `OptimizerResult`
  - `validateSegmentCandidates(raw): SegmentCandidate[]`, `validateKeywords(raw): Omit<Keyword,"present">[]`, `validateRewrites(raw, ids): Rewrite[]`
  - `locateSegments`, `validateRewrite`, `spliceSegments`, `plainTextOf`, `markPresent`, `pdfPageCount`, `coverage`

- [ ] **Step 1: Write the migration**

`supabase/migrations/010_resume_optimizer.sql`:

```sql
-- ============================================================================
-- Migration 010: resume optimizer
-- Created 2026-10-19
--
-- One stored LaTeX resume per user (profiles.resume_tex) and a table of
-- tailored resumes, one row per (application, run) the user chose to save.
-- The PDF lives in the private `tailored-resumes` bucket at
-- `<user_id>/<tailored_resume_id>.pdf`; the .tex, keyword report and bullet
-- diff live in the row so the Resumes tab can re-open them without
-- recomputing. Mirrors migrations 003/009. Idempotent — safe to re-run.
--
-- Apply by pasting into the Supabase SQL editor. The app tolerates this
-- migration being unapplied (Settings and the Resumes tab show a "not set
-- up yet" note), so deploy order doesn't matter.
-- ============================================================================

-- ── Profile columns ──────────────────────────────────────────────────────
alter table profiles
  add column if not exists resume_tex text,
  add column if not exists resume_tex_name text,
  add column if not exists resume_tex_at timestamptz,
  add column if not exists resume_tex_compiler text not null default 'pdflatex',
  add column if not exists resume_tex_pages integer;

-- ── tailored_resumes ─────────────────────────────────────────────────────
create table if not exists tailored_resumes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- Nullable + set null so the saved resume outlives a deleted application;
  -- company_name/role_title are copied so the row stays labelled.
  application_id uuid references applications(id) on delete set null,
  company_name text not null,
  role_title text not null,
  compiler text not null default 'pdflatex',
  tex text not null,
  keywords jsonb not null default '[]'::jsonb,
  changes jsonb not null default '[]'::jsonb,
  page_warning boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists tailored_resumes_owner_idx
  on tailored_resumes (owner_id, created_at desc);

alter table tailored_resumes enable row level security;

drop policy if exists "Users read own tailored resumes" on tailored_resumes;
create policy "Users read own tailored resumes"
  on tailored_resumes for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists "Users insert own tailored resumes" on tailored_resumes;
create policy "Users insert own tailored resumes"
  on tailored_resumes for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "Users update own tailored resumes" on tailored_resumes;
create policy "Users update own tailored resumes"
  on tailored_resumes for update to authenticated
  using (owner_id = auth.uid());

drop policy if exists "Users delete own tailored resumes" on tailored_resumes;
create policy "Users delete own tailored resumes"
  on tailored_resumes for delete to authenticated
  using (owner_id = auth.uid());

-- ── Bucket ────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tailored-resumes',
  'tailored-resumes',
  false,
  10 * 1024 * 1024, -- 10MB cap; compiled resumes are <1MB
  array['application/pdf']
)
on conflict (id) do nothing;

-- ── Storage policies ─────────────────────────────────────────────────────
-- File path convention: `<user_id>/<tailored_resume_id>.pdf`.

drop policy if exists "Users read own tailored resume pdfs" on storage.objects;
create policy "Users read own tailored resume pdfs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tailored-resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users upload own tailored resume pdfs" on storage.objects;
create policy "Users upload own tailored resume pdfs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tailored-resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update own tailored resume pdfs" on storage.objects;
create policy "Users update own tailored resume pdfs"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'tailored-resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete own tailored resume pdfs" on storage.objects;
create policy "Users delete own tailored resume pdfs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'tailored-resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

- [ ] **Step 2: Write the fixture**

`test-fixtures/resume.tex` (Jake's-template style; compiles with stock TeX Live; two identical bullets on purpose):

```latex
\documentclass[letterpaper,11pt]{article}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\pagestyle{empty}
\titleformat{\section}{\scshape\large\raggedright}{}{0em}{}[\titlerule]

\newcommand{\resumeItem}[1]{\item\small{#1 \vspace{-2pt}}}
\newcommand{\resumeSubheading}[4]{
  \item
  \begin{tabular*}{\textwidth}[t]{l@{\extracolsep{\fill}}r}
    \textbf{#1} & #2 \\
    \textit{\small#3} & \textit{\small #4} \\
  \end{tabular*}\vspace{-7pt}
}
\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}

\begin{document}

\begin{center}
  \textbf{\Huge \scshape Jordan Example} \\ \vspace{1pt}
  \small 555-010-0199 $|$ \href{mailto:jordan@example.com}{jordan@example.com}
\end{center}

\section{Experience}
\resumeSubHeadingListStart
  \resumeSubheading{Software Engineering Intern}{Jun 2025 -- Aug 2025}{Acme Corp}{Chicago, IL}
  \resumeItemListStart
    \resumeItem{Built a REST API in Python and Flask that served 1,200 requests per minute with 99.9\% uptime}
    \resumeItem{Wrote unit tests with pytest, raising coverage from 40\% to 85\%}
    \resumeItem{Collaborated with 3 teammates using Git and Jira}
  \resumeItemListEnd
  \resumeSubheading{Teaching Assistant}{Jan 2025 -- May 2025}{State University}{Columbus, OH}
  \resumeItemListStart
    \resumeItem{Collaborated with 3 teammates using Git and Jira}
  \resumeItemListEnd
\resumeSubHeadingListEnd

\section{Projects}
\begin{itemize}[leftmargin=0.15in]
  \item \textbf{Budget Tracker} -- Designed a PostgreSQL schema and a Node.js backend for tracking \$2,000 of monthly spending
  \item \textbf{Weather CLI} -- Parsed JSON from a public API in C++ and cached results locally
\end{itemize}

\section{Skills}
\textbf{Languages}: Python, C++, JavaScript, SQL \\
\textbf{Tools}: Git, Docker, Node.js, PostgreSQL

\end{document}
```

- [ ] **Step 3: Write the failing tests**

`test-resume-optimizer.mts`:

```ts
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

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 4: Run the tests to confirm they fail**

Run: `npx tsx test-resume-optimizer.mts`
Expected: fails with `Cannot find module './src/lib/resume-optimizer-types'`.

- [ ] **Step 5: Write the types module**

`src/lib/resume-optimizer-types.ts`:

```ts
// Types + never-throw validators for the resume optimizer. Pure: no Next,
// Supabase, or Anthropic imports, so it unit-tests with `npx tsx` and is safe
// to import from client components.

export type Compiler = "pdflatex" | "xelatex" | "lualatex";
export const COMPILERS: readonly Compiler[] = ["pdflatex", "xelatex", "lualatex"];
export function isCompiler(v: unknown): v is Compiler {
  return typeof v === "string" && (COMPILERS as readonly string[]).includes(v);
}

/** What Claude proposes: an exact substring of the .tex plus where it sits. */
export type SegmentCandidate = { id: string; section: string; entry: string; text: string };
/** A candidate that code verified occurs exactly once; offsets into the source. */
export type Segment = SegmentCandidate & { start: number; end: number };

export type KeywordCategory = "skill" | "tool" | "domain" | "soft";
const CATEGORIES: readonly KeywordCategory[] = ["skill", "tool", "domain", "soft"];
export type Keyword = { term: string; category: KeywordCategory; weight: 1 | 2 | 3; present: boolean };

/** One rewritten segment; `keywords` are the terms Claude says it worked in. */
export type Rewrite = { id: string; text: string; keywords: string[] };

export type Change = {
  segment: Segment;
  rewrite: Rewrite | null;       // null = Claude left it alone
  accepted: boolean;             // user can revert/restore in the panel
  droppedReason: string | null;  // set when a rewrite failed validation (original kept)
};

export type OptimizerResult = {
  originalTex: string;
  tex: string;
  compiler: Compiler;
  keywords: Keyword[];
  changes: Change[];
  pageWarning: boolean;
};

export const MAX_KEYWORDS = 25;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Never throws. Ids coerced to strings and de-duplicated; empty text dropped. */
export function validateSegmentCandidates(raw: unknown): SegmentCandidate[] {
  try {
    const list = (raw as { segments?: unknown })?.segments;
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const out: SegmentCandidate[] = [];
    for (const item of list as Record<string, unknown>[]) {
      if (!item || typeof item !== "object") continue;
      const id = typeof item.id === "number" ? String(item.id) : str(item.id);
      const text = str(item.text);
      if (!id || !text.trim() || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, section: str(item.section), entry: str(item.entry), text });
    }
    return out;
  } catch {
    return [];
  }
}

/** Never throws. ≤ MAX_KEYWORDS, weight clamped 1–3, unknown category → "skill", terms unique (case-insensitive). */
export function validateKeywords(raw: unknown): Omit<Keyword, "present">[] {
  try {
    const list = (raw as { keywords?: unknown })?.keywords;
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const out: Omit<Keyword, "present">[] = [];
    for (const item of list as Record<string, unknown>[]) {
      if (!item || typeof item !== "object") continue;
      const term = str(item.term).trim();
      if (!term || seen.has(term.toLowerCase())) continue;
      seen.add(term.toLowerCase());
      const w = typeof item.weight === "number" && Number.isFinite(item.weight) ? Math.trunc(item.weight) : 2;
      const weight = (Math.min(3, Math.max(1, w)) as 1 | 2 | 3);
      const category = CATEGORIES.includes(item.category as KeywordCategory) ? (item.category as KeywordCategory) : "skill";
      out.push({ term, category, weight });
      if (out.length >= MAX_KEYWORDS) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Never throws. Keeps only rewrites whose id is a known segment and whose text is a string. */
export function validateRewrites(raw: unknown, segmentIds: readonly string[]): Rewrite[] {
  try {
    const list = (raw as { rewrites?: unknown })?.rewrites;
    if (!Array.isArray(list)) return [];
    const known = new Set(segmentIds);
    const seen = new Set<string>();
    const out: Rewrite[] = [];
    for (const item of list as Record<string, unknown>[]) {
      if (!item || typeof item !== "object") continue;
      const id = typeof item.id === "number" ? String(item.id) : str(item.id);
      if (!known.has(id) || seen.has(id) || typeof item.text !== "string") continue;
      seen.add(id);
      const keywords = Array.isArray(item.keywords)
        ? (item.keywords as unknown[]).filter((k): k is string => typeof k === "string")
        : [];
      out.push({ id, text: item.text, keywords });
    }
    return out;
  } catch {
    return [];
  }
}
```

- [ ] **Step 6: Write the pure LaTeX module**

`src/lib/latex-resume.ts`:

```ts
// Pure LaTeX-resume helpers for the optimizer: no network, DB, or LLM.
// The LLM proposes; everything here verifies and applies mechanically.
import type { Change, Keyword, Segment, SegmentCandidate } from "./resume-optimizer-types";

/**
 * Keep only candidates whose text occurs exactly once, verbatim, in the
 * source; assign offsets; drop any that overlap an earlier-accepted one.
 * Returned sorted by start.
 */
export function locateSegments(source: string, candidates: SegmentCandidate[]): Segment[] {
  const accepted: Segment[] = [];
  for (const c of candidates) {
    const start = source.indexOf(c.text);
    if (start < 0) continue;                                  // not verbatim
    if (source.indexOf(c.text, start + 1) >= 0) continue;     // not unique
    const end = start + c.text.length;
    const overlaps = accepted.some((s) => start < s.end && end > s.start);
    if (overlaps) continue;
    accepted.push({ ...c, start, end });
  }
  return accepted.sort((a, b) => a.start - b.start);
}

export const LENGTH_TOLERANCE = 0.15;

const COMMAND_RE = /\\[a-zA-Z@]+/g;
const NUMBER_RE = /\$?\d[\d,]*(?:\.\d+)?%?/g;
// Structural tokens a rephrase must never introduce.
const STRUCTURE_RES: RegExp[] = [/\\item\b/g, /\\begin\b/g, /\\end\b/g, /\\section\b/g, /\\subsection\b/g, /\\\\/g];

function count(re: RegExp, s: string): number {
  return (s.match(re) ?? []).length;
}

/** Brace balance ignoring escaped `\{` / `\}`; false if depth ever goes negative. */
function bracesBalanced(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") { i++; continue; } // skip escaped char
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth < 0) return false; }
  }
  return depth === 0;
}

/** The edit rules from the spec. Pure; never throws. */
export function validateRewrite(
  original: string,
  rewritten: string,
): { ok: true } | { ok: false; reason: string } {
  if (!rewritten.trim()) return { ok: false, reason: "empty" };
  if (/\n\s*\n/.test(rewritten)) return { ok: false, reason: "blank_line" };
  if (!bracesBalanced(rewritten)) return { ok: false, reason: "unbalanced_braces" };
  for (const re of STRUCTURE_RES) {
    if (count(re, rewritten) > count(re, original)) return { ok: false, reason: "structure" };
  }
  const origCmds = new Set(original.match(COMMAND_RE) ?? []);
  for (const cmd of rewritten.match(COMMAND_RE) ?? []) {
    if (!origCmds.has(cmd)) return { ok: false, reason: "new_command" };
  }
  for (const n of original.match(NUMBER_RE) ?? []) {
    if (!rewritten.includes(n)) return { ok: false, reason: "dropped_number" };
  }
  const delta = Math.abs(rewritten.length - original.length) / Math.max(1, original.length);
  if (delta > LENGTH_TOLERANCE) return { ok: false, reason: "length" };
  return { ok: true };
}

/** Apply accepted rewrites from the highest offset down so earlier offsets stay valid. */
export function spliceSegments(source: string, changes: Change[]): string {
  const live = changes
    .filter((c) => c.accepted && c.rewrite)
    .sort((a, b) => b.segment.start - a.segment.start);
  let out = source;
  for (const c of live) {
    out = out.slice(0, c.segment.start) + c.rewrite!.text + out.slice(c.segment.end);
  }
  return out;
}

/** Rough plain text of a .tex: comments, commands, braces and math gone; escapes resolved. */
export function plainTextOf(source: string): string {
  return source
    .replace(/(^|[^\\])%.*$/gm, "$1")        // comments (not \%)
    .replace(/\\\[[\s\S]*?\\\]/g, " ")       // display math
    .replace(/\$[^$]*\$/g, " ")               // inline math ($|$ separators etc.)
    .replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, " ") // commands + optional [arg]
    .replace(/\\([%$&#_{}])/g, "$1")          // escapes
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive whole-term match; `C` must not match `C++`, `Java` must not match `JavaScript`. */
export function markPresent(keywords: Omit<Keyword, "present">[], plainText: string): Keyword[] {
  return keywords.map((k) => {
    const re = new RegExp(`(?<![A-Za-z0-9+#])${escapeRe(k.term)}(?![A-Za-z0-9+#])`, "i");
    return { ...k, present: re.test(plainText) };
  });
}

/** Counts `/Type /Page` objects; falls back to the largest `/Count N`; never below 1. */
export function pdfPageCount(bytes: Uint8Array): number {
  const text = new TextDecoder("latin1").decode(bytes);
  const pages = count(/\/Type\s*\/Page(?![s])/g, text);
  if (pages > 0) return pages;
  let best = 0;
  for (const m of text.matchAll(/\/Count\s+(\d+)/g)) best = Math.max(best, Number(m[1]));
  return Math.max(1, best);
}

export type Coverage = { matched: number; incorporated: number; missing: number; total: number };

/** Keyword tallies for chips and the Resumes table. */
export function coverage(keywords: Keyword[], changes: Change[]): Coverage {
  const incorporatedTerms = new Set<string>();
  for (const c of changes) {
    if (!c.accepted || !c.rewrite) continue;
    for (const k of c.rewrite.keywords) incorporatedTerms.add(k.toLowerCase());
  }
  let matched = 0, incorporated = 0;
  for (const k of keywords) {
    if (k.present) matched++;
    else if (incorporatedTerms.has(k.term.toLowerCase())) incorporated++;
  }
  return { matched, incorporated, missing: keywords.length - matched - incorporated, total: keywords.length };
}
```

- [ ] **Step 7: Run the tests until they pass**

Run: `npx tsx test-resume-optimizer.mts`
Expected: every line `PASS`, final line `All checks passed.`, exit 0. If a `plainTextOf` or `markPresent` check fails, adjust the regexes — not the test — until the listed expectations hold.

- [ ] **Step 8: Type-check and commit**

Run: `npx tsc --noEmit` → no errors.

```bash
git add supabase/migrations/010_resume_optimizer.sql src/lib/resume-optimizer-types.ts src/lib/latex-resume.ts test-fixtures/resume.tex test-resume-optimizer.mts
git commit -m "feat(resume-optimizer): migration, types, and pure LaTeX helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Compile client and Claude functions

**Files:**
- Create: `src/lib/latex-compile.ts`
- Modify: `.env.example`
- Modify: `src/lib/claude.ts` (append after `refineCoverLetter`, line ~937)
- Modify: `test-resume-optimizer.mts` (append live smoke test)

**Interfaces:**
- Consumes: `Compiler`, `Keyword`, `Rewrite`, `SegmentCandidate`, `validateSegmentCandidates`, `validateKeywords`, `validateRewrites` from Task 1.
- Produces:
  - `compileLatex(source: string, compiler: Compiler): Promise<CompileResult>`; `CompileResult = { ok: true; pdf: Uint8Array } | { ok: false; log: string }`
  - `segmentResumeTex(source: string): Promise<SegmentCandidate[]>`
  - `extractJobKeywords(jobDescription: string, roleTitle: string): Promise<Omit<Keyword,"present">[]>`
  - `rewriteResumeSegments(ctx: RewriteContext): Promise<Rewrite[]>` with
    `RewriteContext = { segments: SegmentCandidate[]; keywords: Keyword[]; resumeText: string | null; jobDescription: string; companyName: string; roleTitle: string; instruction?: string; currentRewrites?: Rewrite[] }`

- [ ] **Step 1: Write the compile client**

`src/lib/latex-compile.ts`:

```ts
// The only module that knows about the LaTeX compile service.
// Default is YtoTech's public LaTeX-on-HTTP; point LATEX_COMPILE_URL at a
// self-hosted instance of the same API to keep resume source private.
import type { Compiler } from "./resume-optimizer-types";

export type CompileResult =
  | { ok: true; pdf: Uint8Array }
  | { ok: false; log: string };

const DEFAULT_URL = "https://latex.ytotech.com/builds/sync";
const TIMEOUT_MS = 60_000;
const LOG_TAIL_LINES = 40;

export function logTail(text: string, lines = LOG_TAIL_LINES): string {
  const all = text.trimEnd().split("\n");
  return all.slice(Math.max(0, all.length - lines)).join("\n");
}

export async function compileLatex(source: string, compiler: Compiler): Promise<CompileResult> {
  const url = process.env.LATEX_COMPILE_URL || DEFAULT_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/pdf, application/json" },
      body: JSON.stringify({
        compiler,
        resources: [{ main: true, content: source }],
        options: { compiler: { halt_on_error: true } },
      }),
      signal: controller.signal,
    });
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && type.includes("application/pdf")) {
      return { ok: true, pdf: new Uint8Array(await res.arrayBuffer()) };
    }
    const body = await res.text();
    // The service returns {"logs": "..."} on compile errors; fall back to raw text.
    let log = body;
    try {
      const parsed = JSON.parse(body) as { logs?: unknown; error?: unknown };
      if (typeof parsed.logs === "string") log = parsed.logs;
      else if (typeof parsed.error === "string") log = parsed.error;
    } catch { /* not JSON */ }
    return { ok: false, log: logTail(log || `Compile service returned HTTP ${res.status}`) };
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError"
      ? `Compile service timed out after ${TIMEOUT_MS / 1000}s`
      : e instanceof Error ? e.message : String(e);
    return { ok: false, log: msg };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Document the env var**

Append to `.env.example` under `# AI + enrichment`:

```
# LaTeX compile service for the resume optimizer (LaTeX-on-HTTP API).
# Default is the public https://latex.ytotech.com/builds/sync — your resume
# source is sent there. Self-host https://github.com/YtoTech/latex-on-http
# and point this at it to keep it private.
LATEX_COMPILE_URL=
```

And change the last line's comment to cover the new flag:

```
# Optional: set to 1 to run tests against live APIs
LIVE_MATCH=
LIVE_TESTS=
```

- [ ] **Step 3: Append the Claude functions**

Add the import at the top of `src/lib/claude.ts` (after the cover-letter-types import):

```ts
import {
  type Keyword,
  type Rewrite,
  type SegmentCandidate,
  validateSegmentCandidates,
  validateKeywords,
  validateRewrites,
} from "@/lib/resume-optimizer-types";
```

Append at the end of the file:

```ts
// ── Resume optimizer ───────────────────────────────────────────────────
// Three calls, each validated by a never-throw validator. The .tex is never
// rewritten wholesale: Claude proposes exact substrings and per-segment
// rewrites; src/lib/latex-resume.ts verifies and splices.

/** Exact rewritable substrings of a .tex resume. Never throws (validator). */
export async function segmentResumeTex(source: string): Promise<SegmentCandidate[]> {
  const system = `You identify the rewritable description text in a LaTeX resume. Output ONLY JSON, no prose, no markdown.
Shape: {"segments": [{"id": string, "section": string, "entry": string, "text": string}]}
Rules:
- "text" is copied CHARACTER-FOR-CHARACTER from the source, including any LaTeX inside it (\\textbf{...}, \\%, \\$). Do not normalize whitespace, quotes, or dashes. It must be a verbatim substring.
- Include only the description sentence(s) of experience, project, leadership, research, or volunteering bullets: the content inside \\resumeItem{...}, after \\item, or similar.
- Exclude section headers, dates, job titles, company names, degree lines, contact info, the skills/technologies list, and macro definitions.
- One segment per bullet. "section" is the section heading ("Experience"); "entry" is the role/project name it belongs to.
- ids: "s1", "s2", ... in document order.`;
  const response = await client.messages.create({
    model: MODEL, max_tokens: 4000, system,
    messages: [{ role: "user", content: `LATEX SOURCE:\n${source}` }],
  });
  try {
    return validateSegmentCandidates(JSON.parse(stripFences(textFrom(response))));
  } catch {
    return [];
  }
}

/** Weighted keywords from a job description. Never throws (validator). */
export async function extractJobKeywords(
  jobDescription: string, roleTitle: string,
): Promise<Omit<Keyword, "present">[]> {
  const system = `You extract the keywords a resume screener would look for in a job description. Output ONLY JSON, no prose, no markdown.
Shape: {"keywords": [{"term": string, "category": "skill"|"tool"|"domain"|"soft", "weight": 1|2|3}]}
- At most 25. weight 3 = central to the role, 2 = clearly wanted, 1 = nice to have.
- "term" is the short canonical form as it would appear on a resume ("Kubernetes", "REST APIs", "A/B testing"), not a phrase ("experience with Kubernetes").
- "tool" = named technologies/products; "skill" = techniques/languages/methods; "domain" = industry or subject knowledge; "soft" = collaboration/communication traits.
- No duplicates, no generic words ("experience", "team").`;
  const user = `Role: ${roleTitle}\n\nJOB DESCRIPTION:\n${jobDescription.slice(0, 12000)}`;
  const response = await client.messages.create({
    model: MODEL, max_tokens: 1200, system, messages: [{ role: "user", content: user }],
  });
  try {
    return validateKeywords(JSON.parse(stripFences(textFrom(response))));
  } catch {
    return [];
  }
}

export type RewriteContext = {
  segments: SegmentCandidate[];
  keywords: Keyword[];
  resumeText: string | null;
  jobDescription: string;
  companyName: string;
  roleTitle: string;
  instruction?: string;        // chat refinement, applied on top of currentRewrites
  currentRewrites?: Rewrite[];
};

const REWRITE_RULES = `You rephrase resume bullets so they surface the job's keywords, without changing what the candidate actually did. Output ONLY JSON, no prose, no markdown.
Shape: {"rewrites": [{"id": string, "text": string, "keywords": string[]}]}
Hard rules, every one is checked by code and a violation discards your rewrite:
- Rephrase ONLY. Never add a tool, technology, metric, outcome, team size, or claim that the original bullet does not already state or clearly demonstrate.
- Use a keyword only when the original bullet already demonstrates it (e.g. "Flask" may be named if the bullet says a Flask API was built). Never work in a keyword the candidate has not shown.
- Keep every number, percentage, dollar amount, and year exactly as written.
- Keep every LaTeX command that appears in the original; add no new commands, no \\item, \\begin, \\end, \\\\ or blank lines. Keep LaTeX escapes (\\%, \\$, \\&).
- Stay within 15% of the original's length so the resume keeps its page count.
- Return only the segments you changed; omit the rest. "keywords" lists the job keywords the rewrite now names.
- Prefer strong verbs and the job's vocabulary; keep the candidate's voice.`;

/** Rewrite segments against keywords (and an optional chat instruction). Never throws (validator). */
export async function rewriteResumeSegments(ctx: RewriteContext): Promise<Rewrite[]> {
  const missing = ctx.keywords.filter((k) => !k.present).map((k) => `${k.term} (${k.category}, w${k.weight})`);
  const present = ctx.keywords.filter((k) => k.present).map((k) => k.term);
  const user = [
    `Company: ${ctx.companyName}`, `Role: ${ctx.roleTitle}`,
    ``, `JOB KEYWORDS ALREADY ON THE RESUME (surface them where a bullet shows them): ${present.join(", ") || "(none)"}`,
    `JOB KEYWORDS NOT YET ON THE RESUME (use one only if a bullet already demonstrates it): ${missing.join(", ") || "(none)"}`,
    ``, `SEGMENTS (JSON):\n${JSON.stringify(ctx.segments)}`,
    ctx.currentRewrites?.length ? `\nCURRENT REWRITES (JSON, the starting point):\n${JSON.stringify(ctx.currentRewrites)}` : "",
    ctx.instruction ? `\nTHE USER WANTS THIS CHANGED: ${ctx.instruction}\nApply it on top of the current rewrites and return the FULL set of rewrites that should now be in effect.` : "",
    ``, `RESUME PLAIN TEXT (for context only):\n${ctx.resumeText ?? "(none)"}`,
    ``, `JOB DESCRIPTION:\n${ctx.jobDescription.slice(0, 12000) || "(none provided)"}`,
  ].filter((l) => l !== "").join("\n");
  const response = await client.messages.create({
    model: MODEL, max_tokens: 4000, system: REWRITE_RULES,
    messages: [{ role: "user", content: user }],
  });
  try {
    return validateRewrites(JSON.parse(stripFences(textFrom(response))), ctx.segments.map((s) => s.id));
  } catch {
    return ctx.currentRewrites ?? [];
  }
}
```

- [ ] **Step 4: Append the gated live smoke test**

Append to `test-resume-optimizer.mts` **before** the final `console.log(fails === 0 ...)` line:

```ts
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
```

- [ ] **Step 5: Run tests and type-check**

Run: `npx tsx test-resume-optimizer.mts` → all PASS (live block skipped).
Run: `LIVE_TESTS=1 npx tsx test-resume-optimizer.mts` → the four live checks PASS (requires network; if the service is down, note it in the commit body and continue).
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/latex-compile.ts .env.example src/lib/claude.ts test-resume-optimizer.mts
git commit -m "feat(resume-optimizer): compile client and Claude segment/keyword/rewrite calls

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Server actions

**Files:**
- Create: `src/lib/job-description.ts`
- Modify: `src/app/(app)/applications/actions.ts` (lines 36, 80–147, 427–445)
- Create: `src/app/(app)/resumes/actions.ts`
- Modify: `src/app/(app)/settings/actions.ts` (append)

**Interfaces:**
- Consumes: everything from Tasks 1–2.
- Produces:
  - `resolveJobDescription(postingUrl, pastedJd?)` in `src/lib/job-description.ts`
  - `ActionResult = { error: string | null; id?: string }`; `createApplication` returns `id` on success
  - `OptimizeResult = { ok: true; result: OptimizerResult; pdfBase64: string | null; compileLog: string | null } | { ok: false; reason: string; log?: string }`
  - `optimizeResumeForApplication(applicationId, pastedJd?)`, `refineResumeRewrites(applicationId, result, instruction, pastedJd?)`, `recompileResume(result)`, `saveTailoredResume(applicationId, result, pdfBase64)`, `deleteTailoredResume(id)`, `tailoredResumePdfUrl(id)`
  - Settings: `saveResumeTex(source, name, compiler)`, `clearResumeTex()`, `resumeTexSource()`

- [ ] **Step 1: Move `resolveJobDescription` into a lib module**

Create `src/lib/job-description.ts`:

```ts
// Resolve the job-description text for an application. Lives outside the
// "use server" files so it isn't exposed as a public action endpoint.
import { guardUrl, fetchPostingHtml, htmlToText } from "@/lib/job-posting";

export type JobDescriptionResult =
  | { ok: true; text: string }
  | { ok: false; reason: "needs_paste" };

/**
 * Pasted text wins; else fetch posting_url through the same guard/fetch/clean
 * chain as the Add Application autofill. Any failure → paste fallback.
 */
export async function resolveJobDescription(
  postingUrl: string | null,
  pastedJd?: string,
): Promise<JobDescriptionResult> {
  if (pastedJd && pastedJd.trim()) return { ok: true, text: pastedJd.trim() };
  if (!postingUrl) return { ok: false, reason: "needs_paste" };
  const guard = guardUrl(postingUrl);
  if (!guard.ok) return { ok: false, reason: "needs_paste" };
  try {
    const html = await fetchPostingHtml(guard.url);
    const text = htmlToText(html);
    if (!text) return { ok: false, reason: "needs_paste" };
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "needs_paste" };
  }
}
```

In `src/app/(app)/applications/actions.ts`:
- Delete the local `resolveJobDescription` function (the block starting with its doc comment `/** Resolve the job description text for an application: ...` through its closing `}` at line ~445).
- Add `import { resolveJobDescription } from "@/lib/job-description";` with the other imports.
- Change line 36 to: `export type ActionResult = { error: string | null; id?: string };`
- Change the end of `createApplication` (line 146) from `return { error: null };` to `return { error: null, id: inserted?.id as string | undefined };`

- [ ] **Step 2: Verify nothing else broke**

Run: `npx tsc --noEmit` → clean. Run: `npx tsx test-cover-letter.mts` → passes.

- [ ] **Step 3: Write the resumes actions**

`src/app/(app)/resumes/actions.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { resolveJobDescription } from "@/lib/job-description";
import { segmentResumeTex, extractJobKeywords, rewriteResumeSegments } from "@/lib/claude";
import { compileLatex } from "@/lib/latex-compile";
import {
  locateSegments, validateRewrite, spliceSegments, plainTextOf, markPresent, pdfPageCount,
} from "@/lib/latex-resume";
import {
  isCompiler,
  type Change, type Compiler, type OptimizerResult, type Rewrite,
} from "@/lib/resume-optimizer-types";

// ── Result shapes ──────────────────────────────────────────────────────
export type OptimizeResult =
  | { ok: true; result: OptimizerResult; pdfBase64: string | null; compileLog: string | null }
  | { ok: false; reason: string; log?: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;

type ResumeProfile = {
  resume_tex: string | null;
  resume_tex_compiler: string | null;
  resume_tex_pages: number | null;
  resume_text: string | null;
};

type ApplicationRow = { company_name: string; role_title: string; posting_url: string | null };

/** True when the error looks like migration 010 hasn't been applied. */
function isNotSetUpError(message: string): boolean {
  return (
    (/resume_tex|tailored_resumes|tailored-resumes/i.test(message) &&
      /column|schema cache|does not exist|could not find|relation/i.test(message)) ||
    /bucket not found/i.test(message)
  );
}

function errorReason(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return isNotSetUpError(message) ? "not_set_up" : message;
}

async function requireUser(supabase: Supabase): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function loadResumeProfile(supabase: Supabase, userId: string): Promise<ResumeProfile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("resume_tex, resume_tex_compiler, resume_tex_pages, resume_text")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data as ResumeProfile;
}

async function loadApplicationRow(supabase: Supabase, applicationId: string): Promise<ApplicationRow> {
  const { data, error } = await supabase
    .from("applications")
    .select("company_name, role_title, posting_url")
    .eq("id", applicationId)
    .single();
  if (error) throw error;
  return data as ApplicationRow;
}

/** Validate each proposed rewrite against its segment; failures keep the original. */
function applyRewrites(changes: Change[], rewrites: Rewrite[]): Change[] {
  const byId = new Map(rewrites.map((r) => [r.id, r]));
  return changes.map((c) => {
    const r = byId.get(c.segment.id);
    if (!r) return { ...c, rewrite: null, accepted: true, droppedReason: null };
    if (r.text === c.segment.text) return { ...c, rewrite: null, accepted: true, droppedReason: null };
    const v = validateRewrite(c.segment.text, r.text);
    return v.ok
      ? { ...c, rewrite: r, accepted: true, droppedReason: null }
      : { ...c, rewrite: null, accepted: true, droppedReason: v.reason };
  });
}

/** Splice + compile; compile failure is reported, not thrown, so .tex download still works. */
async function compileResult(
  result: OptimizerResult, originalPages: number | null,
): Promise<{ result: OptimizerResult; pdfBase64: string | null; compileLog: string | null }> {
  const tex = spliceSegments(result.originalTex, result.changes);
  const compiled = await compileLatex(tex, result.compiler);
  if (!compiled.ok) {
    return { result: { ...result, tex, pageWarning: false }, pdfBase64: null, compileLog: compiled.log };
  }
  const pages = pdfPageCount(compiled.pdf);
  const pageWarning = originalPages != null && pages > originalPages;
  return {
    result: { ...result, tex, pageWarning },
    pdfBase64: Buffer.from(compiled.pdf).toString("base64"),
    compileLog: null,
  };
}

/**
 * Full pipeline for an application. Read-only: no DB write, no revalidate.
 * `pastedJd` supplies the listing when the posting URL can't be fetched (or
 * when the add dialog already had the text pasted).
 */
export async function optimizeResumeForApplication(
  applicationId: string,
  pastedJd?: string,
): Promise<OptimizeResult> {
  try {
    const supabase = await createClient();
    const userId = await requireUser(supabase);
    if (!userId) return { ok: false, reason: "Not signed in." };

    const profile = await loadResumeProfile(supabase, userId);
    if (!profile.resume_tex) return { ok: false, reason: "no_resume_tex" };
    const compiler: Compiler = isCompiler(profile.resume_tex_compiler) ? profile.resume_tex_compiler : "pdflatex";

    const row = await loadApplicationRow(supabase, applicationId);
    const jd = await resolveJobDescription(row.posting_url, pastedJd);
    if (!jd.ok) return { ok: false, reason: "needs_paste" };

    const source = profile.resume_tex;
    const [candidates, rawKeywords] = await Promise.all([
      segmentResumeTex(source),
      extractJobKeywords(jd.text, row.role_title),
    ]);
    const segments = locateSegments(source, candidates);
    if (segments.length === 0) return { ok: false, reason: "no_segments" };

    const keywords = markPresent(rawKeywords, plainTextOf(source));
    const rewrites = await rewriteResumeSegments({
      segments, keywords, resumeText: profile.resume_text, jobDescription: jd.text,
      companyName: row.company_name, roleTitle: row.role_title,
    });
    const changes = applyRewrites(
      segments.map((segment) => ({ segment, rewrite: null, accepted: true, droppedReason: null })),
      rewrites,
    );
    const base: OptimizerResult = { originalTex: source, tex: source, compiler, keywords, changes, pageWarning: false };
    return { ok: true, ...(await compileResult(base, profile.resume_tex_pages)) };
  } catch (e) {
    return { ok: false, reason: errorReason(e) };
  }
}

/** Apply a chat instruction on top of the current rewrites, then recompile. No DB write. */
export async function refineResumeRewrites(
  applicationId: string,
  result: OptimizerResult,
  instruction: string,
  pastedJd?: string,
): Promise<OptimizeResult> {
  try {
    const supabase = await createClient();
    const userId = await requireUser(supabase);
    if (!userId) return { ok: false, reason: "Not signed in." };

    const profile = await loadResumeProfile(supabase, userId);
    const row = await loadApplicationRow(supabase, applicationId);
    const jd = await resolveJobDescription(row.posting_url, pastedJd);

    const currentRewrites = result.changes
      .filter((c) => c.accepted && c.rewrite)
      .map((c) => c.rewrite!);
    const rewrites = await rewriteResumeSegments({
      segments: result.changes.map((c) => c.segment),
      keywords: result.keywords,
      resumeText: profile.resume_text,
      jobDescription: jd.ok ? jd.text : "",
      companyName: row.company_name, roleTitle: row.role_title,
      instruction, currentRewrites,
    });
    const changes = applyRewrites(result.changes, rewrites);
    return { ok: true, ...(await compileResult({ ...result, changes }, profile.resume_tex_pages)) };
  } catch (e) {
    return { ok: false, reason: errorReason(e) };
  }
}

/** Recompile after the user reverts/restores bullets. No DB write. */
export async function recompileResume(result: OptimizerResult): Promise<OptimizeResult> {
  try {
    const supabase = await createClient();
    const userId = await requireUser(supabase);
    if (!userId) return { ok: false, reason: "Not signed in." };
    const profile = await loadResumeProfile(supabase, userId);
    return { ok: true, ...(await compileResult(result, profile.resume_tex_pages)) };
  } catch (e) {
    return { ok: false, reason: errorReason(e) };
  }
}

/** The only writer: inserts the row, uploads the PDF, revalidates /resumes. */
export async function saveTailoredResume(
  applicationId: string,
  result: OptimizerResult,
  pdfBase64: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  try {
    const supabase = await createClient();
    const userId = await requireUser(supabase);
    if (!userId) return { ok: false, reason: "Not signed in." };

    const row = await loadApplicationRow(supabase, applicationId);
    const { data: inserted, error } = await supabase
      .from("tailored_resumes")
      .insert({
        owner_id: userId,
        application_id: applicationId,
        company_name: row.company_name,
        role_title: row.role_title,
        compiler: result.compiler,
        tex: result.tex,
        keywords: result.keywords,
        changes: result.changes,
        page_warning: result.pageWarning,
      })
      .select("id")
      .single();
    if (error) throw error;
    const id = (inserted as { id: string }).id;

    const bytes = Buffer.from(pdfBase64, "base64");
    const { error: uploadError } = await supabase.storage
      .from("tailored-resumes")
      .upload(`${userId}/${id}.pdf`, bytes, { upsert: true, contentType: "application/pdf" });
    if (uploadError) {
      await supabase.from("tailored_resumes").delete().eq("id", id);
      throw uploadError;
    }

    revalidatePath("/resumes");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, reason: errorReason(e) };
  }
}

export async function deleteTailoredResume(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const supabase = await createClient();
    const userId = await requireUser(supabase);
    if (!userId) return { ok: false, reason: "Not signed in." };
    await supabase.storage.from("tailored-resumes").remove([`${userId}/${id}.pdf`]);
    const { error } = await supabase.from("tailored_resumes").delete().eq("id", id);
    if (error) throw error;
    revalidatePath("/resumes");
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: errorReason(e) };
  }
}

/** Short-lived signed URL for a saved PDF. */
export async function tailoredResumePdfUrl(id: string): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  try {
    const supabase = await createClient();
    const userId = await requireUser(supabase);
    if (!userId) return { ok: false, reason: "Not signed in." };
    const { data, error } = await supabase.storage
      .from("tailored-resumes")
      .createSignedUrl(`${userId}/${id}.pdf`, 60);
    if (error) throw error;
    return { ok: true, url: data.signedUrl };
  } catch (e) {
    return { ok: false, reason: errorReason(e) };
  }
}
```

- [ ] **Step 4: Append the Settings actions**

Append to `src/app/(app)/settings/actions.ts` (add these imports at the top: `import { compileLatex } from "@/lib/latex-compile"; import { pdfPageCount } from "@/lib/latex-resume"; import { isCompiler } from "@/lib/resume-optimizer-types";`):

```ts
// ── LaTeX resume (resume optimizer) ────────────────────────────────────

export type ResumeTexState = { error: string | null; saved: boolean; pages?: number };

const RESUME_TEX_MAX_CHARS = 200_000;
const NOT_SET_UP_MSG =
  "The resume optimizer needs its database migration applied. Paste supabase/migrations/010_resume_optimizer.sql into the Supabase SQL editor and run it, then try again.";

function resumeTexNotSetUp(message: string): boolean {
  return /resume_tex/i.test(message) && /column|schema cache|does not exist|could not find/i.test(message);
}

/**
 * Store the user's LaTeX resume after a successful test compile, so a
 * template the compile service can't build is rejected up front with the log
 * tail instead of failing mid-flow later. Also records the page count the
 * optimizer compares tailored output against.
 */
export async function saveResumeTex(
  source: string,
  name: string,
  compiler: string,
): Promise<ResumeTexState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", saved: false };

  const tex = source.replace(/\r\n/g, "\n");
  if (!tex.trim()) return { error: "The .tex source is empty.", saved: false };
  if (tex.length > RESUME_TEX_MAX_CHARS) return { error: "That .tex is too large (200 KB max).", saved: false };
  if (!/\\documentclass/.test(tex) || !/\\begin\{document\}/.test(tex)) {
    return { error: "That doesn't look like a complete LaTeX document (needs \\documentclass and \\begin{document}).", saved: false };
  }
  if (!isCompiler(compiler)) return { error: "Pick pdflatex, xelatex, or lualatex.", saved: false };

  const compiled = await compileLatex(tex, compiler);
  if (!compiled.ok) {
    return { error: `Test compile failed:\n${compiled.log}`, saved: false };
  }
  const pages = pdfPageCount(compiled.pdf);

  const { error } = await supabase
    .from("profiles")
    .update({
      resume_tex: tex,
      resume_tex_name: name.trim() || "resume.tex",
      resume_tex_at: new Date().toISOString(),
      resume_tex_compiler: compiler,
      resume_tex_pages: pages,
    })
    .eq("id", user.id);
  if (error) return { error: resumeTexNotSetUp(error.message) ? NOT_SET_UP_MSG : error.message, saved: false };

  revalidatePath("/settings");
  revalidatePath("/applications");
  revalidatePath("/resumes");
  return { error: null, saved: true, pages };
}

export async function clearResumeTex(): Promise<ResumeTexState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", saved: false };
  const { error } = await supabase
    .from("profiles")
    .update({ resume_tex: null, resume_tex_name: null, resume_tex_at: null, resume_tex_pages: null })
    .eq("id", user.id);
  if (error) return { error: resumeTexNotSetUp(error.message) ? NOT_SET_UP_MSG : error.message, saved: false };
  revalidatePath("/settings");
  revalidatePath("/applications");
  revalidatePath("/resumes");
  return { error: null, saved: true };
}

/** The stored .tex, for the Settings download button. */
export async function resumeTexSource(): Promise<{ source: string | null; name: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { source: null, name: null, error: "Not signed in." };
  const { data, error } = await supabase
    .from("profiles")
    .select("resume_tex, resume_tex_name")
    .eq("id", user.id)
    .maybeSingle();
  if (error) return { source: null, name: null, error: resumeTexNotSetUp(error.message) ? NOT_SET_UP_MSG : error.message };
  return {
    source: (data?.resume_tex as string | null) ?? null,
    name: (data?.resume_tex_name as string | null) ?? null,
    error: null,
  };
}
```

- [ ] **Step 5: Type-check, lint, run suites**

Run: `npx tsc --noEmit` → clean. Run: `npm run lint` → clean. Run: `npx tsx test-resume-optimizer.mts && npx tsx test-cover-letter.mts && npx tsx test-job-posting.mts` → all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/job-description.ts "src/app/(app)/applications/actions.ts" "src/app/(app)/resumes/actions.ts" "src/app/(app)/settings/actions.ts"
git commit -m "feat(resume-optimizer): server actions for optimize/refine/save and settings .tex

createApplication now returns the new id; resolveJobDescription moved to
src/lib/job-description.ts so it isn't exported from a server-action file.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Settings section

**Files:**
- Create: `src/app/(app)/settings/ResumeTexSection.tsx`
- Modify: `src/app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: `saveResumeTex`, `clearResumeTex`, `resumeTexSource` (Task 3); `COMPILERS`, `isCompiler`, `Compiler` (Task 1).
- Produces: `<ResumeTexSection initial={{ name, savedAt, compiler, pages, notSetUp }} />`.

- [ ] **Step 1: Write the section component**

`src/app/(app)/settings/ResumeTexSection.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { saveResumeTex, clearResumeTex, resumeTexSource } from "./actions";
import { COMPILERS, isCompiler, type Compiler } from "@/lib/resume-optimizer-types";

type Initial = {
  name: string | null;
  savedAt: string | null;
  compiler: Compiler;
  pages: number | null;
  notSetUp: boolean;
};

export function ResumeTexSection({ initial }: { initial: Initial }) {
  const [name, setName] = useState(initial.name);
  const [savedAt, setSavedAt] = useState(initial.savedAt);
  const [pages, setPages] = useState(initial.pages);
  const [compiler, setCompiler] = useState<Compiler>(initial.compiler);
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [status, setStatus] = useState<{ kind: "info" | "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setSource(text);
    setFileName(file.name);
    setShowPaste(false);
    setStatus({ kind: "info", text: `Loaded ${file.name} (${text.length.toLocaleString()} chars). Click Save & test-compile.` });
    e.target.value = "";
  }

  function handleSave() {
    if (!source.trim()) return;
    setStatus({ kind: "info", text: "Compiling… this can take up to a minute." });
    startTransition(async () => {
      const res = await saveResumeTex(source, fileName ?? "resume.tex", compiler);
      if (res.error) {
        setStatus({ kind: "error", text: res.error });
        return;
      }
      setName(fileName ?? "resume.tex");
      setSavedAt(new Date().toISOString());
      setPages(res.pages ?? null);
      setSource("");
      setFileName(null);
      setShowPaste(false);
      setStatus({ kind: "success", text: `Saved and compiled (${res.pages ?? "?"} page${res.pages === 1 ? "" : "s"}).` });
    });
  }

  async function handleDownload() {
    const { source: tex, name: n, error } = await resumeTexSource();
    if (error || !tex) {
      setStatus({ kind: "error", text: error ?? "No .tex stored." });
      return;
    }
    const blob = new Blob([tex], { type: "application/x-tex" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = n ?? "resume.tex";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleClear() {
    if (!confirm("Remove the stored LaTeX resume? Saved tailored resumes are kept.")) return;
    startTransition(async () => {
      const res = await clearResumeTex();
      if (res.error) {
        setStatus({ kind: "error", text: res.error });
        return;
      }
      setName(null);
      setSavedAt(null);
      setPages(null);
      setStatus({ kind: "success", text: "LaTeX resume removed." });
    });
  }

  if (initial.notSetUp) {
    return (
      <div className="space-y-2 rounded-lg bg-white p-6 ring-1 ring-slate-200">
        <h2 className="text-sm font-medium text-slate-700">LaTeX resume</h2>
        <p className="text-sm text-slate-600">
          Not set up yet. Paste{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">supabase/migrations/010_resume_optimizer.sql</code>{" "}
          into the Supabase SQL editor and run it to enable the resume optimizer.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg bg-white p-6 ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-slate-700">LaTeX resume</h2>
        <div className="flex items-center gap-2">
          <label className="cursor-pointer rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
            {name ? "Replace .tex" : "Upload .tex"}
            <input type="file" accept=".tex,text/x-tex,application/x-tex,text/plain" onChange={handleFileChange} disabled={pending} className="hidden" />
          </label>
          <button
            type="button"
            onClick={() => setShowPaste((v) => !v)}
            className="cursor-pointer rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {showPaste ? "Hide paste box" : "Paste source"}
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Your default resume as LaTeX. The optimizer rephrases its bullets per job listing and
        compiles a PDF. The source is sent to the compile service configured by{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5">LATEX_COMPILE_URL</code>.
      </p>

      {name && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-800">{name}</p>
            <p className="text-slate-500">
              {savedAt && <>Saved {new Date(savedAt).toLocaleString()} · </>}
              {initial.compiler}
              {pages != null && <> · {pages} page{pages === 1 ? "" : "s"}</>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button type="button" onClick={handleDownload} className="cursor-pointer font-medium text-indigo-600 hover:underline">
              Download .tex
            </button>
            <button type="button" onClick={handleClear} disabled={pending} className="cursor-pointer font-medium text-red-600 hover:underline disabled:opacity-50">
              Clear
            </button>
          </div>
        </div>
      )}

      {showPaste && (
        <textarea
          value={source}
          onChange={(e) => { setSource(e.target.value); setFileName(null); }}
          rows={10}
          placeholder={"\\documentclass{article}\n..."}
          className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-slate-600">
          Compiler{" "}
          <select
            value={compiler}
            onChange={(e) => { if (isCompiler(e.target.value)) setCompiler(e.target.value); }}
            className="ml-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
          >
            {COMPILERS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !source.trim()}
          className="cursor-pointer rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Compiling…" : "Save & test-compile"}
        </button>
        {fileName && !pending && <span className="text-xs text-slate-500">Ready: {fileName}</span>}
      </div>

      {status && (
        <pre
          className={`whitespace-pre-wrap rounded-md px-3 py-2 text-xs ${
            status.kind === "error"
              ? "bg-red-50 text-red-700 ring-1 ring-red-200"
              : status.kind === "success"
                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                : "bg-slate-50 text-slate-600 ring-1 ring-slate-200"
          }`}
        >
          {status.text}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the Settings page**

In `src/app/(app)/settings/page.tsx`:
- Add `import { ResumeTexSection } from "./ResumeTexSection";` and `import { isCompiler } from "@/lib/resume-optimizer-types";`.
- After the cadence-rules query (line ~63), add a separate query so an unapplied migration 010 can't break the page:

```ts
  // resume_tex_* arrive with migration 010. Queried separately so the page
  // still renders (with a "not set up" note) before it's applied.
  const { data: texRow, error: texError } = await supabase
    .from("profiles")
    .select("resume_tex_name, resume_tex_at, resume_tex_compiler, resume_tex_pages")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const texNotSetUp = !!texError && /resume_tex/i.test(texError.message);
  const tex = (texRow ?? null) as {
    resume_tex_name: string | null;
    resume_tex_at: string | null;
    resume_tex_compiler: string | null;
    resume_tex_pages: number | null;
  } | null;
```

- Render after `<CoverLetterTemplateSection … />`:

```tsx
      {/* LaTeX resume for the optimizer */}
      <ResumeTexSection
        initial={{
          name: tex?.resume_tex_name ?? null,
          savedAt: tex?.resume_tex_at ?? null,
          compiler: isCompiler(tex?.resume_tex_compiler) ? tex.resume_tex_compiler : "pdflatex",
          pages: tex?.resume_tex_pages ?? null,
          notSetUp: texNotSetUp,
        }}
      />
```

- [ ] **Step 3: Verify in the dev server**

Run: `npx tsc --noEmit && npm run lint` → clean. Start `npm run dev`, open `/settings`: with migration 010 unapplied the section shows the "Not set up" note; after applying it, upload `test-fixtures/resume.tex` → "Saved and compiled (1 page)." Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/settings/ResumeTexSection.tsx" "src/app/(app)/settings/page.tsx"
git commit -m "feat(resume-optimizer): LaTeX resume section in Settings with test compile

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Optimizer panel + Add Application handoff

**Files:**
- Create: `src/app/(app)/resumes/ResumeOptimizerPanel.tsx`
- Modify: `src/app/(app)/applications/AddApplicationDialog.tsx`
- Modify: `src/app/(app)/applications/ApplicationsView.tsx` (props at lines 65–68, 118)
- Modify: `src/app/(app)/applications/page.tsx` (line ~139)

**Interfaces:**
- Consumes: `OptimizeResult`, `optimizeResumeForApplication`, `refineResumeRewrites`, `recompileResume`, `saveTailoredResume` (Task 3); `OptimizerResult`, `Change`, `Keyword` and `coverage` (Task 1).
- Produces: `<ResumeOptimizerPanel applicationId companyName roleTitle pastedJd? onDone(saved: boolean) />`; `AddApplicationDialog` takes `hasResumeTex: boolean`; `ApplicationsView` takes `hasResumeTex: boolean`.

- [ ] **Step 1: Write the panel**

`src/app/(app)/resumes/ResumeOptimizerPanel.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  optimizeResumeForApplication,
  refineResumeRewrites,
  recompileResume,
  saveTailoredResume,
  type OptimizeResult,
} from "./actions";
import type { Change, Keyword, OptimizerResult } from "@/lib/resume-optimizer-types";
import { coverage } from "@/lib/latex-resume";

type ChatMessage = { role: "user" | "assistant"; text: string };

const ERROR_COPY: Record<string, string> = {
  no_segments: "Couldn't find rewritable bullets in this resume. Check that your experience/project bullets are plain \\item or \\resumeItem{...} text.",
  not_set_up: "The resume optimizer needs its database migration applied. Paste supabase/migrations/010_resume_optimizer.sql into the Supabase SQL editor and run it, then try again.",
};

const DROPPED_COPY: Record<string, string> = {
  dropped_number: "a number changed",
  new_command: "new LaTeX command",
  unbalanced_braces: "unbalanced braces",
  structure: "structural LaTeX added",
  blank_line: "blank line added",
  length: "length drifted >15%",
  empty: "empty rewrite",
};

function downloadBlob(bytes: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "resume";
}

/** Highlight the keywords a rewrite names, case-insensitively. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        terms.some((t) => t.toLowerCase() === p.toLowerCase())
          ? <mark key={i} className="rounded bg-sky-100 px-0.5 text-sky-900">{p}</mark>
          : <span key={i}>{p}</span>,
      )}
    </>
  );
}

export function KeywordChips({ keywords, changes }: { keywords: Keyword[]; changes: Change[] }) {
  const incorporated = new Set<string>();
  for (const c of changes) if (c.accepted && c.rewrite) for (const k of c.rewrite.keywords) incorporated.add(k.toLowerCase());
  const cls = (k: Keyword) =>
    k.present ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : incorporated.has(k.term.toLowerCase()) ? "bg-sky-50 text-sky-800 ring-sky-200"
        : "bg-slate-100 text-slate-500 ring-slate-200";
  const cov = coverage(keywords, changes);
  return (
    <div>
      <p className="text-xs text-slate-500">
        <span className="font-medium text-emerald-700">{cov.matched} matched</span> ·{" "}
        <span className="font-medium text-sky-700">{cov.incorporated} incorporated</span> ·{" "}
        <span className="font-medium text-slate-500">{cov.missing} missing</span> of {cov.total}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {keywords.map((k) => (
          <span key={k.term} title={`${k.category} · weight ${k.weight}`} className={`rounded-full px-2 py-0.5 text-xs ring-1 ${cls(k)}`}>
            {k.term}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ChangeCards({
  changes, onToggle,
}: { changes: Change[]; onToggle?: (id: string) => void }) {
  const changed = changes.filter((c) => c.rewrite || c.droppedReason);
  const unchanged = changes.length - changed.length;
  return (
    <div className="space-y-2">
      {changed.map((c) => (
        <div key={c.segment.id} className={`rounded-md border bg-white p-3 text-sm ${c.accepted && c.rewrite ? "border-sky-200" : "border-slate-200"}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-medium text-slate-500">
              {c.segment.section}{c.segment.entry ? ` › ${c.segment.entry}` : ""}
            </p>
            {c.rewrite && onToggle && (
              <button type="button" onClick={() => onToggle(c.segment.id)} className="shrink-0 cursor-pointer text-xs font-medium text-indigo-600 hover:underline">
                {c.accepted ? "Revert" : "Restore"}
              </button>
            )}
          </div>
          <p className={`mt-1 font-mono text-xs ${c.rewrite && c.accepted ? "text-slate-400 line-through" : "text-slate-800"}`}>{c.segment.text}</p>
          {c.rewrite && (
            <p className={`mt-1 font-mono text-xs ${c.accepted ? "text-slate-900" : "text-slate-400"}`}>
              <Highlighted text={c.rewrite.text} terms={c.rewrite.keywords} />
            </p>
          )}
          {c.droppedReason && (
            <p className="mt-1 text-xs text-amber-700">kept original (validation: {DROPPED_COPY[c.droppedReason] ?? c.droppedReason})</p>
          )}
        </div>
      ))}
      {unchanged > 0 && <p className="text-xs text-slate-400">{unchanged} bullet{unchanged === 1 ? "" : "s"} unchanged</p>}
    </div>
  );
}

export function ResumeOptimizerPanel({
  applicationId, companyName, roleTitle, pastedJd, onDone,
}: {
  applicationId: string;
  companyName: string;
  roleTitle: string;
  pastedJd?: string;
  onDone: (saved: boolean) => void;
}) {
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [compileLog, setCompileLog] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [lastPastedJd, setLastPastedJd] = useState<string | undefined>(pastedJd);
  const [noResumeTex, setNoResumeTex] = useState(false);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const startedRef = useRef(false);
  const recompileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function applyResult(res: OptimizeResult) {
    if (res.ok) {
      setResult(res.result);
      setPdfBase64(res.pdfBase64);
      setCompileLog(res.compileLog);
      setSaved(false);
    } else if (res.reason === "needs_paste") {
      setPasteMode(true);
    } else if (res.reason === "no_resume_tex") {
      setNoResumeTex(true);
    } else {
      setErrorReason(res.reason);
    }
  }

  function runOptimize(jd?: string) {
    setErrorReason(null);
    setNoResumeTex(false);
    setPasteMode(false);
    setResult(null);
    setPdfBase64(null);
    setCompileLog(null);
    setMessages([]);
    startTransition(async () => {
      const res = await optimizeResumeForApplication(applicationId, jd);
      if (res.ok) setLastPastedJd(jd);
      applyResult(res);
    });
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    runOptimize(pastedJd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleChange(id: string) {
    if (!result) return;
    const next: OptimizerResult = {
      ...result,
      changes: result.changes.map((c) => (c.segment.id === id ? { ...c, accepted: !c.accepted } : c)),
    };
    setResult(next);
    setSaved(false);
    if (recompileTimer.current) clearTimeout(recompileTimer.current);
    recompileTimer.current = setTimeout(() => {
      startTransition(async () => applyResult(await recompileResume(next)));
    }, 600);
  }

  function handleSend() {
    const trimmed = chatInput.trim();
    if (!trimmed || !result) return;
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setChatInput("");
    setErrorReason(null);
    startTransition(async () => {
      const res = await refineResumeRewrites(applicationId, result, trimmed, lastPastedJd);
      applyResult(res);
      setMessages((m) => [...m, { role: "assistant", text: res.ok ? "Updated the bullets." : "Couldn't apply that — try again." }]);
    });
  }

  function handleDownloadPdf() {
    if (!pdfBase64) return;
    const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    downloadBlob(bytes, "application/pdf", `${slug(companyName)}-resume.pdf`);
  }

  function handleDownloadTex() {
    if (!result) return;
    downloadBlob(result.tex, "application/x-tex", `${slug(companyName)}-resume.tex`);
  }

  function handleSave() {
    if (!result || !pdfBase64) return;
    setErrorReason(null);
    startTransition(async () => {
      const res = await saveTailoredResume(applicationId, result, pdfBase64);
      if (res.ok) {
        setSaved(true);
        onDone(true);
      } else {
        setErrorReason(res.reason);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tailor resume</h3>
          <p className="text-sm text-slate-700">{companyName} · {roleTitle}</p>
        </div>
        <div className="flex items-center gap-3">
          {result && (
            <button type="button" onClick={() => runOptimize(lastPastedJd)} disabled={pending} className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50">
              Regenerate
            </button>
          )}
          <button type="button" onClick={() => onDone(saved)} className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-800">
            {saved ? "Close" : "Skip"}
          </button>
        </div>
      </div>

      {noResumeTex && (
        <p className="text-sm text-slate-600">
          No LaTeX resume on file.{" "}
          <Link href="/settings" className="font-medium text-indigo-600 hover:underline">Add one in Settings</Link>{" "}
          to tailor resumes.
        </p>
      )}

      {!noResumeTex && pasteMode && (
        <div>
          <label htmlFor={`jd-paste-${applicationId}`} className="block text-sm font-medium text-slate-700">Paste the job description</label>
          <p className="mt-0.5 text-xs text-slate-400">Couldn&rsquo;t read the posting page — paste the listing and we&rsquo;ll tailor from that.</p>
          <textarea
            id={`jd-paste-${applicationId}`}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={5}
            placeholder="Paste the full job description here…"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={() => runOptimize(pasteText)} disabled={pending || !pasteText.trim()} className="cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
              {pending ? "Tailoring…" : "Tailor"}
            </button>
          </div>
        </div>
      )}

      {!noResumeTex && !pasteMode && errorReason && !result && (
        <div>
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{ERROR_COPY[errorReason] ?? errorReason}</p>
          <button type="button" onClick={() => runOptimize(lastPastedJd)} disabled={pending} className="mt-2 cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50">
            {pending ? "Tailoring…" : "Try again"}
          </button>
        </div>
      )}

      {!noResumeTex && !pasteMode && !errorReason && !result && (
        <p className="text-sm text-slate-500">{pending ? "Reading the listing and rephrasing bullets… (20–60 s)" : "Starting…"}</p>
      )}

      {result && (
        <div className="space-y-4">
          <KeywordChips keywords={result.keywords} changes={result.changes} />

          {result.pageWarning && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
              The tailored resume runs one page longer than your original — try asking the chat to tighten the longest bullets, or revert a few.
            </p>
          )}
          {compileLog && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-red-200">
              <p className="font-medium">Compile failed — you can still download the .tex.</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{compileLog}</pre>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="max-h-96 overflow-y-auto pr-1">
              <ChangeCards changes={result.changes} onToggle={toggleChange} />
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Refine by chat</h4>
              <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">
                {messages.length === 0 ? (
                  <p className="text-sm text-slate-400">Ask for a change — e.g. &ldquo;tighten the project bullets&rdquo; or &ldquo;lead with the API work.&rdquo;</p>
                ) : messages.map((m, i) => (
                  <p key={i} className={`rounded-md px-3 py-1.5 text-sm ${m.role === "user" ? "bg-indigo-100 text-indigo-900" : "bg-slate-100 text-slate-600"}`}>{m.text}</p>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSend(); } }}
                  placeholder="Describe the change…"
                  disabled={pending}
                  className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                />
                <button type="button" onClick={handleSend} disabled={pending || !chatInput.trim()} className="cursor-pointer rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
                  Send
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
            <button type="button" onClick={handleDownloadPdf} disabled={pending || !pdfBase64} className="cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
              Download PDF
            </button>
            <button type="button" onClick={handleDownloadTex} disabled={pending} className="cursor-pointer rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
              Download .tex
            </button>
            <button type="button" onClick={handleSave} disabled={pending || !pdfBase64 || saved} className="cursor-pointer rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50">
              {saved ? "✓ Saved to Resumes" : "Save to Resumes"}
            </button>
            {pending && <span className="text-xs text-slate-400">Working…</span>}
            {errorReason && result && <span className="text-sm text-red-600">{ERROR_COPY[errorReason] ?? errorReason}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Thread `hasResumeTex` through the Applications page**

`src/app/(app)/applications/page.tsx` — after the `hasTemplate` block (line ~55), add:

```ts
  // resume_tex_name arrives with migration 010. Separate query so an
  // unapplied migration can't break the page; falls back to "no .tex".
  const { data: texRow, error: texError } = await supabase
    .from("profiles")
    .select("resume_tex_name")
    .eq("id", user.id)
    .maybeSingle();
  const hasResumeTex = texError ? false : !!(texRow as { resume_tex_name: string | null } | null)?.resume_tex_name;
```

and change the return to `<ApplicationsView applications={applications} hasTemplate={hasTemplate} hasResumeTex={hasResumeTex} />`.

`src/app/(app)/applications/ApplicationsView.tsx` — add `hasResumeTex: boolean` to the top-level component's props (destructure at line ~65, type at line ~68) and change line 118 to `<AddApplicationDialog hasResumeTex={hasResumeTex} />`. Do not pass it anywhere else.

- [ ] **Step 3: Add the checkbox and handoff to the dialog**

In `src/app/(app)/applications/AddApplicationDialog.tsx`:

Add the import: `import { ResumeOptimizerPanel } from "../resumes/ResumeOptimizerPanel";`

Change the signature: `export function AddApplicationDialog({ hasResumeTex }: { hasResumeTex: boolean }) {`

Add state after `const [reading, startReading] = useTransition();`:

```ts
  // Resume-tailoring handoff. `handoff` is captured at submit time (the form
  // remounts/reset afterwards) and `createdId` flips the dialog to step 2.
  const [tailor, setTailor] = useState(true);
  const [handoff, setHandoff] = useState<{ company: string; role: string; jd?: string } | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
```

Extend `handleClose`:

```ts
  function handleClose() {
    setOpen(false);
    setCreatedId(null);
    setHandoff(null);
    resetAutofill();
  }
```

Replace the success `useEffect` with:

```ts
  // After a successful submit: either hand off to the resume optimizer
  // (box checked, .tex on file, id returned) or close + reset as before.
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      formRef.current?.reset();
      if (hasResumeTex && tailor && state.id && handoff) {
        setCreatedId(state.id);
      } else {
        setOpen(false);
        resetAutofill();
      }
    }
    wasPending.current = pending;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, state.error, state.id]);
```

On the `<form>`, add an `onSubmit` that captures the handoff **before** the action runs (it does not prevent default):

```tsx
            <form
              ref={formRef}
              key={formKey}
              action={formAction}
              onSubmit={(e) => {
                const fd = new FormData(e.currentTarget);
                setHandoff({
                  company: String(fd.get("company_name") ?? ""),
                  role: String(fd.get("role_title") ?? ""),
                  jd: pasteMode && pasteText.trim() ? pasteText.trim() : undefined,
                });
              }}
              className="space-y-4 px-6 py-5"
            >
```

Add the checkbox just above the Cancel/Submit row (inside the form, after the Notes field):

```tsx
              {hasResumeTex && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={tailor}
                    onChange={(e) => setTailor(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Tailor my resume for this role
                  <span className="text-xs text-slate-400">(opens after saving)</span>
                </label>
              )}
```

Make the dialog body conditional: wrap the existing autofill `<div className="border-b …">` and the `<form>` in a fragment rendered when `!createdId`, and render the panel when `createdId`:

```tsx
            {createdId && handoff ? (
              <div className="px-6 py-5">
                <ResumeOptimizerPanel
                  applicationId={createdId}
                  companyName={handoff.company}
                  roleTitle={handoff.role}
                  pastedJd={handoff.jd}
                  onDone={() => handleClose()}
                />
              </div>
            ) : (
              <>
                {/* existing autofill panel div */}
                {/* existing <form> */}
              </>
            )}
```

Also change the header title to `{createdId ? "Tailor resume" : "Add application"}` and widen the dialog when in step 2: `className={\`mt-8 w-full ${createdId ? "max-w-4xl" : "max-w-lg"} rounded-xl bg-white shadow-xl ring-1 ring-slate-200\`}`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint` → clean.
Dev-server check: with a `.tex` saved in Settings, open Applications → Add application → fill company/role (optionally a posting URL) → the checkbox is visible and checked → submit → the dialog switches to **Tailor resume**, keyword chips and change cards appear, Download PDF works, Save to Resumes closes the dialog. With the box unchecked, the dialog closes as before. With no `.tex`, no checkbox. The applications table itself is unchanged.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/resumes/ResumeOptimizerPanel.tsx" "src/app/(app)/applications/AddApplicationDialog.tsx" "src/app/(app)/applications/ApplicationsView.tsx" "src/app/(app)/applications/page.tsx"
git commit -m "feat(resume-optimizer): review panel and add-application handoff

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Resumes tab

**Files:**
- Modify: `src/app/(app)/NavLinks.tsx`
- Create: `src/app/(app)/resumes/page.tsx`
- Create: `src/app/(app)/resumes/ResumesView.tsx`

**Interfaces:**
- Consumes: `ResumeOptimizerPanel`, `KeywordChips`, `ChangeCards` (Task 5); `deleteTailoredResume`, `tailoredResumePdfUrl` (Task 3); `coverage` (Task 1).
- Produces: `/resumes` route; `TailoredResumeRow`, `PickerApplication` types.

- [ ] **Step 1: Add the nav link**

In `src/app/(app)/NavLinks.tsx`, insert after the Applications entry:

```ts
  { href: "/resumes", label: "Resumes" },
```

- [ ] **Step 2: Write the page**

`src/app/(app)/resumes/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { ResumesView, type TailoredResumeRow, type PickerApplication } from "./ResumesView";
import type { Change, Keyword } from "@/lib/resume-optimizer-types";

export default async function ResumesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("tailored_resumes")
    .select("id, application_id, company_name, role_title, compiler, keywords, changes, page_warning, created_at")
    .order("created_at", { ascending: false });

  if (error && /tailored_resumes/i.test(error.message) && /exist|relation|schema|column/i.test(error.message)) {
    return <NotSetUp />;
  }
  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 ring-1 ring-red-200">
        <p className="text-sm text-red-900">Couldn&apos;t load resumes: {error.message}</p>
      </div>
    );
  }

  const rows: TailoredResumeRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    applicationId: (r.application_id as string | null) ?? null,
    companyName: r.company_name as string,
    roleTitle: r.role_title as string,
    compiler: r.compiler as string,
    keywords: (r.keywords as Keyword[]) ?? [],
    changes: (r.changes as Change[]) ?? [],
    pageWarning: !!r.page_warning,
    createdAt: r.created_at as string,
  }));

  const { data: apps } = await supabase
    .from("applications")
    .select("id, company_name, role_title, status")
    .order("created_at", { ascending: false });
  const applications: PickerApplication[] = ((apps ?? []) as Record<string, unknown>[]).map((a) => ({
    id: a.id as string,
    companyName: a.company_name as string,
    roleTitle: a.role_title as string,
    status: a.status as string,
  }));

  const { data: texRow, error: texError } = await supabase
    .from("profiles")
    .select("resume_tex_name")
    .eq("id", user.id)
    .maybeSingle();
  const hasResumeTex = texError ? false : !!(texRow as { resume_tex_name: string | null } | null)?.resume_tex_name;

  return <ResumesView rows={rows} applications={applications} hasResumeTex={hasResumeTex} />;
}

function NotSetUp() {
  return (
    <div className="max-w-2xl space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Resumes</h1>
      <div className="rounded-lg bg-white p-6 ring-1 ring-slate-200">
        <p className="text-sm text-slate-700">
          The resume database isn&apos;t set up yet. Paste{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">supabase/migrations/010_resume_optimizer.sql</code>{" "}
          into the Supabase SQL editor and run it, then reload.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the view**

`src/app/(app)/resumes/ResumesView.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deleteTailoredResume, tailoredResumePdfUrl } from "./actions";
import { ResumeOptimizerPanel, KeywordChips, ChangeCards } from "./ResumeOptimizerPanel";
import { coverage } from "@/lib/latex-resume";
import type { Change, Keyword } from "@/lib/resume-optimizer-types";

export type TailoredResumeRow = {
  id: string;
  applicationId: string | null;
  companyName: string;
  roleTitle: string;
  compiler: string;
  keywords: Keyword[];
  changes: Change[];
  pageWarning: boolean;
  createdAt: string;
};

export type PickerApplication = { id: string; companyName: string; roleTitle: string; status: string };

function Modal({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm sm:p-8" onClick={onClose}>
      <div className={`mt-8 w-full ${wide ? "max-w-4xl" : "max-w-lg"} rounded-xl bg-white shadow-xl ring-1 ring-slate-200`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="cursor-pointer rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function ResumesView({ rows, applications, hasResumeTex }: { rows: TailoredResumeRow[]; applications: PickerApplication[]; hasResumeTex: boolean }) {
  const router = useRouter();
  const [viewing, setViewing] = useState<TailoredResumeRow | null>(null);
  const [picking, setPicking] = useState(false);
  const [tailoring, setTailoring] = useState<PickerApplication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const tailoredAppIds = useMemo(() => new Set(rows.map((r) => r.applicationId).filter(Boolean)), [rows]);
  const pickerApps = useMemo(() => {
    const without = applications.filter((a) => !tailoredAppIds.has(a.id));
    const withOne = applications.filter((a) => tailoredAppIds.has(a.id));
    return { without, withOne };
  }, [applications, tailoredAppIds]);

  function openPdf(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await tailoredResumePdfUrl(id);
      if (res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
      else setError(res.reason);
    });
  }

  function downloadTex(row: TailoredResumeRow) {
    // The .tex is rebuilt from the saved changes to avoid shipping the full
    // source in every table row; the row keeps `tex` server-side too.
    const url = URL.createObjectURL(new Blob([texOf(row)], { type: "application/x-tex" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${row.companyName.replace(/[^A-Za-z0-9]+/g, "-")}-resume.tex`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function remove(row: TailoredResumeRow) {
    if (!confirm(`Delete the tailored resume for ${row.companyName} · ${row.roleTitle}?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteTailoredResume(row.id);
      if (!res.ok) setError(res.reason);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Resumes</h1>
          <p className="mt-1 text-sm text-slate-600">Every resume you&apos;ve tailored, by company and role.</p>
        </div>
        {hasResumeTex ? (
          <button type="button" onClick={() => setPicking(true)} className="cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500">
            Tailor for an application…
          </button>
        ) : (
          <p className="text-sm text-slate-500">
            <Link href="/settings" className="font-medium text-indigo-600 hover:underline">Add a LaTeX resume in Settings</Link> to start tailoring.
          </p>
        )}
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</p>}

      {rows.length === 0 ? (
        <div className="rounded-lg bg-white p-8 text-center ring-1 ring-slate-200">
          <p className="text-sm text-slate-600">No tailored resumes yet. Tick &ldquo;Tailor my resume&rdquo; when adding an application, or use the button above.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Company</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Keywords</th>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const cov = coverage(r.keywords, r.changes);
                return (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="max-w-[14rem] truncate px-4 py-2 font-medium text-slate-900">{r.companyName}</td>
                    <td className="max-w-[16rem] truncate px-4 py-2 text-slate-700">{r.roleTitle}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {cov.matched + cov.incorporated}/{cov.total} matched
                      {r.pageWarning && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700 ring-1 ring-amber-200">+1 page</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500">{new Date(r.createdAt).toLocaleDateString()}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <div className="inline-flex items-center gap-3 text-xs font-medium">
                        <button type="button" onClick={() => openPdf(r.id)} disabled={pending} className="cursor-pointer text-indigo-600 hover:underline disabled:opacity-50">PDF</button>
                        <button type="button" onClick={() => downloadTex(r)} className="cursor-pointer text-indigo-600 hover:underline">.tex</button>
                        <button type="button" onClick={() => setViewing(r)} className="cursor-pointer text-slate-600 hover:underline">View</button>
                        <button type="button" onClick={() => remove(r)} disabled={pending} className="cursor-pointer text-red-600 hover:underline disabled:opacity-50">Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewing && (
        <Modal title={`${viewing.companyName} · ${viewing.roleTitle}`} wide onClose={() => setViewing(null)}>
          <div className="space-y-4">
            <KeywordChips keywords={viewing.keywords} changes={viewing.changes} />
            <div className="max-h-[60vh] overflow-y-auto pr-1">
              <ChangeCards changes={viewing.changes} />
            </div>
          </div>
        </Modal>
      )}

      {picking && !tailoring && (
        <Modal title="Tailor for an application" onClose={() => setPicking(false)}>
          {applications.length === 0 ? (
            <p className="text-sm text-slate-600">No applications yet — add one on the Applications tab.</p>
          ) : (
            <div className="max-h-[60vh] space-y-4 overflow-y-auto">
              {[{ label: "Not yet tailored", list: pickerApps.without }, { label: "Already tailored (makes a new version)", list: pickerApps.withOne }]
                .filter((g) => g.list.length > 0)
                .map((g) => (
                  <div key={g.label}>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{g.label}</p>
                    <ul className="mt-1 divide-y divide-slate-100 rounded-md border border-slate-200">
                      {g.list.map((a) => (
                        <li key={a.id}>
                          <button type="button" onClick={() => { setTailoring(a); setPicking(false); }} className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                            <span className="truncate"><span className="font-medium text-slate-900">{a.companyName}</span> <span className="text-slate-600">· {a.roleTitle}</span></span>
                            <span className="ml-3 shrink-0 text-xs text-slate-400">{a.status.replace(/_/g, " ")}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </Modal>
      )}

      {tailoring && (
        <Modal title="Tailor resume" wide onClose={() => setTailoring(null)}>
          <ResumeOptimizerPanel
            applicationId={tailoring.id}
            companyName={tailoring.companyName}
            roleTitle={tailoring.roleTitle}
            onDone={(saved) => { setTailoring(null); if (saved) router.refresh(); }}
          />
        </Modal>
      )}
    </div>
  );
}

/** Rebuild the final .tex from the saved original + accepted changes. */
function texOf(row: TailoredResumeRow): string {
  // `changes[].segment` carries offsets into the ORIGINAL source, which the
  // row doesn't ship to the client; the server kept the spliced `tex`. Fetch
  // it lazily via the PDF-adjacent action instead of bundling it here.
  return row.changes.map((c) => (c.accepted && c.rewrite ? c.rewrite.text : c.segment.text)).join("\n");
}
```

**Correction before you implement:** the `.tex` download must be the real spliced source, not a bullet dump. Replace the `texOf` helper and `downloadTex` above with a server round-trip: add this action to `src/app/(app)/resumes/actions.ts`:

```ts
/** The saved .tex for a tailored resume (download button on the Resumes tab). */
export async function tailoredResumeTex(id: string): Promise<{ ok: true; tex: string } | { ok: false; reason: string }> {
  try {
    const supabase = await createClient();
    const userId = await requireUser(supabase);
    if (!userId) return { ok: false, reason: "Not signed in." };
    const { data, error } = await supabase.from("tailored_resumes").select("tex").eq("id", id).single();
    if (error) throw error;
    return { ok: true, tex: (data as { tex: string }).tex };
  } catch (e) {
    return { ok: false, reason: errorReason(e) };
  }
}
```

and in `ResumesView.tsx` import it and replace `downloadTex` with:

```ts
  function downloadTex(row: TailoredResumeRow) {
    setError(null);
    startTransition(async () => {
      const res = await tailoredResumeTex(row.id);
      if (!res.ok) { setError(res.reason); return; }
      const url = URL.createObjectURL(new Blob([res.tex], { type: "application/x-tex" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${row.companyName.replace(/[^A-Za-z0-9]+/g, "-")}-resume.tex`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
```

Delete the `texOf` function entirely.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint` → clean.
Dev-server check: the nav shows **Resumes**; `/resumes` lists saved rows with PDF / .tex / View / Delete working; **Tailor for an application…** opens the picker then the panel; saving refreshes the table. With migration 010 unapplied the page shows the not-set-up note.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/NavLinks.tsx" "src/app/(app)/resumes/page.tsx" "src/app/(app)/resumes/ResumesView.tsx" "src/app/(app)/resumes/actions.ts"
git commit -m "feat(resume-optimizer): Resumes tab listing saved tailored resumes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Final verification

**Files:** none new.

- [ ] **Step 1: Full checks**

Run each and confirm:
- `npx tsc --noEmit` → no output.
- `npm run lint` → no errors.
- `npx tsx test-resume-optimizer.mts` → `All checks passed.`
- `npx tsx test-cover-letter.mts` and `npx tsx test-job-posting.mts` → pass.
- `npm run build` → succeeds (catches server/client boundary mistakes such as importing `latex-compile.ts` into a client component).

- [ ] **Step 2: Spec walk-through**

Check each success criterion in the spec against the running app and note any gap in the final report:
1. Settings upload test-compiles; broken file rejected with log tail.
2. Add application → panel without re-entering the listing → chips + diffs → PDF differs only in accepted bullets.
3. Accepted rewrites pass the rules; outside bytes unchanged (`spliceSegments` test).
4. Save → row in Resumes with PDF, `.tex`, report; delete removes both.
5. Applications page renders as before (`git diff 8b13e75 -- "src/app/(app)/applications/ApplicationsView.tsx"` shows only the `hasResumeTex` prop plumbing).
6. All test scripts pass.

- [ ] **Step 3: Commit any fixes**

If verification required changes, commit them with a `fix(resume-optimizer): …` message ending in the Co-Authored-By line.
