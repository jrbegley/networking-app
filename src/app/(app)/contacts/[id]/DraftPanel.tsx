"use client";

import { useState } from "react";
import {
  generateDraftForContact,
  refineDraftForContact,
  saveDraftForContact,
  sendToOutlookDrafts,
} from "./actions";
import type { Draft } from "@/lib/claude";

type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
};

type Status = { kind: "success" | "error" | "info"; text: string } | null;

export function DraftPanel({
  contactId,
  hasResearch,
  initialSubject,
  initialBody,
  outlookConnected,
  hasEmail,
}: {
  contactId: string;
  hasResearch: boolean;
  initialSubject: string;
  initialBody: string;
  outlookConnected: boolean;
  hasEmail: boolean;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);

  // Last persisted version, for the dirty indicator.
  const [savedSubject, setSavedSubject] = useState(initialSubject);
  const [savedBody, setSavedBody] = useState(initialBody);

  const [instruction, setInstruction] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  const [usage, setUsage] = useState<Usage | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState<null | "generate" | "refine" | "save" | "outlook">(null);
  const [outlookLink, setOutlookLink] = useState<string | null>(null);

  const hasDraft = body.trim().length > 0;
  const dirty = subject !== savedSubject || body !== savedBody;

  function applyDraft(d: Draft) {
    // Generate and refine both persist server-side, so the new draft IS the
    // saved snapshot — not dirty.
    setSubject(d.subject);
    setBody(d.body);
    setSavedSubject(d.subject);
    setSavedBody(d.body);
    setUsage({
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      cacheReadTokens: d.cacheReadTokens,
    });
  }

  async function handleGenerate() {
    setBusy("generate");
    setStatus(null);
    try {
      const r = await generateDraftForContact(contactId);
      if (r.error || !r.draft) {
        setStatus({ kind: "error", text: r.error ?? "Couldn't draft." });
        return;
      }
      applyDraft(r.draft);
      setStatus({ kind: "success", text: "Draft generated and saved." });
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    setBusy("save");
    setStatus(null);
    try {
      const r = await saveDraftForContact(contactId, subject, body);
      if (r.error) {
        setStatus({ kind: "error", text: r.error });
        return;
      }
      setSavedSubject(subject);
      setSavedBody(body);
      setStatus({ kind: "success", text: "Saved." });
    } finally {
      setBusy(null);
    }
  }

  async function handleRefine() {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    setBusy("refine");
    setStatus(null);
    try {
      const r = await refineDraftForContact(contactId, trimmed, subject, body);
      if (r.error || !r.draft) {
        setStatus({ kind: "error", text: r.error ?? "Couldn't revise." });
        return;
      }
      applyDraft(r.draft);
      setHistory((h) => [...h, trimmed]);
      setInstruction("");
      setStatus({ kind: "success", text: "Revised by Claude." });
    } finally {
      setBusy(null);
    }
  }

  async function handleOutlook() {
    if (!subject.trim() && !body.trim()) return;
    setBusy("outlook");
    setStatus(null);
    try {
      const r = await sendToOutlookDrafts(contactId, subject, body);
      if (r.error) {
        setStatus({ kind: "error", text: r.error });
        return;
      }
      setOutlookLink(r.webLink);
      setStatus({ kind: "success", text: "Saved to Outlook Drafts." });
    } finally {
      setBusy(null);
    }
  }

  function handleCopy() {
    navigator.clipboard
      .writeText(`Subject: ${subject}\n\n${body}`)
      .then(() => setStatus({ kind: "success", text: "Copied to clipboard." }))
      .catch(() => setStatus({ kind: "error", text: "Couldn't copy." }));
  }

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
        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy !== null}
          className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "generate"
            ? "Drafting…"
            : hasDraft
              ? "Redraft from scratch"
              : "Draft with Claude"}
        </button>
      </div>

      {status && (
        <p
          className={`mt-3 text-sm ${
            status.kind === "success"
              ? "text-emerald-700"
              : status.kind === "error"
                ? "text-red-600"
                : "text-slate-500"
          }`}
        >
          {status.text}
        </p>
      )}

      {hasDraft && (
        <div className="mt-5 space-y-4">
          {/* Editable subject */}
          <div>
            <label
              htmlFor="draft_subject"
              className="block text-xs uppercase tracking-wide text-slate-500"
            >
              Subject
            </label>
            <input
              id="draft_subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Editable body */}
          <div>
            <label
              htmlFor="draft_body"
              className="block text-xs uppercase tracking-wide text-slate-500"
            >
              Body
            </label>
            <textarea
              id="draft_body"
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-sans text-sm leading-relaxed text-slate-900 shadow-sm focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Action row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={busy !== null || !dirty}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
              </button>
              <button
                type="button"
                onClick={handleCopy}
                disabled={busy !== null}
                className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
              >
                Copy
              </button>
              {outlookConnected ? (
                <button
                  type="button"
                  onClick={handleOutlook}
                  disabled={busy !== null || !hasEmail}
                  title={
                    hasEmail
                      ? undefined
                      : "This contact has no email address yet — use Find email in the header."
                  }
                  className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === "outlook"
                    ? "Sending…"
                    : hasEmail
                      ? "→ Outlook Drafts"
                      : "No email yet"}
                </button>
              ) : (
                <a
                  href="/settings"
                  className="rounded-md px-3 py-1.5 text-sm text-slate-400 hover:text-slate-600"
                >
                  Connect Outlook to send
                </a>
              )}
              {outlookLink && (
                <a
                  href={outlookLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline"
                >
                  Open in Outlook ↗
                </a>
              )}
              {dirty && (
                <span className="text-xs text-amber-600">Unsaved changes</span>
              )}
            </div>
            {usage && (
              <span className="text-xs text-slate-400">
                {usage.inputTokens} in · {usage.outputTokens} out
                {usage.cacheReadTokens > 0 && (
                  <> · {usage.cacheReadTokens} cached</>
                )}
              </span>
            )}
          </div>

          {/* Refine with Claude */}
          <div className="rounded-md border border-slate-200 bg-slate-50/60 p-4">
            <p className="text-sm font-medium text-slate-900">
              Refine with Claude
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Tell Claude what to change. It revises the email above using the
              same rules. Edits you made by hand are included.
            </p>

            {history.length > 0 && (
              <ul className="mt-3 space-y-1">
                {history.map((h, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-xs text-slate-600"
                  >
                    <span className="select-none text-slate-400">↳</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleRefine();
                  }
                }}
                placeholder="e.g. make it shorter, or mention our shared class"
                disabled={busy !== null}
                className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleRefine}
                disabled={busy !== null || !instruction.trim()}
                className="shrink-0 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "refine" ? "Revising…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
