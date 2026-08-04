# Cover-letter Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a per-job cover letter from an uploaded `.docx` template that keeps the template's exact margins/headers/fonts/letterhead/signature, regenerating only date/recipient/salutation/body from the job posting and the user's resume, refined via chat and downloaded or saved to the application.

**Architecture:** A `.docx` is a zip of XML. We edit `word/document.xml` **in place** and never touch `w:sectPr` (margins), `word/header*.xml`/`footer*.xml`, or `word/styles.xml`, so formatting is byte-identical. Claude classifies each body paragraph by role and produces a structured `CoverLetterContent`; a pure library maps that content back onto the template, cloning each replaced paragraph's own formatting. Generation/refine/download run as server actions; a chat panel in the application drawer drives refinement.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (Postgres + Storage + RLS), Anthropic SDK (pinned `MODEL` in `src/lib/claude.ts`), `pizzip` (pure-JS zip), `@xmldom/xmldom` (server-side DOM). Tests: `.mts` files run with `npx tsx`, no framework.

**Source spec:** `docs/superpowers/specs/2026-08-03-cover-letter-generator-design.md` — read it before starting.

## Global Constraints

- **Never touch** `w:sectPr`, `word/header*.xml`, `word/footer*.xml`, or `word/styles.xml` in the `.docx`. Only `word/document.xml` body content changes.
- Reuse the existing module-level `client` and the pinned `const MODEL = "claude-sonnet-4-5-20250929"` in `src/lib/claude.ts`. Never construct a second `Anthropic` client; never hardcode a different model string.
- Claude JSON helpers copy the existing idiom (`translateSearchQuery`, `pickLinkedInMatch`): system prompt says "output ONLY JSON"; strip ```json fences with `.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim()`; `JSON.parse` in try/catch; return a safe fallback; **never throw**.
- Server actions: `"use server"`, `const supabase = await createClient()` (async — must await), auth-gate every action with `supabase.auth.getUser()`. Only DB-writing actions call `revalidatePath`.
- One template per user. No PDF export. No multiple/named templates.
- Storage buckets are **private**, owner-scoped RLS mirroring the existing `resumes` bucket. Paths: `cover-letter-templates/${user.id}/template.docx`, `cover-letters/${user.id}/${applicationId}.docx`.
- Feature degrades to a "not set up" note until migration 009 is applied (mirror the 007/008 handling already in the codebase).
- Test harness convention: `.mts` in repo root, `npx tsx`, a `check(label, got, want)` helper, `process.exit(fails ? 1 : 0)`. Mirror `test-job-posting.mts`.
- `.docx` MIME: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/cover-letter-types.ts` (new) | Shared types (`ParagraphRole`, `LetterClassification`, `CoverLetterContent`, `CoverLetterContext`) + pure validators. No deps, no network. |
| `src/lib/docx-template.ts` (new) | Pure zip/XML: `extractParagraphs`, `templateExampleText`, `applyContent`. Uses pizzip + xmldom. No network/DB/LLM. |
| `test-fixtures/make-fixture.mjs` (new) | Authors a minimal valid `.docx` fixture deterministically. |
| `test-fixtures/template.docx` (new, generated) | Committed fixture for tests. |
| `test-cover-letter.mts` (new) | Unit tests for validators + docx-template against the fixture. |
| `src/lib/claude.ts` (modify) | Add `classifyLetterParagraphs`, `generateCoverLetter`, `refineCoverLetter`. |
| `supabase/migrations/009_cover_letters.sql` (new) | Columns + private buckets + RLS. |
| `src/app/(app)/applications/actions.ts` (modify) | `generateCoverLetterForApplication`, `refineCoverLetterContent`, `downloadCoverLetter`, `saveCoverLetter`, `coverLetterDownloadUrl`. |
| `src/app/(app)/applications/CoverLetterPanel.tsx` (new) | Client: text preview + chat + Download/Save buttons. |
| `src/app/(app)/applications/ApplicationsView.tsx` (modify) | "Generate cover letter" button in the drawer + saved-letter chip. |
| `src/app/(app)/settings/CoverLetterTemplateSection.tsx` (new) | Client: upload/replace/remove template. |
| `src/app/(app)/settings/actions.ts` (modify) | Record/clear template metadata; signed-URL helper. |
| `src/app/(app)/settings/SettingsForm.tsx` or `page.tsx` (modify) | Mount the template section. |
| `package.json` (modify) | Add `pizzip`, `@xmldom/xmldom`. |

---

### Task 1: Shared types + pure validators

**Files:**
- Create: `src/lib/cover-letter-types.ts`
- Test: `test-cover-letter.mts` (created here; extended in Task 2)

**Interfaces:**
- Produces:
  - `type ParagraphRole = "letterhead" | "date" | "recipient" | "salutation" | "body" | "closing" | "signature"`
  - `type LetterClassification = { roles: ParagraphRole[]; bodyStart: number; bodyEnd: number }`
  - `type CoverLetterContent = { date: string; recipient: string[]; salutation: string; body: string[] }`
  - `type CoverLetterContext = { templateText: string; resumeText: string | null; jobDescription: string; companyName: string; roleTitle: string; location: string | null; today: string }`
  - `validateClassification(raw: unknown, paragraphCount: number): LetterClassification`
  - `validateCoverLetterContent(raw: unknown): CoverLetterContent`

- [ ] **Step 1: Write the failing tests**

Create `test-cover-letter.mts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd "D:/Claude Code/networking-app" && npx tsx test-cover-letter.mts`
Expected: FAIL — cannot find module `./src/lib/cover-letter-types`.

- [ ] **Step 3: Implement `src/lib/cover-letter-types.ts`**

```ts
export type ParagraphRole =
  | "letterhead" | "date" | "recipient" | "salutation" | "body" | "closing" | "signature";

const ROLES: readonly ParagraphRole[] = [
  "letterhead", "date", "recipient", "salutation", "body", "closing", "signature",
];

export type LetterClassification = { roles: ParagraphRole[]; bodyStart: number; bodyEnd: number };
export type CoverLetterContent = { date: string; recipient: string[]; salutation: string; body: string[] };
export type CoverLetterContext = {
  templateText: string; resumeText: string | null; jobDescription: string;
  companyName: string; roleTitle: string; location: string | null; today: string;
};

function clampInt(v: unknown, lo: number, hi: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Never throws. Unknown/missing roles become "letterhead" (safest: untouched). */
export function validateClassification(raw: unknown, paragraphCount: number): LetterClassification {
  const safe = (): LetterClassification => ({
    roles: Array.from({ length: paragraphCount }, () => "letterhead" as ParagraphRole),
    bodyStart: -1, bodyEnd: -1,
  });
  try {
    const o = raw as { roles?: unknown; bodyStart?: unknown; bodyEnd?: unknown };
    if (!o || !Array.isArray(o.roles)) return safe();
    const roles: ParagraphRole[] = Array.from({ length: paragraphCount }, (_, i) => {
      const r = o.roles![i];
      return ROLES.includes(r as ParagraphRole) ? (r as ParagraphRole) : "letterhead";
    });
    const hasBody = roles.includes("body");
    const bodyStart = hasBody ? clampInt(o.bodyStart, 0, paragraphCount - 1) : -1;
    const bodyEnd = hasBody ? clampInt(o.bodyEnd, 0, paragraphCount - 1) : -1;
    return { roles, bodyStart: Math.min(bodyStart, bodyEnd), bodyEnd: Math.max(bodyStart, bodyEnd) };
  } catch {
    return safe();
  }
}

/** Never throws. body is always >= 1 paragraph. */
export function validateCoverLetterContent(raw: unknown): CoverLetterContent {
  const safe: CoverLetterContent = { date: "", recipient: [], salutation: "", body: [""] };
  try {
    const o = raw as Partial<CoverLetterContent>;
    if (!o || typeof o !== "object") return safe;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const body = arr(o.body);
    return {
      date: str(o.date),
      recipient: arr(o.recipient),
      salutation: str(o.salutation),
      body: body.length ? body : [""],
    };
  } catch {
    return safe;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd "D:/Claude Code/networking-app" && npx tsx test-cover-letter.mts`
Expected: all PASS, exit 0.

- [ ] **Step 5: Typecheck + commit**

```bash
cd "D:/Claude Code/networking-app"
npx tsc --noEmit
git add src/lib/cover-letter-types.ts test-cover-letter.mts
git commit -m "feat(cover-letter): shared types + pure validators"
```

---

### Task 2: docx-template library + fixture

**Files:**
- Modify: `package.json` (add `pizzip`, `@xmldom/xmldom`)
- Create: `test-fixtures/make-fixture.mjs`, `test-fixtures/template.docx`
- Create: `src/lib/docx-template.ts`
- Test: `test-cover-letter.mts` (extend)

**Interfaces:**
- Consumes: `LetterClassification`, `CoverLetterContent` (Task 1).
- Produces:
  - `extractParagraphs(docx: Uint8Array): { index: number; text: string }[]` — top-level `w:body` `w:p` only, in order.
  - `templateExampleText(docx: Uint8Array): string` — newline-joined paragraph text.
  - `applyContent(docx: Uint8Array, cls: LetterClassification, content: CoverLetterContent): Uint8Array` — new `.docx` bytes.

- [ ] **Step 1: Install dependencies**

```bash
cd "D:/Claude Code/networking-app"
npm install pizzip @xmldom/xmldom
```
Expected: both added to `package.json` dependencies.

- [ ] **Step 2: Create the fixture generator and run it**

Create `test-fixtures/make-fixture.mjs` — authors a minimal but realistic letter `.docx` (letterhead, date, recipient x2, salutation, body x2, closing, signature; a header part; a `sectPr` with explicit margins). It must produce top-level `w:body` paragraphs in that order.

```js
import PizZip from "pizzip";
import { writeFileSync } from "node:fs";

const p = (text) =>
  `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${p("Jane Applicant")}
${p("2026-01-01")}
${p("Hiring Manager")}
${p("Acme Corp")}
${p("Dear Hiring Manager,")}
${p("This is the first body paragraph of the example letter.")}
${p("This is the second body paragraph of the example letter.")}
${p("Sincerely,")}
${p("Jane Applicant")}
<w:sectPr><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body>
</w:document>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdH1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>`;

const header1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>LETTERHEAD</w:t></w:r></w:p></w:hdr>`;

const zip = new PizZip();
zip.file("[Content_Types].xml", contentTypes);
zip.file("_rels/.rels", rootRels);
zip.file("word/document.xml", documentXml);
zip.file("word/_rels/document.xml.rels", docRels);
zip.file("word/header1.xml", header1);

const buf = zip.generate({ type: "nodebuffer" });
writeFileSync(new URL("./template.docx", import.meta.url), buf);
console.log("wrote template.docx", buf.length, "bytes");
```

Run: `cd "D:/Claude Code/networking-app" && node test-fixtures/make-fixture.mjs`
Expected: prints `wrote template.docx <n> bytes`; the file exists.

- [ ] **Step 3: Write the failing tests (extend `test-cover-letter.mts`)**

Add imports and cases at the end (before `process.exit`):

```ts
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
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd "D:/Claude Code/networking-app" && npx tsx test-cover-letter.mts`
Expected: FAIL — cannot find module `./src/lib/docx-template`.

- [ ] **Step 5: Implement `src/lib/docx-template.ts`**

```ts
import PizZip from "pizzip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { LetterClassification, CoverLetterContent } from "./cover-letter-types";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function readDocumentXml(docx: Uint8Array): { zip: PizZip; doc: Document; body: Element } {
  const zip = new PizZip(docx);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("Not a .docx: word/document.xml missing.");
  const doc = new DOMParser().parseFromString(file.asText(), "text/xml") as unknown as Document;
  const body = doc.getElementsByTagName("w:body")[0] as unknown as Element;
  if (!body) throw new Error("Not a Word document: no w:body.");
  return { zip, doc, body };
}

/** Top-level w:p children of w:body, in order. Skips table/textbox paragraphs. */
function topLevelParagraphs(body: Element): Element[] {
  const out: Element[] = [];
  for (let n = body.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).nodeName === "w:p") out.push(n as Element);
  }
  return out;
}

function paragraphText(p: Element): string {
  const ts = p.getElementsByTagName("w:t");
  let s = "";
  for (let i = 0; i < ts.length; i++) s += ts.item(i)?.textContent ?? "";
  return s;
}

export function extractParagraphs(docx: Uint8Array): { index: number; text: string }[] {
  const { body } = readDocumentXml(docx);
  return topLevelParagraphs(body).map((p, index) => ({ index, text: paragraphText(p) }));
}

export function templateExampleText(docx: Uint8Array): string {
  return extractParagraphs(docx).map((p) => p.text).join("\n");
}

/** Put `text` into the first w:t of the paragraph, blank the rest. Preserves the first run's rPr. */
function setParagraphText(p: Element): (text: string) => void {
  return (text: string) => {
    const ts = p.getElementsByTagName("w:t");
    if (ts.length === 0) return;
    const first = ts.item(0)!;
    first.setAttribute("xml:space", "preserve");
    first.textContent = text;
    for (let i = 1; i < ts.length; i++) ts.item(i)!.textContent = "";
  };
}

export function applyContent(
  docx: Uint8Array,
  cls: LetterClassification,
  content: CoverLetterContent,
): Uint8Array {
  const { zip, doc, body } = readDocumentXml(docx);
  const paras = topLevelParagraphs(body);

  // Single-line fields: replace text in place, preserving formatting.
  const dateIdx = cls.roles.indexOf("date");
  if (dateIdx >= 0 && content.date) setParagraphText(paras[dateIdx])(content.date);

  const salIdx = cls.roles.indexOf("salutation");
  if (salIdx >= 0 && content.salutation) setParagraphText(paras[salIdx])(content.salutation);

  // Recipient: map lines onto consecutive recipient paragraphs; clone the last for overflow.
  const recipIdxs = cls.roles.flatMap((r, i) => (r === "recipient" ? [i] : []));
  if (recipIdxs.length && content.recipient.length) {
    const lastRecip = paras[recipIdxs[recipIdxs.length - 1]];
    for (let i = 0; i < content.recipient.length; i++) {
      if (i < recipIdxs.length) {
        setParagraphText(paras[recipIdxs[i]])(content.recipient[i]);
      } else {
        const clone = lastRecip.cloneNode(true) as Element;
        setParagraphText(clone)(content.recipient[i]);
        lastRecip.parentNode!.insertBefore(clone, lastRecip.nextSibling);
      }
    }
    // Blank any leftover template recipient paragraphs.
    for (let i = content.recipient.length; i < recipIdxs.length; i++) {
      setParagraphText(paras[recipIdxs[i]])("");
    }
  }

  // Body: replace the contiguous range with N new paragraphs cloning a template body paragraph.
  if (cls.bodyStart >= 0 && cls.bodyEnd >= cls.bodyStart) {
    const templateBody = paras[cls.bodyStart].cloneNode(true) as Element;
    const anchor = paras[cls.bodyEnd].nextSibling; // insert before whatever followed the body
    const parent = paras[cls.bodyStart].parentNode!;
    for (let i = cls.bodyStart; i <= cls.bodyEnd; i++) parent.removeChild(paras[i]);
    for (const text of content.body) {
      const clone = templateBody.cloneNode(true) as Element;
      setParagraphText(clone)(text);
      parent.insertBefore(clone, anchor);
    }
  }

  const xml = new XMLSerializer().serializeToString(doc as unknown as Node);
  zip.file("word/document.xml", xml);
  return zip.generate({ type: "uint8array" });
}
```

- [ ] **Step 6: Run to verify tests pass**

Run: `cd "D:/Claude Code/networking-app" && npx tsx test-cover-letter.mts`
Expected: all PASS (Task 1 + Task 2 cases), exit 0.

- [ ] **Step 7: Typecheck + commit**

```bash
cd "D:/Claude Code/networking-app"
npx tsc --noEmit
git add package.json package-lock.json src/lib/docx-template.ts test-cover-letter.mts test-fixtures/
git commit -m "feat(cover-letter): in-place .docx edit library + fixture tests"
```

---

### Task 3: Claude functions (classify / generate / refine)

**Files:**
- Modify: `src/lib/claude.ts` (add three functions near the other JSON helpers)

**Interfaces:**
- Consumes: `LetterClassification`, `CoverLetterContent`, `CoverLetterContext`, `validateClassification`, `validateCoverLetterContent` (Task 1).
- Produces:
  - `classifyLetterParagraphs(paragraphs: { index: number; text: string }[]): Promise<LetterClassification>`
  - `generateCoverLetter(ctx: CoverLetterContext): Promise<CoverLetterContent>`
  - `refineCoverLetter(current: CoverLetterContent, instruction: string, ctx: CoverLetterContext): Promise<CoverLetterContent>`

- [ ] **Step 1: Implement the three functions**

Add to `src/lib/claude.ts` (reuse existing `client`, `MODEL`, and the fence-strip/parse idiom from `translateSearchQuery`). Import the types + validators at the top:

```ts
import {
  type LetterClassification,
  type CoverLetterContent,
  type CoverLetterContext,
  validateClassification,
  validateCoverLetterContent,
} from "@/lib/cover-letter-types";
```

Then:

```ts
function textFrom(response: Anthropic.Message): string {
  return response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text).join("").trim();
}
function stripFences(t: string): string {
  return t.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
}

/** Classify each body paragraph by role. Never throws (validator gives a safe default). */
export async function classifyLetterParagraphs(
  paragraphs: { index: number; text: string }[],
): Promise<LetterClassification> {
  if (!paragraphs.length) return validateClassification(null, 0);
  const system = `You label the paragraphs of a cover letter by role. Output ONLY JSON, no prose, no markdown.
Shape: {"roles": string[], "bodyStart": number, "bodyEnd": number}
- roles has exactly one entry per input paragraph, in order, each one of:
  "letterhead","date","recipient","salutation","body","closing","signature".
- "date" = the letter's date line. "recipient" = the addressee block (name/company/address lines).
  "salutation" = the greeting ("Dear ..."). "body" = the substantive paragraphs.
  "closing" = the sign-off word ("Sincerely,"). "signature" = the sender's name/contact after the closing.
  "letterhead" = anything above the date (sender name/contact at the top) or anything you are unsure about.
- bodyStart/bodyEnd = the inclusive index range of the contiguous "body" paragraphs.
When unsure, prefer "letterhead" so the paragraph is left untouched.`;
  const user = JSON.stringify(paragraphs.map((p) => ({ index: p.index, text: p.text })));
  const response = await client.messages.create({
    model: MODEL, max_tokens: 500, system, messages: [{ role: "user", content: user }],
  });
  try {
    return validateClassification(JSON.parse(stripFences(textFrom(response))), paragraphs.length);
  } catch {
    return validateClassification(null, paragraphs.length);
  }
}

const COVER_LETTER_RULES = `You write a job-application cover letter as structured JSON. Output ONLY JSON, no prose, no markdown.
Shape: {"date": string, "recipient": string[], "salutation": string, "body": string[]}
- Match the tone, length, and paragraph count of the EXAMPLE LETTER as closely as you can; it shows the writer's voice.
- "date" is today's date in the same style the example uses.
- "recipient" is the addressee block for THIS company (1+ short lines). If you don't know the hiring manager, address the team/department, never invent a person's name.
- "salutation" greets the recipient.
- "body" are the substantive paragraphs (an array, one string per paragraph). Ground every claim about the applicant ONLY in the RESUME. Never invent experience. Tie the letter to the JOB DESCRIPTION specifics.
- No markdown, no bullet characters, plain sentences.`;

export async function generateCoverLetter(ctx: CoverLetterContext): Promise<CoverLetterContent> {
  const user = [
    `Today's date: ${ctx.today}`,
    `Company: ${ctx.companyName}`, `Role: ${ctx.roleTitle}`,
    ctx.location ? `Location: ${ctx.location}` : "",
    ``, `EXAMPLE LETTER (match its voice and structure):\n${ctx.templateText}`,
    ``, `RESUME (the only source of applicant facts):\n${ctx.resumeText ?? "(none provided)"}`,
    ``, `JOB DESCRIPTION:\n${ctx.jobDescription || "(none provided)"}`,
  ].filter(Boolean).join("\n");
  const response = await client.messages.create({
    model: MODEL, max_tokens: 1200, system: COVER_LETTER_RULES,
    messages: [{ role: "user", content: user }],
  });
  try {
    return validateCoverLetterContent(JSON.parse(stripFences(textFrom(response))));
  } catch {
    return validateCoverLetterContent(null);
  }
}

export async function refineCoverLetter(
  current: CoverLetterContent, instruction: string, ctx: CoverLetterContext,
): Promise<CoverLetterContent> {
  const user = [
    `Today's date: ${ctx.today}`,
    `Company: ${ctx.companyName}`, `Role: ${ctx.roleTitle}`,
    ``, `CURRENT LETTER (JSON):\n${JSON.stringify(current)}`,
    ``, `RESUME (only source of applicant facts):\n${ctx.resumeText ?? "(none provided)"}`,
    ``, `JOB DESCRIPTION:\n${ctx.jobDescription || "(none provided)"}`,
    ``, `THE USER WANTS THIS CHANGED: ${instruction}`,
    ``, `Apply the instruction and return the FULL revised letter in the same JSON shape. Keep everything the instruction does not ask you to change. Same sourcing discipline: applicant facts only from the resume.`,
  ].join("\n");
  const response = await client.messages.create({
    model: MODEL, max_tokens: 1200, system: COVER_LETTER_RULES,
    messages: [{ role: "user", content: user }],
  });
  try {
    return validateCoverLetterContent(JSON.parse(stripFences(textFrom(response))));
  } catch {
    return current; // keep the last good content on failure
  }
}
```

Note: if `textFrom`/`stripFences` collide with existing local helpers in `claude.ts`, reuse the existing ones instead of redefining.

- [ ] **Step 2: Typecheck**

Run: `cd "D:/Claude Code/networking-app" && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Anti-pattern check**

Run: `cd "D:/Claude Code/networking-app" && git grep -n "new Anthropic\|claude-sonnet\|claude-opus\|claude-3" -- src/lib/claude.ts`
Expected: only the pre-existing `client` (line ~7) and the single `MODEL` constant (line ~10). Your additions add neither.

- [ ] **Step 4: Commit**

```bash
cd "D:/Claude Code/networking-app"
git add src/lib/claude.ts
git commit -m "feat(cover-letter): classify/generate/refine Claude helpers"
```

---

### Task 4: Migration 009

**Files:**
- Create: `supabase/migrations/009_cover_letters.sql`

**Interfaces:**
- Produces (DB, applied by the user): `applications.cover_letter_name`, `applications.cover_letter_at`, `profiles.cover_letter_template_name`, `profiles.cover_letter_template_at`; private buckets `cover-letter-templates`, `cover-letters` with owner RLS.

- [ ] **Step 1: Read the existing pattern**

Read `supabase/migrations/008_applications.sql` and the storage/RLS for the `resumes` bucket (search: `git grep -n "resumes" -- supabase/`). Mirror the owner-scoped policy shape and the `resumes` bucket's RLS exactly for the two new buckets.

- [ ] **Step 2: Write `supabase/migrations/009_cover_letters.sql`**

```sql
-- 009: cover-letter generator — metadata columns + private storage buckets.

alter table public.applications
  add column if not exists cover_letter_name text,
  add column if not exists cover_letter_at   timestamptz;

alter table public.profiles
  add column if not exists cover_letter_template_name text,
  add column if not exists cover_letter_template_at   timestamptz;

-- Private buckets (mirror the existing `resumes` bucket).
insert into storage.buckets (id, name, public)
values ('cover-letter-templates', 'cover-letter-templates', false),
       ('cover-letters', 'cover-letters', false)
on conflict (id) do nothing;

-- Owner-scoped RLS: a user may only touch files under their own <uid>/ prefix.
-- (Match the policy names/shape used for the `resumes` bucket in this project.)
do $$
declare b text;
begin
  foreach b in array array['cover-letter-templates','cover-letters'] loop
    execute format($p$
      create policy %I on storage.objects for all to authenticated
      using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text);
    $p$, 'own_' || replace(b,'-','_'), b, b);
  end loop;
end $$;
```

If the project's `resumes` policies differ in shape, replace the `do $$` block with policies copied verbatim from the `resumes` bucket, renamed for the two new buckets.

- [ ] **Step 3: Commit (do NOT apply — the user applies it)**

```bash
cd "D:/Claude Code/networking-app"
git add supabase/migrations/009_cover_letters.sql
git commit -m "feat(cover-letter): migration 009 (columns + private buckets)"
```

---

### Task 5: Server actions

**Files:**
- Modify: `src/app/(app)/applications/actions.ts`

**Interfaces:**
- Consumes: `extractParagraphs`, `templateExampleText`, `applyContent` (Task 2); `classifyLetterParagraphs`, `generateCoverLetter`, `refineCoverLetter` (Task 3); `CoverLetterContent`, `LetterClassification`, `CoverLetterContext` (Task 1); `fetchPostingHtml`, `htmlToText`, `guardUrl` (existing `src/lib/job-posting.ts`).
- Produces:
  - `type CoverLetterResult = { ok: true; content: CoverLetterContent; classification: LetterClassification } | { ok: false; reason: string }`
  - `generateCoverLetterForApplication(applicationId: string, pastedJd?: string): Promise<CoverLetterResult>`
  - `refineCoverLetterContent(applicationId: string, current: CoverLetterContent, instruction: string): Promise<{ ok: true; content: CoverLetterContent } | { ok: false; reason: string }>`
  - `downloadCoverLetter(applicationId: string, content: CoverLetterContent, classification: LetterClassification): Promise<{ ok: true; base64: string; filename: string } | { ok: false; reason: string }>`
  - `saveCoverLetter(applicationId, content, classification): Promise<{ ok: true } | { ok: false; reason: string }>`
  - `coverLetterDownloadUrl(applicationId: string): Promise<{ ok: true; url: string } | { ok: false; reason: string }>`

- [ ] **Step 1: Implement the actions**

Key shared logic (write once, reuse):
- Load the template: `supabase.storage.from("cover-letter-templates").download(`${user.id}/template.docx`)`. If missing → `{ ok:false, reason:"no_template" }`.
- Load the application row (`company_name, role_title, location, posting_url`) via the cookie client (RLS scopes to the owner).
- Load `resume_text` from `profiles`.
- Build `ctx: CoverLetterContext` with `today = new Date().toISOString().slice(0,10)` and `templateText = templateExampleText(bytes)`.
- JD resolution: if `pastedJd` is provided, use it. Else if `posting_url` present, `guardUrl` → `fetchPostingHtml` → `htmlToText`; on any failure return `{ ok:false, reason:"needs_paste" }`. Else `{ ok:false, reason:"needs_paste" }`.

`generateCoverLetterForApplication`: after building ctx, `extractParagraphs` → `classifyLetterParagraphs` → if no body region (`bodyStart < 0`) return `{ ok:false, reason:"unreadable_template" }` → `generateCoverLetter(ctx)` → return `{ ok:true, content, classification }`. No DB write, no `revalidatePath`.

`refineCoverLetterContent`: rebuild ctx (same JD resolution; if JD now needs paste, pass empty string — refinement can proceed without re-fetching by reusing companyName/role and empty JD) → `refineCoverLetter(current, instruction, ctx)` → `{ ok:true, content }`. No DB write.

`downloadCoverLetter`: download template bytes → `applyContent(bytes, classification, content)` → `{ ok:true, base64: Buffer.from(out).toString("base64"), filename: `${companyName}-cover-letter.docx` }`. No DB write.

`saveCoverLetter`: like download but `supabase.storage.from("cover-letters").upload(`${user.id}/${applicationId}.docx`, out, { upsert: true, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })`; then `update applications set cover_letter_name, cover_letter_at = now()`; `revalidatePath("/applications")`; `{ ok:true }`.

`coverLetterDownloadUrl`: `supabase.storage.from("cover-letters").createSignedUrl(`${user.id}/${applicationId}.docx`, 60)` → `{ ok:true, url }`.

Wrap every action body in try/catch → `{ ok:false, reason: message }`. Auth-gate all. Detect the migration-not-applied case (a Postgres error mentioning `cover_letter` / undefined column, or bucket-not-found) and return `reason:"not_set_up"`.

- [ ] **Step 2: Typecheck**

Run: `cd "D:/Claude Code/networking-app" && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Anti-pattern check**

Run: `cd "D:/Claude Code/networking-app" && git grep -n "revalidatePath" -- "src/app/(app)/applications/actions.ts"`
Expected: appears in `saveCoverLetter` and the pre-existing write actions only — NOT in generate/refine/download/coverLetterDownloadUrl.

- [ ] **Step 4: Commit**

```bash
cd "D:/Claude Code/networking-app"
git add "src/app/(app)/applications/actions.ts"
git commit -m "feat(cover-letter): generate/refine/download/save server actions"
```

---

### Task 6: Settings — template upload

**Files:**
- Create: `src/app/(app)/settings/CoverLetterTemplateSection.tsx`
- Modify: `src/app/(app)/settings/actions.ts`, and the settings page/form to mount the section.

**Interfaces:**
- Consumes: Supabase Storage `cover-letter-templates` bucket; `profiles.cover_letter_template_name/at`.
- Produces: `recordCoverLetterTemplate(filename: string)` and `clearCoverLetterTemplate()` server actions; a `coverLetterTemplateUrl()` signed-URL action.

- [ ] **Step 1: Read the resume upload pattern**

Read `src/app/(app)/settings/SettingsForm.tsx` and the resume-related actions in `src/app/(app)/settings/actions.ts` (the `resume.pdf` upload → `recordResumeUpload` → signed-url → remove flow). Copy that flow, substituting `.docx` + the `cover-letter-templates` bucket + the `cover_letter_template_*` columns.

- [ ] **Step 2: Implement the client section**

`CoverLetterTemplateSection.tsx` (`"use client"`): file input accepting `.docx` only (`accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"`); on select, client-uploads to `cover-letter-templates/${user.id}/template.docx` with `{ upsert: true }` using the browser Supabase client (mirror the resume upload); then calls `recordCoverLetterTemplate(file.name)`. Shows "Current template: <name>" with Replace/Remove, matching the resume UI. No `.docx` parsing on the client (unlike the resume PDF) — the server reads it at generation time.

- [ ] **Step 3: Implement the server actions**

In `settings/actions.ts`, add `recordCoverLetterTemplate(filename)` (update `cover_letter_template_name`, `cover_letter_template_at = now()`), `clearCoverLetterTemplate()` (remove the storage object + null the columns), and `coverLetterTemplateUrl()` (signed URL). Auth-gate; mirror the resume equivalents. `revalidatePath("/settings")` on writes.

- [ ] **Step 4: Mount + typecheck + commit**

Mount `<CoverLetterTemplateSection ... />` in the settings page near the resume section. Then:

```bash
cd "D:/Claude Code/networking-app"
npx tsc --noEmit
git add "src/app/(app)/settings/"
git commit -m "feat(cover-letter): Settings template upload"
```

---

### Task 7: Application drawer — generate button + cover-letter panel

**Files:**
- Create: `src/app/(app)/applications/CoverLetterPanel.tsx`
- Modify: `src/app/(app)/applications/ApplicationsView.tsx` (drawer)

**Interfaces:**
- Consumes: `generateCoverLetterForApplication`, `refineCoverLetterContent`, `downloadCoverLetter` (Task 5); `CoverLetterContent`, `LetterClassification` (Task 1).
- Produces: `<CoverLetterPanel applicationId hasTemplate />`.

- [ ] **Step 1: Implement `CoverLetterPanel.tsx`**

`"use client"`. State: `content: CoverLetterContent | null`, `classification: LetterClassification | null`, `messages: {role,text}[]`, `pasteMode: boolean`, `pastedJd: string`, `pending` (via `useTransition`), `error`. Behavior:
- On first open (or a "Generate" click): call `generateCoverLetterForApplication(applicationId)`. On `ok` set content + classification. On `reason==="needs_paste"` show a "Paste the job description" textarea + a button that re-calls `generateCoverLetterForApplication(applicationId, pastedJd)`. On `reason==="no_template"` show a link to Settings. On `"unreadable_template"`/`"not_set_up"` show the matching message from the spec §Error handling.
- **Preview:** render `content` as text — the date, the recipient lines, the salutation, then each body paragraph. Label it "Text preview — formatting is applied in the downloaded .docx".
- **Chat:** an input; on submit push the user message, call `refineCoverLetterContent(applicationId, content, instruction)`, and on `ok` replace `content` and push an assistant acknowledgement. Keep chat in-session only.
- **Download button:** call `downloadCoverLetter(applicationId, content, classification)`; on `ok`, build the file client-side and trigger download:

```ts
const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a"); a.href = url; a.download = res.filename; a.click();
URL.revokeObjectURL(url);
```

- **Save button:** call `saveCoverLetter(applicationId, content, classification)`; on `ok` show "Saved to application".
- Match the Tailwind/indigo styling of `AddApplicationDialog.tsx`.

- [ ] **Step 2: Wire the button into the drawer**

In `ApplicationsView.tsx`, in the expandable drawer, add a **Generate cover letter** button. Disable it (with a "Upload a template in Settings" hint) when `hasTemplate` is false — pass `hasTemplate` down from the page (read `profiles.cover_letter_template_name` in `applications/page.tsx` and thread it through). Clicking toggles `<CoverLetterPanel>` open within the drawer.

- [ ] **Step 3: Typecheck + build + commit**

```bash
cd "D:/Claude Code/networking-app"
npx tsc --noEmit
npx next build   # confirm /applications compiles (client/server boundary)
git add "src/app/(app)/applications/"
git commit -m "feat(cover-letter): drawer button + chat/preview/download panel"
```

---

### Task 8: Saved-letter chip + re-download

**Files:**
- Modify: `src/app/(app)/applications/ApplicationsView.tsx`, `src/app/(app)/applications/page.tsx`

**Interfaces:**
- Consumes: `coverLetterDownloadUrl` (Task 5); `applications.cover_letter_name/at` (migration 009).

- [ ] **Step 1: Surface the saved letter**

In `applications/page.tsx`, include `cover_letter_name, cover_letter_at` in the applications select (guard for the migration-not-applied case the same way `stage_changed_at`/008 are guarded elsewhere). Thread onto the row type.

- [ ] **Step 2: Render the chip**

In `ApplicationsView.tsx`, when a row has `cover_letter_name`, show a **Cover letter** chip (indigo, matching the "Application:" chip convention). Clicking calls `coverLetterDownloadUrl(applicationId)` and opens the signed URL in a new tab.

- [ ] **Step 3: Typecheck + commit**

```bash
cd "D:/Claude Code/networking-app"
npx tsc --noEmit
git add "src/app/(app)/applications/"
git commit -m "feat(cover-letter): saved-letter chip + signed-url re-download"
```

---

### Task 9: Final verification

- [ ] **Step 1: Tests**

Run: `cd "D:/Claude Code/networking-app" && npx tsx test-cover-letter.mts && npx tsx test-job-posting.mts && npx tsx test-applications.mts`
Expected: all three suites exit 0.

- [ ] **Step 2: Typecheck + build**

Run: `cd "D:/Claude Code/networking-app" && npx tsc --noEmit && npx next build`
Expected: clean; `/applications` and `/settings` compile.

- [ ] **Step 3: Anti-pattern sweep** (all expect empty)

```bash
cd "D:/Claude Code/networking-app"
git grep -n "new Anthropic" -- src/lib/docx-template.ts src/lib/cover-letter-types.ts
git grep -n "claude-sonnet\|claude-opus\|claude-3" -- src/lib/cover-letter-types.ts src/lib/docx-template.ts "src/app/(app)/applications"
# confirm sectPr/header/styles are never written:
git grep -n "sectPr\|header1.xml\|styles.xml" -- src/lib/docx-template.ts   # only READ context, never zip.file(... , ...) writes to those parts
```

- [ ] **Step 4: Manual acceptance (user — cannot be done from here)**

The user must: apply migration 009 in the Supabase SQL editor; upload a `.docx` template in Settings; open an application, Generate, chat an edit, Download, and confirm in Word that margins/header/letterhead/signature are identical to the template and only date/recipient/salutation/body changed; Save and confirm the chip re-downloads. (Spec §Success criteria 1–6.)

- [ ] **Step 5: Push**

```bash
cd "D:/Claude Code/networking-app"
git push origin main
```

---

## Self-Review

**Spec coverage:** template upload (Task 6) ✓; entry from application row (Task 7) ✓; JD re-fetch + paste fallback (Task 5) ✓; formatting-preservation mechanism (Task 2) ✓; classify/generate/refine (Task 3) ✓; chat + text preview (Task 7) ✓; download (Task 7) + save + chip (Tasks 5,8) ✓; migration 009 (Task 4) ✓; error handling — no_template/needs_paste/unreadable_template/not_set_up (Tasks 5,7) ✓; tests + fixture (Tasks 1,2) ✓; deps pizzip/@xmldom/xmldom (Task 2) ✓; one template per user / no PDF (Global Constraints) ✓.

**Type consistency:** `CoverLetterContent`, `LetterClassification`, `CoverLetterContext` defined in Task 1 and consumed unchanged in Tasks 2/3/5/7; `CoverLetterResult` produced in Task 5 and consumed in Task 7; action names match across Tasks 5/7/8.

**Placeholder scan:** pure-logic tasks (1–3) carry complete code; the migration (4) is complete SQL; actions/UI (5–8) specify exact signatures, file paths, and the non-obvious code (JD resolution, base64 download, storage paths) with concrete per-branch behavior rather than "handle errors."
