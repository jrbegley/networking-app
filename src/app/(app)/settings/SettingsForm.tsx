"use client";

import { useActionState, useState } from "react";
import {
  saveProfile,
  scanMyLinkedIn,
  recordResumeUpload,
  getResumeDownloadUrl,
  deleteResume,
  type ProfileFormState,
} from "./actions";
import { parsePdfToText } from "@/lib/pdf-parse-client";
import { createClient } from "@/lib/supabase/client";

const initialState: ProfileFormState = { error: null, saved: false };

type Initial = {
  displayName: string;
  bio: string;
  resumeText: string;
  outreachGoal: string;
  linkedinUrl: string;
  resumePdfName: string | null;
  resumePdfUploadedAt: string | null;
};

export function SettingsForm({ initial }: { initial: Initial }) {
  const [state, formAction, pending] = useActionState(
    saveProfile,
    initialState,
  );

  // Controlled fields for those we update programmatically
  const [bio, setBio] = useState(initial.bio);
  const [resumeText, setResumeText] = useState(initial.resumeText);
  const [linkedinUrl, setLinkedinUrl] = useState(initial.linkedinUrl);

  // Stored-resume metadata. Update locally after upload/delete so the UI
  // reflects the new state without a full page reload.
  const [resumePdfName, setResumePdfName] = useState(initial.resumePdfName);
  const [resumePdfUploadedAt, setResumePdfUploadedAt] = useState(
    initial.resumePdfUploadedAt,
  );

  const [pdfStatus, setPdfStatus] = useState<{
    kind: "info" | "success" | "error";
    text: string;
  } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const [scanStatus, setScanStatus] = useState<{
    kind: "info" | "success" | "error";
    text: string;
  } | null>(null);
  const [scanning, setScanning] = useState(false);

  async function handlePdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPdfBusy(true);
    setPdfStatus({ kind: "info", text: `Reading ${file.name}…` });

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const storagePath = `${user.id}/resume.pdf`;

      // Parallel: parse text in the browser, upload PDF to Storage.
      const [parseResult, uploadResult] = await Promise.allSettled([
        parsePdfToText(file),
        supabase.storage
          .from("resumes")
          .upload(storagePath, file, {
            upsert: true,
            contentType: "application/pdf",
          }),
      ]);

      if (parseResult.status === "fulfilled") {
        setResumeText(parseResult.value);
      }

      if (uploadResult.status === "rejected") {
        throw new Error(uploadResult.reason?.message ?? "Upload failed.");
      }
      if (uploadResult.status === "fulfilled" && uploadResult.value.error) {
        throw new Error(uploadResult.value.error.message);
      }

      // Persist the metadata server-side so it shows up on next reload too.
      const metaResult = await recordResumeUpload(file.name);
      if (metaResult.error) throw new Error(metaResult.error);

      setResumePdfName(file.name);
      setResumePdfUploadedAt(new Date().toISOString());

      // Compose status — note both successes and any partial failure.
      if (parseResult.status === "rejected") {
        setPdfStatus({
          kind: "info",
          text: `Uploaded ${file.name}, but couldn't parse text. Paste it manually below.`,
        });
      } else {
        setPdfStatus({
          kind: "success",
          text: `Uploaded ${file.name} and extracted ${parseResult.value.length.toLocaleString()} chars. Review and save.`,
        });
      }
    } catch (err) {
      setPdfStatus({
        kind: "error",
        text:
          err instanceof Error
            ? err.message
            : "Couldn't process this PDF.",
      });
    } finally {
      setPdfBusy(false);
      e.target.value = ""; // allow re-uploading the same file
    }
  }

  async function handleViewResume() {
    const { url, error } = await getResumeDownloadUrl();
    if (error || !url) {
      setPdfStatus({
        kind: "error",
        text: error ?? "Couldn't generate a download link.",
      });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleDeleteResume() {
    if (
      !confirm("Delete the stored resume PDF? The text below is kept.")
    ) {
      return;
    }
    setPdfBusy(true);
    const result = await deleteResume();
    setPdfBusy(false);
    if (result.error) {
      setPdfStatus({ kind: "error", text: result.error });
      return;
    }
    setResumePdfName(null);
    setResumePdfUploadedAt(null);
    setPdfStatus({ kind: "success", text: "Resume PDF removed." });
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
          <label className="cursor-pointer rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
            {pdfBusy ? "Working…" : resumePdfName ? "Replace PDF" : "Upload PDF"}
            <input
              type="file"
              accept="application/pdf"
              onChange={handlePdfChange}
              disabled={pdfBusy}
              className="hidden"
            />
          </label>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          PDF is uploaded to your private storage (encrypted; only you can
          read it) AND parsed in your browser to populate the text below.
          Keeping the file lets us attach it to outbound emails later.
        </p>

        {resumePdfName && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900">
                {resumePdfName}
              </p>
              {resumePdfUploadedAt && (
                <p className="text-slate-500">
                  Uploaded {new Date(resumePdfUploadedAt).toLocaleString()}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleViewResume}
                className="font-medium text-slate-700 hover:text-slate-900"
              >
                View
              </button>
              <button
                type="button"
                onClick={handleDeleteResume}
                disabled={pdfBusy}
                className="font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
        )}

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
