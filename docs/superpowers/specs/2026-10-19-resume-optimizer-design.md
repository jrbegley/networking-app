# Resume optimizer

Tailor the user's LaTeX resume to a job listing: pull keywords from the
listing, match them to what the resume already says, rephrase bullets so the
matching ones surface, compile to PDF, and keep every tailored resume in a
**Resumes** tab — the resume database — labelled by company and role.

## Problem

Every application wants the same resume phrased slightly differently. Doing
that by hand in LaTeX per listing is slow, and the result lives in a folder
nobody can find a month later. The listing is already in hand when the user
adds the application to the tracker; retyping it elsewhere is friction.

## Solution

- One default LaTeX resume per user, stored in Settings and test-compiled on
  upload.
- When adding an application, a checkbox tailors the resume for that listing
  in the same flow, reusing the listing the autofill already read.
- A bullet-by-bullet review panel (original → rewritten, keywords
  highlighted, revert per bullet, chat refinement) before anything is saved.
- A separate **Resumes** tab holds every saved tailored resume: PDF, `.tex`,
  and the keyword report. The Applications page is not touched.

## Scope

**In:**
- Settings: upload or paste one `.tex`; pick a compiler; test-compile on save.
- Rephrasing existing bullet/description text only.
- Keyword extraction from the listing and a matched / incorporated / missing
  report.
- Compile to PDF through a hosted LaTeX-on-HTTP service.
- Review panel with per-bullet revert and chat refinement.
- Resumes tab: list, view report + diff, download PDF / `.tex`, delete, and
  "tailor for an application…" for applications added before this feature.
- Add-application checkbox that hands off to the panel after the row is
  created.

**Out (decided, not deferred by oversight):**
- Reordering or pruning bullets or skills.
- Rewriting the Skills section (it is read for matching, never changed).
- Inventing facts, tools, metrics, or claims.
- Multiple stored resumes; editing the `.tex` in-app.
- In-browser PDF preview; per-row match-score %; suggested skills to add.
- Any change to the Applications page beyond the add dialog's checkbox and
  `createApplication` returning the new id.

## Edit rules (what the optimizer may change)

A rewrite is accepted only if **all** hold against the original segment:

1. Braces balanced; no blank lines; none of `\item`, `\begin`, `\end`,
   `\section`, `\\` added.
2. The set of `\commands` used in the rewrite ⊆ the set in the original.
3. Every number, percentage, currency amount, and 4-digit year token present
   in the original is present in the rewrite.
4. Length within ±15% of the original's character count (keeps one page).
5. Any keyword the rewrite claims to incorporate is one the original bullet
   already demonstrates — enforced by the prompt and surfaced in the diff for
   the user to revert.

A rewrite that fails any rule is dropped and the original kept; the panel
labels that card "kept original (validation)".

## Core mechanism: Claude segments, code verifies, Claude rewrites, code verifies, code splices

Same pattern as the cover-letter generator (`classifyLetterParagraphs` →
validate → apply). No LaTeX is parsed by hand.

1. **Segment.** `segmentResumeTex(source)` asks Claude for the exact
   substrings that are rewritable description text (experience / project /
   leadership bullets), each tagged `{ id, section, entry, text }`.
   `locateSegments` keeps only candidates whose `text` occurs **exactly once,
   verbatim** in the source, records `start`/`end`, and drops overlaps.
2. **Keywords.** `extractJobKeywords(jobDescription, roleTitle)` returns ≤ 25
   weighted keywords. `plainTextOf(source)` strips commands; each keyword is
   marked `present` by case-insensitive whole-word match against it.
3. **Rewrite.** `rewriteResumeSegments({ segments, keywords, resumeText,
   jobDescription, instruction? })` returns `{ id, text, keywords }` for
   changed segments only. `validateRewrite` applies the edit rules.
4. **Splice.** `spliceSegments` replaces accepted segments from the end of
   the source backwards. Everything outside the segments is byte-identical.
5. **Compile.** `compileLatex(tex, compiler)` POSTs to the compile service.
   `pdfPageCount` of the result is compared with the original resume's;
   `pageWarning` is set if it grew.

## Compile service

`src/lib/latex-compile.ts` is the only module that knows the service.

- `compileLatex(source: string, compiler: Compiler): Promise<CompileResult>`
  where `Compiler = "pdflatex" | "xelatex" | "lualatex"` and
  `CompileResult = { ok: true; pdf: Uint8Array } | { ok: false; log: string }`.
- `POST ${LATEX_COMPILE_URL}` (env; default
  `https://latex.ytotech.com/builds/sync`) with JSON
  `{ compiler, resources: [{ main: true, content }], options: { compiler: { halt_on_error: true } } }`.
- 60 s timeout via `AbortController`. A `200` with `application/pdf` → `pdf`.
  Anything else → `log` = response body trimmed to its last 40 lines, or the
  network/timeout error message.
- Privacy note for the README/env example: the resume source is sent to that
  third-party service. Swap `LATEX_COMPILE_URL` to a self-hosted
  `latex-on-http` to keep it private.

## Data sources

| Input | Source |
|---|---|
| Resume source | `profiles.resume_tex` (+ `resume_tex_compiler`), set in Settings. |
| Resume plain text | `profiles.resume_text` (existing) as extra context for the rewriter. |
| Job description | Pasted text if the add dialog used paste mode; else re-read from the application's `posting_url` via the existing `resolveJobDescription` chain (`guardUrl` → `fetchPostingHtml` → `htmlToText`); failure → paste fallback. Not stored. |
| Company / role | The application row; copied onto the tailored-resume row. |

## Migration — `supabase/migrations/010_resume_optimizer.sql`

Idempotent; applied by the user in the Supabase SQL editor. Until applied,
the Resumes tab and Settings section show a "not set up" note (migrations
007–009 pattern).

- `profiles`: `resume_tex text`, `resume_tex_name text`,
  `resume_tex_at timestamptz`, `resume_tex_compiler text not null default 'pdflatex'`.
- New table `tailored_resumes`:
  ```
  id uuid pk default gen_random_uuid()
  owner_id uuid not null references auth.users(id) on delete cascade
  application_id uuid references applications(id) on delete set null
  company_name text not null
  role_title text not null
  compiler text not null
  tex text not null
  keywords jsonb not null default '[]'
  changes jsonb not null default '[]'
  page_warning boolean not null default false
  created_at timestamptz not null default now()
  ```
  RLS: owner-only select/insert/update/delete. Index on `(owner_id, created_at desc)`.
- Private bucket `tailored-resumes` (`application/pdf`, 10 MB cap), path
  `${user.id}/${tailoredResumeId}.pdf`, owner-scoped policies mirroring the
  `resumes` bucket.

## Types — `src/lib/resume-optimizer-types.ts` (pure)

```ts
export type Compiler = "pdflatex" | "xelatex" | "lualatex";
export type Segment = { id: string; section: string; entry: string; text: string; start: number; end: number };
export type KeywordCategory = "skill" | "tool" | "domain" | "soft";
export type Keyword = { term: string; category: KeywordCategory; weight: 1 | 2 | 3; present: boolean };
export type Rewrite = { id: string; text: string; keywords: string[] };
export type Change = { segment: Segment; rewrite: Rewrite | null; accepted: boolean; droppedReason: string | null };
export type OptimizerResult = {
  originalTex: string; tex: string; compiler: Compiler;
  keywords: Keyword[]; changes: Change[]; pageWarning: boolean;
};
```

Never-throw validators for every Claude response:
`validateSegmentCandidates(raw) → {id,section,entry,text}[]`,
`validateKeywords(raw) → Omit<Keyword,"present">[]` (≤ 25, weight clamped to
1–3, unknown category → `"skill"`), `validateRewrites(raw, segmentIds) →
Rewrite[]` (drops unknown ids and non-string text).
`isCompiler(v): v is Compiler`.

## Pure module — `src/lib/latex-resume.ts` (no network/DB/LLM)

| Export | Behavior |
|---|---|
| `locateSegments(source, candidates)` | Verbatim-unique filter; assigns offsets; drops overlaps (earlier candidate wins). |
| `validateRewrite(original, rewritten)` | `{ ok: true } \| { ok: false; reason }` per the edit rules. |
| `spliceSegments(source, changes)` | Applies `accepted && rewrite` changes from the highest offset down. |
| `plainTextOf(source)` | Strips comments, `\commands`, braces, math; collapses whitespace. |
| `markPresent(keywords, plainText)` | Case-insensitive whole-word match → `Keyword[]`. |
| `pdfPageCount(bytes)` | Counts `/Type\s*/Page\b` (not `/Pages`); returns ≥ 1. |
| `coverage(keywords, changes)` | `{ matched, incorporated, missing, total }` for chips and the table. |

## Claude functions — `src/lib/claude.ts` (+3)

| Function | Prompt contract |
|---|---|
| `segmentResumeTex(source)` | Return JSON `{ segments: [{ id, section, entry, text }] }`. `text` is copied character-for-character from the source, including LaTeX inside it. Only description sentences of experience/project/leadership entries. Never headers, dates, titles, company names, contact lines, or the skills list. |
| `extractJobKeywords(jobDescription, roleTitle)` | Return JSON `{ keywords: [{ term, category, weight }] }`, ≤ 25, weight 3 = core to the role. Short canonical terms ("Kubernetes", not "experience with Kubernetes"). |
| `rewriteResumeSegments(ctx)` | Return JSON `{ rewrites: [{ id, text, keywords }] }` for changed segments only. Rephrase only; may use a keyword only when the original already demonstrates it; never add tools, metrics, or claims; keep every number and LaTeX command; stay within ±15% length; `instruction` (chat) applies on top of the current rewrites. |

All three use the existing `MODEL` and the JSON-extraction helper already
used by the cover-letter functions.

## Server actions — `src/app/(app)/resumes/actions.ts` (auth-gated)

```
optimizeResumeForApplication(applicationId, pastedJd?)
  → profile (resume_tex, compiler, resume_text) + application row
  → resolveJobDescription (needs_paste fallback)
  → segmentResumeTex → locateSegments → extractJobKeywords → markPresent
  → rewriteResumeSegments → validateRewrite each → spliceSegments
  → compileLatex → pdfPageCount vs original
  → { ok:true, result: OptimizerResult, pdfBase64 } | { ok:false, reason, log? }

refineResumeRewrites(applicationId, result, instruction, pastedJd?)
  → rewriteResumeSegments with instruction over current accepted texts → validate → splice → compile
  → same shape; no DB write

recompileResume(result)                      → splice + compile after revert/restore; same shape
saveTailoredResume(applicationId, result, pdfBase64)
  → insert tailored_resumes row → upload PDF → revalidatePath("/resumes")
  → { ok:true, id } | { ok:false, reason }
deleteTailoredResume(id)                     → delete PDF + row; revalidate
tailoredResumePdfUrl(id)                     → 60 s signed URL
```

Reasons: `not_set_up`, `no_resume_tex`, `needs_paste`, `no_segments`,
`compile_failed` (with `log`), else the error message.

`src/app/(app)/applications/actions.ts`: `createApplication` returns
`{ error: null, id }` on success (`ActionResult` gains optional `id`). The
existing cover-letter `resolveJobDescription` and `loadApplicationRow`
helpers are exported for reuse.

`src/app/(app)/settings/actions.ts`: `saveResumeTex(source, name, compiler)`
test-compiles first (returns `{ error: "<log tail>" }` on failure), then
writes the four profile columns; `clearResumeTex()`.

## Settings — `ResumeTexSection.tsx`

Modelled on `CoverLetterTemplateSection`. File input (`.tex`) **or** a paste
textarea; compiler dropdown; **Save & test-compile**. Shows name, saved date,
compiler, **Download .tex**, **Clear**. Compile failure shows the log tail and
nothing is stored. A "not set up" note when migration 010 isn't applied.

## Add Application dialog

- Checkbox **Tailor my resume for this role**, rendered only when the page
  passes `hasResumeTex`; default checked.
- On successful create with the box checked, the dialog swaps its body for
  `ResumeOptimizerPanel` (applicationId = returned id, `pastedJd` = paste-mode
  text if any) instead of closing. **Skip** or **Save** closes it; the
  application exists either way.

## Resumes tab — `/resumes`

- `NavLinks`: `{ href: "/resumes", label: "Resumes" }` after Applications.
- `page.tsx` loads `tailored_resumes` (newest first) and the user's
  applications (id, company, role) for the picker; "not set up" note if the
  table is missing.
- `ResumesView.tsx`: table — company, role, created, coverage
  ("11/16 matched"), actions **PDF** (signed URL), **.tex** (blob from the
  row), **View** (modal: keyword chips + change cards, read-only), **Delete**
  (confirm). Button **Tailor for an application…** → picker (applications
  without a tailored resume first, others below) → `ResumeOptimizerPanel`.

## `ResumeOptimizerPanel.tsx` (shared)

Props: `{ applicationId, companyName, roleTitle, pastedJd?, onDone(saved: boolean) }`.
Same shell as `CoverLetterPanel`.

- Runs `optimizeResumeForApplication` on mount; `needs_paste` shows the paste
  box; `no_resume_tex` links to Settings.
- **Keyword bar:** chips — matched (green), incorporated (blue), missing
  (grey).
- **Changes:** one card per segment with a rewrite: `section › entry`,
  original → rewritten, incorporated keywords highlighted, **Revert** /
  **Restore**. Dropped rewrites show "kept original (validation)". Unchanged
  segments collapsed under "N unchanged".
- Revert/Restore triggers `recompileResume` (debounced 600 ms) so downloads
  are always current. `pageWarning` → amber banner "The tailored resume runs
  one page longer — try asking the chat to tighten the longest bullets."
- **Chat** input → `refineResumeRewrites`.
- Buttons: **Download PDF**, **Download .tex**, **Save to Resumes**, **Skip**.
- Compile failure: red banner with the log tail; **Download .tex** still
  works; Save disabled.

## Error handling

| Condition | Result |
|---|---|
| Migration 010 not applied | "Not set up" notes in Settings and Resumes; checkbox hidden |
| No `.tex` in Settings | Checkbox hidden; panel (from picker) links to Settings |
| Listing unavailable | Paste fallback (existing copy) |
| No verifiable segments | "Couldn't find rewritable bullets in this resume." Nothing produced |
| Rewrite fails validation | Original kept; card labelled |
| Compile fails / service down / timeout | Log tail shown; `.tex` download available; Save disabled |
| Page count grew | Amber warning; chat suggestion |
| Unexpected throw | Caught; message shown; nothing saved |

## Testing — `test-resume-optimizer.mts` + `test-fixtures/resume.tex`

`npx tsx test-resume-optimizer.mts`; no framework, no network, no DB. The
fixture is a small Jake's-template-style resume with `\resumeItem{...}`
bullets, a plain `\item` list, a skills line, and two identical bullets (to
exercise the uniqueness rule).

- `locateSegments`: drops non-verbatim and duplicate candidates; offsets
  slice back to the text; overlaps dropped.
- `validateRewrite`: rejects unbalanced braces, a dropped number, a new
  command, a blank line, > ±15% length; accepts a clean rephrase.
- `spliceSegments`: everything outside segments byte-identical; two
  non-adjacent replacements both land.
- `plainTextOf` / `markPresent`: whole-word, case-insensitive; `C++` and
  `Node.js` match.
- `pdfPageCount`: 1 and 2 on two tiny inline PDFs; never below 1.
- Validators never throw on `null`, strings, arrays, or wrong shapes.
- `compileLatex`: live smoke test only when `LIVE_TESTS=1` is set.

## Files

| File | Change |
|---|---|
| `supabase/migrations/010_resume_optimizer.sql` | new |
| `src/lib/resume-optimizer-types.ts` | new |
| `src/lib/latex-resume.ts` | new |
| `src/lib/latex-compile.ts` | new |
| `test-resume-optimizer.mts`, `test-fixtures/resume.tex` | new |
| `src/lib/claude.ts` | +3 functions |
| `src/app/(app)/resumes/{page,actions,ResumesView,ResumeOptimizerPanel}.tsx` | new |
| `src/app/(app)/applications/actions.ts` | `createApplication` returns `id`; export two helpers |
| `src/app/(app)/applications/AddApplicationDialog.tsx`, `page.tsx` | checkbox + handoff; pass `hasResumeTex` |
| `src/app/(app)/settings/{ResumeTexSection.tsx,actions.ts,page.tsx}` | new section + actions |
| `src/app/(app)/NavLinks.tsx` | Resumes link |
| `.env.example` | `LATEX_COMPILE_URL` with privacy note |

## Success criteria

1. Uploading a `.tex` in Settings compiles it through the service and stores
   it; a broken file is rejected with the log tail.
2. Adding an application with the box checked opens the panel without
   re-entering the listing, shows keyword chips and bullet diffs, and
   downloads a PDF whose only differences from the original are the accepted
   bullets.
3. Every accepted rewrite passes the edit rules; nothing outside the segments
   changes byte-for-byte.
4. Saving creates a row in the Resumes tab with PDF, `.tex`, and a
   re-openable report; deleting removes both row and file.
5. The Applications page renders exactly as before.
6. `npx tsx test-resume-optimizer.mts` passes and existing suites still pass.
