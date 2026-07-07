"use client";

import { useState, useTransition } from "react";
import {
  addCadenceRule,
  setCadenceRuleEnabled,
  deleteCadenceRule,
} from "./actions";
import { STAGE_LABEL, type PipelineStage } from "@/lib/pipeline";
import type { CadenceRule } from "@/lib/cadence";

// Stages where "waiting too long" is actionable. Later stages (meetings,
// nurture) get their own treatment in a future phase.
const TRIGGER_STAGES: PipelineStage[] = [
  "identified",
  "researched",
  "drafted",
  "sent",
  "replied",
  "nurture",
];

export function CadenceSection({ rules }: { rules: CadenceRule[] }) {
  const [stage, setStage] = useState<PipelineStage>("sent");
  const [waitDays, setWaitDays] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      const r = await addCadenceRule(stage, waitDays);
      if (r.error) setError(r.error);
    });
  }

  function handleToggle(rule: CadenceRule) {
    setError(null);
    startTransition(async () => {
      const r = await setCadenceRuleEnabled(rule.id, !rule.enabled);
      if (r.error) setError(r.error);
    });
  }

  function handleDelete(rule: CadenceRule) {
    setError(null);
    startTransition(async () => {
      const r = await deleteCadenceRule(rule.id);
      if (r.error) setError(r.error);
    });
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-900">Follow-up rules</h2>
      <p className="mt-1 text-sm text-slate-600">
        When a contact sits in a stage past the wait, they surface in the
        Due follow-ups list on the pipeline. Example: after Sent, wait 5
        days.
      </p>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {rules.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <input
                  id={`rule-${rule.id}`}
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => handleToggle(rule)}
                  disabled={pending}
                  className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-indigo-600"
                />
                <label
                  htmlFor={`rule-${rule.id}`}
                  className={`cursor-pointer text-sm ${rule.enabled ? "text-slate-900" : "text-slate-400 line-through"}`}
                >
                  After{" "}
                  <span className="font-medium">
                    {STAGE_LABEL[rule.trigger_stage]}
                  </span>
                  , wait{" "}
                  <span className="font-medium">
                    {rule.wait_days} day{rule.wait_days === 1 ? "" : "s"}
                  </span>
                </label>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(rule)}
                disabled={pending}
                className="cursor-pointer rounded-md px-2 py-1 text-xs text-slate-400 transition-colors duration-150 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="cadence-stage"
            className="block text-xs font-medium text-slate-500"
          >
            After stage
          </label>
          <select
            id="cadence-stage"
            value={stage}
            onChange={(e) => setStage(e.target.value as PipelineStage)}
            className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {TRIGGER_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="cadence-days"
            className="block text-xs font-medium text-slate-500"
          >
            Wait (days)
          </label>
          <input
            id="cadence-days"
            type="number"
            min={1}
            max={365}
            value={waitDays}
            onChange={(e) => setWaitDays(Number(e.target.value))}
            className="mt-1 w-24 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={pending}
          className="cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : "Add rule"}
        </button>
      </div>
    </section>
  );
}
