// Dev harness: generate drafts for all real contacts through the live
// drafting pipeline (src/lib/claude.ts), including recent-draft injection,
// mirroring loadDraftContext. Run: npx tsx test-drafts.mts
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { createClient } = await import("@supabase/supabase-js");
const { draftOutreachEmail, extractDraftSnippet } = await import("./src/lib/claude");

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const { data: profile } = await db
  .from("profiles")
  .select("id, bio, resume_text, outreach_goal, linkedin_url")
  .limit(1)
  .single();

const { data: contacts } = await db
  .from("contacts")
  .select("id, name, title, linkedin_url, notes, research_notes, company:companies(name, industry)")
  .order("created_at", { ascending: true });

for (const contact of contacts ?? []) {
  const [{ data: li }, { data: ap }, { data: recent }] = await Promise.all([
    db.from("research_artifacts").select("payload").eq("contact_id", contact.id).eq("source", "linkedin").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("research_artifacts").select("payload").eq("contact_id", contact.id).eq("source", "apollo").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("contacts").select("draft_body").neq("id", contact.id).not("draft_body", "is", null).order("draft_updated_at", { ascending: false }).limit(3),
  ]);

  const company = Array.isArray(contact.company) ? (contact.company[0] ?? null) : (contact.company as { name: string; industry: string | null } | null);

  const draft = await draftOutreachEmail({
    contactName: contact.name,
    contactTitle: contact.title,
    companyName: company?.name ?? null,
    companyIndustry: company?.industry ?? null,
    linkedinUrl: contact.linkedin_url,
    linkedinPayload: li?.payload ?? null,
    apolloPayload: ap?.payload ?? null,
    tavilyPayload: null,
    userNotes: contact.notes,
    researchNotes: contact.research_notes ?? null,
    recentDrafts: (recent ?? [])
      .filter((r): r is { draft_body: string } => !!r.draft_body)
      .map((r) => extractDraftSnippet(r.draft_body)),
    sender: {
      bio: profile?.bio ?? null,
      resumeText: profile?.resume_text ?? null,
      outreachGoal: profile?.outreach_goal ?? null,
      linkedinUrl: profile?.linkedin_url ?? null,
    },
  });

  console.log(`\n${"=".repeat(70)}\nTO: ${contact.name} (${contact.title ?? "?"} at ${company?.name ?? "?"})`);
  console.log(`SUBJECT: ${draft.subject}\n`);
  console.log(draft.body);
}
