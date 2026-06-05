"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchMessagesFromSender } from "@/lib/graph";
import { revalidatePath } from "next/cache";

export type GlobalSyncResult = {
  error: string | null;
  newCount: number;
  contactsChecked: number;
};

/**
 * Sync inbound emails for ALL contacts that have an email address.
 * Runs sequentially to avoid hammering Graph — at 10-20 contacts this
 * completes in a few seconds.
 */
export async function syncAllInboxes(): Promise<GlobalSyncResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", newCount: 0, contactsChecked: 0 };

  // Only contacts that have an email address
  const { data: contacts, error: contactsErr } = await supabase
    .from("contacts")
    .select("id, email, current_stage")
    .not("email", "is", null);

  if (contactsErr) return { error: contactsErr.message, newCount: 0, contactsChecked: 0 };
  if (!contacts?.length) return { error: null, newCount: 0, contactsChecked: 0 };

  // Load all existing received message IDs in one query
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

  let totalNew = 0;
  const toAdvance: string[] = [];

  for (const contact of contacts) {
    const { messages, error } = await fetchMessagesFromSender(user.id, contact.email!);
    if (error || !messages.length) continue;

    const seen = seenByContact.get(contact.id) ?? new Set();
    const newMessages = messages.filter((m) => !seen.has(m.id));
    if (!newMessages.length) continue;

    await supabase.from("interactions").insert(
      newMessages.map((m) => ({
        owner_id: user.id,
        contact_id: contact.id,
        type: "email_received",
        subject: m.subject,
        body: m.bodyText,
        outlook_message_id: m.id,
        occurred_at: m.receivedAt,
      })),
    );

    totalNew += newMessages.length;
    if (contact.current_stage === "sent") toAdvance.push(contact.id);
  }

  if (toAdvance.length > 0) {
    await supabase
      .from("contacts")
      .update({ current_stage: "replied" })
      .in("id", toAdvance);
  }

  revalidatePath("/contacts");

  return { error: null, newCount: totalNew, contactsChecked: contacts.length };
}
