# Cover-letter generator

**Date:** 2026-08-03
**Status:** Drafted — awaiting review

## Problem

Writing a cover letter per application is slow, and the tedious part is not
the prose — it is reproducing your own letter's exact look: the margins, the
letterhead, the font, the header. People keep a "good" cover letter in Word and
retype the body for each job, hoping they don't disturb the formatting.

## Solution

Upload your cover letter once as a `.docx` "template." From an application in
the tracker, generate a new letter that is the **same document** — byte-identical
margins, headers, fonts, letterhead, and signature — with the date, recipient,
salutation, and body regenerated for that job and your resume. Refine it by
chatting with the agent, then download the `.docx` or save it to the application.

## Scope

**In:**
- One reusable `.docx` template per user, uploaded/managed in Settings.
- A "Generate cover letter" action on an application row/drawer.
- Regenerating **date, recipient block, salutation, and body paragraphs**;
  keeping **letterhead, closing, and signature** exactly as the template.
- A chat panel to iteratively refine the generated content.
- Download the finished `.docx`; save it to the application (Supabase Storage).

**Out (decided, not deferred by oversight):**
- No PDF export.
- No multiple/named templates (one per user in v1).
- No in-browser pixel-perfect render. The chat preview shows text content;
  exact formatting is guaranteed in the produced `.docx`, seen on download.
- No editing of the template itself in-app (replace it by re-uploading).
- Templates whose **body** is laid out in tables, text boxes, or multiple
  columns are unsupported. A letterhead built as a table/text box is fine
  because that region is never touched.

## Data sources

| Input | Source |
|---|---|
| Template | `.docx` in Supabase Storage bucket `cover-letter-templates` at `${user.id}/template.docx`, uploaded client-side like the resume. |
| Resume | `resume_text` already on the user's profile (Settings). |
| Job description | Re-fetched at generation time from the application's `posting_url` using the existing `fetchPostingHtml` + `htmlToText` from `src/lib/job-posting.ts`, with a paste-the-description fallback. Posting text is not stored (per the autofill spec). |
| Company / role / location | The application row (`company_name`, `role_title`, `location`). |

## Formatting-preservation mechanism (the core)

A `.docx` is a zip of XML parts. The letter is **edited in place, never
regenerated from scratch**:

1. Unzip with `pizzip`; read `word/document.xml`. Parse it with
   `@xmldom/xmldom` (server-side DOM).
2. **Leave untouched:** `w:sectPr` (page margins), `word/header*.xml` and
   `word/footer*.xml`, `word/styles.xml`, and every part except the body of
   `document.xml`. This is what guarantees margins and headers come out
   byte-identical.
3. Extract the ordered list of body paragraphs (`w:p`), each as
   `{ index, text }` (concatenated `w:t` runs).
4. **Classify** each paragraph via Claude into one of: `letterhead`, `date`,
   `recipient`, `salutation`, `body`, `closing`, `signature`. Returns the
   classification plus the contiguous body paragraph index range.
5. **Apply** the regenerated content:
   - `date` / `recipient` / `salutation` (single paragraphs): replace the text
     of the paragraph's runs, preserving each run's `w:rPr`. If a field spans
     multiple template paragraphs (e.g. a multi-line recipient block), map new
     lines onto those paragraphs; extra lines clone the first line's `pPr`/`rPr`.
   - `body`: delete the template's body paragraph range and insert N new `w:p`
     nodes, each cloning the `pPr` and run `rPr` of a representative template
     body paragraph, with the new paragraph's text.
   - `letterhead` / `closing` / `signature`: untouched.
6. Serialize `document.xml` back, re-zip → finished `.docx`.

**Libraries (new deps):** `pizzip` (pure-JS zip, server-side) and
`@xmldom/xmldom` (server-side DOM). Both pure JS, no native build.

**Failure posture:** if classification finds no `body` region, or the template
can't be parsed as a flat letter, generation returns an actionable error
("Couldn't read this template as a standard letter…") and nothing is produced.

## Generation & chat-edit flow

The regenerated content is a structured object, never free text, so it maps
cleanly back onto paragraphs:

```
CoverLetterContent = {
  date: string,                 // one line
  recipient: string[],          // 1+ lines
  salutation: string,           // one line
  body: string[],               // N paragraphs
}
```

1. **Generate:** assemble template example text (for tone/length cues) + resume
   + JD + company/role → `generateCoverLetter()` returns `CoverLetterContent`.
   Date anchored to today (same lesson as the email prompt).
2. **Chat refine:** the panel shows the content as text. Each user message
   ("tighten paragraph 2", "mention my Python internship") calls
   `refineCoverLetter(current, instruction, ...context)`, which returns the full
   revised `CoverLetterContent`. Mirrors the existing `refineOutreachEmail`.
   Chat history is in-session only; it is not persisted.
3. **Produce:** Download or Save renders the final `CoverLetterContent` into the
   template via the mechanism above.

The preview is text, not a render. Formatting fidelity is the `.docx`'s job.

## New functions in `src/lib/claude.ts`

Both copy the existing JSON-returning-helper idiom (`translateSearchQuery`,
`pickLinkedInMatch`): reuse the module-level `client` and pinned `MODEL`,
strip ```json fences, `JSON.parse` in try/catch with a safe fallback.

| Function | Behavior |
|---|---|
| `classifyLetterParagraphs(paragraphs)` | Input: `{index,text}[]`. Output: per-paragraph role + the body range. Validator: unknown role → `body` is never assumed; a paragraph with no confident role is `letterhead` (safest = untouched). Never throws. |
| `generateCoverLetter(ctx)` | Input: template example text, resume text, JD text, company/role/location, today. Output: `CoverLetterContent`. Nulls/empties tolerated; body is always ≥1 paragraph. |
| `refineCoverLetter(current, instruction, ctx)` | Input: current `CoverLetterContent` + instruction + same context. Output: full revised `CoverLetterContent`. |

## New module `src/lib/docx-template.ts` (pure, no network/DB/LLM)

All zip/XML logic, so it unit-tests on a fixture `.docx` with no network.

| Export | Behavior |
|---|---|
| `extractParagraphs(docxBuf)` | `{ index, text }[]` from `word/document.xml` body. |
| `applyContent(docxBuf, classification, content)` | Returns a new `.docx` `Buffer`/`Uint8Array` with date/recipient/salutation/body replaced, `pPr`/`rPr` cloned, all other parts untouched. |
| `templateExampleText(docxBuf)` | Plain-text dump of the template for tone cues (feeds `generateCoverLetter`). |

## Server actions in `src/app/(app)/applications/actions.ts`

All auth-gated like the existing actions.

```
generateCoverLetterForApplication(applicationId)
  auth → load application + template from storage + resume_text
       → templateExampleText + (fetch JD from posting_url | needs_paste)
       → extractParagraphs → classifyLetterParagraphs → generateCoverLetter
  → { ok:true, content, classification } | { ok:false, reason }

refineCoverLetterContent(applicationId, current, instruction)
  auth → refineCoverLetter → { ok:true, content } | { ok:false, reason }

downloadCoverLetter(applicationId, content, classification)   // returns the .docx bytes
saveCoverLetter(applicationId, content, classification)        // writes to storage + columns; revalidates
```

`generate`/`refine`/`download` do **not** write to the DB and do not call
`revalidatePath`. `saveCoverLetter` writes and revalidates `/applications`.

Passing `classification` back to the client lets download/save re-apply content
without re-classifying. The client holds the working `content` during chat.

## Settings

A new section (mirrors the resume upload): upload/replace/remove the `.docx`
template, showing "Current template: <name>". Client uploads the file to the
`cover-letter-templates` bucket; a server action records
`cover_letter_template_name` + `cover_letter_template_at` on the profile.

## Migration — `supabase/migrations/009_cover_letters.sql`

- `applications`: add `cover_letter_name text`, `cover_letter_at timestamptz`.
- `profiles`: add `cover_letter_template_name text`,
  `cover_letter_template_at timestamptz`.
- Storage buckets `cover-letter-templates` and `cover-letters` (private) with
  owner-scoped RLS policies mirroring the `resumes` bucket.

Applied by the user in the Supabase SQL editor. Until then, the feature shows a
"not set up" note, matching migrations 007/008.

## UI

- Application drawer: a **Generate cover letter** button (enabled once a
  template exists). Opens a cover-letter panel: a text preview of the content
  and a chat input. Buttons: **Download .docx**, **Save to application**.
- After saving: a **Cover letter** chip on the row with a signed-URL
  re-download (same pattern as the resume download).
- No template uploaded → the button links to Settings with a hint.

## Error handling

| Condition | Result |
|---|---|
| No template uploaded | Button disabled; hint to upload in Settings. |
| No resume text | Warn; allow generation but note the letter will be thin. |
| `posting_url` missing or fetch fails | Paste-the-description fallback (reuses the autofill copy). |
| Template not a flat letter (no body region found) | "Couldn't read this template as a standard letter — check it's a normal cover letter .docx." Nothing produced. |
| Claude returns unusable content | Keep the previous content; show the error; form stays usable. |
| Any unexpected throw | Caught; message shown; nothing saved. |

## Testing — `test-cover-letter.mts`

Matches `test-job-posting.mts`: `npx tsx`, no framework, no network, no DB.
Uses a small fixture `.docx` committed under `test-fixtures/`.

- `extractParagraphs` — paragraph count and text on the fixture.
- `applyContent` — after applying known content: (1) body text is present,
  (2) `sectPr` bytes are unchanged (margins preserved), (3) header part
  unchanged, (4) letterhead/signature paragraphs unchanged, (5) output re-zips
  and re-parses.
- Classification-response validator — unknown role coerces to `letterhead`;
  malformed JSON → safe default; never throws.
- `CoverLetterContent` validators — body always ≥1 paragraph.

Claude and `fetch` are not unit-tested; their response handling is.

## Files

| File | Change |
|---|---|
| `src/lib/docx-template.ts` | new |
| `test-cover-letter.mts` + `test-fixtures/template.docx` | new |
| `src/lib/claude.ts` | add 3 functions |
| `src/app/(app)/applications/actions.ts` | add cover-letter actions |
| `applications/` cover-letter panel component | new |
| `applications/ApplicationsView.tsx` (drawer) | add the button + chip |
| `src/app/(app)/settings/` | template upload section + action |
| `supabase/migrations/009_cover_letters.sql` | new |
| `package.json` | add `pizzip`, `@xmldom/xmldom` |

## Success criteria

1. A generated `.docx` opens in Word with the template's exact margins, header,
   fonts, letterhead, and signature — only date/recipient/salutation/body differ.
2. The body reflects the job description and the user's resume.
3. Chatting an edit ("shorten paragraph 2") updates the preview and the
   downloaded file.
4. Save to application produces a re-downloadable file linked from the row.
5. A missing posting URL degrades to the paste fallback; a missing template
   disables the action with a Settings hint.
6. `npx tsx test-cover-letter.mts` passes, and existing test suites still pass.
