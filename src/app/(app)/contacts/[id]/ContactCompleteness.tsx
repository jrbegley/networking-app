"use client";

import { useState, useTransition } from "react";
import { findEmailForContact, findLinkedInForContact } from "./actions";

/**
 * Header chips for missing contact data, each with a one-click fix:
 * email via Apollo person match, LinkedIn via the verified resolver.
 */
export function ContactCompleteness({
  contactId,
  hasEmail,
  hasLinkedin,
}: {
  contactId: string;
  hasEmail: boolean;
  hasLinkedin: boolean;
}) {
  const [findingEmail, startEmail] = useTransition();
  const [findingLinkedin, startLinkedin] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (hasEmail && hasLinkedin) return null;

  function handleFindEmail() {
    setError(null);
    setNotice(null);
    startEmail(async () => {
      const r = await findEmailForContact(contactId);
      if (r.error) setError(r.error);
      else if (r.message) setNotice(r.message);
    });
  }

  function handleFindLinkedin() {
    setError(null);
    setNotice(null);
    startLinkedin(async () => {
      const r = await findLinkedInForContact(contactId);
      if (r.error) setError(r.error);
      else setNotice("LinkedIn profile found and verified.");
    });
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-3">
        {!hasEmail && (
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 py-1 pl-2.5 pr-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
            No email address
            <button
              type="button"
              onClick={handleFindEmail}
              disabled={findingEmail || findingLinkedin}
              className="cursor-pointer rounded-full bg-white px-2 py-0.5 font-medium text-indigo-600 shadow-sm ring-1 ring-slate-200 transition-colors duration-150 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
              title="Apollo lookup — 1 credit unless cached"
            >
              {findingEmail ? "Searching…" : "Find email"}
            </button>
          </span>
        )}
        {!hasLinkedin && (
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 py-1 pl-2.5 pr-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
            No LinkedIn profile
            <button
              type="button"
              onClick={handleFindLinkedin}
              disabled={findingEmail || findingLinkedin}
              className="cursor-pointer rounded-full bg-white px-2 py-0.5 font-medium text-indigo-600 shadow-sm ring-1 ring-slate-200 transition-colors duration-150 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
              title="Searches LinkedIn and verifies the match before saving (~30s)"
            >
              {findingLinkedin ? "Searching…" : "Find LinkedIn"}
            </button>
          </span>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {notice && <p className="mt-2 text-sm text-emerald-700">{notice}</p>}
    </div>
  );
}
