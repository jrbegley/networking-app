import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncContactEmails, type SyncContactInput } from "@/lib/inbox-sync";

// Vercel calls this route on the cron schedule defined in vercel.json.
// Protected by CRON_SECRET so only Vercel (and you) can trigger it.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Service role: this route runs outside of a user session, so the
  // cookie-scoped client would see zero rows under RLS. Bypassing RLS
  // here is intentional — access is gated by CRON_SECRET above.
  const supabase = createServiceClient();

  // Get all users who have Outlook connected
  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id")
    .not("outlook_access_token", "is", null);

  if (profilesErr) {
    console.error("Cron: failed to load profiles", profilesErr);
    return NextResponse.json({ error: profilesErr.message }, { status: 500 });
  }

  let totalReceived = 0;
  let totalSent = 0;
  let totalAdvanced = 0;

  for (const profile of profiles ?? []) {
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, email, current_stage")
      .eq("owner_id", profile.id)
      .not("email", "is", null);

    for (const contact of (contacts ?? []) as SyncContactInput[]) {
      try {
        const r = await syncContactEmails(supabase, profile.id, contact);
        totalReceived += r.received;
        totalSent += r.sent;
        if (r.newStage) totalAdvanced++;
      } catch (e) {
        console.error(`Cron: error syncing contact ${contact.id}:`, e);
      }
    }
  }

  console.log(
    `Cron sync-inbox: ${totalReceived} received, ${totalSent} sent, ${totalAdvanced} contacts advanced`,
  );
  return NextResponse.json({
    ok: true,
    newEmails: totalReceived,
    sentEmails: totalSent,
    advanced: totalAdvanced,
  });
}
