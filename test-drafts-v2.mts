// Temporary: same 3 contacts, new prompt from email-prompt-v2.txt.
// Context assembly mirrors claude.ts exactly (summarizers imported from src).
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { createClient } = await import("@supabase/supabase-js");
const Anthropic = (await import("@anthropic-ai/sdk")).default;
const { summarizeLinkedInPayload } = await import("./src/lib/linkedin-summary");
const { summarizeApolloPayload } = await import("./src/lib/apollo-summary");

const PROMPT = fs.readFileSync("email-prompt-v2.txt", "utf8");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const { data: profile } = await db
  .from("profiles")
  .select("bio, resume_text, outreach_goal, linkedin_url")
  .limit(1)
  .single();

const senderSections: string[] = [];
if (profile?.bio) senderSections.push(`# Background\n${profile.bio}`);
if (profile?.outreach_goal) senderSections.push(`# Outreach goal\n${profile.outreach_goal}`);
if (profile?.resume_text) senderSections.push(`# Resume / detailed history\n${profile.resume_text}`);
if (profile?.linkedin_url) senderSections.push(`# Sender's LinkedIn\n${profile.linkedin_url}`);
const senderBlock = `SENDER PROFILE:\n\n${senderSections.join("\n\n")}`;

const { data: contacts } = await db
  .from("contacts")
  .select("id, name, title, linkedin_url, notes, research_notes, company:companies(name, industry)")
  .order("created_at", { ascending: true });

for (const contact of contacts ?? []) {
  const [{ data: li }, { data: ap }] = await Promise.all([
    db.from("research_artifacts").select("payload").eq("contact_id", contact.id).eq("source", "linkedin").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("research_artifacts").select("payload").eq("contact_id", contact.id).eq("source", "apollo").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const company = Array.isArray(contact.company) ? (contact.company[0] ?? null) : (contact.company as { name: string; industry: string | null } | null);

  const ctxLines: string[] = ["RECIPIENT:", `- Name: ${contact.name}`];
  if (contact.title) ctxLines.push(`- Title: ${contact.title}`);
  if (company?.name) ctxLines.push(`- Company: ${company.name}`);
  if (company?.industry) ctxLines.push(`- Industry: ${company.industry}`);
  if (contact.linkedin_url) ctxLines.push(`- LinkedIn: ${contact.linkedin_url}`);
  if (contact.notes) ctxLines.push(`\nUser's notes about this person:\n${contact.notes}`);
  if (li?.payload) {
    const s = summarizeLinkedInPayload(li.payload);
    if (s) ctxLines.push(`\nLinkedIn profile (scraped, high-signal structured data):\n${s}`);
  }
  if (ap?.payload) {
    const s = summarizeApolloPayload(ap.payload);
    if (s) ctxLines.push(`\nApollo research on recipient:\n${s}`);
  }
  if (contact.research_notes) {
    ctxLines.push(`\nUser's own research notes (treat as authoritative, these are first-hand observations):\n${contact.research_notes}`);
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 600,
    system: [
      { type: "text", text: PROMPT },
      { type: "text", text: senderBlock },
    ],
    messages: [{ role: "user", content: `Draft an outreach email.\n\n${ctxLines.join("\n")}` }],
  });

  const text = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();

  console.log(`\n${"=".repeat(70)}\nTO: ${contact.name} (${contact.title ?? "?"} at ${company?.name ?? "?"})\n`);
  console.log(text);
}
