"use client";

import { useState, useTransition } from "react";
import { saveResumeTex, clearResumeTex, resumeTexSource } from "./actions";
import { COMPILERS, isCompiler, type Compiler } from "@/lib/resume-optimizer-types";

type Initial = {
  name: string | null;
  savedAt: string | null;
  compiler: Compiler;
  pages: number | null;
  notSetUp: boolean;
};

export function ResumeTexSection({ initial }: { initial: Initial }) {
  const [name, setName] = useState(initial.name);
  const [savedAt, setSavedAt] = useState(initial.savedAt);
  const [pages, setPages] = useState(initial.pages);
  const [compiler, setCompiler] = useState<Compiler>(initial.compiler);
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [status, setStatus] = useState<{ kind: "info" | "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setSource(text);
    setFileName(file.name);
    setShowPaste(false);
    setStatus({ kind: "info", text: `Loaded ${file.name} (${text.length.toLocaleString()} chars). Click Save & test-compile.` });
    e.target.value = "";
  }

  function handleSave() {
    if (!source.trim()) return;
    setStatus({ kind: "info", text: "Compiling… this can take up to a minute." });
    startTransition(async () => {
      const res = await saveResumeTex(source, fileName ?? "resume.tex", compiler);
      if (res.error) {
        setStatus({ kind: "error", text: res.error });
        return;
      }
      setName(fileName ?? "resume.tex");
      setSavedAt(new Date().toISOString());
      setPages(res.pages ?? null);
      setSource("");
      setFileName(null);
      setShowPaste(false);
      setStatus({ kind: "success", text: `Saved and compiled (${res.pages ?? "?"} page${res.pages === 1 ? "" : "s"}).` });
    });
  }

  async function handleDownload() {
    const { source: tex, name: n, error } = await resumeTexSource();
    if (error || !tex) {
      setStatus({ kind: "error", text: error ?? "No .tex stored." });
      return;
    }
    const blob = new Blob([tex], { type: "application/x-tex" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = n ?? "resume.tex";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleClear() {
    if (!confirm("Remove the stored LaTeX resume? Saved tailored resumes are kept.")) return;
    startTransition(async () => {
      const res = await clearResumeTex();
      if (res.error) {
        setStatus({ kind: "error", text: res.error });
        return;
      }
      setName(null);
      setSavedAt(null);
      setPages(null);
      setStatus({ kind: "success", text: "LaTeX resume removed." });
    });
  }

  if (initial.notSetUp) {
    return (
      <div className="space-y-2 rounded-lg bg-white p-6 ring-1 ring-slate-200">
        <h2 className="text-sm font-medium text-slate-700">LaTeX resume</h2>
        <p className="text-sm text-slate-600">
          Not set up yet. Paste{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">supabase/migrations/010_resume_optimizer.sql</code>{" "}
          into the Supabase SQL editor and run it to enable the resume optimizer.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg bg-white p-6 ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-slate-700">LaTeX resume</h2>
        <div className="flex items-center gap-2">
          <label className="cursor-pointer rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
            {name ? "Replace .tex" : "Upload .tex"}
            <input type="file" accept=".tex,text/x-tex,application/x-tex,text/plain" onChange={handleFileChange} disabled={pending} className="hidden" />
          </label>
          <button
            type="button"
            onClick={() => setShowPaste((v) => !v)}
            className="cursor-pointer rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {showPaste ? "Hide paste box" : "Paste source"}
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Your default resume as LaTeX. The optimizer rephrases its bullets per job listing and
        compiles a PDF. The source is sent to the compile service configured by{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5">LATEX_COMPILE_URL</code>.
      </p>

      {name && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-800">{name}</p>
            <p className="text-slate-500">
              {savedAt && <>Saved {new Date(savedAt).toLocaleString()} · </>}
              {initial.compiler}
              {pages != null && <> · {pages} page{pages === 1 ? "" : "s"}</>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button type="button" onClick={handleDownload} className="cursor-pointer font-medium text-indigo-600 hover:underline">
              Download .tex
            </button>
            <button type="button" onClick={handleClear} disabled={pending} className="cursor-pointer font-medium text-red-600 hover:underline disabled:opacity-50">
              Clear
            </button>
          </div>
        </div>
      )}

      {showPaste && (
        <textarea
          value={source}
          onChange={(e) => { setSource(e.target.value); setFileName(null); }}
          rows={10}
          placeholder={"\\documentclass{article}\n..."}
          className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-slate-600">
          Compiler{" "}
          <select
            value={compiler}
            onChange={(e) => { if (isCompiler(e.target.value)) setCompiler(e.target.value); }}
            className="ml-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
          >
            {COMPILERS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !source.trim()}
          className="cursor-pointer rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Compiling…" : "Save & test-compile"}
        </button>
        {fileName && !pending && <span className="text-xs text-slate-500">Ready: {fileName}</span>}
      </div>

      {status && (
        <pre
          className={`whitespace-pre-wrap rounded-md px-3 py-2 text-xs ${
            status.kind === "error"
              ? "bg-red-50 text-red-700 ring-1 ring-red-200"
              : status.kind === "success"
                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                : "bg-slate-50 text-slate-600 ring-1 ring-slate-200"
          }`}
        >
          {status.text}
        </pre>
      )}
    </div>
  );
}
