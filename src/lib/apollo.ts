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
  organization_names?: string[];   // OR match across company names
  organization_industry_tag_ids?: string[];
  organization_num_employees_ranges?: string[];
};

export type ApolloSearchPerson = {
  id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;           // populated after inference, null from API
  last_name_obfuscated: string | null; // raw from API e.g. "Gr***n"
  title: string | null;
  linkedin_url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  organization: { name: string | null; primary_domain: string | null } | null;
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

  if (data.people?.length) {
    console.log("[Apollo] first person raw:", JSON.stringify(data.people[0], null, 2));
  }

  return {
    people: ((data.people ?? []) as Record<string, unknown>[]).map((p) => ({
      id: (p.id as string) ?? "",
      name: (p.name as string | null) ?? null,
      first_name: (p.first_name as string | null) ?? null,
      last_name: null, // populated post-inference
      last_name_obfuscated: (p.last_name_obfuscated as string | null) ?? null,
      title: (p.title as string | null) ?? null,
      linkedin_url: (p.linkedin_url as string | null) ?? null,
      city: (p.city as string | null) ?? null,
      state: (p.state as string | null) ?? null,
      country: (p.country as string | null) ?? null,
      organization: p.organization
        ? {
            name: ((p.organization as Record<string, unknown>).name as string | null) ?? null,
            primary_domain: ((p.organization as Record<string, unknown>).primary_domain as string | null) ?? null,
          }
        : null,
    })) as ApolloSearchPerson[],
    pagination: data.pagination ?? {
      page,
      per_page: perPage,
      total_entries: 0,
      total_pages: 0,
    },
  };
}

// ── Bulk enrichment ────────────────────────────────────────────────────

export type ApolloEnrichedPerson = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  email: string | null;
  email_status: string | null;
  linkedin_url: string | null;
  title: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  organization: ApolloOrganization | null;
  employment_history: ApolloPerson["employment_history"];
};

/**
 * Bulk enrich up to 10 people by Apollo ID. Costs 1 credit per matched
 * person. Returns verified email + full profile. linkedin_url may still
 * be null if Apollo doesn't have it for that person.
 */
export async function bulkEnrichByApolloId(
  ids: string[],
): Promise<ApolloEnrichedPerson[]> {
  if (!ids.length) return [];
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) throw new Error("APOLLO_API_KEY not set");

  const res = await fetch(`${APOLLO_BASE}/people/bulk_match`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": apiKey,
      accept: "application/json",
    },
    body: JSON.stringify({
      details: ids.map((id) => ({ id })),
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apollo bulk_match ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return ((data.matches ?? []) as Record<string, unknown>[]).map((p) => ({
    id: (p.id as string) ?? "",
    first_name: (p.first_name as string | null) ?? null,
    last_name: (p.last_name as string | null) ?? null,
    name: (p.name as string | null) ?? null,
    email: (p.email as string | null) ?? null,
    email_status: (p.email_status as string | null) ?? null,
    linkedin_url: (p.linkedin_url as string | null) ?? null,
    title: (p.title as string | null) ?? null,
    city: (p.city as string | null) ?? null,
    state: (p.state as string | null) ?? null,
    country: (p.country as string | null) ?? null,
    organization: (p.organization as ApolloOrganization | null) ?? null,
    employment_history: (p.employment_history as ApolloPerson["employment_history"]) ?? [],
  }));
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
