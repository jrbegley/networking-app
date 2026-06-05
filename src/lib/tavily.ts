/**
 * Tavily client. Two endpoints we use:
 *   - /search: web search with an LLM-generated answer
 *   - /extract: direct content extraction from URLs (works on some public
 *     profile pages, often blocked by LinkedIn's anti-bot — try anyway,
 *     handle empty gracefully)
 *
 * Free tier: 1000 calls/month combined.
 */

const TAVILY_BASE = "https://api.tavily.com";

/**
 * Sidelined 2026-06-04 — coffee-chat material wasn't landing.
 * The `researchWithTavily` action still works if called directly, so we
 * can keep iterating on the query. Flip this flag to surface Tavily in
 * the contact UI and feed it back into the drafting prompt.
 */
export const TAVILY_ENABLED = true;

// ── Search ─────────────────────────────────────────────────────────────

export type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score: number;
};

export type TavilySearchResponse = {
  answer: string | null;
  query: string;
  results: TavilyResult[];
  response_time?: number;
};

export type TavilySearchOptions = {
  includeDomains?: string[];
  excludeDomains?: string[];
  maxResults?: number;
  // "general" (default) returns broad results; "news" restricts to news outlets
  // and unlocks the `days` recency filter.
  topic?: "general" | "news";
  // Only honored when topic === "news".
  days?: number;
  // Coarser recency hint that works on general topic too.
  timeRange?: "day" | "week" | "month" | "year";
};

export async function searchTavily(
  query: string,
  opts: TavilySearchOptions = {},
): Promise<TavilySearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");

  const body: Record<string, unknown> = {
    api_key: apiKey,
    query,
    search_depth: "advanced",
    include_answer: true,
    include_raw_content: false,
    max_results: opts.maxResults ?? 5,
    include_domains: opts.includeDomains ?? [],
    exclude_domains: opts.excludeDomains ?? [],
  };
  if (opts.topic) body.topic = opts.topic;
  if (opts.topic === "news" && opts.days) body.days = opts.days;
  if (opts.timeRange) body.time_range = opts.timeRange;

  const res = await fetch(`${TAVILY_BASE}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Tavily search ${res.status}: ${text.slice(0, 200) || res.statusText}`,
    );
  }

  return (await res.json()) as TavilySearchResponse;
}

// ── Extract ────────────────────────────────────────────────────────────

export type TavilyExtractResult = {
  url: string;
  raw_content: string;
};

export type TavilyExtractFailure = {
  url: string;
  error: string;
};

export type TavilyExtractResponse = {
  results: TavilyExtractResult[];
  failed_results: TavilyExtractFailure[];
};

export async function extractTavily(
  urls: string[],
): Promise<TavilyExtractResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");

  const res = await fetch(`${TAVILY_BASE}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      urls,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Tavily extract ${res.status}: ${text.slice(0, 200) || res.statusText}`,
    );
  }

  return (await res.json()) as TavilyExtractResponse;
}

// ── LinkedIn URL finder ────────────────────────────────────────────────

/**
 * Try to find a LinkedIn profile URL for someone given their name,
 * company, and title. Uses a site-restricted Tavily search and extracts
 * the first linkedin.com/in/ URL from results.
 *
 * Returns null if nothing confident is found — callers should save the
 * contact without a LinkedIn URL rather than storing a wrong one.
 */
export async function findLinkedInUrl(opts: {
  firstName: string;
  lastName: string;
  company: string;
  title?: string | null;
  email?: string | null; // preferred signal when available
}): Promise<string | null> {
  const { firstName, lastName, company, title, email } = opts;

  let query: string;

  if (email) {
    // Email is the most precise signal — domain ties directly to the person.
    // Search for their name + email domain on LinkedIn.
    const domain = email.split("@")[1] ?? "";
    const isInitialOnly = lastName.replace(".", "").trim().length <= 1;
    const namePart = isInitialOnly ? `"${firstName}"` : `"${firstName} ${lastName}"`;
    query = domain
      ? `site:linkedin.com/in ${namePart} "${domain}"`
      : `site:linkedin.com/in ${namePart} "${company}"`;
  } else {
    const isInitialOnly = lastName.replace(".", "").trim().length <= 1;
    const namePart = isInitialOnly ? `"${firstName}"` : `"${firstName} ${lastName}"`;
    const titlePart = title ? ` "${title}"` : "";
    query = `site:linkedin.com/in ${namePart} "${company}"${titlePart}`;
  }

  let response: TavilySearchResponse;
  try {
    response = await searchTavily(query, {
      includeDomains: ["linkedin.com"],
      maxResults: 3,
      topic: "general",
    });
  } catch {
    return null;
  }

  // Pull the first linkedin.com/in/ URL from results
  for (const result of response.results) {
    const match = result.url.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[^/?#\s]+/i);
    if (match) return match[0];
  }

  // Also check the answer text in case Tavily surfaced it there
  if (response.answer) {
    const match = response.answer.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[^/?#\s]+/i);
    if (match) return match[0];
  }

  return null;
}

// ── Combined payload (what we persist as a research_artifact) ──────────

export type TavilyNamedSearch = {
  label: "person" | "firm" | "general";
  query: string;
  result: TavilySearchResponse | null;
};

export type TavilyResearchPayload = {
  // Human-readable combined query string, shown in the UI.
  query: string;
  // v2 shape: one or more labeled searches. Older artifacts may still have
  // the v1 `search` field instead — the summarizer handles both.
  searches?: TavilyNamedSearch[];
  // v1 legacy field, retained so old rows render correctly.
  search?: TavilySearchResponse | null;
  extract: TavilyExtractResponse | null;
};
