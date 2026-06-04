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
