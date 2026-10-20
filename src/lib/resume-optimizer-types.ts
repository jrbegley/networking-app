// Types + never-throw validators for the resume optimizer. Pure: no Next,
// Supabase, or Anthropic imports, so it unit-tests with `npx tsx` and is safe
// to import from client components.

export type Compiler = "pdflatex" | "xelatex" | "lualatex";
export const COMPILERS: readonly Compiler[] = ["pdflatex", "xelatex", "lualatex"];
export function isCompiler(v: unknown): v is Compiler {
  return typeof v === "string" && (COMPILERS as readonly string[]).includes(v);
}

/** "list" = a skills/coursework/certifications-style line: only chat edits it, and it may grow. */
export type SegmentKind = "bullet" | "list";
/** What Claude proposes: an exact substring of the .tex plus where it sits. */
export type SegmentCandidate = { id: string; section: string; entry: string; text: string; kind?: SegmentKind };
/** A candidate that code verified occurs exactly once; offsets into the source. */
export type Segment = SegmentCandidate & { start: number; end: number };

export type KeywordCategory = "skill" | "tool" | "domain" | "soft";
const CATEGORIES: readonly KeywordCategory[] = ["skill", "tool", "domain", "soft"];
export type Keyword = { term: string; category: KeywordCategory; weight: 1 | 2 | 3; present: boolean };

/** One rewritten segment; `keywords` are the terms Claude says it worked in. */
export type Rewrite = { id: string; text: string; keywords: string[] };

export type Change = {
  segment: Segment;
  rewrite: Rewrite | null;       // null = Claude left it alone
  accepted: boolean;             // user can revert/restore in the panel
  droppedReason: string | null;  // set when a rewrite failed validation (original kept)
};

export type OptimizerResult = {
  originalTex: string;
  tex: string;
  compiler: Compiler;
  keywords: Keyword[];
  changes: Change[];
  pageWarning: boolean;
};

export const MAX_KEYWORDS = 25;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Never throws. Ids coerced to strings and de-duplicated; empty text dropped. */
export function validateSegmentCandidates(raw: unknown): SegmentCandidate[] {
  try {
    const list = (raw as { segments?: unknown })?.segments;
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const out: SegmentCandidate[] = [];
    for (const item of list as Record<string, unknown>[]) {
      if (!item || typeof item !== "object") continue;
      const id = typeof item.id === "number" ? String(item.id) : str(item.id);
      const text = str(item.text);
      if (!id || !text.trim() || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, section: str(item.section), entry: str(item.entry), text, ...(item.kind === "list" ? { kind: "list" as const } : {}) });
    }
    return out;
  } catch {
    return [];
  }
}

/** Never throws. ≤ MAX_KEYWORDS, weight clamped 1–3, unknown category → "skill", terms unique (case-insensitive). */
export function validateKeywords(raw: unknown): Omit<Keyword, "present">[] {
  try {
    const list = (raw as { keywords?: unknown })?.keywords;
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const out: Omit<Keyword, "present">[] = [];
    for (const item of list as Record<string, unknown>[]) {
      if (!item || typeof item !== "object") continue;
      const term = str(item.term).trim();
      if (!term || seen.has(term.toLowerCase())) continue;
      seen.add(term.toLowerCase());
      const w = typeof item.weight === "number" && Number.isFinite(item.weight) ? Math.trunc(item.weight) : 2;
      const weight = (Math.min(3, Math.max(1, w)) as 1 | 2 | 3);
      const category = CATEGORIES.includes(item.category as KeywordCategory) ? (item.category as KeywordCategory) : "skill";
      out.push({ term, category, weight });
      if (out.length >= MAX_KEYWORDS) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Never throws. Keeps only rewrites whose id is a known segment and whose text is a string. */
export function validateRewrites(raw: unknown, segmentIds: readonly string[]): Rewrite[] {
  try {
    const list = (raw as { rewrites?: unknown })?.rewrites;
    if (!Array.isArray(list)) return [];
    const known = new Set(segmentIds);
    const seen = new Set<string>();
    const out: Rewrite[] = [];
    for (const item of list as Record<string, unknown>[]) {
      if (!item || typeof item !== "object") continue;
      const id = typeof item.id === "number" ? String(item.id) : str(item.id);
      if (!known.has(id) || seen.has(id) || typeof item.text !== "string") continue;
      seen.add(id);
      const keywords = Array.isArray(item.keywords)
        ? (item.keywords as unknown[]).filter((k): k is string => typeof k === "string")
        : [];
      out.push({ id, text: item.text, keywords });
    }
    return out;
  } catch {
    return [];
  }
}
