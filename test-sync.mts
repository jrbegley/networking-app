// Temporary: verify the Sent Items Graph query + full shared sync path
// against the real mailbox and real contacts.
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { createServiceClient } = await import("./src/lib/supabase/service");
const { fetchSentMessagesTo } = await import("./src/lib/graph");
const { syncContactEmails } = await import("./src/lib/inbox-sync");

const db = createServiceClient();

const { data: profile } = await db
  .from("profiles")
  .select("id, outlook_email")
  .not("outlook_access_token", "is", null)
  .limit(1)
  .single();
console.log("user:", profile!.outlook_email);

const { data: contacts } = await db
  .from("contacts")
  .select("id, name, email, current_stage")
  .eq("owner_id", profile!.id)
  .not("email", "is", null);

for (const c of contacts ?? []) {
  const sent = await fetchSentMessagesTo(profile!.id, c.email!, 90, db);
  console.log(
    `\n${c.name} <${c.email}> stage=${c.current_stage}: sent-query ${sent.error ? "ERROR " + sent.error : "ok"}, ${sent.messages.length} sent message(s)`,
  );
  const r = await syncContactEmails(db, profile!.id, {
    id: c.id,
    email: c.email!,
    current_stage: c.current_stage,
  });
  console.log(
    `  sync: received=${r.received} sent=${r.sent} newStage=${r.newStage ?? "(unchanged)"} error=${r.error ?? "none"}`,
  );
}
