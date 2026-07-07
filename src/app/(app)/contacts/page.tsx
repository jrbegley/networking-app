import { createClient } from "@/lib/supabase/server";
import { PipelineView, type ContactRow } from "./PipelineView";
import type { PipelineStage } from "@/lib/pipeline";
import { computeDueFollowUps, type CadenceRule } from "@/lib/cadence";

const CONTACT_FIELDS =
  "id, name, title, email, linkedin_url, current_stage, company:companies(id, name, industry)";

export default async function ContactsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("outlook_access_token")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };
  const outlookConnected = !!(profile?.outlook_access_token);

  // stage_changed_at arrives with migration 007. Until it's applied, fall
  // back to a query without it — aging and due-follow-ups stay hidden
  // rather than breaking the page.
  let rows: Record<string, unknown>[] | null = null;
  let loadError: string | null = null;
  let hasStageTiming = true;

  const first = await supabase
    .from("contacts")
    .select(`${CONTACT_FIELDS}, stage_changed_at`)
    .order("current_stage")
    .order("name");

  if (first.error && /stage_changed_at/i.test(first.error.message)) {
    hasStageTiming = false;
    const second = await supabase
      .from("contacts")
      .select(CONTACT_FIELDS)
      .order("current_stage")
      .order("name");
    rows = (second.data as Record<string, unknown>[] | null) ?? null;
    loadError = second.error?.message ?? null;
  } else {
    rows = (first.data as Record<string, unknown>[] | null) ?? null;
    loadError = first.error?.message ?? null;
  }

  if (loadError) {
    return (
      <div className="rounded-md bg-red-50 p-4 ring-1 ring-red-200">
        <p className="text-sm text-red-900">
          Couldn&apos;t load contacts: {loadError}
        </p>
      </div>
    );
  }

  const contacts: ContactRow[] = (rows ?? []).map((c) => {
    const co = Array.isArray(c.company) ? (c.company[0] ?? null) : c.company;
    return {
      id: c.id as string,
      name: c.name as string,
      title: c.title as string | null,
      email: c.email as string | null,
      linkedin_url: c.linkedin_url as string | null,
      current_stage: c.current_stage as PipelineStage,
      stage_changed_at: hasStageTiming
        ? ((c as Record<string, unknown>).stage_changed_at as string | null)
        : null,
      company: co
        ? {
            id: (co as { id: string; name: string; industry: string | null }).id,
            name: (co as { id: string; name: string; industry: string | null }).name,
            industry: (co as { id: string; name: string; industry: string | null }).industry,
          }
        : null,
    };
  });

  const { data: ruleRows } = await supabase
    .from("cadence_rules")
    .select("id, name, trigger_stage, wait_days, enabled");
  const rules = (ruleRows ?? []) as CadenceRule[];

  const dueFollowUps = computeDueFollowUps(contacts, rules);

  return (
    <PipelineView
      contacts={contacts}
      outlookConnected={outlookConnected}
      dueFollowUps={dueFollowUps}
      hasCadenceRules={rules.some((r) => r.enabled)}
      hasStageTiming={hasStageTiming}
    />
  );
}
