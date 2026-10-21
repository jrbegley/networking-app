/** "joseph.begley" / "Joseph Begley" → "JosephBegley"; "goldman sachs" → "GoldmanSachs". */
function pascalPart(s: string | null | undefined): string {
  return (s ?? "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}

/** e.g. "Joseph Begley", "Goldman Sachs", "pdf" → "JosephBegley_GoldmanSachs_Resume.pdf". Missing parts are skipped. */
export function resumeFilename(name: string | null | undefined, company: string | null | undefined, ext: string): string {
  return [pascalPart(name), pascalPart(company), "Resume"].filter(Boolean).join("_") + `.${ext}`;
}
