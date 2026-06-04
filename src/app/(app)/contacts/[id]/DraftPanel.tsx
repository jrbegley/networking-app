"use client";

import { useActionState } from "react";
import { draftEmail, type DraftState } from "./actions";

const initialState: DraftState = { error: null, draft: null };

export function DraftPanel({
  contactId,
  hasResearch,
}: {
  contactId: string;
  hasResearch: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    draftEmail,
    initialState,
  );

  const draft = state.draft;

  return (
    <section className="rounded-lg bg-white p-6 ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Draft outreach
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {hasResearch
              ? "Uses your latest research as context."
              : "Will draft from contact basics. Enrich first for a stronger draft."}
          </p>
        </div>
        <form action={formAction}>
          <input type="hidden" name="contactId" value={contactId} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Drafting…" : draft ? "Redraft" : "Draft with Claude"}
          </button>
        </form>
      </div>

      {state.error && (
        <p className="mt-3 text-sm text-red-600">{state.error}</p>
      )}

      {draft && (
        <div className="mt-5 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Subject
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {draft.subject}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Body
            </p>
            <pre className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-4 font-sans text-sm text-slate-900 ring-1 ring-slate-200">
              {draft.body}
            </pre>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              {draft.inputTokens} in · {draft.outputTokens} out
              {draft.cacheReadTokens > 0 && (
                <> · {draft.cacheReadTokens} cache hit</>
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  .writeText(`Subject: ${draft.subject}\n\n${draft.body}`)
                  .catch(() => {});
              }}
              className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              Copy to clipboard
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
