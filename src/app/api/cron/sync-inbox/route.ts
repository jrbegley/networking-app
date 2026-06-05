import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchMessagesFromSender } from "@/lib/graph";

// Vercel calls this route on the cron schedule defined in vercel.json.
// Protected by CRON_SECRET so only Vercel (and you) can trigger it.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use service role to query across all users — this route runs outside
  // of a user session. RLS is bypassed intentionally here.
  const { createClient: createServiceClient } = await import(
    "@/lib/supabase/server"
  );
  const supabase = await createServiceClient();

  // Get all users who have Outlook connected
  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, outlook_access_token, outlook_refresh_token, outlook_token_expires_at")
    .not("outlook_access_token", "is", null);

  if (profilesErr) {
    console.error("Cron: failed to load profiles", profilesErr);
    return NextResponse.json({ error: profilesErr.message }, { status: 500 });
  }

  let totalNew = 0;
  let totalAdvanced = 0;

  for (const profile of profiles ?? []) {
    try {
      const result = await syncUserInbox(supabase, profile.id);
      totalNew += result.newCount;
      totalAdvanced += result.advanced;
    } catch (e) {
      console.error(`Cron: error syncing user ${profile.id}:`, e);
    }
  }

  console.log(`Cron sync-inbox: ${totalNew} new emails, ${totalAdvanced} contacts advanced`);
  return NextResponse.json({ ok: true, newEmails: totalNew, advanced: totalAdvanced });
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function syncUserInbox(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ newCount: number; advanced: number }> {
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, email, current_stage")
    .eq("owner_id", userId)
    .not("email", "is", null);

  if (!contacts?.length) return { newCount: 0, advanced: 0 };

  const contactIds = contacts.map((c) => c.id);
  const { data: existing } = await supabase
    .from("interactions")
    .select("contact_id, outlook_message_id")
    .in("contact_id", contactIds)
    .eq("type", "email_received")
    .not("outlook_message_id", "is", null);

  const seenByContact = new Map<string, Set<string>>();
  for (const row of existing ?? []) {
    if (!seenByContact.has(row.contact_id)) {
      seenByContact.set(row.contact_id, new Set());
    }
    seenByContact.get(row.contact_id)!.add(row.outlook_message_id);
  }

  let newCount = 0;
  const toAdvance: string[] = [];

  for (const contact of contacts) {
    const { messages, error } = await fetchMessagesFromSender(userId, contact.email!);
    if (error || !messages.length) continue;

    const seen = seenByContact.get(contact.id) ?? new Set();
    const newMessages = messages.filter((m) => !seen.has(m.id));
    if (!newMessages.length) continue;

    await supabase.from("interactions").insert(
      newMessages.map((m) => ({
        owner_id: userId,
        contact_id: contact.id,
        type: "email_received",
        subject: m.subject,
        body: m.bodyText,
        outlook_message_id: m.id,
        occurred_at: m.receivedAt,
      })),
    );

    newCount += newMessages.length;
    if (contact.current_stage === "sent") toAdvance.push(contact.id);
  }

  if (toAdvance.length > 0) {
    await supabase
      .from("contacts")
      .update({ current_stage: "replied" })
      .in("id", toAdvance);
  }

  return { newCount, advanced: toAdvance.length };
}
