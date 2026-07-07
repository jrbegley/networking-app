/**
 * Cadence rules → due follow-ups, computed live at page load.
 *
 * A rule is "after stage X, wait N days". A contact is due when it has sat
 * in a rule's trigger stage for at least N days. No queue: with tens of
 * contacts, deriving this on read is simpler and can't drift out of sync.
 * (scheduled_actions exists in the schema for when volume demands a queue.)
 */

import { daysInStage, type PipelineStage, STAGE_LABEL } from "@/lib/pipeline";

export type CadenceRule = {
  id: string;
  name: string;
  trigger_stage: PipelineStage;
  wait_days: number;
  enabled: boolean;
};

export type DueFollowUp = {
  contactId: string;
  contactName: string;
  companyName: string | null;
  stage: PipelineStage;
  stageLabel: string;
  daysWaiting: number;
  waitDays: number;
};

export function computeDueFollowUps(
  contacts: Array<{
    id: string;
    name: string;
    current_stage: PipelineStage;
    stage_changed_at: string | null;
    company: { name: string } | null;
  }>,
  rules: CadenceRule[],
): DueFollowUp[] {
  const active = rules.filter((r) => r.enabled);
  if (!active.length) return [];

  // Shortest wait wins when multiple rules share a trigger stage.
  const waitByStage = new Map<PipelineStage, number>();
  for (const r of active) {
    const current = waitByStage.get(r.trigger_stage);
    if (current === undefined || r.wait_days < current) {
      waitByStage.set(r.trigger_stage, r.wait_days);
    }
  }

  const due: DueFollowUp[] = [];
  for (const c of contacts) {
    const wait = waitByStage.get(c.current_stage);
    if (wait === undefined) continue;
    const days = daysInStage(c.stage_changed_at);
    if (days === null || days < wait) continue;
    due.push({
      contactId: c.id,
      contactName: c.name,
      companyName: c.company?.name ?? null,
      stage: c.current_stage,
      stageLabel: STAGE_LABEL[c.current_stage],
      daysWaiting: days,
      waitDays: wait,
    });
  }

  // Most overdue first
  due.sort((a, b) => b.daysWaiting - b.waitDays - (a.daysWaiting - a.waitDays));
  return due;
}
