"use client";

import { useState } from "react";
import {
  recordCoverLetterTemplate,
  coverLetterTemplateUrl,
  clearCoverLetterTemplate,
} from "./actions";
import { createClient } from "@/lib/supabase/client";

type Initial = {
  templateName: string | null;
  templateUploadedAt: string | null;
};

export function CoverLetterTemplateSection({ initial }: { initial: Initial }) {
  const [templateName, setTemplateName] = useState(initial.templateName);
  const [templateUploadedAt, setTemplateUploadedAt] = useState(
    initial.templateUploadedAt,
  );

  const [status, setStatus] = useState<{
    kind: "info" | "success" | "error";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setStatus({ kind: "info", text: `Uploading ${file.name}…` });

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const storagePath = `${user.id}/template.docx`;

      const { error: uploadError } = await supabase.storage
        .from("cover-letter-templates")
        .upload(storagePath, file, {
          upsert: true,
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
      if (uploadError) throw new Error(uploadError.message);

      const metaResult = await recordCoverLetterTemplate(file.name);
      if (metaResult.error) throw new Error(metaResult.error);

      setTemplateName(file.name);
      setTemplateUploadedAt(new Date().toISOString());
      setStatus({ kind: "success", text: `Uploaded ${file.name}.` });
    } catch (err) {
      setStatus({
        kind: "error",
        text:
          err instanceof Error
            ? err.message
            : "Couldn't upload this template.",
      });
    } finally {
      setBusy(false);
      e.target.value = ""; // allow re-uploading the same file
    }
  }

  async function handleView() {
    const { url, error } = await coverLetterTemplateUrl();
    if (error || !url) {
      setStatus({
        kind: "error",
        text: error ?? "Couldn't generate a download link.",
      });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleRemove() {
    if (!confirm("Remove the stored cover-letter template?")) {
      return;
    }
    setBusy(true);
    const result = await clearCoverLetterTemplate();
    setBusy(false);
    if (result.error) {
      setStatus({ kind: "error", text: result.error });
      return;
    }
    setTemplateName(null);
    setTemplateUploadedAt(null);
    setStatus({ kind: "success", text: "Template removed." });
  }

  return (
    <div className="space-y-6 rounded-lg bg-white p-6 ring-1 ring-slate-200">
      <div>
        <div className="flex items-baseline justify-between">
          <h2 className="block text-sm font-medium text-slate-700">
            Cover-letter template
          </h2>
          <label className="cursor-pointer rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
            {busy ? "Working…" : templateName ? "Replace template" : "Upload template"}
            <input
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleFileChange}
              disabled={busy}
              className="hidden"
            />
          </label>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          Upload a .docx cover letter you&apos;ve already used. We keep its
          exact margins, header, letterhead, and signature — only the date,
          recipient, salutation, and body get regenerated per application.
        </p>

        {templateName && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900">
                {templateName}
              </p>
              {templateUploadedAt && (
                <p className="text-slate-500">
                  Uploaded {new Date(templateUploadedAt).toLocaleString()}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleView}
                className="font-medium text-slate-700 hover:text-slate-900"
              >
                View
              </button>
              <button
                type="button"
                onClick={handleRemove}
                disabled={busy}
                className="font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
        )}

        {status && (
          <p
            className={`mt-2 text-xs ${
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
      </div>
    </div>
  );
}
