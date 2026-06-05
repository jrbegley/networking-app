"use client";

import { useState, useTransition, useRef } from "react";
import Link from "next/link";
import { searchApollo, addContactsFromSearch, type SearchResult } from "./actions";

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [filtersUsed, setFiltersUsed] = useState<Record<string, unknown> | null>(null);
  const [showInPipeline, setShowInPipeline] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();
  const lastQuery = useRef("");

  function runSearch(page = 1, show = showInPipeline) {
    if (!query.trim()) return;
    lastQuery.current = query;
    setError(null);
    setStatus(null);
    setSelected(new Set());
    startSearch(async () => {
      const r = await searchApollo(query, page, show);
      if (r.error) {
        setError(r.error);
        return;
      }
      setResults(r.results);
      setTotalEntries(r.totalEntries);
      setTotalPages(r.totalPages);
      setCurrentPage(r.page);
      setFiltersUsed(r.filtersUsed);
    });
  }

  function toggleInPipeline() {
    const next = !showInPipeline;
    setShowInPipeline(next);
    if (lastQuery.current) runSearch(currentPage, next);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const addable = results.filter((r) => !r.inPipeline);
    if (selected.size === addable.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(addable.map((r) => r.id)));
    }
  }

  function handleAddSingle(person: SearchResult) {
    setStatus(null);
    startAdd(async () => {
      const r = await addContactsFromSearch([person]);
      if (r.error) {
        setError(r.error);
      } else {
        setStatus(`Added ${person.name ?? "contact"} to pipeline.`);
        setResults((prev) =>
          prev.map((p) => (p.id === person.id ? { ...p, inPipeline: true } : p)),
        );
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(person.id);
          return next;
        });
      }
    });
  }

  function handleAddSelected() {
    const toAdd = results.filter((r) => selected.has(r.id) && !r.inPipeline);
    if (!toAdd.length) return;
    setStatus(null);
    startAdd(async () => {
      const r = await addContactsFromSearch(toAdd);
      if (r.error) {
        setError(r.error);
      } else {
        const addedIds = new Set(toAdd.map((p) => p.id));
        setStatus(`Added ${r.added} contact${r.added === 1 ? "" : "s"} to pipeline.`);
        setResults((prev) =>
          prev.map((p) => (addedIds.has(p.id) ? { ...p, inPipeline: true } : p)),
        );
        setSelected(new Set());
      }
    });
  }

  const addableSelected = results.filter(
    (r) => selected.has(r.id) && !r.inPipeline,
  ).length;
  const addableAll = results.filter((r) => !r.inPipeline);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Find contacts
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Search Apollo&apos;s database. Describe who you&apos;re looking for in plain English.
          LinkedIn URLs are looked up via Tavily when you add a contact.
        </p>
      </div>

      {/* Search box */}
      <div className="flex gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch(1);
          }}
          placeholder="e.g. VCs at fintech firms who went to UIUC, or consultants in Chicago at mid-size firms"
          className="flex-1 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
        <button
          type="button"
          onClick={() => runSearch(1)}
          disabled={searching || !query.trim()}
          className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
      {status && (
        <p className="text-sm text-emerald-700">{status}</p>
      )}

      {/* Filters used */}
      {filtersUsed && Object.keys(filtersUsed).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Filters applied:</span>
          {Object.entries(filtersUsed).map(([k, v]) => (
            <span
              key={k}
              className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs text-slate-600"
            >
              <span className="font-medium text-slate-400">{k}:</span>&nbsp;
              {Array.isArray(v) ? v.join(", ") : String(v)}
            </span>
          ))}
        </div>
      )}

      {/* Results toolbar */}
      {results.length > 0 && (
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <p className="text-sm text-slate-600">
              {totalEntries.toLocaleString()} results
              {!showInPipeline && " (already-added contacts hidden)"}
            </p>
            <button
              type="button"
              onClick={toggleInPipeline}
              className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800"
            >
              {showInPipeline ? "Hide added" : "Show added"}
            </button>
          </div>

          <div className="flex items-center gap-3">
            {addableSelected > 0 && (
              <button
                type="button"
                onClick={handleAddSelected}
                disabled={adding}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {adding ? "Adding…" : `Add ${addableSelected} selected`}
              </button>
            )}
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              {selected.size === addableAll.length && addableAll.length > 0
                ? "Deselect all"
                : "Select all"}
            </button>
          </div>
        </div>
      )}

      {/* Results list */}
      {results.length > 0 && (
        <div className="overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
          <ul className="divide-y divide-slate-100">
            {results.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                selected={selected.has(person.id)}
                onToggle={() => toggleSelect(person.id)}
                onAdd={() => handleAddSingle(person)}
                adding={adding}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => runSearch(currentPage - 1)}
            disabled={currentPage <= 1 || searching}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-sm text-slate-500">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => runSearch(currentPage + 1)}
            disabled={currentPage >= totalPages || searching}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}

      {searching && results.length === 0 && (
        <div className="py-12 text-center text-sm text-slate-500">
          Translating your query and searching Apollo…
        </div>
      )}
    </div>
  );
}

function PersonRow({
  person,
  selected,
  onToggle,
  onAdd,
  adding,
}: {
  person: SearchResult;
  selected: boolean;
  onToggle: () => void;
  onAdd: () => void;
  adding: boolean;
}) {
  const location = [person.city, person.state, person.country]
    .filter(Boolean)
    .join(", ");

  return (
    <li
      className={`flex items-center gap-4 px-5 py-4 ${
        person.inPipeline ? "opacity-50" : "hover:bg-slate-50"
      }`}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        disabled={person.inPipeline}
        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 disabled:cursor-not-allowed"
      />

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-900">
            {person.name ?? [person.first_name, person.last_name].filter(Boolean).join(" ") ?? "Unknown"}
          </p>
          {person.inPipeline && (
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
              In pipeline
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {[person.title, person.organization?.name].filter(Boolean).join(" · ")}
          {location && (
            <span className="text-slate-400"> · {location}</span>
          )}
        </p>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-3">
        {person.linkedin_url && (
          <a
            href={person.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-400 hover:text-slate-700"
          >
            LinkedIn ↗
          </a>
        )}
        {person.inPipeline ? (
          person.contactId ? (
            <Link
              href={`/contacts/${person.contactId}`}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
            >
              View →
            </Link>
          ) : null
        ) : (
          <button
            type="button"
            onClick={onAdd}
            disabled={adding}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Add
          </button>
        )}
      </div>
    </li>
  );
}
