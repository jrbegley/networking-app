/**
 * Apify client targeting HarvestAPI's LinkedIn Profile Scraper actor.
 *
 *   Actor: harvestapi/linkedin-profile-scraper
 *   Pricing: $0.004 per profile (no email lookup)
 *   Auth: Bearer token, no LinkedIn cookies needed
 *
 * We use Apify's `run-sync-get-dataset-items` endpoint, which runs the
 * actor synchronously and returns the dataset in the same HTTP response —
 * no run polling, no webhook handling. Typical wall-clock time for a
 * single profile is 10–30 seconds.
 *
 * Vercel server-action timeout: see `export const maxDuration = 60` in
 * the actions file that calls this. Hobby plan allows up to 60s.
 */

const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR_PATH = "harvestapi~linkedin-profile-scraper"; // tilde-encoded /
const SEARCH_BY_NAME_ACTOR_PATH = "harvestapi~linkedin-profile-search-by-name";

// ── Output schema (partial — pulls fields we use) ────────────────────────

export type LinkedInPosition = {
  title?: string;
  companyName?: string;
  description?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
};

export type LinkedInEducation = {
  schoolName?: string;
  degree?: string;
  fieldOfStudy?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
};

export type LinkedInSkill = {
  name?: string;
  endorsements?: number;
};

export type LinkedInCertification = {
  name?: string;
  issuer?: string;
  issuedDate?: string;
};

export type LinkedInProject = {
  title?: string;
  description?: string;
};

export type LinkedInLanguage = {
  language?: string;
  proficiency?: string;
};

export type LinkedInRecommendation = {
  author?: string;
  authorTitle?: string;
  text?: string;
};

export type LinkedInProfile = {
  profileUrl?: string;
  publicIdentifier?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  about?: string;
  location?: {
    city?: string;
    country?: string;
  };
  currentPosition?: LinkedInPosition;
  positions?: LinkedInPosition[];
  education?: LinkedInEducation[];
  skills?: LinkedInSkill[];
  certifications?: LinkedInCertification[];
  projects?: LinkedInProject[];
  languages?: LinkedInLanguage[];
  recommendations?: LinkedInRecommendation[];
};

// ── Client ───────────────────────────────────────────────────────────────

export async function scrapeLinkedInProfile(
  url: string,
): Promise<LinkedInProfile | null> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN not set");

  const res = await fetch(
    `${APIFY_BASE}/acts/${ACTOR_PATH}/run-sync-get-dataset-items`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        // HarvestAPI actor input schema (confirmed from docs):
        // - queries: array of LinkedIn profile URLs
        // - profileScraperMode: which tier to use ($4/1k = no email)
        queries: [url],
        profileScraperMode: "Profile details no email ($4 per 1k)",
      }),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Apify ${res.status}: ${text.slice(0, 300) || res.statusText}`,
    );
  }

  const items = (await res.json()) as LinkedInProfile[];
  return Array.isArray(items) && items.length > 0 ? items[0] : null;
}

// ── LinkedIn people search by name ───────────────────────────────────────
//
// HarvestAPI's search-by-name actor runs a real LinkedIn people search and
// returns the actual search hits (name, headline, location, profile URL).
// "Short" mode is the cheap tier — enough to identify the right person
// without scraping full profiles.

export type LinkedInSearchHit = {
  id?: string;
  name?: string;
  position?: string; // headline, e.g. "VP of Sales at Acme"
  location?: { linkedinText?: string };
  linkedinUrl?: string;
  publicIdentifier?: string;
};

export async function searchLinkedInProfilesByName(opts: {
  firstName: string;
  lastName: string;
  maxItems?: number;
}): Promise<LinkedInSearchHit[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN not set");

  const res = await fetch(
    `${APIFY_BASE}/acts/${SEARCH_BY_NAME_ACTOR_PATH}/run-sync-get-dataset-items`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        profileScraperMode: "Short",
        firstName: opts.firstName,
        lastName: opts.lastName,
        maxItems: opts.maxItems ?? 8,
      }),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Apify search-by-name ${res.status}: ${text.slice(0, 300) || res.statusText}`,
    );
  }

  const items = (await res.json()) as LinkedInSearchHit[];
  return Array.isArray(items) ? items.filter((i) => i.linkedinUrl) : [];
}
