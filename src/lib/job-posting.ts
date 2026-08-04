/**
 * URL → posting-text extraction for the Add Application autofill flow.
 *
 * Pure, network-light logic: only `fetchPostingHtml` touches the network, and
 * it is kept separate so the other exports unit-test offline. No DB, no
 * Supabase, no LLM lives here — Claude parsing is in claude.ts and the actions
 * orchestrate the two.
 *
 * Extraction is two-tier (see the design spec): JSON-LD first when a
 * schema.org JobPosting blob is embedded, otherwise cleaned text for Claude.
 */

/** The four fields we try to pull off a posting page. Null = not stated. */
export type JobPostingFields = {
  company_name: string | null;
  role_title: string | null;
  location: string | null;
  deadline: string | null;
};

/** Where a posting came from, derived deterministically from its hostname. */
export type PostingSource =
  | "Greenhouse"
  | "Lever"
  | "Ashby"
  | "Workday"
  | "Company site";

/** Result of validating a user-supplied URL before we fetch it. */
export type GuardResult = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * Cleaned text under this many characters means we fetched an SPA shell (the
 * classic Workday case) rather than real content — route to the paste
 * fallback instead of wasting a Claude call on an empty page.
 */
export const THIN_CONTENT_CHARS = 400;

const REJECT_REASON = "That doesn't look like a job posting URL.";

/**
 * Validate a user-supplied URL before the server fetches it (SSRF guard).
 * Accepts only http/https and rejects loopback, link-local, and RFC-1918
 * private hosts plus `.local` mDNS names.
 */
export function guardUrl(raw: string): GuardResult {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: REJECT_REASON };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: REJECT_REASON };
  }
  if (isPrivateHost(url.hostname)) {
    return { ok: false, reason: REJECT_REASON };
  }
  return { ok: true, url };
}

/** True for loopback / link-local / private / mDNS hosts we refuse to fetch. */
function isPrivateHost(hostname: string): boolean {
  // Strip IPv6 brackets that URL.hostname keeps (e.g. "[::1]").
  const host = hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();

  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  if (host.endsWith(".local")) return true;

  if (/^127\./.test(host)) return true; // loopback
  if (/^10\./.test(host)) return true; // private
  if (/^192\.168\./.test(host)) return true; // private
  if (/^169\.254\./.test(host)) return true; // link-local

  // 172.16.0.0 – 172.31.255.255 (private)
  const m = host.match(/^172\.(\d{1,3})\./);
  if (m) {
    const octet = Number(m[1]);
    if (octet >= 16 && octet <= 31) return true;
  }

  return false;
}

/** Map a hostname to its ATS/source label. Deterministic and always right. */
export function sourceFromHost(host: string): PostingSource {
  const h = host.toLowerCase();
  if (h.includes("greenhouse.io")) return "Greenhouse";
  if (h.includes("lever.co")) return "Lever";
  if (h.includes("ashbyhq.com")) return "Ashby";
  if (h.includes("myworkdayjobs.com") || h.includes("workday")) return "Workday";
  return "Company site";
}

// A recent desktop-Chrome UA. Some career pages 403 an obvious bot agent.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2 MB read cap

/**
 * Fetch a posting page as HTML text. The ONLY network export in this module.
 * 10s timeout, browser User-Agent, requires an HTML/plain-text content-type,
 * and caps the read at 2 MB. Throws on any of those — the caller maps the
 * throw to the paste fallback.
 */
export async function fetchPostingHtml(url: URL): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    redirect: "follow",
    headers: {
      "User-Agent": BROWSER_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    throw new Error(`fetchPostingHtml: HTTP ${res.status}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!/text\/html|text\/plain/i.test(contentType)) {
    throw new Error(`fetchPostingHtml: non-HTML content-type "${contentType}"`);
  }

  // undici has no size option; read the body and cap it ourselves.
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf).subarray(0, MAX_HTML_BYTES);
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Scan `<script type="application/ld+json">` blocks for a schema.org
 * JobPosting object (including inside `@graph` arrays) and map its fields.
 * Returns null when none is found. Never throws on malformed JSON — each
 * block's parse is guarded so one bad blob can't sink the page.
 */
export function jobPostingFromJsonLd(html: string): JobPostingFields | null {
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const match of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue; // malformed block — skip, do not throw
    }
    const posting = findJobPosting(parsed);
    if (posting) return mapPosting(posting);
  }

  return null;
}

/** Walk a parsed JSON-LD value for the first `@type: "JobPosting"` object. */
function findJobPosting(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (isJobPostingType(obj["@type"])) return obj;
    if (Array.isArray(obj["@graph"])) return findJobPosting(obj["@graph"]);
  }
  return null;
}

/** `@type` can be a string or an array of strings. */
function isJobPostingType(type: unknown): boolean {
  if (typeof type === "string") return type === "JobPosting";
  if (Array.isArray(type)) return type.some((t) => t === "JobPosting");
  return false;
}

function mapPosting(p: Record<string, unknown>): JobPostingFields {
  return {
    company_name: hiringOrgName(p["hiringOrganization"]),
    role_title: asString(p["title"]),
    location: jobLocationText(p["jobLocation"]),
    deadline: toDate(p["validThrough"]),
  };
}

/** `hiringOrganization` may be an Organization object, a string, or array. */
function hiringOrgName(v: unknown): string | null {
  if (typeof v === "string") return asString(v);
  if (Array.isArray(v)) {
    for (const item of v) {
      const name = hiringOrgName(item);
      if (name) return name;
    }
    return null;
  }
  if (v && typeof v === "object") {
    return asString((v as Record<string, unknown>)["name"]);
  }
  return null;
}

/** Dig `jobLocation` → address.addressLocality / addressRegion into a label. */
function jobLocationText(v: unknown): string | null {
  if (Array.isArray(v)) {
    for (const item of v) {
      const text = jobLocationText(item);
      if (text) return text;
    }
    return null;
  }
  if (typeof v === "string") return asString(v);
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const address = obj["address"];
    if (address && typeof address === "object") {
      const a = address as Record<string, unknown>;
      const parts = [asString(a["addressLocality"]), asString(a["addressRegion"])].filter(
        (part): part is string => Boolean(part),
      );
      if (parts.length) return parts.join(", ");
      const country = asString(a["addressCountry"]);
      if (country) return country;
    }
    const name = asString(obj["name"]);
    if (name) return name;
  }
  return null;
}

/** Take the YYYY-MM-DD date part of an ISO-ish string; else return it as-is. */
function toDate(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s;
}

/** Trimmed non-empty string, or null. */
function asString(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t || null;
  }
  return null;
}

// Tags whose close should become a line break so text doesn't run together.
const BLOCK_CLOSE_TAGS =
  /<\/(p|div|section|article|header|footer|li|ul|ol|h[1-6]|tr|table|blockquote|pre|dl|dd|dt)\s*>/gi;

/** Cap on cleaned text handed to Claude (design-spec decision, kept). */
const MAX_TEXT_CHARS = 15_000;

/**
 * Reduce posting HTML to readable plain text: drop non-content elements, turn
 * block boundaries into newlines, decode common entities, collapse
 * whitespace, and cap at 15,000 characters.
 */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");

  text = text.replace(/<br\s*\/?>/gi, "\n").replace(BLOCK_CLOSE_TAGS, "\n");

  // Strip every remaining tag, then decode entities and normalize whitespace.
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  text = text
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.slice(0, MAX_TEXT_CHARS);
}

/** Decode the handful of entities that actually show up in posting markup. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => safeCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => safeCodePoint(parseInt(code, 16)))
    // &amp; last so "&amp;lt;" doesn't get double-decoded into "<".
    .replace(/&amp;/g, "&");
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}
