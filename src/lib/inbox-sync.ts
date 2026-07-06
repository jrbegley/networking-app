/**
 * Shared per-contact email sync, used by all three sync paths (contact
 * page button, pipeline sync-all button, daily cron). One implementation
 * so sent-detection and stage advancement behave identically everywhere.
 *
 * What it does for one contact:
 *   1. Logs new INBOUND emails from the contact (Inbox etc.).
 *   2. Logs emails the user actually SENT to the contact (Sent Items).
 *      A pushed Outlook draft only counts once it really goes out.
 *   3. Advances the pipeline stage forward only:
 *        anything before "sent"  → "sent"    when a sent email is found
 *        "sent"                  → "replied" when a new inbound arrives
 *      Later stages (meetings, nurture) are never touched.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMessagesFromSender, fetchSentMessagesTo } from "@/lib/graph";
import { stageOrder, type PipelineStage } from "@/lib/pipeline";

export type SyncContactInput = {
  id: string;
  email: string;
  current_stage: PipelineStage;
};

export type SyncContactOutput = {
  received: number;
  sent: number;
  newStage: PipelineStage | null;
  error: string | null;
};

export async function syncContactEmails(
  db: SupabaseClient,
  ownerId: string,
  contact: SyncContactInput,
): Promise<SyncContactOutput> {
  const none = { received: 0, sent: 0, newStage: null };

  // Existing logged emails for dedupe (and stale-draft reconciliation).
  const { data: existing } = await db
    .from("interactions")
    .select("id, type, subject, outlook_message_id")
    .eq("contact_id", contact.id)
    .in("type", ["email_received", "email_sent"]);

  const receivedIds = new Set(
    (existing ?? [])
      .filter((r) => r.type === "email_received" && r.outlook_message_id)
      .map((r) => r.outlook_message_id as string),
  );
  const sentRows = (existing ?? []).filter((r) => r.type === "email_sent");
  const sentIds = new Set(
    sentRows.map((r) => r.outlook_message_id).filter(Boolean) as string[],
  );

  const [inbound, outbound] = await Promise.all([
    fetchMessagesFromSender(ownerId, contact.email, 90, db),
    fetchSentMessagesTo(ownerId, contact.email, 90, db),
  ]);
  if (inbound.error && outbound.error) {
    return { ...none, error: inbound.error };
  }

  // 1. New inbound emails
  const newInbound = inbound.messages.filter((m) => !receivedIds.has(m.id));
  if (newInbound.length) {
    await db.from("interactions").insert(
      newInbound.map((m) => ({
        owner_id: ownerId,
        contact_id: contact.id,
        type: "email_received",
        subject: m.subject,
        body: m.bodyText,
        outlook_message_id: m.id,
        occurred_at: m.receivedAt,
      })),
    );
  }

  // 2. New sent emails. Legacy rows logged at draft-push time carry the
  // DRAFT's message id (Graph assigns a new id when the message lands in
  // Sent Items), so first try to reconcile by subject: update the stale
  // row in place rather than showing the same email twice in the thread.
  const staleBySubject = new Map<string, string>(); // subject -> interaction row id
  for (const row of sentRows) {
    if (row.subject && (!row.outlook_message_id || !outboundHasId(outbound.messages, row.outlook_message_id))) {
      if (!staleBySubject.has(row.subject)) staleBySubject.set(row.subject, row.id);
    }
  }

  let sentCount = 0;
  for (const m of outbound.messages) {
    if (sentIds.has(m.id)) continue;

    const staleRowId = m.subject ? staleBySubject.get(m.subject) : undefined;
    if (staleRowId) {
      staleBySubject.delete(m.subject!);
      await db
        .from("interactions")
        .update({ outlook_message_id: m.id, occurred_at: m.sentAt })
        .eq("id", staleRowId);
    } else {
      await db.from("interactions").insert({
        owner_id: ownerId,
        contact_id: contact.id,
        type: "email_sent",
        subject: m.subject,
        body: m.bodyText,
        outlook_message_id: m.id,
        occurred_at: m.sentAt,
      });
    }
    sentCount++;
  }

  // 3. Forward-only stage advancement
  let stage: PipelineStage = contact.current_stage;
  if (sentCount > 0 && stageOrder(stage) < stageOrder("sent")) {
    stage = "sent";
  }
  if (newInbound.length > 0 && stage === "sent") {
    stage = "replied";
  }
  const newStage = stage !== contact.current_stage ? stage : null;
  if (newStage) {
    await db
      .from("contacts")
      .update({ current_stage: newStage })
      .eq("id", contact.id);
  }

  return {
    received: newInbound.length,
    sent: sentCount,
    newStage,
    error: null,
  };
}

function outboundHasId(
  messages: Array<{ id: string }>,
  id: string,
): boolean {
  return messages.some((m) => m.id === id);
}
