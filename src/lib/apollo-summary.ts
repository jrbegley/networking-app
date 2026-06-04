/**
 * Shared Apollo payload summarizer — used both for the contact detail
 * page display AND for the Claude drafting prompt. Single source of truth
 * so what the user sees matches what the model sees.
 */
/**
 * Detect a "shell" Apollo response — Apollo's free tier confirms a person
 * exists in their DB but masks every field except `linkedin_url` and `id`.
 * If we only have those, we have effectively nothing.
 */
export function isApolloShellResponse(payload: unknown): boolean {
  const person = (payload as { person?: Record<string, unknown> } | null)
    ?.person;
  if (!person) return true;
  const hasName =
    typeof person.name === "string" && person.name.trim().length > 0;
  const hasTitle =
    typeof person.title === "string" && person.title.trim().length > 0;
  const hasHeadline =
    typeof person.headline === "string" && person.headline.trim().length > 0;
  const org = person.organization as Record<string, unknown> | null | undefined;
  const hasOrg =
    !!org &&
    typeof org.name === "string" &&
    (org.name as string).trim().length > 0;
  const history = person.employment_history as Array<unknown> | undefined;
  const hasHistory = Array.isArray(history) && history.length > 0;
  return !(hasName || hasTitle || hasHeadline || hasOrg || hasHistory);
}

export function summarizeApolloPayload(payload: unknown): string | null {
  if (isApolloShellResponse(payload)) return null;

  const person = (payload as { person?: Record<string, unknown> } | null)
    ?.person;
  if (!person) return null;

  const lines: string[] = [];
  const getStr = (k: string) => {
    const v = person[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  const fullName = getStr("name");
  if (fullName) lines.push(`- Name: ${fullName}`);
  const headline = getStr("headline");
  if (headline) lines.push(`- Headline: ${headline}`);

  if (getStr("title")) lines.push(`- Title: ${getStr("title")}`);
  if (getStr("seniority")) lines.push(`- Seniority: ${getStr("seniority")}`);
  if (getStr("departments"))
    lines.push(`- Department: ${getStr("departments")}`);

  if (getStr("email")) lines.push(`- Email on file: ${getStr("email")}`);

  const loc = [getStr("city"), getStr("state"), getStr("country")]
    .filter(Boolean)
    .join(", ");
  if (loc) lines.push(`- Location: ${loc}`);

  const org =
    (person.organization as Record<string, unknown> | null | undefined) ??
    null;
  if (org) {
    const orgGet = (k: string) => {
      const v = org[k];
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    const orgName = orgGet("name");
    if (orgName) lines.push(`- Company: ${orgName}`);
    if (orgGet("industry")) lines.push(`- Industry: ${orgGet("industry")}`);
    if (orgGet("primary_domain"))
      lines.push(`- Company domain: ${orgGet("primary_domain")}`);
    const orgSize =
      typeof org.estimated_num_employees === "number"
        ? org.estimated_num_employees
        : null;
    if (orgSize) lines.push(`- Company size: ~${orgSize} employees`);
    if (orgGet("short_description"))
      lines.push(`- Company description: ${orgGet("short_description")}`);
  }

  const history = person.employment_history as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(history) && history.length > 0) {
    const recent = history.slice(0, 5);
    const histLines = recent
      .map((h) => {
        const t = typeof h.title === "string" ? h.title : null;
        const o =
          typeof h.organization_name === "string"
            ? h.organization_name
            : null;
        const start = typeof h.start_date === "string" ? h.start_date : "";
        const end =
          typeof h.end_date === "string" && h.end_date
            ? h.end_date
            : "present";
        if (t && o) {
          return start
            ? `  • ${t} at ${o} (${start} – ${end})`
            : `  • ${t} at ${o}`;
        }
        if (o) return `  • ${o}`;
        return null;
      })
      .filter(Boolean);
    if (histLines.length > 0) {
      lines.push("- Employment history:");
      lines.push(...(histLines as string[]));
    }
  }

  const schools = (person.schools ?? person.education) as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(schools) && schools.length > 0) {
    const schoolLines = schools
      .slice(0, 5)
      .map((s) => {
        const name = typeof s.name === "string" ? s.name : null;
        const degree = typeof s.degree === "string" ? s.degree : null;
        const field =
          typeof s.field_of_study === "string" ? s.field_of_study : null;
        if (!name) return null;
        const parts = [name, degree, field].filter(Boolean).join(" — ");
        return `  • ${parts}`;
      })
      .filter(Boolean);
    if (schoolLines.length > 0) {
      lines.push("- Education:");
      lines.push(...(schoolLines as string[]));
    }
  }

  if (getStr("linkedin_url"))
    lines.push(`- LinkedIn: ${getStr("linkedin_url")}`);
  if (getStr("twitter_url"))
    lines.push(`- Twitter/X: ${getStr("twitter_url")}`);

  return lines.length > 0 ? lines.join("\n") : null;
}
