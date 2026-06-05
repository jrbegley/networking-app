"use server";

import { createClient } from "@/lib/supabase/server";
import { searchPeople, type ApolloSearchPerson } from "@/lib/apollo";
import { translateSearchQuery } from "@/lib/claude";
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
  error: string | null;
};

/**
 * Add one or more Apollo search results directly to the pipeline as
 * 'identified' contacts. Skips any that are already in the pipeline.
 */
export async function addContactsFromSearch(
  people: ApolloSearchPerson[],
): Promise<AddContactsResult> {
  if (!people.length) return { added: 0, error: null };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { added: 0, error: "Not signed in." };

  let added = 0;

  for (const person of people) {
    // Upsert company first
    let companyId: string | null = null;
    if (person.organization?.name) {
      const { data: existing } = await supabase
        .from("companies")
        .select("id")
        .eq("owner_id", user.id)
        .eq("name", person.organization.name)
        .maybeSingle();

      if (existing) {
        companyId = existing.id;
      } else {
        const { data: created } = await supabase
          .from("companies")
          .insert({
            owner_id: user.id,
            name: person.organization.name,
            domain: person.organization.primary_domain ?? null,
          })
          .select("id")
          .single();
        companyId = created?.id ?? null;
      }
    }

    const { error } = await supabase.from("contacts").insert({
      owner_id: user.id,
      name: person.name ?? [person.first_name, person.last_name].filter(Boolean).join(" ") ?? "Unknown",
      title: person.title ?? null,
      linkedin_url: person.linkedin_url ?? null,
      apollo_id: person.id ?? null,
      company_id: companyId,
      current_stage: "identified",
      source: "apollo_search",
    });

    if (!error) added++;
  }

  revalidatePath("/contacts");
  revalidatePath("/search");
  return { added, error: null };
}
