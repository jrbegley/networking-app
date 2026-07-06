"use server";

import { createClient } from "@/lib/supabase/server";
import { searchPeople, bulkEnrichByApolloId, type ApolloSearchPerson } from "@/lib/apollo";
import { translateSearchQuery, inferLastNamesFromObfuscated } from "@/lib/claude";
import { resolveLinkedInUrl } from "@/lib/linkedin-resolver";
import { revalidatePath } from "next/cache";

export type SearchResult = ApolloSearchPerson & {
  inPipeline: boolean;
  contactId: string | null;
};

export type SearchResponse = {
  results: SearchResult[];
  totalEntries: number;
  totalPages: number;
  page: number;
  filtersUsed: Record<string, unknown>;
  error: string | null;
};

export async function searchApollo(
  query: string,
  page = 1,
  showInPipeline = false,
): Promise<SearchResponse> {
  if (!query.trim()) {
    return { results: [], totalEntries: 0, totalPages: 0, page: 1, filtersUsed: {}, error: null };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { results: [], totalEntries: 0, totalPages: 0, page: 1, filtersUsed: {}, error: "Not signed in." };

  // Load user profile for shared-trait context
  const { data: profile } = await supabase
    .from("profiles")
    .select("bio, resume_text, outreach_goal")
    .eq("id", user.id)
    .maybeSingle();

  // Translate natural language → Apollo filters via Claude
  let filters: Record<string, unknown>;
  try {
    filters = await translateSearchQuery(query, {
      bio: profile?.bio ?? null,
      resumeText: profile?.resume_text ?? null,
      outreachGoal: profile?.outreach_goal ?? null,
    });
  } catch (e) {
    return {
      results: [],
      totalEntries: 0,
      totalPages: 0,
      page: 1,
      filtersUsed: {},
      error: `Couldn't translate search: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }

  // Search Apollo
  let searchData;
  try {
    searchData = await searchPeople(filters, page);
  } catch (e) {
    return {
      results: [],
      totalEntries: 0,
      totalPages: 0,
      page: 1,
      filtersUsed: filters,
      error: `Apollo search failed: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }

  // Infer last names from Apollo's obfuscated patterns (e.g. "Gr***n") via
  // Claude. One batched call for the whole page. Mutates last_name in place
  // so display, LinkedIn lookup, and saved contact name all benefit.
  const withObfuscated = searchData.people
    .map((p, i) => ({
      i,
      firstName: p.first_name ?? "",
      lastNameObfuscated: p.last_name_obfuscated ?? "",
      company: p.organization?.name ?? "",
      title: p.title ?? null,
    }))
    .filter((x) => x.lastNameObfuscated && x.firstName);

  if (withObfuscated.length > 0) {
    try {
      const lastNames = await inferLastNamesFromObfuscated(withObfuscated);
      withObfuscated.forEach((x, j) => {
        const ln = lastNames[j];
        if (ln) searchData.people[x.i].last_name = ln;
      });
    } catch {
      // Non-fatal — proceed with partial names
    }
  }

  // Check which Apollo IDs / LinkedIn URLs are already in the pipeline
  const apolloIds = searchData.people.map((p) => p.id).filter(Boolean);
  const linkedinUrls = searchData.people.map((p) => p.linkedin_url).filter(Boolean);

  const [{ data: byApollo }, { data: byLinkedin }] = await Promise.all([
    apolloIds.length
      ? supabase
          .from("contacts")
          .select("id, apollo_id")
          .eq("owner_id", user.id)
          .in("apollo_id", apolloIds)
      : Promise.resolve({ data: [] }),
    linkedinUrls.length
      ? supabase
          .from("contacts")
          .select("id, linkedin_url")
          .eq("owner_id", user.id)
          .in("linkedin_url", linkedinUrls)
      : Promise.resolve({ data: [] }),
  ]);

  const inPipelineByApollo = new Map(
    (byApollo ?? []).map((c) => [c.apollo_id, c.id]),
  );
  const inPipelineByLinkedin = new Map(
    (byLinkedin ?? []).map((c) => [c.linkedin_url, c.id]),
  );

  let results: SearchResult[] = searchData.people.map((p) => {
    const contactId =
      inPipelineByApollo.get(p.id) ??
      inPipelineByLinkedin.get(p.linkedin_url ?? "") ??
      null;
    return { ...p, inPipeline: !!contactId, contactId };
  });

  if (!showInPipeline) {
    results = results.filter((r) => !r.inPipeline);
  }

  return {
    results,
    totalEntries: searchData.pagination.total_entries,
    totalPages: searchData.pagination.total_pages,
    page: searchData.pagination.page,
    filtersUsed: filters,
    error: null,
  };
}

export type AddContactsResult = {
  added: number;
  withLinkedIn: number;
  error: string | null;
};

/**
 * Best display name. Prefers Apollo enrichment (the person's REAL name)
 * over anything reconstructed from obfuscated search data.
 */
function buildName(
  person: ApolloSearchPerson,
  enriched: { name: string | null; first_name: string | null; last_name: string | null } | undefined,
): string {
  if (enriched?.name) return enriched.name;
  if (enriched?.first_name && enriched?.last_name) {
    return `${enriched.first_name} ${enriched.last_name}`;
  }
  if (person.name) return person.name;
  const first = person.first_name ?? "";
  const last = person.last_name ?? "";           // inferred by Claude
  const obfuscated = person.last_name_obfuscated ?? "";
  if (!first) return "Unknown";
  if (last) return `${first} ${last}`;
  if (obfuscated) return `${first} ${obfuscated}`;
  return first;
}

/**
 * Add one or more Apollo search results directly to the pipeline as
 * 'identified' contacts. Skips any that are already in the pipeline.
 */
export async function addContactsFromSearch(
  people: ApolloSearchPerson[],
): Promise<AddContactsResult> {
  if (!people.length) return { added: 0, withLinkedIn: 0, error: null };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { added: 0, withLinkedIn: 0, error: "Not signed in." };

  // Step 1: Bulk enrich via Apollo (1 credit/person) to get verified email
  // AND the person's real name — search results only carry an obfuscated
  // last name. Process in batches of 10 (API limit).
  const apolloIds = people.map((p) => p.id).filter(Boolean);
  const enrichedMap = new Map<string, Awaited<ReturnType<typeof bulkEnrichByApolloId>>[number]>();
  for (let i = 0; i < apolloIds.length; i += 10) {
    try {
      const batch = await bulkEnrichByApolloId(apolloIds.slice(i, i + 10));
      for (const e of batch) if (e.id) enrichedMap.set(e.id, e);
    } catch {
      // Non-fatal — proceed without enrichment for this batch
    }
  }

  // Step 2: Resolve LinkedIn URLs, all contacts in parallel. Each resolution
  // searches LinkedIn + the web for candidates and has Claude verify which
  // one is actually this person (see lib/linkedin-resolver.ts). A returned
  // URL is verified; null means no confident match — we save null rather
  // than a wrong profile.
  const linkedinUrls = await Promise.all(
    people.map(async (person) => {
      const enriched = enrichedMap.get(person.id);
      // Apollo's own linkedin_url comes from its matched record — trust it.
      if (enriched?.linkedin_url) return enriched.linkedin_url;

      const firstName = enriched?.first_name ?? person.first_name ?? "";
      if (!firstName) return null;

      // Real last name from enrichment beats the Claude guess from the
      // obfuscated pattern. Track which one we're using: a guess may be
      // used to SEARCH but never to VERIFY.
      const realLast = enriched?.last_name ?? null;
      const guessLast = person.last_name ?? null;

      // api_search omits city/state; the enriched record has them.
      const location = [
        person.city ?? enriched?.city,
        person.state ?? enriched?.state,
        person.country ?? enriched?.country,
      ]
        .filter(Boolean)
        .join(", ");

      const { url } = await resolveLinkedInUrl({
        firstName,
        lastName: realLast ?? guessLast,
        lastNameTrusted: !!realLast,
        company: person.organization?.name ?? enriched?.organization?.name ?? null,
        title: person.title ?? enriched?.title ?? null,
        location: location || null,
      });
      return url;
    }),
  );

  let added = 0;
  let withLinkedIn = 0;

  for (let i = 0; i < people.length; i++) {
    const person = people[i];
    const enriched = enrichedMap.get(person.id);
    const linkedinUrl = linkedinUrls[i] ?? null;

    // Upsert company
    let companyId: string | null = null;
    const orgName = person.organization?.name ?? null;
    if (orgName) {
      const { data: existing } = await supabase
        .from("companies")
        .select("id")
        .eq("owner_id", user.id)
        .eq("name", orgName)
        .maybeSingle();

      if (existing) {
        companyId = existing.id;
      } else {
        const { data: created } = await supabase
          .from("companies")
          .insert({
            owner_id: user.id,
            name: orgName,
            domain: person.organization?.primary_domain ?? null,
          })
          .select("id")
          .single();
        companyId = created?.id ?? null;
      }
    }

    const { error } = await supabase.from("contacts").insert({
      owner_id: user.id,
      name: buildName(person, enriched),
      title: person.title ?? enriched?.title ?? null,
      email: enriched?.email ?? null,
      linkedin_url: linkedinUrl,
      apollo_id: person.id ?? null,
      company_id: companyId,
      current_stage: "identified",
      source: "apollo_search",
    });

    if (!error) {
      added++;
      if (linkedinUrl) withLinkedIn++;
    }
  }

  revalidatePath("/contacts");
  revalidatePath("/search");
  return { added, withLinkedIn, error: null };
}
