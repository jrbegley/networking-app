"use client";

import { useActionState } from "react";
import {
  enrichWithLinkedin,
  type LinkedInEnrichState,
} from "./actions";

const initialState: LinkedInEnrichState = {
  error: null,
  cached: false,
  message: null,
};

export function LinkedInButton({
  contactId,
  disabled = false,
}: {
  contactId: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    enrichWithLinkedin,
    initialState,
  );

  return (
    <div className="flex flex-col items-end gap-2">
      <form action={formAction}>
        <input type="hidden" name="contactId" value={contactId} />
        <button
          type="submit"
          disabled={disabled || pending}
          className="rounded-md bg-[#0a66c2] px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-[#084d94] focus:outline-none focus:ring-2 focus:ring-[#0a66c2] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Scraping… (10–30s)" : "Pull LinkedIn"}
        </button>
      </form>
      {state.message && (
        <p className="text-xs text-emerald-700">{state.message}</p>
      )}
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </div>
  );
}
