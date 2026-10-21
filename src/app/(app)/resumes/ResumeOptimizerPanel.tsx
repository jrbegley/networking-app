"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  optimizeResumeForApplication,
  refineResumeRewrites,
  recompileResume,
  saveTailoredResume,
  type OptimizeResult,
} from "./actions";
import type { Change, Keyword, OptimizerResult } from "@/lib/resume-optimizer-types";
import { coverage } from "@/lib/latex-resume";
import { resumeFilename } from "@/lib/resume-filename";
import { ResumeCompareModal } from "./ResumeCompareModal";

type ChatEdit = { id: string; label: string; before: string; after: string };
type ChatRejected = { id: string; label: string; reason: string };
type ChatMessage = { role: "user" | "assistant"; text: string; edits?: ChatEdit[]; rejected?: ChatRejected[] };

const ERROR_COPY: Record<string, string> = {
  refine_unparsed: "The model didn't return usable edits for that request, so nothing changed. Try rephrasing it.",
  resume_changed: "Your LaTeX resume changed in Settings since this run. Click Regenerate to tailor the new version.",
  no_segments: "Couldn't find rewritable bullets in this resume. Check that your experience/project bullets are plain \\item or \\resumeItem{...} text.",
  not_set_up: "The resume optimizer needs its database migration applied. Paste supabase/migrations/010_resume_optimizer.sql into the Supabase SQL editor and run it, then try again.",
};

const DROPPED_COPY: Record<string, string> = {
  dropped_number: "a number changed",
  new_command: "new LaTeX command",
  unbalanced_braces: "unbalanced braces",
  structure: "structural LaTeX added",
  blank_line: "blank line added",
  length: "length drifted >15%",
  empty: "empty rewrite",
};

export function downloadBlob(bytes: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download in Safari/Firefox.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function effectiveText(c: Change): string {
  return c.accepted && c.rewrite ? c.rewrite.text : c.segment.text;
}

/** What a chat refinement actually changed, bullet by bullet. */
function diffChanges(prev: Change[], next: Change[]): { edits: ChatEdit[]; rejected: ChatRejected[] } {
  const before = new Map(prev.map((c) => [c.segment.id, c]));
  const edits: ChatEdit[] = [];
  const rejected: ChatRejected[] = [];
  for (const c of next) {
    const old = before.get(c.segment.id);
    if (!old) continue;
    const label = `${c.segment.section}${c.segment.entry ? ` › ${c.segment.entry}` : ""}`;
    const was = effectiveText(old);
    const now = effectiveText(c);
    if (was !== now) edits.push({ id: c.segment.id, label, before: was, after: now });
    if (c.droppedReason && (c.droppedReason !== old.droppedReason || old.rewrite)) {
      rejected.push({ id: c.segment.id, label, reason: DROPPED_COPY[c.droppedReason] ?? c.droppedReason });
    }
  }
  return { edits, rejected };
}

/** Highlight the keywords a rewrite names, case-insensitively. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        terms.some((t) => t.toLowerCase() === p.toLowerCase())
          ? <mark key={i} className="rounded bg-sky-100 px-0.5 text-sky-900">{p}</mark>
          : <span key={i}>{p}</span>,
      )}
    </>
  );
}

export function KeywordChips({ keywords, changes }: { keywords: Keyword[]; changes: Change[] }) {
  const incorporated = new Set<string>();
  for (const c of changes) if (c.accepted && c.rewrite) for (const k of c.rewrite.keywords) incorporated.add(k.toLowerCase());
  const cls = (k: Keyword) =>
    k.present ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : incorporated.has(k.term.toLowerCase()) ? "bg-sky-50 text-sky-800 ring-sky-200"
        : "bg-slate-100 text-slate-500 ring-slate-200";
  const cov = coverage(keywords, changes);
  return (
    <div>
      <p className="text-xs text-slate-500">
        <span className="font-medium text-emerald-700">{cov.matched} matched</span> ·{" "}
        <span className="font-medium text-sky-700">{cov.incorporated} incorporated</span> ·{" "}
        <span className="font-medium text-slate-500">{cov.missing} missing</span> of {cov.total}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {keywords.map((k) => (
          <span key={k.term} title={`${k.category} · weight ${k.weight}`} className={`rounded-full px-2 py-0.5 text-xs ring-1 ${cls(k)}`}>
            {k.term}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ChangeCards({
  changes, onToggle,
}: { changes: Change[]; onToggle?: (id: string) => void }) {
  const changed = changes.filter((c) => c.rewrite || c.droppedReason);
  const unchanged = changes.length - changed.length;
  return (
    <div className="space-y-2">
      {changed.map((c) => (
        <div key={c.segment.id} className={`rounded-md border bg-white p-3 text-sm ${c.accepted && c.rewrite ? "border-sky-200" : "border-slate-200"}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-medium text-slate-500">
              {c.segment.section}{c.segment.entry ? ` › ${c.segment.entry}` : ""}
            </p>
            {c.rewrite && onToggle && (
              <button type="button" onClick={() => onToggle(c.segment.id)} className="shrink-0 cursor-pointer text-xs font-medium text-indigo-600 hover:underline">
                {c.accepted ? "Revert" : "Restore"}
              </button>
            )}
          </div>
          <p className={`mt-1 font-mono text-xs ${c.rewrite && c.accepted ? "text-slate-400 line-through" : "text-slate-800"}`}>{c.segment.text}</p>
          {c.rewrite && (
            <p className={`mt-1 font-mono text-xs ${c.accepted ? "text-slate-900" : "text-slate-400"}`}>
              <Highlighted text={c.rewrite.text} terms={c.rewrite.keywords} />
            </p>
          )}
          {c.droppedReason && (
            <p className="mt-1 text-xs text-amber-700">kept original (validation: {DROPPED_COPY[c.droppedReason] ?? c.droppedReason})</p>
          )}
        </div>
      ))}
      {unchanged > 0 && <p className="text-xs text-slate-400">{unchanged} bullet{unchanged === 1 ? "" : "s"} unchanged</p>}
    </div>
  );
}

export function ResumeOptimizerPanel({
  applicationId, companyName, roleTitle, pastedJd, onDone,
}: {
  applicationId: string;
  companyName: string;
  roleTitle: string;
  pastedJd?: string;
  onDone: (saved: boolean) => void;
}) {
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [compileLog, setCompileLog] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [lastPastedJd, setLastPastedJd] = useState<string | undefined>(pastedJd);
  const [noResumeTex, setNoResumeTex] = useState(false);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [pending, startTransition] = useTransition();
  const startedRef = useRef(false);
  const recompileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped whenever a newer action supersedes an in-flight recompile, so a
  // late response can't overwrite newer toggles. `dirty` = toggled but the
  // PDF/.tex on screen haven't caught up yet.
  const seqRef = useRef(0);
  const [dirty, setDirty] = useState(false);

  function supersedeRecompile() {
    seqRef.current++;
    if (recompileTimer.current) clearTimeout(recompileTimer.current);
    setDirty(false);
  }

  function applyResult(res: OptimizeResult) {
    if (res.ok) {
      setResult(res.result);
      setPdfBase64(res.pdfBase64);
      setCompileLog(res.compileLog);
      setDisplayName(res.displayName);
      setSaved(false);
    } else if (res.reason === "needs_paste") {
      setPasteMode(true);
    } else if (res.reason === "no_resume_tex") {
      setNoResumeTex(true);
    } else {
      setErrorReason(res.reason);
    }
  }

  function runOptimize(jd?: string) {
    supersedeRecompile();
    setErrorReason(null);
    setNoResumeTex(false);
    setPasteMode(false);
    setResult(null);
    setPdfBase64(null);
    setCompileLog(null);
    setMessages([]);
    startTransition(async () => {
      const res = await optimizeResumeForApplication(applicationId, jd);
      if (res.ok) setLastPastedJd(jd);
      applyResult(res);
    });
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    runOptimize(pastedJd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleChange(id: string) {
    if (!result) return;
    const next: OptimizerResult = {
      ...result,
      changes: result.changes.map((c) => (c.segment.id === id ? { ...c, accepted: !c.accepted } : c)),
    };
    setResult(next);
    setSaved(false);
    setDirty(true);
    const seq = ++seqRef.current;
    if (recompileTimer.current) clearTimeout(recompileTimer.current);
    recompileTimer.current = setTimeout(() => {
      startTransition(async () => {
        const res = await recompileResume(next);
        if (seq !== seqRef.current) return; // a newer toggle or chat edit superseded this
        if (res.ok) {
          // Merge only the derived fields; the user's current toggles stay.
          setResult((prev) => (prev ? { ...prev, tex: res.result.tex, pageWarning: res.result.pageWarning } : prev));
          setPdfBase64(res.pdfBase64);
          setCompileLog(res.compileLog);
        } else {
          applyResult(res);
        }
        setDirty(false);
      });
    }, 600);
  }

  function handleSend() {
    const trimmed = chatInput.trim();
    if (!trimmed || !result) return;
    supersedeRecompile();
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setChatInput("");
    setErrorReason(null);
    startTransition(async () => {
      const res = await refineResumeRewrites(applicationId, result, trimmed, lastPastedJd);
      applyResult(res);
      if (!res.ok) {
        setMessages((m) => [...m, { role: "assistant", text: ERROR_COPY[res.reason] ?? "Couldn't apply that — try again." }]);
        return;
      }
      const { edits, rejected } = diffChanges(result.changes, res.result.changes);
      const summary = edits.length
        ? `Changed ${edits.length} line${edits.length === 1 ? "" : "s"}${res.pdfBase64 ? " — PDF rebuilt." : "."}`
        : rejected.length ? "Nothing changed — the edits were rejected:" : "Nothing changed.";
      const text = res.note ? `${res.note} ${summary}` : summary;
      setMessages((m) => [...m, { role: "assistant", text, edits, rejected }]);
    });
  }

  function handleDownloadPdf() {
    if (!pdfBase64) return;
    const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    downloadBlob(bytes, "application/pdf", resumeFilename(displayName, companyName, "pdf"));
  }

  function handleDownloadTex() {
    if (!result) return;
    downloadBlob(result.tex, "application/x-tex", resumeFilename(displayName, companyName, "tex"));
  }

  function handleSave() {
    if (!result || !pdfBase64) return;
    setErrorReason(null);
    startTransition(async () => {
      const res = await saveTailoredResume(applicationId, result, pdfBase64);
      if (res.ok) {
        setSaved(true);
        onDone(true);
      } else {
        setErrorReason(res.reason);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tailor resume</h3>
          <p className="text-sm text-slate-700">{companyName} · {roleTitle}</p>
        </div>
        <div className="flex items-center gap-3">
          {result && (
            <button type="button" onClick={() => runOptimize(lastPastedJd)} disabled={pending} className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50">
              Regenerate
            </button>
          )}
          <button type="button" onClick={() => onDone(saved)} className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-800">
            {saved ? "Close" : "Skip"}
          </button>
        </div>
      </div>

      {noResumeTex && (
        <p className="text-sm text-slate-600">
          No LaTeX resume on file.{" "}
          <Link href="/settings" className="font-medium text-indigo-600 hover:underline">Add one in Settings</Link>{" "}
          to tailor resumes.
        </p>
      )}

      {!noResumeTex && pasteMode && (
        <div>
          <label htmlFor={`jd-paste-${applicationId}`} className="block text-sm font-medium text-slate-700">Paste the job description</label>
          <p className="mt-0.5 text-xs text-slate-400">Couldn&rsquo;t read the posting page — paste the listing and we&rsquo;ll tailor from that.</p>
          <textarea
            id={`jd-paste-${applicationId}`}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={5}
            placeholder="Paste the full job description here…"
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={() => runOptimize(pasteText)} disabled={pending || !pasteText.trim()} className="cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
              {pending ? "Tailoring…" : "Tailor"}
            </button>
          </div>
        </div>
      )}

      {!noResumeTex && !pasteMode && errorReason && !result && (
        <div>
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{ERROR_COPY[errorReason] ?? errorReason}</p>
          <button type="button" onClick={() => runOptimize(lastPastedJd)} disabled={pending} className="mt-2 cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50">
            {pending ? "Tailoring…" : "Try again"}
          </button>
        </div>
      )}

      {!noResumeTex && !pasteMode && !errorReason && !result && (
        <p className="text-sm text-slate-500">{pending ? "Reading the listing and rephrasing bullets… (20–60 s)" : "Starting…"}</p>
      )}

      {result && (
        <div className="space-y-4">
          <KeywordChips keywords={result.keywords} changes={result.changes} />

          {result.pageWarning && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
              The tailored resume runs one page longer than your original — try asking the chat to tighten the longest bullets, or revert a few.
            </p>
          )}
          {compileLog && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-red-200">
              <p className="font-medium">Compile failed — you can still download the .tex.</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{compileLog}</pre>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="max-h-96 overflow-y-auto pr-1">
              <ChangeCards changes={result.changes} onToggle={toggleChange} />
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Refine by chat</h4>
              <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
                {messages.length === 0 ? (
                  <p className="text-sm text-slate-400">Ask for a change — e.g. &ldquo;tighten the project bullets&rdquo; or &ldquo;lead with the API work.&rdquo;</p>
                ) : messages.map((m, i) => (
                  <div key={i} className={`rounded-md px-3 py-1.5 text-sm ${m.role === "user" ? "bg-indigo-100 text-indigo-900" : "bg-slate-100 text-slate-600"}`}>
                    <p>{m.text}</p>
                    {m.edits?.map((e) => (
                      <div key={e.id} className="mt-2 border-t border-slate-200 pt-1.5">
                        <p className="truncate text-xs font-medium text-slate-500">{e.label}</p>
                        <p className="mt-0.5 font-mono text-xs text-slate-400 line-through">{e.before}</p>
                        <p className="mt-0.5 font-mono text-xs text-slate-900">{e.after}</p>
                      </div>
                    ))}
                    {m.rejected?.map((r) => (
                      <p key={r.id} className="mt-1.5 text-xs text-amber-700">
                        {r.label}: rewrite rejected ({r.reason}), kept original
                      </p>
                    ))}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSend(); } }}
                  placeholder="Describe the change…"
                  disabled={pending}
                  className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                />
                <button type="button" onClick={handleSend} disabled={pending || !chatInput.trim()} className="cursor-pointer rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
                  Send
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
            <button type="button" onClick={handleDownloadPdf} disabled={pending || dirty || !pdfBase64} className="cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
              Download PDF
            </button>
            <button type="button" onClick={handleDownloadTex} disabled={pending || dirty} className="cursor-pointer rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
              Download .tex
            </button>
            <button type="button" onClick={() => setComparing(true)} disabled={pending || dirty || !result || !result.changes.some((c) => c.accepted && c.rewrite)} title={result && !result.changes.some((c) => c.accepted && c.rewrite) ? "No accepted changes to compare" : undefined} className="cursor-pointer rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
              Compare
            </button>
            <button type="button" onClick={handleSave} disabled={pending || dirty || !pdfBase64 || saved} className="cursor-pointer rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50">
              {saved ? "✓ Saved to Resumes" : "Save to Resumes"}
            </button>
            {(pending || dirty) && <span className="text-xs text-slate-400">Working…</span>}
            {errorReason && result && <span className="text-sm text-red-600">{ERROR_COPY[errorReason] ?? errorReason}</span>}
          </div>
          {comparing && (
            <ResumeCompareModal input={{ result }} title={`${companyName} · ${roleTitle}`} onClose={() => setComparing(false)} />
          )}
        </div>
      )}
    </div>
  );
}
