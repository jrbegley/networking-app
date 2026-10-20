// Pure LaTeX-resume helpers for the optimizer: no network, DB, or LLM.
// The LLM proposes; everything here verifies and applies mechanically.
import type { Change, Keyword, Segment, SegmentCandidate } from "./resume-optimizer-types";

/**
 * Keep only candidates whose text occurs exactly once, verbatim, in the
 * source; assign offsets; drop any that overlap an earlier-accepted one.
 * Returned sorted by start.
 */
export function locateSegments(source: string, candidates: SegmentCandidate[]): Segment[] {
  const accepted: Segment[] = [];
  for (const c of candidates) {
    const start = source.indexOf(c.text);
    if (start < 0) continue;                                  // not verbatim
    if (source.indexOf(c.text, start + 1) >= 0) continue;     // not unique
    const end = start + c.text.length;
    const overlaps = accepted.some((s) => start < s.end && end > s.start);
    if (overlaps) continue;
    accepted.push({ ...c, start, end });
  }
  return accepted.sort((a, b) => a.start - b.start);
}

export const LENGTH_TOLERANCE = 0.15;

const COMMAND_RE = /\\[a-zA-Z@]+/g;
const NUMBER_RE = /\$?\d+(?:,\d{3})*(?:\.\d+)?%?/g;
// Structural tokens a rephrase must never introduce.
const STRUCTURE_RES: RegExp[] = [/\\item\b/g, /\\begin\b/g, /\\end\b/g, /\\section\b/g, /\\subsection\b/g, /\\\\/g];

function count(re: RegExp, s: string): number {
  return (s.match(re) ?? []).length;
}

/** Brace balance ignoring escaped `\{` / `\}`; false if depth ever goes negative. */
function bracesBalanced(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") { i++; continue; } // skip escaped char
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth < 0) return false; }
  }
  return depth === 0;
}

/** The edit rules from the spec. Pure; never throws. */
export function validateRewrite(
  original: string,
  rewritten: string,
): { ok: true } | { ok: false; reason: string } {
  if (!rewritten.trim()) return { ok: false, reason: "empty" };
  if (/\n\s*\n/.test(rewritten)) return { ok: false, reason: "blank_line" };
  if (!bracesBalanced(rewritten)) return { ok: false, reason: "unbalanced_braces" };
  for (const re of STRUCTURE_RES) {
    if (count(re, rewritten) > count(re, original)) return { ok: false, reason: "structure" };
  }
  const origCmds = new Set(original.match(COMMAND_RE) ?? []);
  for (const cmd of rewritten.match(COMMAND_RE) ?? []) {
    if (!origCmds.has(cmd)) return { ok: false, reason: "new_command" };
  }
  for (const n of original.match(NUMBER_RE) ?? []) {
    if (!rewritten.includes(n)) return { ok: false, reason: "dropped_number" };
  }
  const delta = Math.abs(rewritten.length - original.length) / Math.max(1, original.length);
  if (delta > LENGTH_TOLERANCE) return { ok: false, reason: "length" };
  return { ok: true };
}

/** Apply accepted rewrites from the highest offset down so earlier offsets stay valid. */
export function spliceSegments(source: string, changes: Change[]): string {
  const live = changes
    .filter((c) => c.accepted && c.rewrite)
    .sort((a, b) => b.segment.start - a.segment.start);
  let out = source;
  for (const c of live) {
    out = out.slice(0, c.segment.start) + c.rewrite!.text + out.slice(c.segment.end);
  }
  return out;
}

export type Range = { start: number; end: number };
export const HIGHLIGHT_OLD = "tailorOld";
export const HIGHLIGHT_NEW = "tailorNew";

function acceptedByStart(changes: Change[]): Change[] {
  return changes.filter((c) => c.accepted && c.rewrite).sort((a, b) => a.segment.start - b.segment.start);
}

/** Ranges in the ORIGINAL source of every accepted rewrite, sorted. */
export function changedOriginalRanges(changes: Change[]): Range[] {
  return acceptedByStart(changes).map((c) => ({ start: c.segment.start, end: c.segment.end }));
}

/** Ranges in the spliced (tailored) tex where each accepted rewrite sits. */
export function tailoredRanges(changes: Change[]): Range[] {
  let delta = 0;
  return acceptedByStart(changes).map((c) => {
    const start = c.segment.start + delta;
    const end = start + c.rewrite!.text.length;
    delta += c.rewrite!.text.length - c.segment.text.length;
    return { start, end };
  });
}

/** Reverse spliceSegments; null if the saved tex doesn't line up with the changes. */
export function reconstructOriginal(tailoredTex: string, changes: Change[]): string | null {
  const live = acceptedByStart(changes);
  const ranges = tailoredRanges(changes);
  let out = tailoredTex;
  for (let i = live.length - 1; i >= 0; i--) {
    const { start, end } = ranges[i];
    if (out.slice(start, end) !== live[i].rewrite!.text) return null;
    out = out.slice(0, start) + live[i].segment.text + out.slice(end);
  }
  return out;
}

/** Wrap each range in a colour group, highest start first. Ranges must not overlap. */
export function highlightRanges(source: string, ranges: Range[], color: string): string {
  let out = source;
  for (const r of [...ranges].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, r.start) + "{\\color{" + color + "}" + out.slice(r.start, r.end) + "}" + out.slice(r.end);
  }
  return out;
}

/** Define the highlight colours before the first \begin{document}; idempotent. */
export function withHighlightColors(source: string): string {
  if (source.includes("\\definecolor{" + HIGHLIGHT_OLD + "}")) return source;
  const at = source.indexOf("\\begin{document}");
  if (at < 0) return source;
  const defs =
    "\\usepackage{xcolor}\n" +
    "\\definecolor{" + HIGHLIGHT_OLD + "}{HTML}{B91C1C}\n" +
    "\\definecolor{" + HIGHLIGHT_NEW + "}{HTML}{15803D}\n";
  return source.slice(0, at) + defs + source.slice(at);
}

/** View-only sources for the side-by-side comparer: changed text red on the left, green on the right. */
export function reviewSources(originalTex: string, changes: Change[]): { original: string; tailored: string } {
  return {
    original: withHighlightColors(highlightRanges(originalTex, changedOriginalRanges(changes), HIGHLIGHT_OLD)),
    tailored: withHighlightColors(
      highlightRanges(spliceSegments(originalTex, changes), tailoredRanges(changes), HIGHLIGHT_NEW),
    ),
  };
}

/** Rough plain text of a .tex: comments, commands, braces and math gone; escapes resolved. */
export function plainTextOf(source: string): string {
  return source
    .replace(/(^|[^\\])%.*$/gm, "$1")        // comments (not \%)
    .replace(/\\\[[\s\S]*?\\\]/g, " ")       // display math
    .replace(/\$[^$]*\$/g, " ")               // inline math ($|$ separators etc.)
    .replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, " ") // commands + optional [arg]
    .replace(/\\([%$&#_{}])/g, "$1")          // escapes
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive whole-term match; `C` must not match `C++`, `Java` must not match `JavaScript`. */
export function markPresent(keywords: Omit<Keyword, "present">[], plainText: string): Keyword[] {
  return keywords.map((k) => {
    const re = new RegExp(`(?<![A-Za-z0-9+#])${escapeRe(k.term)}(?![A-Za-z0-9+#])`, "i");
    return { ...k, present: re.test(plainText) };
  });
}

/** Counts `/Type /Page` objects; falls back to the largest `/Count N`; never below 1. */
export function pdfPageCount(bytes: Uint8Array): number {
  const text = new TextDecoder("latin1").decode(bytes);
  const pages = count(/\/Type\s*\/Page(?![s])/g, text);
  if (pages > 0) return pages;
  let best = 0;
  for (const m of text.matchAll(/\/Count\s+(\d+)/g)) best = Math.max(best, Number(m[1]));
  return Math.max(1, best);
}

export type Coverage = { matched: number; incorporated: number; missing: number; total: number };

/** Keyword tallies for chips and the Resumes table. */
export function coverage(keywords: Keyword[], changes: Change[]): Coverage {
  const incorporatedTerms = new Set<string>();
  for (const c of changes) {
    if (!c.accepted || !c.rewrite) continue;
    for (const k of c.rewrite.keywords) incorporatedTerms.add(k.toLowerCase());
  }
  let matched = 0, incorporated = 0;
  for (const k of keywords) {
    if (k.present) matched++;
    else if (incorporatedTerms.has(k.term.toLowerCase())) incorporated++;
  }
  return { matched, incorporated, missing: keywords.length - matched - incorporated, total: keywords.length };
}
