/**
 * Contact data hygiene, applied wherever scraped/enriched data is written.
 *
 * Two recurring pollution sources:
 *   - LinkedIn headlines saved as titles ("Incoming Associate @ BCG | James
 *     Scholar at ..."). A title is the part before the first pipe, minus
 *     any "@ Company" tail (the company lives in its own field).
 *   - Names saved from Apollo's obfuscated search data ("Doris T",
 *     "Keith Be***s"). A scraped LinkedIn profile knows the real name.
 */

/** Reduce a headline-ish string to a plain job title. Null-safe. */
export function cleanTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let title = raw.split("|")[0];
  // Drop "@ Company" tails; the company is a separate field.
  title = title.replace(/(^|\s)@\s+\S.*$/, "");
  title = title.replace(/\s{2,}/g, " ").trim();
  return title || null;
}

/**
 * True when a stored contact name looks like it came from obfuscated
 * Apollo data: missing surname, 1-2 character surname, or asterisks.
 */
export function nameLooksBroken(name: string): boolean {
  if (name.includes("*")) return true;
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return true;
  const surname = parts.slice(1).join(" ").replace(/\./g, "");
  return surname.length <= 2;
}

/**
 * Pick the better name between what's stored and what a scraped profile
 * says. Only repairs names that look broken — a name the user typed in
 * full is never overwritten.
 */
export function repairName(
  current: string,
  scraped: string | null | undefined,
): string | null {
  const candidate = scraped?.trim();
  if (!candidate || candidate === current) return null;
  if (!nameLooksBroken(current)) return null;
  if (nameLooksBroken(candidate)) return null;
  return candidate;
}
