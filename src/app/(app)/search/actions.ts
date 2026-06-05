"use server";

import { createClient } from "@/lib/supabase/server";
import { searchPeople, type ApolloSearchPerson } from "@/lib/apollo";
import { translateSearchQuery, parseLastNamesFromEmails } from "@/lib/claude";
import { findLinkedInUrl } from "@/lib/tavily";
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

  // Parse last names from emails via Claude (one batched call).
  // Apollo free tier returns only first name + last initial, but the email
  // local part usually contains the full last name. Mutate last_name in place
  // so all downstream code (display, LinkedIn lookup, saved name) benefits.
  const withEmail = searchData.people
    .map((p, i) => ({ i, firstName: p.first_name ?? "", email: p.email ?? "" }))
    .filter((x) => x.email && x.firstName);

  if (withEmail.length > 0) {
    try {
      const lastNames = await parseLastNamesFromEmails(
        withEmail.map((x) => ({ firstName: x.firstName, email: x.email })),
      );
      withEmail.forEach((x, j) => {
        const ln = lastNames[j];
        if (ln) searchData.people[x.i].last_name = ln;
      });
    } catch {
      // Non-fatal — proceed with whatever Apollo returned
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
  error: string | null;
};

/**
 * Add one or more Apollo search results directly to the pipeline as
 * 'identified' contacts. Skips any that are already in the pipeline.
 */
function buildName(person: ApolloSearchPerson): string {
  if (person.name) return person.name;
  const first = person.first_name ?? "";
  const last = person.last_name ?? "";
  if (!first && !last) return "Unknown";
  const isInitial = last.replace(".", "").trim().length <= 1;
  if (!last) return first;
  return isInitial ? `${first} ${last.replace(".", "")}.` : `${first} ${last}`;
}

export async function addContactsFromSearch(
  people: ApolloSearchPerson[],
): Promise<AddContactsResult> {
  if (!people.length) return { added: 0, error: null };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { added: 0, error: "Not signed in." };

  // Resolve LinkedIn URLs in parallel via Tavily before inserting.
  // Apollo free tier only returns first name + last initial, so we search
  // site:linkedin.com/in with name + company + title. Null if not found.
  const linkedinUrls = await Promise.all(
    people.map((person) => {
      const firstName = person.first_name ?? person.name?.split(" ")[0] ?? "";
      const lastName = person.last_name ?? person.name?.split(" ").slice(1).join(" ") ?? "";
      const company = person.organization?.name ?? "";
      if (!firstName || !company) return Promise.resolve(null);
      return findLinkedInUrl({
        firstName,
        lastName,
        company,
        title: person.title ?? null,
      });
    }),
  );

  let added = 0;

  for (let i = 0; i < people.length; i++) {
    const person = people[i];
    const linkedinUrl = linkedinUrls[i] ?? person.linkedin_url ?? null;

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
      name: buildName(person),
      title: person.title ?? null,
      email: person.email ?? null,
      linkedin_url: linkedinUrl,
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
