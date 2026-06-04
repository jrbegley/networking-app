import type { LinkedInProfile } from "@/lib/apify";

const ABOUT_CHAR_LIMIT = 800;
const DESC_CHAR_LIMIT = 300;
const MAX_POSITIONS = 6;
const MAX_EDUCATION = 4;
const MAX_SKILLS = 15;
const MAX_PROJECTS = 4;
const MAX_CERTS = 6;

/**
 * Format a stored LinkedIn profile for both the contact detail UI and
 * the Claude drafting prompt. Single source of truth.
 *
 * Returns null when payload is empty or has no useful fields.
 */
export function summarizeLinkedInPayload(payload: unknown): string | null {
  const p = payload as LinkedInProfile | null;
  if (!p) return null;

  const lines: string[] = [];

  if (p.name) lines.push(`- Name: ${p.name}`);
  if (p.headline) lines.push(`- Headline: ${p.headline}`);

  if (p.location) {
    const loc = [p.location.city, p.location.country]
      .filter(Boolean)
      .join(", ");
    if (loc) lines.push(`- Location: ${loc}`);
  }

  if (p.about && p.about.trim()) {
    const about = p.about.replace(/\s+/g, " ").trim();
    lines.push("- About:");
    lines.push(
      `  ${
        about.length > ABOUT_CHAR_LIMIT
          ? about.slice(0, ABOUT_CHAR_LIMIT) + "…"
          : about
      }`,
    );
  }

  // Positions: combine current + history, dedupe, take most recent N
  const allPositions: LinkedInPosition[] = [];
  if (p.currentPosition) allPositions.push(p.currentPosition);
  if (Array.isArray(p.positions)) allPositions.push(...p.positions);
  const seen = new Set<string>();
  const deduped = allPositions.filter((pos) => {
    const key = `${pos.title ?? ""}|${pos.companyName ?? ""}|${pos.startDate ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (deduped.length > 0) {
    lines.push("- Work history:");
    for (const pos of deduped.slice(0, MAX_POSITIONS)) {
      const title = pos.title ?? "";
      const company = pos.companyName ?? "";
      const start = pos.startDate ?? "";
      const end = pos.endDate ?? "present";
      if (title && company) {
        const dates = start ? ` (${start} – ${end})` : "";
        lines.push(`  • ${title} at ${company}${dates}`);
        if (pos.description) {
          const desc = pos.description.replace(/\s+/g, " ").trim();
          lines.push(
            `    ${
              desc.length > DESC_CHAR_LIMIT
                ? desc.slice(0, DESC_CHAR_LIMIT) + "…"
                : desc
            }`,
          );
        }
      }
    }
  }

  if (Array.isArray(p.education) && p.education.length > 0) {
    lines.push("- Education:");
    for (const ed of p.education.slice(0, MAX_EDUCATION)) {
      const parts = [ed.schoolName, ed.degree, ed.fieldOfStudy]
        .filter(Boolean)
        .join(" — ");
      if (parts) {
        const dates =
          ed.startDate || ed.endDate
            ? ` (${ed.startDate ?? ""} – ${ed.endDate ?? ""})`
            : "";
        lines.push(`  • ${parts}${dates}`);
      }
    }
  }

  if (Array.isArray(p.skills) && p.skills.length > 0) {
    const topSkills = p.skills
      .slice(0, MAX_SKILLS)
      .map((s) => s.name)
      .filter((n): n is string => !!n);
    if (topSkills.length > 0) {
      lines.push(`- Skills: ${topSkills.join(", ")}`);
    }
  }

  if (Array.isArray(p.projects) && p.projects.length > 0) {
    lines.push("- Projects:");
    for (const proj of p.projects.slice(0, MAX_PROJECTS)) {
      if (!proj.title) continue;
      lines.push(`  • ${proj.title}`);
      if (proj.description) {
        const desc = proj.description.replace(/\s+/g, " ").trim();
        lines.push(
          `    ${
            desc.length > DESC_CHAR_LIMIT
              ? desc.slice(0, DESC_CHAR_LIMIT) + "…"
              : desc
          }`,
        );
      }
    }
  }

  if (Array.isArray(p.certifications) && p.certifications.length > 0) {
    const certs = p.certifications
      .slice(0, MAX_CERTS)
      .map((c) =>
        c.name
          ? `${c.name}${c.issuer ? ` (${c.issuer})` : ""}`
          : null,
      )
      .filter((c): c is string => !!c);
    if (certs.length > 0) {
      lines.push(`- Certifications: ${certs.join("; ")}`);
    }
  }

  if (Array.isArray(p.languages) && p.languages.length > 0) {
    const langs = p.languages
      .map((l) =>
        l.language
          ? `${l.language}${l.proficiency ? ` (${l.proficiency})` : ""}`
          : null,
      )
      .filter((l): l is string => !!l);
    if (langs.length > 0) {
      lines.push(`- Languages: ${langs.join(", ")}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

// Re-export type for in-file convenience; avoids a separate import
// elsewhere in the codebase.
type LinkedInPosition = LinkedInProfile["positions"] extends
  | Array<infer T>
  | undefined
  ? T
  : never;
