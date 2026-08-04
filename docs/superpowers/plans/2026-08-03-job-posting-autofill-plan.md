# Implementation Plan — Job-posting autofill

**Date:** 2026-08-03
**Source spec:** `docs/superpowers/specs/2026-07-21-job-posting-autofill-design.md` (read it before Phase 1)
**Goal:** Paste an ATS / career-page URL into the Add Application dialog, click **Fetch**, and have company / role / location / deadline / source fill in for review before saving. Manual typing and a paste-the-description fallback always remain.

The three review points the spec left open are **settled** as follows (matches the spec's own leanings):
1. When JSON-LD yields both `company_name` and `role_title`, **skip the Claude call** even if location/deadline are missing.
2. **Keep** the 15,000-char cap on text sent to Claude (via `htmlToText`).
3. **No** Workday-specific JSON-endpoint seam — the paste fallback is the answer.

No database migration. No new dependencies. No stored posting text.

---

## Phase 0 — Documentation Discovery (DONE — consolidated below)

### Allowed APIs (verified against the actual codebase, do not deviate)

**Anthropic SDK — copy the exact idiom from `src/lib/claude.ts`:**
- Client: the module-level `client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` already exists — reuse it, do not construct a new one.
- Model: the pinned `const MODEL = "claude-sonnet-4-5-20250929"` already exists — reuse it, do not hardcode another model string.
- Call shape: `await client.messages.create({ model: MODEL, max_tokens, system: <string>, messages: [{ role: "user", content: <string> }] })`.
- Response → text: `response.content.filter((c): c is Anthropic.TextBlock => c.type === "text").map(c => c.text).join("").trim()`.
- JSON parse: strip fences with `.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim()`, then `JSON.parse` inside `try/catch`, returning a safe fallback in `catch`.
- Reference implementations to copy from, line-for-line: `translateSearchQuery` (claude.ts:523) and `inferLastNamesFromObfuscated` (claude.ts:599). Both return structured JSON and both anchor / validate before trusting the model.

**Server actions — copy the idiom from `src/app/(app)/applications/actions.ts`:**
- `"use server"` at top; `const supabase = await createClient()` from `@/lib/supabase/server` (it is async — must be awaited).
- Auth gate every action: `const { data: { user } } = await supabase.auth.getUser(); if (!user) return <failure>`.
- Existing helpers `parseText` / `parseDate` live in this file already; reuse rather than redefine.
- `revalidatePath` is called **only by actions that write**. The two new read actions write nothing → **do not** call `revalidatePath`.

**fetch:** global `fetch` (undici) is available server-side. Use `AbortSignal.timeout(10_000)`. There is no size option on `fetch`; enforce the 2 MB cap by reading the body and slicing / checking length.

**Dialog:** `AddApplicationDialog.tsx` is a client component already using `useActionState(createApplication, initialState)`. The `posting_url` field is currently a plain `<Field>` inside the `<form>` (lines 172–177) — this moves out.

### Anti-patterns to guard against (grep for these before claiming done)
- ❌ Any `new Anthropic(` in `job-posting.ts` or a second one in `claude.ts` — reuse the existing client.
- ❌ Any model string other than the `MODEL` constant.
- ❌ `client.completions` / `client.complete` / `.beta.messages` — the codebase uses `client.messages.create` only.
- ❌ A `supabase/migrations/00*.sql` change — spec forbids schema changes.
- ❌ Importing Tavily / Apify into the fetch path — plain `fetch` only.
- ❌ `revalidatePath` inside `readPostingFromUrl` / `readPostingFromText`.
- ❌ The URL box or Fetch button rendered **inside** the `<form>` — it must sit above it.
- ❌ Storing the posting description anywhere (no column, no state that gets saved).

---

## Phase 1 — Pure extraction library + tests (no network, no LLM, no DB)

**Build first, test-driven.** Everything here is deterministic, so write `test-job-posting.mts` alongside and make it pass.

### Implement `src/lib/job-posting.ts` (new)
Exports, per spec §Components:

| Export | Behavior |
|---|---|
| `guardUrl(raw: string)` | Returns `{ ok: true; url: URL }` or `{ ok: false; reason: string }`. `http`/`https` only. Reject `localhost`, `127.*`, `10.*`, `192.168.*`, `172.16–31.*`, `169.254.*`, `::1`, hosts ending `.local`. |
| `sourceFromHost(host: string)` | `"Greenhouse" \| "Lever" \| "Ashby" \| "Workday" \| "Company site"` by hostname match (greenhouse.io, lever.co, ashbyhq.com, myworkdayjobs.com/workday). |
| `fetchPostingHtml(url: URL)` | `AbortSignal.timeout(10_000)`, browser `User-Agent`, require `content-type` HTML or plain text, 2 MB read cap. Returns html string or throws a tagged error the action maps to the paste fallback. |
| `jobPostingFromJsonLd(html: string)` | Scan `<script type="application/ld+json">` blocks for `@type: "JobPosting"` (including inside `@graph` arrays). Map `title`→role_title, `hiringOrganization.name`→company_name, `jobLocation`(→address.addressLocality/region)→location, `validThrough`→deadline. Return `null` when absent/malformed. **Never throw on bad JSON** (wrap each block's `JSON.parse` in try/catch). |
| `htmlToText(html: string)` | Strip `<script>/<style>/<noscript>/<svg>`, block-closing tags → newline, decode common entities, collapse whitespace, **cap at 15,000 chars**. |

Also export a small `THIN_CONTENT_CHARS = 400` (spec's SPA-shell threshold) so the action can decide "needs_paste."

`fetchPostingHtml` is the only network export; keep it separate so the other four test without network.

### Write `test-job-posting.mts` (new)
Mirror `test-applications.mts` exactly: `npx tsx`, no framework, `check(label, got, want)` helper, `process.exit(fails ? 1 : 0)`. Cover, per spec §Testing:
- `htmlToText`: entity decode, script/style removal, block→newline, whitespace collapse, char cap.
- `guardUrl`: reject `javascript:`, `file:`, `localhost`, `10.0.0.1`, `169.254.169.254`; accept a normal HTTPS ATS URL.
- `sourceFromHost`: each known host + unknown-host default.
- `jobPostingFromJsonLd`: a Greenhouse-shaped fixture, an `@graph`-wrapped fixture, malformed JSON (→ null, no throw), and no-JSON-LD (→ null).

### Verification
- `npx tsx test-job-posting.mts` → all PASS, exit 0.
- `npx tsc --noEmit` clean.
- Grep guard: `git grep -n "new Anthropic\|Tavily\|apify" src/lib/job-posting.ts` → no matches.

---

## Phase 2 — `parseJobPosting()` in `src/lib/claude.ts`

Add one exported function next to the other JSON-returning helpers. **Copy the structure of `translateSearchQuery`.**

- **Signature:** `parseJobPosting(text: string, host: string, today: string): Promise<{ company_name: string | null; role_title: string | null; location: string | null; deadline: string | null }>`.
- System prompt: extract the four fields from posting text; output **ONLY JSON**; a field not clearly stated is `null` (never guessed); `deadline` must be `YYYY-MM-DD`. Pass `today` so relative phrasing ("closes in two weeks") resolves — same date-anchoring the email prompt uses (claude.ts:296–301 shows the date-formatting idiom).
- `max_tokens`: small (≈300), structured output only.
- **Validator after parse:** wrap `JSON.parse` in try/catch; coerce a `deadline` that fails `/^\d{4}-\d{2}-\d{2}$/` to `null`; missing keys → `null`. On any failure return all-null object, never throw.
- Does **not** compute `source` (that's `sourceFromHost`).

### Verification
- `npx tsc --noEmit` clean.
- Add response-validator cases to `test-job-posting.mts` if the validator is factored out as a pure helper; otherwise assert the null-coercion logic directly. (Live Claude/fetch stay un-unit-tested per spec — only their *response handling* is.)

---

## Phase 3 — Two read-only server actions in `applications/actions.ts`

Add to the existing file. Define a shared return type, e.g.
`type ReadPostingResult = { ok: true; fields: {company_name,role_title,location,deadline}; source: string | null } | { ok: false; reason: "needs_paste" | string }`.

```
readPostingFromUrl(url: string): Promise<ReadPostingResult>
  auth gate
  → guardUrl(url)                    // bad → { ok:false, reason:"That doesn't look like a job posting URL." }
  → fetchPostingHtml                 // throw/4xx/5xx/timeout/non-HTML → { ok:false, reason:"needs_paste" }
  → jobPostingFromJsonLd(html)
        if it yields company_name AND role_title → use it, SKIP Claude
        else htmlToText; if length < THIN_CONTENT_CHARS → { ok:false, reason:"needs_paste" }
             else parseJobPosting(text, host, today), then merge with any
             non-null JSON-LD field winning
  → source = sourceFromHost(host)
  → { ok:true, fields, source }

readPostingFromText(text: string, url?: string): Promise<ReadPostingResult>
  auth gate
  → parseJobPosting(text, hostFrom(url) ?? "", today)
  → source = url ? sourceFromHost(host) : null
  → { ok:true, fields, source }
```

- Both auth-gate like every other action in the file.
- **Neither writes to the DB. Neither calls `revalidatePath`.**
- `today` = `new Date().toISOString().slice(0,10)`.

### Verification
- `npx tsc --noEmit` clean.
- `git grep -n "revalidatePath" src/app/(app)/applications/actions.ts` shows it only in the pre-existing write actions, not the two new ones.

---

## Phase 4 — Wire the dialog (`AddApplicationDialog.tsx`)

Per spec §AddApplicationDialog:
- Move the URL input + a **Fetch** button **above** the `<form>` (not inside it), so the URL is never submitted and survives the form remount.
- Add a **hidden** `posting_url` input **inside** the form carrying the current URL into `createApplication`. Remove the old visible `posting_url` `<Field>` (lines 172–177).
- Prefill: a `prefill` state object + a `key` on the `<form>`; company/role/location/deadline/source fields read `defaultValue={prefill.x}`. On a successful fetch, set prefill and increment the key so the form remounts with new defaults.
- Call the server actions with `useTransition` (or a local `pending` flag); they're plain async functions, not `useActionState` form actions.
- States: **idle** (URL box + Fetch) → **loading** ("Reading posting…", Fetch disabled) → **filled** ("✓ Filled from posting · review below") → **failed** (URL box swaps for a "Paste the job description" textarea + **Parse** button calling `readPostingFromText`).
- Error copy from spec §Error handling. The manual form is never blocked.

### Verification
- `npx tsc --noEmit` clean.
- `next build` (or dev compile) shows `/applications` compiling with no errors.
- Manual (user, authed browser): a Greenhouse/Lever/Ashby URL fills company+role+location (+deadline when stated); a Workday URL fails fast and offers the paste box; nothing saves without the explicit **Add** click.

---

## Phase 5 — Final verification (spec §Success criteria)

1. `npx tsx test-job-posting.mts` passes **and** `npx tsx test-applications.mts` still passes.
2. `npx tsc --noEmit` clean.
3. Anti-pattern grep sweep (all empty):
   - `git grep -n "new Anthropic" src/lib/job-posting.ts`
   - `git grep -rn "claude-sonnet\|claude-opus\|claude-3" src/lib/job-posting.ts src/app/(app)/applications` (model strings belong only to the `MODEL` const in claude.ts)
   - `git grep -n "revalidatePath" src/app/(app)/applications/actions.ts` → only pre-existing write actions
   - `git diff --name-only` shows **no** file under `supabase/migrations/`
4. Manual acceptance in the authed browser (user runs; can't be done from here): the four success-criteria flows in the spec §Success criteria.
5. Commit. Suggested subject: `Implement job-posting autofill (impl of adacd83 spec)`.

---

## Execution notes
- Phases 1→4 are sequential (each builds on the previous). Phase 1 is the only one with meaningful pure-unit coverage; lean on it.
- No migration to apply, so nothing is blocked on the user pasting SQL this time.
- The one thing that can't be verified from this environment is the authed-browser acceptance (can't log in as the user) — flag it for the user at the end, don't claim it passed.
