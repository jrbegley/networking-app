import type {
  TavilyNamedSearch,
  TavilyResearchPayload,
  TavilySearchResponse,
  TavilyExtractResponse,
} from "@/lib/tavily";

const EXTRACT_CHAR_LIMIT = 4000; // per-URL — keeps prompt budget sane
const RESULT_SNIPPET_CHARS = 320;

const SECTION_HEADINGS: Record<TavilyNamedSearch["label"], string> = {
  person: "What the person has put out",
  firm: "Recent firm activity",
  general: "Web research",
};

/**
 * Format a stored Tavily payload for both the contact detail UI and the
 * Claude drafting prompt. Handles three shapes:
 *   1. v2 combined payload { query, searches[], extract }
 *   2. v1 combined payload { query, search, extract }
 *   3. Legacy direct TavilySearchResponse (pre-extract addition)
 */
export function summarizeTavilyPayload(payload: unknown): string | null {
  const { searches, extract } = unwrap(payload);
  const lines: string[] = [];

  // Direct extract content (highest signal — actual page text)
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

  for (const s of searches) {
    if (!s.result) continue;
    const sectionLines = renderSearch(s.label, s.result);
    if (sectionLines.length > 0) {
      lines.push(...sectionLines);
      lines.push("");
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

function renderSearch(
  label: TavilyNamedSearch["label"],
  search: TavilySearchResponse,
): string[] {
  const lines: string[] = [];
  const heading = SECTION_HEADINGS[label] ?? "Web research";

  if (search.answer && search.answer.trim()) {
    lines.push(`${heading} — summary:`);
    lines.push(search.answer.trim());
    lines.push("");
  }

  if (Array.isArray(search.results) && search.results.length > 0) {
    lines.push(`${heading} — top sources:`);
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

  return lines;
}

function unwrap(payload: unknown): {
  searches: TavilyNamedSearch[];
  extract: TavilyExtractResponse | null;
} {
  if (!payload || typeof payload !== "object") {
    return { searches: [], extract: null };
  }
  const p = payload as Partial<TavilyResearchPayload> &
    Partial<TavilySearchResponse>;

  const extract = (p.extract as TavilyExtractResponse) ?? null;

  // v2 shape — labeled searches array
  if (Array.isArray(p.searches) && p.searches.length > 0) {
    return { searches: p.searches as TavilyNamedSearch[], extract };
  }
  // v1 shape — single `search` field
  if ("search" in p || "extract" in p) {
    return {
      searches: p.search
        ? [
            {
              label: "general",
              query: (p.query as string) ?? "",
              result: p.search as TavilySearchResponse,
            },
          ]
        : [],
      extract,
    };
  }
  // Legacy: payload IS the search response
  if ("answer" in p || "results" in p) {
    return {
      searches: [
        {
          label: "general",
          query: "",
          result: payload as TavilySearchResponse,
        },
      ],
      extract: null,
    };
  }
  return { searches: [], extract };
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
