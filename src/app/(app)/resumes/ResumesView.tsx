"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deleteTailoredResume, tailoredResumePdfUrl, tailoredResumeTex } from "./actions";
import { ResumeCompareModal } from "./ResumeCompareModal";
import { ResumeOptimizerPanel, KeywordChips, ChangeCards } from "./ResumeOptimizerPanel";
import { coverage } from "@/lib/latex-resume";
import type { Change, Keyword } from "@/lib/resume-optimizer-types";

export type TailoredResumeRow = {
  id: string;
  applicationId: string | null;
  companyName: string;
  roleTitle: string;
  compiler: string;
  keywords: Keyword[];
  changes: Change[];
  pageWarning: boolean;
  createdAt: string;
};

export type PickerApplication = { id: string; companyName: string; roleTitle: string; status: string };

function Modal({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm sm:p-8" onClick={onClose}>
      <div className={`mt-8 w-full ${wide ? "max-w-4xl" : "max-w-lg"} rounded-xl bg-white shadow-xl ring-1 ring-slate-200`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="cursor-pointer rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function ResumesView({ rows, applications, hasResumeTex }: { rows: TailoredResumeRow[]; applications: PickerApplication[]; hasResumeTex: boolean }) {
  const router = useRouter();
  const [viewing, setViewing] = useState<TailoredResumeRow | null>(null);
  const [comparing, setComparing] = useState<TailoredResumeRow | null>(null);
  const [picking, setPicking] = useState(false);
  const [tailoring, setTailoring] = useState<PickerApplication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const tailoredAppIds = useMemo(() => new Set(rows.map((r) => r.applicationId).filter(Boolean)), [rows]);
  const pickerApps = useMemo(() => {
    const without = applications.filter((a) => !tailoredAppIds.has(a.id));
    const withOne = applications.filter((a) => tailoredAppIds.has(a.id));
    return { without, withOne };
  }, [applications, tailoredAppIds]);

  function openPdf(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await tailoredResumePdfUrl(id);
      if (res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
      else setError(res.reason);
    });
  }

  function downloadTex(row: TailoredResumeRow) {
    setError(null);
    startTransition(async () => {
      const res = await tailoredResumeTex(row.id);
      if (!res.ok) { setError(res.reason); return; }
      const url = URL.createObjectURL(new Blob([res.tex], { type: "application/x-tex" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${row.companyName.replace(/[^A-Za-z0-9]+/g, "-")}-resume.tex`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function remove(row: TailoredResumeRow) {
    if (!confirm(`Delete the tailored resume for ${row.companyName} · ${row.roleTitle}?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteTailoredResume(row.id);
      if (!res.ok) setError(res.reason);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Resumes</h1>
          <p className="mt-1 text-sm text-slate-600">Every resume you&apos;ve tailored, by company and role.</p>
        </div>
        {hasResumeTex ? (
          <button type="button" onClick={() => setPicking(true)} className="cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500">
            Tailor for an application…
          </button>
        ) : (
          <p className="text-sm text-slate-500">
            <Link href="/settings" className="font-medium text-indigo-600 hover:underline">Add a LaTeX resume in Settings</Link> to start tailoring.
          </p>
        )}
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</p>}

      {rows.length === 0 ? (
        <div className="rounded-lg bg-white p-8 text-center ring-1 ring-slate-200">
          <p className="text-sm text-slate-600">No tailored resumes yet. Tick &ldquo;Tailor my resume&rdquo; when adding an application, or use the button above.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Company</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Keywords</th>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const cov = coverage(r.keywords, r.changes);
                return (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="max-w-[14rem] truncate px-4 py-2 font-medium text-slate-900">{r.companyName}</td>
                    <td className="max-w-[16rem] truncate px-4 py-2 text-slate-700">{r.roleTitle}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {cov.matched + cov.incorporated}/{cov.total} matched
                      {r.pageWarning && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700 ring-1 ring-amber-200">+1 page</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500">{new Date(r.createdAt).toLocaleDateString()}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <div className="inline-flex items-center gap-3 text-xs font-medium">
                        <button type="button" onClick={() => openPdf(r.id)} disabled={pending} className="cursor-pointer text-indigo-600 hover:underline disabled:opacity-50">PDF</button>
                        <button type="button" onClick={() => downloadTex(r)} className="cursor-pointer text-indigo-600 hover:underline">.tex</button>
                        <button type="button" onClick={() => setViewing(r)} className="cursor-pointer text-slate-600 hover:underline">View</button>
                        {r.changes.some((c) => c.accepted && c.rewrite) && (
                          <button type="button" onClick={() => setComparing(r)} className="cursor-pointer text-slate-600 hover:underline">Compare</button>
                        )}
                        <button type="button" onClick={() => remove(r)} disabled={pending} className="cursor-pointer text-red-600 hover:underline disabled:opacity-50">Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewing && (
        <Modal title={`${viewing.companyName} · ${viewing.roleTitle}`} wide onClose={() => setViewing(null)}>
          <div className="space-y-4">
            <KeywordChips keywords={viewing.keywords} changes={viewing.changes} />
            <div className="max-h-[60vh] overflow-y-auto pr-1">
              <ChangeCards changes={viewing.changes} />
            </div>
          </div>
        </Modal>
      )}

      {comparing && (
        <ResumeCompareModal
          key={comparing.id}
          input={{ tailoredResumeId: comparing.id }}
          title={`${comparing.companyName} · ${comparing.roleTitle}`}
          onClose={() => setComparing(null)}
        />
      )}

      {picking && !tailoring && (
        <Modal title="Tailor for an application" onClose={() => setPicking(false)}>
          {applications.length === 0 ? (
            <p className="text-sm text-slate-600">No applications yet — add one on the Applications tab.</p>
          ) : (
            <div className="max-h-[60vh] space-y-4 overflow-y-auto">
              {[{ label: "Not yet tailored", list: pickerApps.without }, { label: "Already tailored (makes a new version)", list: pickerApps.withOne }]
                .filter((g) => g.list.length > 0)
                .map((g) => (
                  <div key={g.label}>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{g.label}</p>
                    <ul className="mt-1 divide-y divide-slate-100 rounded-md border border-slate-200">
                      {g.list.map((a) => (
                        <li key={a.id}>
                          <button type="button" onClick={() => { setTailoring(a); setPicking(false); }} className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                            <span className="truncate"><span className="font-medium text-slate-900">{a.companyName}</span> <span className="text-slate-600">· {a.roleTitle}</span></span>
                            <span className="ml-3 shrink-0 text-xs text-slate-400">{a.status.replace(/_/g, " ")}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </Modal>
      )}

      {tailoring && (
        <Modal title="Tailor resume" wide onClose={() => { if (confirm("Discard this tailored resume?")) setTailoring(null); }}>
          <ResumeOptimizerPanel
            applicationId={tailoring.id}
            companyName={tailoring.companyName}
            roleTitle={tailoring.roleTitle}
            onDone={(saved) => { setTailoring(null); if (saved) router.refresh(); }}
          />
        </Modal>
      )}
    </div>
  );
}
