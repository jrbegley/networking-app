import type { TavilySearchResponse } from "@/lib/tavily";

/**
 * Format a Tavily payload into a human-readable summary used by both the
 * detail page UI and the Claude drafting prompt.
 */
export function summarizeTavilyPayload(payload: unknown): string | null {
  const data = payload as TavilySearchResponse | null;
  if (!data) return null;

  const lines: string[] = [];

  if (data.answer && data.answer.trim()) {
    lines.push(`Summary: ${data.answer.trim()}`);
  }

  if (Array.isArray(data.results) && data.results.length > 0) {
    lines.push("");
    lines.push("Top sources:");
    for (const r of data.results.slice(0, 5)) {
      if (!r.title || !r.url) continue;
      lines.push(`- ${r.title}`);
      lines.push(`  ${r.url}`);
      if (r.content) {
        const snippet = r.content.replace(/\s+/g, " ").trim().slice(0, 280);
        lines.push(
          `  ${snippet}${r.content.length > 280 ? "…" : ""}`,
        );
      }
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}
