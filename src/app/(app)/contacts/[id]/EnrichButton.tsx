"use client";

import { useActionState } from "react";
import { enrichContact, type EnrichState } from "./actions";

const initialState: EnrichState = {
  error: null,
  cached: false,
  message: null,
};

export function EnrichButton({
  contactId,
  disabled = false,
}: {
  contactId: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    enrichContact,
    initialState,
  );

  return (
    <div className="flex flex-col items-end gap-2">
      <form action={formAction}>
        <input type="hidden" name="contactId" value={contactId} />
        <button
          type="submit"
          disabled={disabled || pending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Enriching…" : "Enrich with Apollo"}
        </button>
      </form>
      {state.message && (
        <p className="text-xs text-emerald-700">{state.message}</p>
      )}
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </div>
  );
}
