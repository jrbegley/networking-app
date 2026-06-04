"use client";

import { useActionState, useState } from "react";
import {
  saveProfile,
  scanMyLinkedIn,
  type ProfileFormState,
} from "./actions";
import { parsePdfToText } from "@/lib/pdf-parse-client";

const initialState: ProfileFormState = { error: null, saved: false };

type Initial = {
  displayName: string;
  bio: string;
  resumeText: string;
  outreachGoal: string;
  linkedinUrl: string;
};

export function SettingsForm({ initial }: { initial: Initial }) {
  const [state, formAction, pending] = useActionState(
    saveProfile,
    initialState,
  );

  // Controlled fields for the two that we want to update programmatically
  // (resume from PDF upload, bio/resume from LinkedIn scan). The rest stay
  // uncontrolled / defaultValue.
  const [bio, setBio] = useState(initial.bio);
  const [resumeText, setResumeText] = useState(initial.resumeText);
  const [linkedinUrl, setLinkedinUrl] = useState(initial.linkedinUrl);

  // Transient feedback state for the upload + scan flows
  const [pdfStatus, setPdfStatus] = useState<{
    kind: "info" | "success" | "error";
    text: string;
  } | null>(null);
  const [pdfParsing, setPdfParsing] = useState(false);

  const [scanStatus, setScanStatus] = useState<{
    kind: "info" | "success" | "error";
    text: string;
  } | null>(null);
  const [scanning, setScanning] = useState(false);

  async function handlePdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfStatus({ kind: "info", text: `Reading ${file.name}…` });
    setPdfParsing(true);
    try {
      const text = await parsePdfToText(file);
      setResumeText(text);
      setPdfStatus({
        kind: "success",
        text: `Extracted ${text.length.toLocaleString()} chars from ${file.name}. Review below and save.`,
      });
    } catch (err) {
      setPdfStatus({
        kind: "error",
        text:
          err instanceof Error
            ? err.message
            : "Couldn't parse this PDF. Try a different file or paste text manually.",
      });
    } finally {
      setPdfParsing(false);
      // Allow re-uploading the same file
      e.target.value = "";
    }
  }

  async function handleScan() {
    if (!linkedinUrl.trim()) {
      setScanStatus({
        kind: "error",
        text: "Paste your LinkedIn URL above first.",
      });
      return;
    }
    setScanning(true);
    setScanStatus({ kind: "info", text: "Scanning via Apollo…" });
    const result = await scanMyLinkedIn(linkedinUrl);
    setScanning(false);

    if (result.error) {
      setScanStatus({ kind: "error", text: result.error });
      return;
    }

    let updated = 0;
    if (result.bio && !bio.trim()) {
      setBio(result.bio);
      updated++;
    }
    if (result.resumeText) {
      // Only overwrite if currently empty — otherwise append a marker so
      // user knows what's new.
      if (!resumeText.trim()) {
        setResumeText(result.resumeText);
      } else {
        setResumeText(
          `${resumeText.trim()}\n\n--- from LinkedIn scan ---\n${result.resumeText}`,
        );
      }
      updated++;
    }

    setScanStatus({
      kind: "success",
      text:
        updated > 0
          ? `Pulled ${updated} field${updated === 1 ? "" : "s"} from your LinkedIn. Review below and save.`
          : "Apollo found your profile but couldn't extract anything new.",
    });
  }

  return (
    <form
      action={formAction}
      className="space-y-6 rounded-lg bg-white p-6 ring-1 ring-slate-200"
    >
      {state.saved && (
        <div className="rounded-md bg-emerald-50 p-3 ring-1 ring-emerald-200">
          <p className="text-sm text-emerald-900">
            Saved. Your next draft will use this.
          </p>
        </div>
      )}
      {state.error && (
        <div className="rounded-md bg-red-50 p-3 ring-1 ring-red-200">
          <p className="text-sm text-red-900">{state.error}</p>
        </div>
      )}

      {/* ── Display name ─────────────────────────────────────────────── */}
      <div>
        <label
          htmlFor="display_name"
          className="block text-sm font-medium text-slate-700"
        >
          Your name
        </label>
        <p className="mt-0.5 text-xs text-slate-500">
          Shown in the top nav. Not used in outreach emails.
        </p>
        <input
          id="display_name"
          name="display_name"
          type="text"
          defaultValue={initial.displayName}
          placeholder="Joe Begley"
          className="mt-2 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      </div>

      {/* ── LinkedIn URL + scan ─────────────────────────────────────── */}
      <div>
        <label
          htmlFor="linkedin_url"
          className="block text-sm font-medium text-slate-700"
        >
          Your LinkedIn URL
        </label>
        <p className="mt-0.5 text-xs text-slate-500">
          Pull your bio and work history from LinkedIn (via Apollo). Burns
          1 credit per scan.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            id="linkedin_url"
            name="linkedin_url"
            type="url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://linkedin.com/in/yourname"
            className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          <button
            type="button"
            onClick={handleScan}
            disabled={scanning || !linkedinUrl.trim()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scanning ? "Scanning…" : "Scan LinkedIn"}
          </button>
        </div>
        {scanStatus && (
          <p
            className={`mt-2 text-xs ${
              scanStatus.kind === "success"
                ? "text-emerald-700"
                : scanStatus.kind === "error"
                  ? "text-red-600"
                  : "text-slate-500"
            }`}
          >
            {scanStatus.text}
          </p>
        )}
      </div>

      {/* ── Bio ──────────────────────────────────────────────────────── */}
      <div>
        <label
          htmlFor="bio"
          className="block text-sm font-medium text-slate-700"
        >
          About you
        </label>
        <p className="mt-0.5 text-xs text-slate-500">
          1–3 sentences. School, year, focus area, anything that helps Claude
          place you in context.
        </p>
        <textarea
          id="bio"
          name="bio"
          rows={3}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Junior at UIUC studying CS…"
          className="mt-2 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      </div>

      {/* ── Resume upload + textarea ────────────────────────────────── */}
      <div>
        <div className="flex items-baseline justify-between">
          <label
            htmlFor="resume_text"
            className="block text-sm font-medium text-slate-700"
          >
            Resume / detailed history
          </label>
          <label className="cursor-pointer text-xs font-medium text-slate-700 hover:text-slate-900">
            {pdfParsing ? "Reading…" : "Upload PDF"}
            <input
              type="file"
              accept="application/pdf"
              onChange={handlePdfChange}
              disabled={pdfParsing}
              className="hidden"
            />
          </label>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          Upload your resume PDF (parsed in your browser — never leaves your
          machine) or paste manually. The more specific, the more genuine
          common ground Claude can surface.
        </p>
        {pdfStatus && (
          <p
            className={`mt-2 text-xs ${
              pdfStatus.kind === "success"
                ? "text-emerald-700"
                : pdfStatus.kind === "error"
                  ? "text-red-600"
                  : "text-slate-500"
            }`}
          >
            {pdfStatus.text}
          </p>
        )}
        <textarea
          id="resume_text"
          name="resume_text"
          rows={12}
          value={resumeText}
          onChange={(e) => setResumeText(e.target.value)}
          placeholder="EDUCATION&#10;University of Illinois Urbana-Champaign — BS Computer Science, expected 2027…"
          className="mt-2 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      </div>

      {/* ── Outreach goal ────────────────────────────────────────────── */}
      <div>
        <label
          htmlFor="outreach_goal"
          className="block text-sm font-medium text-slate-700"
        >
          What you&apos;re reaching out for
        </label>
        <p className="mt-0.5 text-xs text-slate-500">
          Your typical outreach goal. Claude uses this to tune the ask in
          each email.
        </p>
        <textarea
          id="outreach_goal"
          name="outreach_goal"
          rows={2}
          defaultValue={initial.outreachGoal}
          placeholder="PM internships at fintech / consumer startups for summer 2027."
          className="mt-2 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
