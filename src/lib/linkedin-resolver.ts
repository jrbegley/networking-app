/**
 * LinkedIn URL resolution: person facts → verified profile URL or null.
 *
 * Pipeline:
 *   1. Candidate generation, two sources in parallel:
 *      - HarvestAPI search-by-name (a real LinkedIn people search — the
 *        strongest source, returns actual profile name/headline/location)
 *      - Tavily site:linkedin.com/in web search (cheap, catches profiles
 *        LinkedIn search ranks poorly)
 *   2. Claude verification: all candidates + trusted facts → pick the one
 *      that is actually this person, or none. Only "high" confidence wins.
 *
 * The contract callers rely on: a returned URL has been VERIFIED against
 * the person's known company/title/location. No more first-hit guessing.
 * Null means "save the contact without a URL" — never store a maybe.
 */

import { searchLinkedInProfilesByName } from "@/lib/apify";
import { findLinkedInCandidates, normalizeLinkedInUrl } from "@/lib/tavily";
import {
  pickLinkedInMatch,
  type LinkedInMatchCandidate,
} from "@/lib/claude";

export type ResolveLinkedInInput = {
  firstName: string;
  /** Best-available last name — used only to build search queries. */
  lastName: string | null;
  /** True only when lastName comes from a trusted source (Apollo enrichment,
   * user input). False for Claude-inferred guesses from obfuscated patterns —
   * a guessed name is fine as a search query but must not be treated as a
   * fact during verification. */
  lastNameTrusted: boolean;
  company: string | null;
  title: string | null;
  location: string | null; // "City, State, Country" — whatever parts exist
};

export type ResolveLinkedInResult = {
  url: string | null;
  /** Which source produced the verified match (null when no match). */
  method: "linkedin_search" | "web_search" | null;
};

export async function resolveLinkedInUrl(
  input: ResolveLinkedInInput,
): Promise<ResolveLinkedInResult> {
  const { firstName, lastName, lastNameTrusted, company, title, location } = input;
  if (!firstName) return { url: null, method: null };

  // Without a last name, LinkedIn's people search is useless (first-name-only
  // returns thousands of hits). Tavily + company can still work.
  const canSearchLinkedIn = !!lastName && lastName.replace(".", "").trim().length > 1;

  const [linkedinHits, webHits] = await Promise.all([
    canSearchLinkedIn
      ? searchLinkedInProfilesByName({
          firstName,
          lastName: lastName!,
          maxItems: 8,
        }).catch(() => [])
      : Promise.resolve([]),
    findLinkedInCandidates({ firstName, lastName, company, title }).catch(
      () => [],
    ),
  ]);

  // Merge, LinkedIn-search entries first (richer metadata), dedupe by URL.
  const byUrl = new Map<string, LinkedInMatchCandidate>();
  for (const hit of linkedinHits) {
    if (!hit.linkedinUrl) continue;
    const url = normalizeLinkedInUrl(hit.linkedinUrl);
    if (!byUrl.has(url)) {
      byUrl.set(url, {
        url,
        name: hit.name ?? null,
        headline: hit.position ?? null,
        location: hit.location?.linkedinText ?? null,
        snippet: null,
        source: "linkedin_search",
      });
    }
  }
  for (const hit of webHits) {
    const url = normalizeLinkedInUrl(hit.url);
    if (!byUrl.has(url)) {
      byUrl.set(url, {
        url,
        name: null, // name only appears inside title/snippet — let the verifier read it
        headline: hit.title || null,
        location: null,
        snippet: hit.snippet || null,
        source: "web_search",
      });
    }
  }

  const candidates = [...byUrl.values()];
  if (!candidates.length) return { url: null, method: null };

  const matchIndex = await pickLinkedInMatch(
    {
      firstName,
      // Guessed last names are queries, not facts.
      lastName: lastNameTrusted ? lastName : null,
      company,
      title,
      location,
    },
    candidates,
  ).catch(() => null);

  if (matchIndex === null) return { url: null, method: null };
  const chosen = candidates[matchIndex];
  return { url: chosen.url, method: chosen.source };
}
