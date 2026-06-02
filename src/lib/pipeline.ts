/**
 * Shared pipeline-stage metadata, used by list/dashboard/detail views.
 * Single source of truth for stage order, labels, and badge colors.
 */

export const PIPELINE_STAGES = [
  "identified",
  "researched",
  "drafted",
  "sent",
  "replied",
  "meeting_scheduled",
  "meeting_held",
  "nurture",
  "dormant",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABEL: Record<PipelineStage, string> = {
  identified: "Identified",
  researched: "Researched",
  drafted: "Drafted",
  sent: "Sent",
  replied: "Replied",
  meeting_scheduled: "Meeting scheduled",
  meeting_held: "Meeting held",
  nurture: "Nurture",
  dormant: "Dormant",
};

/**
 * Tailwind class string for each stage's badge.
 * Progression of color tracks "warmth" of the conversation:
 * - cool tones early (slate/blue) when nothing's happened yet
 * - amber when awaiting reply (slight urgency)
 * - emerald when they replied (success)
 * - violet/purple for meetings (an event)
 * - teal for ongoing nurture
 * - zinc dim for dormant
 */
export const STAGE_BADGE_CLASS: Record<PipelineStage, string> = {
  identified: "bg-slate-100 text-slate-700 ring-slate-200",
  researched: "bg-blue-100 text-blue-800 ring-blue-200",
  drafted: "bg-indigo-100 text-indigo-800 ring-indigo-200",
  sent: "bg-amber-100 text-amber-800 ring-amber-200",
  replied: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  meeting_scheduled: "bg-violet-100 text-violet-800 ring-violet-200",
  meeting_held: "bg-purple-100 text-purple-800 ring-purple-200",
  nurture: "bg-teal-100 text-teal-800 ring-teal-200",
  dormant: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};

export function stageOrder(stage: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(stage);
}
