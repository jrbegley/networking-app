import type {
  TavilyResearchPayload,
  TavilySearchResponse,
  TavilyExtractResponse,
} from "@/lib/tavily";

const EXTRACT_CHAR_LIMIT = 4000; // per-URL — keeps prompt budget sane
const RESULT_SNIPPET_CHARS = 320;

/**
 * Format a stored Tavily payload for both the contact detail UI and the
 * Claude drafting prompt. Handles two shapes:
 *   1. New combined payload { query, search, extract }
 *   2. Legacy direct TavilySearchResponse (pre-extract addition)
 */
export function summarizeTavilyPayload(payload: unknown): string | null {
  const { search, extract } = unwrap(payload);
  const lines: string[] = [];

  // Direct extract content (highest signal — actual LinkedIn / page text)
  if (extract?.results && extract.results.length > 0) {
    for (const r of extract.results) {
      if (!r.raw_content || r.raw_content.trim().length < 60) continue;
      lines.push(`Extracted from ${r.url}:`);
      const cleaned = collapseWhitespace(r.raw_content);
      lines.push(
        cleaned.length > EXTRACT_CHAR_LIMIT
          ? `${cleaned.slice(0, EXTRACT_CHAR_LIMIT)}…`
          : cleaned,
      );
      lines.push("");
    }
  }

  // Tavily's LLM-generated answer from search
  if (search?.answer && search.answer.trim()) {
    lines.push(`Web search summary: ${search.answer.trim()}`);
    lines.push("");
  }

  // Top web sources from search
  if (Array.isArray(search?.results) && search.results.length > 0) {
    lines.push("Top web sources:");
    for (const r of search.results.slice(0, 5)) {
      if (!r.title || !r.url) continue;
      lines.push(`- ${r.title}`);
      lines.push(`  ${r.url}`);
      if (r.content) {
        const snippet = collapseWhitespace(r.content).slice(
          0,
          RESULT_SNIPPET_CHARS,
        );
        lines.push(
          `  ${snippet}${r.content.length > RESULT_SNIPPET_CHARS ? "…" : ""}`,
        );
      }
    }
  }

  // Note extraction failures so the user knows we tried
  if (
    extract?.failed_results &&
    extract.failed_results.length > 0 &&
    (!extract.results || extract.results.length === 0)
  ) {
    lines.push("");
    lines.push(
      `Note: direct extract attempted but blocked or returned no content (${extract.failed_results.length} URL${extract.failed_results.length === 1 ? "" : "s"}).`,
    );
  }

  return lines.length > 0 ? lines.join("\n").trim() : null;
}

function unwrap(payload: unknown): {
  search: TavilySearchResponse | null;
  extract: TavilyExtractResponse | null;
} {
  if (!payload || typeof payload !== "object") {
    return { search: null, extract: null };
  }
  const p = payload as Partial<TavilyResearchPayload> &
    Partial<TavilySearchResponse>;
  // New combined shape
  if ("search" in p || "extract" in p) {
    return {
      search: (p.search as TavilySearchResponse) ?? null,
      extract: (p.extract as TavilyExtractResponse) ?? null,
    };
  }
  // Legacy: payload IS the search response
  if ("answer" in p || "results" in p) {
    return {
      search: payload as TavilySearchResponse,
      extract: null,
    };
  }
  return { search: null, extract: null };
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
