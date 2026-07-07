// One-off data hygiene: repair names saved from obfuscated Apollo data and
// headline-as-title fields, using each contact's LinkedIn scrape as truth.
// Then regenerate stale drafts sequentially with the live v2 prompt so the
// recent-drafts injection differentiates them.
// Run: npx tsx scripts/fix-contact-data.mts
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { createServiceClient } = await import("../src/lib/supabase/service");
const { draftOutreachEmail, extractDraftSnippet } = await import("../src/lib/claude");
import type { LinkedInProfile } from "../src/lib/apify";

const db = createServiceClient();

const { data: profile } = await db
  .from("profiles")
  .select("id, bio, resume_text, outreach_goal, linkedin_url")
  .limit(1)
  .single();

const { data: contacts } = await db
  .from("contacts")
  .select("id, name, title, linkedin_url, notes, research_notes, draft_body, company:companies(name, industry)")
  .order("created_at", { ascending: true });

// ── Pass 1: name + title repair from LinkedIn scrapes ────────────────────
for (const c of contacts ?? []) {
  const { data: li } = await db
    .from("research_artifacts")
    .select("payload")
    .eq("contact_id", c.id)
    .eq("source", "linkedin")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const p = (li?.payload ?? null) as LinkedInProfile | null;
  if (!p) continue;

  const updates: Record<string, string> = {};

  // Name: repair if the stored surname is missing/obfuscated/one letter.
  const scrapeName =
    p.name ?? [p.firstName, p.lastName].filter(Boolean).join(" ");
  const surname = c.name.split(/\s+/).slice(1).join(" ");
  const looksBroken =
    !surname || surname.length <= 2 || surname.includes("*");
  if (scrapeName && looksBroken && scrapeName !== c.name) {
    updates.name = scrapeName;
  }

  // Title: if it looks like a full LinkedIn headline (contains |), replace
  // with the current position title from the scrape, or the pre-| segment.
  if (c.title?.includes("|")) {
    const positionTitle = Array.isArray(p.currentPosition)
      ? (p.currentPosition[0] as { title?: string } | undefined)?.title
      : p.currentPosition?.title;
    const fromScrape = positionTitle ?? p.positions?.[0]?.title;
    updates.title = (fromScrape ?? c.title.split("|")[0]).trim();
  }

  if (Object.keys(updates).length) {
    await db.from("contacts").update(updates).eq("id", c.id);
    console.log(`fixed ${c.name}:`, JSON.stringify(updates));
  } else {
    console.log(`ok    ${c.name}`);
  }
}

// ── Pass 2: regenerate stale drafts with the v2 prompt, sequentially ─────
const { data: fresh } = await db
  .from("contacts")
  .select("id, name, title, linkedin_url, notes, research_notes, draft_body, company:companies(name, industry)")
  .not("draft_body", "is", null)
  .order("created_at", { ascending: true });

for (const c of fresh ?? []) {
  const [{ data: li }, { data: ap }, { data: recent }] = await Promise.all([
    db.from("research_artifacts").select("payload").eq("contact_id", c.id).eq("source", "linkedin").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("research_artifacts").select("payload").eq("contact_id", c.id).eq("source", "apollo").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("contacts").select("draft_body").neq("id", c.id).not("draft_body", "is", null).order("draft_updated_at", { ascending: false }).limit(3),
  ]);
  const company = Array.isArray(c.company) ? (c.company[0] ?? null) : (c.company as { name: string; industry: string | null } | null);

  const draft = await draftOutreachEmail({
    contactName: c.name,
    contactTitle: c.title,
    companyName: company?.name ?? null,
    companyIndustry: company?.industry ?? null,
    linkedinUrl: c.linkedin_url,
    linkedinPayload: li?.payload ?? null,
    apolloPayload: ap?.payload ?? null,
    tavilyPayload: null,
    userNotes: c.notes,
    researchNotes: c.research_notes ?? null,
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

  await db
    .from("contacts")
    .update({
      draft_subject: draft.subject,
      draft_body: draft.body,
      draft_updated_at: new Date().toISOString(),
    })
    .eq("id", c.id);
  console.log(`\nredrafted ${c.name}: ${draft.subject}`);
}
console.log("\ndone");
