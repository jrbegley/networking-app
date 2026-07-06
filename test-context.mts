// Temporary: print the exact context the drafter sees, to fact-check drafts.
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { createClient } = await import("@supabase/supabase-js");
const { summarizeLinkedInPayload } = await import("./src/lib/linkedin-summary");

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const { data: profile } = await db.from("profiles").select("bio, resume_text, outreach_goal").limit(1).single();
console.log("SENDER BIO:", profile?.bio);
console.log("\nSENDER RESUME (first 1200 chars):\n", (profile?.resume_text ?? "").slice(0, 1200));

const { data: contacts } = await db
  .from("contacts")
  .select("id, name")
  .order("created_at", { ascending: true });

for (const c of contacts ?? []) {
  const { data: li } = await db
    .from("research_artifacts").select("payload").eq("contact_id", c.id).eq("source", "linkedin")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  console.log(`\n${"=".repeat(60)}\n${c.name} — LinkedIn summary:\n`);
  console.log(li?.payload ? summarizeLinkedInPayload(li.payload) : "(no linkedin artifact)");
}
