"use client";

import { useActionState } from "react";
import { saveResearchNotes, type ResearchNotesState } from "./actions";

const initialState: ResearchNotesState = { error: null, saved: false };

export function ResearchNotes({
  contactId,
  initial,
}: {
  contactId: string;
  initial: string;
}) {
  const [state, formAction, pending] = useActionState(
    saveResearchNotes,
    initialState,
  );

  return (
    <form action={formAction} className="mt-6 space-y-2">
      <input type="hidden" name="contactId" value={contactId} />
      <div className="flex items-baseline justify-between">
        <label
          htmlFor="research_notes"
          className="text-sm font-medium text-slate-900"
        >
          Your research notes
        </label>
        <span className="text-xs text-slate-500">
          Goes into the draft prompt as authoritative.
        </span>
      </div>
      <p className="text-xs text-slate-500">
        Add anything Apollo / web search missed: mutual connections, podcast
        or article you saw, a project they shipped, why you&apos;re reaching
        out specifically. Claude treats this as first-hand truth.
      </p>
      <textarea
        id="research_notes"
        name="research_notes"
        rows={6}
        defaultValue={initial}
        placeholder="Saw their post about migrating from Postgres to ClickHouse on Hacker News. Mutual connection: my advisor Prof. Smith was on their PhD committee."
        className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <div className="flex items-center justify-between">
        {state.saved && (
          <p className="text-xs text-emerald-700">Saved.</p>
        )}
        {state.error && (
          <p className="text-xs text-red-600">{state.error}</p>
        )}
        {!state.saved && !state.error && <span />}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save notes"}
        </button>
      </div>
    </form>
  );
}
