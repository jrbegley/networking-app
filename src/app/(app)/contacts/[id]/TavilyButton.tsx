"use client";

import { useActionState } from "react";
import { researchWithTavily, type TavilyState } from "./actions";

const initialState: TavilyState = {
  error: null,
  cached: false,
  message: null,
};

export function TavilyButton({ contactId }: { contactId: string }) {
  const [state, formAction, pending] = useActionState(
    researchWithTavily,
    initialState,
  );

  return (
    <div className="flex flex-col items-end gap-2">
      <form action={formAction}>
        <input type="hidden" name="contactId" value={contactId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Searching…" : "Research the web"}
        </button>
      </form>
      {state.message && (
        <p className="text-xs text-emerald-700">{state.message}</p>
      )}
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </div>
  );
}
