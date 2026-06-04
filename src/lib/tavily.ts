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
};

export async function searchTavily(
  query: string,
  opts: TavilySearchOptions = {},
): Promise<TavilySearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");

  const res = await fetch(`${TAVILY_BASE}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "advanced",
      include_answer: true,
      include_raw_content: false,
      max_results: opts.maxResults ?? 5,
      include_domains: opts.includeDomains ?? [],
      exclude_domains: opts.excludeDomains ?? [],
    }),
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

// ── Combined payload (what we persist as a research_artifact) ──────────

export type TavilyResearchPayload = {
  query: string;
  search: TavilySearchResponse | null;
  extract: TavilyExtractResponse | null;
};
