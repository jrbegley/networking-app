"use server";

import { createClient } from "@/lib/supabase/server";
import { syncContactEmails, type SyncContactInput } from "@/lib/inbox-sync";
import { revalidatePath } from "next/cache";

export type GlobalSyncResult = {
  error: string | null;
  newCount: number;
  sentCount: number;
  advanced: number;
  contactsChecked: number;
};

/**
 * Sync sent + received emails for ALL contacts that have an email address.
 * Runs sequentially to avoid hammering Graph — at 10-20 contacts this
 * completes in a few seconds.
 */
export async function syncAllInboxes(): Promise<GlobalSyncResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in.", newCount: 0, sentCount: 0, advanced: 0, contactsChecked: 0 };
  }

  // Only contacts that have an email address
  const { data: contacts, error: contactsErr } = await supabase
    .from("contacts")
    .select("id, email, current_stage")
    .not("email", "is", null);

  if (contactsErr) {
    return { error: contactsErr.message, newCount: 0, sentCount: 0, advanced: 0, contactsChecked: 0 };
  }
  if (!contacts?.length) {
    return { error: null, newCount: 0, sentCount: 0, advanced: 0, contactsChecked: 0 };
  }

  let totalReceived = 0;
  let totalSent = 0;
  let advanced = 0;

  for (const contact of contacts as SyncContactInput[]) {
    const r = await syncContactEmails(supabase, user.id, contact);
    totalReceived += r.received;
    totalSent += r.sent;
    if (r.newStage) advanced++;
  }

  revalidatePath("/contacts");

  return {
    error: null,
    newCount: totalReceived,
    sentCount: totalSent,
    advanced,
    contactsChecked: contacts.length,
  };
}
