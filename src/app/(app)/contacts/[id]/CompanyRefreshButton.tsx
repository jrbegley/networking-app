"use client";

import { useState, useTransition } from "react";
import { enrichCompanyDetails } from "./actions";

export function CompanyRefreshButton({ contactId }: { contactId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error: string | null; message: string | null } | null>(null);

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      setResult(await enrichCompanyDetails(contactId));
    });
  }

  return (
    <div className="flex items-center gap-3">
      {result?.error && (
        <span className="text-xs text-red-600">{result.error}</span>
      )}
      {result?.message && (
        <span className="text-xs text-emerald-700">{result.message}</span>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="cursor-pointer rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors duration-150 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Fetching…" : "Fill in from Apollo"}
      </button>
    </div>
  );
}
