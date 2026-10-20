"use client";

import { useEffect, useRef, useState } from "react";
import { compareResumes, type CompareInput } from "./actions";

const ERROR_COPY: Record<string, string> = {
  resume_changed: "Your LaTeX resume changed in Settings since this run. Regenerate to tailor the new version, then compare.",
  cannot_compare: "This saved resume can't be compared — its text no longer lines up with the recorded changes.",
  compile_failed: "One of the two versions failed to compile.",
};

function pdfUrl(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

type Loaded =
  | { status: "loading" }
  | { status: "ready"; original: string; tailored: string }
  | { status: "error"; reason: string; log?: string };

export function ResumeCompareModal({ input, title, onClose }: { input: CompareInput; title: string; onClose: () => void }) {
  const [state, setState] = useState<Loaded>({ status: "loading" });
  const startedRef = useRef(false);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    compareResumes(input).then((res) => {
      if (!res.ok) { setState({ status: "error", reason: res.reason, log: res.log }); return; }
      const original = pdfUrl(res.originalPdfBase64);
      const tailored = pdfUrl(res.tailoredPdfBase64);
      urlsRef.current = [original, tailored];
      setState({ status: "ready", original, tailored });
    }).catch((e) => setState({ status: "error", reason: e instanceof Error ? e.message : String(e) }));
    // input is captured once on mount by design
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { urlsRef.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm sm:p-8" onClick={onClose}>
      <div className="mt-8 w-full max-w-7xl rounded-xl bg-white shadow-xl ring-1 ring-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">Compare · {title}</h2>
          <button type="button" onClick={onClose} className="cursor-pointer rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="space-y-3 px-6 py-5">
          {state.status === "loading" && <p className="text-sm text-slate-500">Compiling both versions… (5–15 s)</p>}
          {state.status === "error" && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
              <p>{ERROR_COPY[state.reason] ?? state.reason}</p>
              {state.reason === "compile_failed" && state.log && (
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs">{state.log}</pre>
              )}
            </div>
          )}
          {state.status === "ready" && (
            <>
              <p className="text-xs text-slate-500">Changed bullets: red = before, green = after. View only — downloads stay unhighlighted.</p>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-700" />Original
                  </h3>
                  <iframe src={state.original} title="Original resume" className="h-[75vh] w-full rounded ring-1 ring-slate-200" />
                </div>
                <div>
                  <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-700" />Tailored
                  </h3>
                  <iframe src={state.tailored} title="Tailored resume" className="h-[75vh] w-full rounded ring-1 ring-slate-200" />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
