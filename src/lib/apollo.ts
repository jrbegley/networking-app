/**
 * Apollo API client.
 *
 * Free tier is hard-capped at ~50 credits/month, so every caller MUST
 * check the cache (research_artifacts) before calling this. We never
 * want a click to silently burn a credit.
 */

const APOLLO_BASE = "https://api.apollo.io/api/v1";

export type ApolloPerson = {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  city?: string;
  state?: string;
  country?: string;
  organization?: ApolloOrganization | null;
  employment_history?: Array<{
    organization_name?: string;
    title?: string;
    start_date?: string;
    end_date?: string;
  }>;
};

export type ApolloOrganization = {
  id?: string;
  name?: string;
  primary_domain?: string;
  website_url?: string;
  industry?: string;
  estimated_num_employees?: number;
  linkedin_url?: string;
};

export type ApolloMatchResponse = {
  person: ApolloPerson | null;
};

// ── People search ─────────────────────────────────────────────────────

export type ApolloSearchFilters = {
  q_keywords?: string;
  person_titles?: string[];
  person_locations?: string[];
  person_seniorities?: string[];
  person_schools?: string[];
  organization_industry_tag_ids?: string[];
  organization_num_employees_ranges?: string[];
};

export type ApolloSearchPerson = {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  linkedin_url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  organization: { name: string | null; primary_domain: string | null } | null;
  // email is only populated if the user has reveal credits; omit from type
  // to avoid confusion — use enrichPersonByLinkedInUrl for that.
};

export type ApolloSearchResponse = {
  people: ApolloSearchPerson[];
  pagination: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
};

/**
 * Search Apollo's people database. Does NOT reveal emails — that costs
 * credits and goes through enrichPersonByLinkedInUrl separately.
 * Searching itself is free on the Apollo free tier.
 */
export async function searchPeople(
  filters: ApolloSearchFilters,
  page = 1,
  perPage = 25,
): Promise<ApolloSearchResponse> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) throw new Error("APOLLO_API_KEY not set");

  const body = {
    ...filters,
    page,
    per_page: perPage,
  };

  const res = await fetch(`${APOLLO_BASE}/mixed_people/api_search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": apiKey,
      accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Apollo search ${res.status}: ${text.slice(0, 200) || res.statusText}`,
    );
  }

  const data = await res.json();
  // Log the first result's keys in dev so we can see the actual response shape
  if (process.env.NODE_ENV !== "production" && data.people?.length) {
    console.log("[Apollo api_search] first person keys:", Object.keys(data.people[0]));
    console.log("[Apollo api_search] first person sample:", JSON.stringify(data.people[0], null, 2));
  } else if (data.people?.length) {
    console.log("[Apollo api_search] first person keys:", Object.keys(data.people[0]));
  }

  return {
    people: (data.people ?? []) as ApolloSearchPerson[],
    pagination: data.pagination ?? {
      page,
      per_page: perPage,
      total_entries: 0,
      total_pages: 0,
    },
  };
}

export async function enrichPersonByLinkedInUrl(
  linkedinUrl: string,
): Promise<ApolloMatchResponse> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    throw new Error("APOLLO_API_KEY not set");
  }

  const res = await fetch(`${APOLLO_BASE}/people/match`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": apiKey,
      accept: "application/json",
    },
    body: JSON.stringify({ linkedin_url: linkedinUrl }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Apollo API ${res.status}: ${text.slice(0, 200) || res.statusText}`,
    );
  }

  const data = (await res.json()) as ApolloMatchResponse;
  return data;
}
