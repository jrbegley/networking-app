/**
 * Summarize a LinkedIn profile payload from HarvestAPI's Apify actor.
 *
 * HarvestAPI-specific field names (different from what Apollo uses):
 *   - experience    → work history (NOT positions/currentPosition)
 *   - position      → job title within an experience item (NOT title)
 *   - companyName   → company name ✓
 *   - description   → job description ✓
 *   - startDate     → { month?: string, year?: number, text?: string }
 *   - endDate       → { month?: string, year?: number, text?: string }
 *                    "Present" stored in endDate.text when current role
 *   - about         → bio/summary ✓
 *   - education     → array (field names mostly match)
 *   - skills        → array of strings OR { name: string } objects
 */

const ABOUT_CHAR_LIMIT = 800;
const DESC_CHAR_LIMIT = 400;
const MAX_POSITIONS = 6;
const MAX_EDUCATION = 4;
const MAX_SKILLS = 15;
const MAX_PROJECTS = 4;
const MAX_CERTS = 6;

// ── Date helpers ──────────────────────────────────────────────────────────

type HarvestDate =
  | string
  | { text?: string; month?: string; year?: number }
  | null
  | undefined;

function formatDate(d: HarvestDate): string {
  if (!d) return "";
  if (typeof d === "string") return d;
  // Use the pre-formatted .text field when available ("Jan 2024", "Present")
  if (d.text && d.text.trim()) return d.text.trim();
  // Fall back to constructing from month + year
  if (d.year) {
    return d.month ? `${d.month} ${d.year}` : String(d.year);
  }
  return "";
}

function isCurrentRole(endDate: HarvestDate): boolean {
  if (!endDate) return true;
  if (typeof endDate === "string")
    return endDate.toLowerCase().includes("present");
  const text = (endDate as { text?: string }).text ?? "";
  return text.toLowerCase().includes("present") || text === "";
}

// ── Main summarizer ──────────────────────────────────────────────────────

export function summarizeLinkedInPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  const lines: string[] = [];

  const str = (k: string) => {
    const v = p[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  if (str("name")) lines.push(`- Name: ${str("name")}`);
  if (str("headline")) lines.push(`- Headline: ${str("headline")}`);

  // Location — HarvestAPI may return a string or { city, country } object
  const loc = p["location"];
  if (typeof loc === "string" && loc.trim()) {
    lines.push(`- Location: ${loc.trim()}`);
  } else if (loc && typeof loc === "object") {
    const locObj = loc as Record<string, string>;
    const locStr = [locObj.city, locObj.country].filter(Boolean).join(", ");
    if (locStr) lines.push(`- Location: ${locStr}`);
  }

  // About / summary
  const about = str("about") ?? str("summary");
  if (about) {
    const trimmed = about.replace(/\s+/g, " ");
    lines.push("- About:");
    lines.push(
      `  ${trimmed.length > ABOUT_CHAR_LIMIT ? trimmed.slice(0, ABOUT_CHAR_LIMIT) + "…" : trimmed}`,
    );
  }

  // ── Work experience ──────────────────────────────────────────────────
  // HarvestAPI uses "experience" array; fall back to "positions"
  const expArr =
    Array.isArray(p["experience"])
      ? (p["experience"] as Record<string, unknown>[])
      : Array.isArray(p["positions"])
        ? (p["positions"] as Record<string, unknown>[])
        : [];

  if (expArr.length > 0) {
    lines.push("- Work history:");
    for (const job of expArr.slice(0, MAX_POSITIONS)) {
      // HarvestAPI uses "position" for title; fall back to "title"
      const title =
        (typeof job["position"] === "string" ? job["position"] : null) ??
        (typeof job["title"] === "string" ? job["title"] : null) ??
        "";
      const company =
        (typeof job["companyName"] === "string" ? job["companyName"] : null) ??
        (typeof job["company"] === "string" ? job["company"] : null) ??
        "";

      if (!title && !company) continue;

      const start = formatDate(job["startDate"] as HarvestDate);
      const end = isCurrentRole(job["endDate"] as HarvestDate)
        ? "Present"
        : formatDate(job["endDate"] as HarvestDate);
      const dates = start ? ` (${start} – ${end})` : "";

      lines.push(`  • ${title || "Role"}${company ? ` at ${company}` : ""}${dates}`);

      const desc =
        typeof job["description"] === "string" ? job["description"].trim() : "";
      if (desc) {
        const clean = desc.replace(/\s+/g, " ");
        lines.push(
          `    ${clean.length > DESC_CHAR_LIMIT ? clean.slice(0, DESC_CHAR_LIMIT) + "…" : clean}`,
        );
      }
    }
  }

  // ── Education ────────────────────────────────────────────────────────
  const edArr = Array.isArray(p["education"])
    ? (p["education"] as Record<string, unknown>[])
    : [];

  if (edArr.length > 0) {
    lines.push("- Education:");
    for (const ed of edArr.slice(0, MAX_EDUCATION)) {
      const school =
        (typeof ed["schoolName"] === "string" ? ed["schoolName"] : null) ??
        (typeof ed["school"] === "string" ? ed["school"] : null) ??
        "";
      const degree =
        typeof ed["degree"] === "string" ? ed["degree"] : "";
      const field =
        (typeof ed["fieldOfStudy"] === "string" ? ed["fieldOfStudy"] : null) ??
        (typeof ed["field"] === "string" ? ed["field"] : null) ??
        "";
      const parts = [school, degree, field].filter(Boolean).join(" — ");
      if (!parts) continue;

      const start = formatDate(ed["startDate"] as HarvestDate);
      const end = formatDate(ed["endDate"] as HarvestDate);
      const dates =
        start || end ? ` (${start}${start && end ? " – " : ""}${end})` : "";
      lines.push(`  • ${parts}${dates}`);

      const desc =
        typeof ed["description"] === "string" ? ed["description"].trim() : "";
      if (desc) {
        const clean = desc.replace(/\s+/g, " ");
        lines.push(
          `    ${clean.length > DESC_CHAR_LIMIT ? clean.slice(0, DESC_CHAR_LIMIT) + "…" : clean}`,
        );
      }
    }
  }

  // ── Skills ───────────────────────────────────────────────────────────
  const skillsRaw = p["skills"];
  if (Array.isArray(skillsRaw)) {
    const skills = skillsRaw
      .slice(0, MAX_SKILLS)
      .map((s) => {
        if (typeof s === "string") return s;
        if (s && typeof s === "object") {
          const so = s as Record<string, unknown>;
          return typeof so["name"] === "string" ? so["name"] : null;
        }
        return null;
      })
      .filter((s): s is string => !!s);
    if (skills.length > 0) lines.push(`- Skills: ${skills.join(", ")}`);
  }

  // ── Projects ─────────────────────────────────────────────────────────
  const projArr = Array.isArray(p["projects"])
    ? (p["projects"] as Record<string, unknown>[])
    : [];
  if (projArr.length > 0) {
    lines.push("- Projects:");
    for (const proj of projArr.slice(0, MAX_PROJECTS)) {
      const title =
        (typeof proj["title"] === "string" ? proj["title"] : null) ??
        (typeof proj["name"] === "string" ? proj["name"] : null);
      if (!title) continue;
      lines.push(`  • ${title}`);
      const desc =
        typeof proj["description"] === "string" ? proj["description"].trim() : "";
      if (desc) {
        const clean = desc.replace(/\s+/g, " ");
        lines.push(
          `    ${clean.length > DESC_CHAR_LIMIT ? clean.slice(0, DESC_CHAR_LIMIT) + "…" : clean}`,
        );
      }
    }
  }

  // ── Certifications ───────────────────────────────────────────────────
  const certArr = Array.isArray(p["certifications"])
    ? (p["certifications"] as Record<string, unknown>[])
    : Array.isArray(p["licenses"])
      ? (p["licenses"] as Record<string, unknown>[])
      : [];
  if (certArr.length > 0) {
    const certs = certArr
      .slice(0, MAX_CERTS)
      .map((c) => {
        const name = typeof c["name"] === "string" ? c["name"] : null;
        const issuer =
          (typeof c["issuer"] === "string" ? c["issuer"] : null) ??
          (typeof c["authority"] === "string" ? c["authority"] : null);
        return name ? `${name}${issuer ? ` (${issuer})` : ""}` : null;
      })
      .filter((c): c is string => !!c);
    if (certs.length > 0)
      lines.push(`- Certifications: ${certs.join("; ")}`);
  }

  // ── Languages ────────────────────────────────────────────────────────
  const langArr = Array.isArray(p["languages"])
    ? (p["languages"] as Record<string, unknown>[])
    : [];
  if (langArr.length > 0) {
    const langs = langArr
      .map((l) => {
        if (typeof l === "string") return l;
        const lo = l as Record<string, unknown>;
        const name =
          (typeof lo["language"] === "string" ? lo["language"] : null) ??
          (typeof lo["name"] === "string" ? lo["name"] : null);
        const prof =
          typeof lo["proficiency"] === "string" ? lo["proficiency"] : null;
        return name ? `${name}${prof ? ` (${prof})` : ""}` : null;
      })
      .filter((l): l is string => !!l);
    if (langs.length > 0) lines.push(`- Languages: ${langs.join(", ")}`);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}
