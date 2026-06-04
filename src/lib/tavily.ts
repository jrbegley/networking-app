/**
 * Tavily web search client. Free tier ships 1000 searches/month — much
 * more headroom than Apollo's free tier, and Tavily's "advanced" search
 * comes back with an LLM-generated answer plus the top web pages.
 *
 * We pair the answer (high-signal summary) with each result's snippet so
 * Claude has both a TL;DR and source-grounded facts.
 */

const TAVILY_BASE = "https://api.tavily.com";

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

export async function searchTavily(
  query: string,
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
      max_results: 5,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Tavily API ${res.status}: ${text.slice(0, 200) || res.statusText}`,
    );
  }

  return (await res.json()) as TavilySearchResponse;
}
