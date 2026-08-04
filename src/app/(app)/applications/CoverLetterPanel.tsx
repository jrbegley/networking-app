"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  generateCoverLetterForApplication,
  refineCoverLetterContent,
  downloadCoverLetter,
  saveCoverLetter,
} from "./actions";
import type {
  CoverLetterContent,
  LetterClassification,
} from "@/lib/cover-letter-types";

type ChatMessage = { role: "user" | "assistant"; text: string };

// Copy for the reasons that aren't handled by a dedicated UI state
// (no_template and needs_paste get their own branches below).
const ERROR_COPY: Record<string, string> = {
  unreadable_template:
    "Couldn't read this template as a standard letter — check it's a normal cover letter .docx.",
  not_set_up:
    "The cover-letter feature needs its database migration applied. Paste supabase/migrations/009_cover_letters.sql into the Supabase SQL editor and run it, then try again.",
};

export function CoverLetterPanel({
  applicationId,
  hasTemplate,
  onClose,
}: {
  applicationId: string;
  hasTemplate: boolean;
  onClose: () => void;
}) {
  const [content, setContent] = useState<CoverLetterContent | null>(null);
  const [classification, setClassification] =
    useState<LetterClassification | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedJd, setPastedJd] = useState("");
  const [noTemplate, setNoTemplate] = useState(false);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const startedRef = useRef(false);

  function runGenerate(jd?: string) {
    setErrorReason(null);
    setNoTemplate(false);
    setPasteMode(false);
    setSaved(false);
    setContent(null);
    setClassification(null);
    startTransition(async () => {
      const res = await generateCoverLetterForApplication(applicationId, jd);
      if (res.ok) {
        setContent(res.content);
        setClassification(res.classification);
        setPasteMode(false);
        setMessages([]);
      } else if (res.reason === "needs_paste") {
        setPasteMode(true);
      } else if (res.reason === "no_template") {
        setNoTemplate(true);
      } else {
        setErrorReason(res.reason);
      }
    });
  }

  // Kick off generation the moment the panel opens, so there's no extra
  // click for the common case (template already uploaded).
  useEffect(() => {
    if (startedRef.current || !hasTemplate) return;
    startedRef.current = true;
    runGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleParse() {
    if (!pastedJd.trim()) return;
    runGenerate(pastedJd);
  }

  function handleSend() {
    const trimmed = chatInput.trim();
    if (!trimmed || !content) return;
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setChatInput("");
    setErrorReason(null);
    startTransition(async () => {
      const res = await refineCoverLetterContent(
        applicationId,
        content,
        trimmed,
      );
      if (res.ok) {
        setContent(res.content);
        setSaved(false);
        setMessages((m) => [
          ...m,
          { role: "assistant", text: "Updated the letter." },
        ]);
      } else {
        setErrorReason(res.reason);
        setMessages((m) => [
          ...m,
          { role: "assistant", text: "Couldn't apply that — try again." },
        ]);
      }
    });
  }

  function handleDownload() {
    if (!content || !classification) return;
    setErrorReason(null);
    startTransition(async () => {
      const res = await downloadCoverLetter(
        applicationId,
        content,
        classification,
      );
      if (!res.ok) {
        setErrorReason(res.reason);
        return;
      }
      const bytes = Uint8Array.from(atob(res.base64), (c) =>
        c.charCodeAt(0),
      );
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function handleSave() {
    if (!content || !classification) return;
    setErrorReason(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveCoverLetter(applicationId, content, classification);
      if (res.ok) setSaved(true);
      else setErrorReason(res.reason);
    });
  }

  return (
    <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50/30 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Cover letter
        </h3>
        <div className="flex items-center gap-3">
          {content && (
            <button
              type="button"
              onClick={() => runGenerate()}
              disabled={pending}
              className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              Regenerate
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close cover letter panel"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* No template on file (uploaded then removed, or race with the
          drawer's own hasTemplate check). */}
      {noTemplate && (
        <p className="mt-3 text-sm text-slate-600">
          No cover-letter template on file.{" "}
          <Link href="/settings" className="font-medium text-indigo-600 hover:underline">
            Upload one in Settings
          </Link>{" "}
          to generate letters.
        </p>
      )}

      {/* Job description couldn't be re-fetched — paste fallback. */}
      {!noTemplate && pasteMode && (
        <div className="mt-3">
          <label
            htmlFor={`jd-paste-${applicationId}`}
            className="block text-sm font-medium text-slate-700"
          >
            Paste the job description
          </label>
          <p className="mt-0.5 text-xs text-slate-400">
            Couldn&rsquo;t read the posting page — paste the job description
            and we&rsquo;ll write the letter from that.
          </p>
          <textarea
            id={`jd-paste-${applicationId}`}
            value={pastedJd}
            onChange={(e) => setPastedJd(e.target.value)}
            rows={5}
            placeholder="Paste the full job description here…"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="mt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setPasteMode(false);
                setPastedJd("");
              }}
              className="cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleParse}
              disabled={pending || !pastedJd.trim()}
              className="shrink-0 cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Generating…" : "Generate"}
            </button>
          </div>
        </div>
      )}

      {/* Generic / unreadable_template / not_set_up errors. */}
      {!noTemplate && !pasteMode && errorReason && !content && (
        <div className="mt-3">
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
            {ERROR_COPY[errorReason] ?? errorReason}
          </p>
          <button
            type="button"
            onClick={() => runGenerate()}
            disabled={pending}
            className="mt-2 cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Generating…" : "Try again"}
          </button>
        </div>
      )}

      {/* Loading state before any content exists. */}
      {!noTemplate && !pasteMode && !errorReason && !content && (
        <p className="mt-3 text-sm text-slate-500">
          {pending ? "Generating cover letter…" : "Starting…"}
        </p>
      )}

      {/* Loaded content: preview + chat + actions. */}
      {content && (
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-slate-500">
              Text preview — formatting is applied in the downloaded .docx
            </p>
            <div className="mt-1.5 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-800">
              {content.date && <p>{content.date}</p>}
              {content.recipient.length > 0 && (
                <p className="mt-2">
                  {content.recipient.map((line, i) => (
                    <span key={i}>
                      {line}
                      <br />
                    </span>
                  ))}
                </p>
              )}
              {content.salutation && (
                <p className="mt-2">{content.salutation}</p>
              )}
              {content.body.map((para, i) => (
                <p key={i} className="mt-2">
                  {para}
                </p>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleDownload}
                disabled={pending}
                className="cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Download .docx
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={pending}
                className="cursor-pointer rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm transition-colors duration-150 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save to application
              </button>
              {saved && (
                <span className="text-sm font-medium text-emerald-600">
                  ✓ Saved to application
                </span>
              )}
            </div>
            {errorReason && (
              <p className="mt-2 text-sm text-red-600">
                {ERROR_COPY[errorReason] ?? errorReason}
              </p>
            )}
          </div>

          {/* Chat */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Refine by chat
            </h4>
            <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">
              {messages.length === 0 ? (
                <p className="text-sm text-slate-400">
                  Ask for a change — e.g. &ldquo;tighten paragraph 2&rdquo; or
                  &ldquo;mention my internship at Acme.&rdquo;
                </p>
              ) : (
                messages.map((m, i) => (
                  <p
                    key={i}
                    className={`rounded-md px-3 py-1.5 text-sm ${
                      m.role === "user"
                        ? "bg-indigo-100 text-indigo-900"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {m.text}
                  </p>
                ))
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Describe the change…"
                disabled={pending}
                className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={pending || !chatInput.trim()}
                className="cursor-pointer rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
