# Job-posting autofill for the application tracker

**Date:** 2026-07-21
**Status:** Drafted — awaiting review

## Problem

Logging an application means retyping company, role, location, and deadline
into the Add Application dialog — the exact fields already printed on the
posting page. The typing is the friction, and friction means applications go
unlogged.

## Solution

Paste the posting URL into the dialog, click **Fetch**, and the fields fill in
for review before saving.

## Scope

**In:** filling `company_name`, `role_title`, `location`, `deadline`,
`posting_url`, and `source` on the existing add-application form, from an ATS
or company career-page URL, with a paste-the-description fallback when the page
can't be read.

**Out (decided, not deferred by oversight):**

- No schema change. The posting description is not stored; `posting_url`
  already lets you reread it.
- No LinkedIn job URLs. They are login-gated and are not where these postings
  come from.
- No bulk/multi-URL import.
- No autofill on the row-edit drawer. Create-time only.

## Target sites

Greenhouse, Lever, Ashby, Workday, and company career pages. The first three
are server-rendered and read cleanly with a plain fetch. **Workday is a
JavaScript SPA — its initial HTML is an empty shell and will not parse.** That
is the primary reason the paste fallback exists; it is expected behavior, not a
bug to fix later.

## Approach

Plain server-side `fetch`, no Tavily. Greenhouse/Lever/Ashby return real
content to a plain fetch, and this keeps the Tavily free-tier credits for the
LinkedIn resolver, which genuinely needs them.

Extraction is two-tier:

1. **JSON-LD first.** Most ATS pages embed a schema.org `JobPosting` blob with
   exact values. When present it wins — especially for `validThrough`, the
   closing date, which is the field an LLM most often misreads from prose.
2. **Claude on cleaned text** when there is no usable JSON-LD.

**Partial JSON-LD merges per-field.** JSON-LD blobs are frequently incomplete
(a `title` and `hiringOrganization` but no `jobLocation`, say). The rule:

- If JSON-LD yields **both** `company_name` and `role_title`, use it and skip
  the Claude call entirely — even when `location` or `deadline` are missing.
  Those two are the required fields; a saved application without a location is
  fine, and a wasted LLM call to maybe recover one is not worth it.
- Otherwise run Claude on the cleaned text and merge, with **any non-null
  JSON-LD field taking precedence** over Claude's value for the same field.

`source` comes from neither — it is derived from the hostname, which is
deterministic and always right.

## Components

### `src/lib/job-posting.ts` (new)

All URL→text logic. No DB, no Supabase, no LLM — so it tests without network.

| Export | Behavior |
|---|---|
| `guardUrl(raw)` | Returns a validated `URL` or a rejection reason. `http`/`https` only; rejects `localhost`, `127.*`, `10.*`, `192.168.*`, `172.16–31.*`, `169.254.*`, `::1`, and `.local`. |
| `sourceFromHost(host)` | `"Greenhouse" \| "Lever" \| "Ashby" \| "Workday" \| "Company site"` |
| `fetchPostingHtml(url)` | 10s `AbortSignal.timeout`, 2 MB read cap, browser User-Agent, `content-type` must be HTML or plain text. |
| `jobPostingFromJsonLd(html)` | Scans `<script type="application/ld+json">` blocks for `@type: "JobPosting"` (including inside `@graph` arrays); maps `title`, `hiringOrganization.name`, `jobLocation`, `validThrough`. Returns `null` when absent or malformed — never throws on bad JSON. |
| `htmlToText(html)` | Drops `<script>/<style>/<noscript>/<svg>`, turns block-closing tags into newlines, decodes entities, collapses whitespace, caps at 15,000 chars. |

**SSRF guard rationale:** the server fetches a user-supplied URL. With two
trusted users the present risk is low, but this app is explicitly headed for
multi-tenant, and the guard is ~10 lines now versus a security review later.

**Thin-content threshold:** cleaned text under 400 characters means an SPA
shell. Routes to the paste fallback.

### `parseJobPosting()` in `src/lib/claude.ts` (new function)

Follows the existing JSON-returning helpers (`pickLinkedInMatch`,
`translateSearchQuery`) and the pinned `MODEL` constant.

- **Input:** cleaned posting text, the hostname, and **today's date**. Date
  anchoring is required so relative phrasing ("applications close in two
  weeks") resolves — the same lesson the email prompt already learned.
- **Output:** `{company_name, role_title, location, deadline}`.
- **Nulls, not guesses.** A field that isn't clearly stated comes back null.
- **Validator:** malformed JSON, or a `deadline` not matching `YYYY-MM-DD`,
  yields null for that field rather than throwing.
- Does **not** produce `source`.

### `src/app/(app)/applications/actions.ts` (2 new actions)

```
readPostingFromUrl(url)
  auth → guardUrl → fetchPostingHtml → jobPostingFromJsonLd
       → (if no JSON-LD) htmlToText → parseJobPosting
  → { ok: true, fields, source } | { ok: false, reason: "needs_paste" | string }

readPostingFromText(text, url?)
  auth → parseJobPosting
  → { ok: true, fields, source } | { ok: false, reason: string }
```

`url` on `readPostingFromText` is optional and is used only to derive `source`.
The dialog passes whatever is in the URL box, which is normally the URL that
just failed to fetch. When it is absent or unparseable, `source` is `null` and
the field is left for the user.

Both require a signed-in user, matching every other action in the file.
**Neither writes to the database.** Saving remains the explicit **Add** click.

### `AddApplicationDialog.tsx` (edit)

The URL input and Fetch button sit **above** the `<form>`, not inside it, so
the URL is never submitted as a field and survives the form remount. A hidden
`posting_url` input inside the form carries the URL into `createApplication`.

States:

| State | UI |
|---|---|
| idle | URL box + Fetch |
| loading | "Reading posting…", Fetch disabled |
| filled | "✓ Filled from posting · review below" |
| failed | Box swaps for a "Paste the job description" textarea + Parse button |

**Prefill mechanism:** a `prefill` state object plus a `key` on the `<form>`;
fields read `defaultValue`. On successful fetch the key increments and the form
remounts with new defaults.

*Known tradeoff:* remounting discards anything typed before Fetch was clicked.
Accepted because pasting the URL is the first action in the intended flow.

## Error handling

| Condition | Result |
|---|---|
| Bad scheme / private host | "That doesn't look like a job posting URL." |
| Fetch blocked, 4xx/5xx, or timeout | Paste fallback |
| Non-HTML content type | Paste fallback |
| Cleaned text < 400 chars (Workday) | Paste fallback |
| Claude returns no usable fields | Fields stay blank: "Read the page but couldn't identify the role — fill in below." |
| Any unexpected throw | Caught; message shown; form stays usable |

The manual path is never blocked. Every failure degrades to typing it in,
which is exactly today's behavior.

## Testing — `test-job-posting.mts`

Matches `test-applications.mts`: `npx tsx`, no framework, no network, no DB.

- `htmlToText` — entity decoding, script/style removal, block→newline, whitespace collapse, char cap
- `guardUrl` — rejects `javascript:`, `file:`, `localhost`, `10.0.0.1`, `169.254.169.254`; accepts a normal HTTPS ATS URL
- `sourceFromHost` — each known host plus the unknown-host default
- `jobPostingFromJsonLd` — a Greenhouse-shaped fixture, an `@graph`-wrapped fixture, malformed JSON, and no-JSON-LD
- parse-response validator — bad JSON, bad date format, missing fields

Claude and `fetch` are not unit-tested; their *response handling* is.

## Files

| File | Change |
|---|---|
| `src/lib/job-posting.ts` | new |
| `test-job-posting.mts` | new |
| `src/lib/claude.ts` | add `parseJobPosting` |
| `src/app/(app)/applications/actions.ts` | add 2 actions |
| `src/app/(app)/applications/AddApplicationDialog.tsx` | URL box, states, prefill |

## Success criteria

1. A Greenhouse, Lever, or Ashby URL fills company, role, and location
   correctly, and the deadline when the posting states one.
2. A Workday URL fails fast with the paste box offered; pasting the
   description fills the same fields.
3. No extraction result is ever saved without an explicit **Add** click.
4. Every failure path still leaves a manually fillable form.
5. `npx tsx test-job-posting.mts` passes, as does the existing
   `npx tsx test-applications.mts`.
