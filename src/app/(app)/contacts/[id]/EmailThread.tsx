"use client";

import { useState } from "react";
import { logReceivedEmail } from "./actions";

type Interaction = {
  id: string;
  type: string;
  subject: string | null;
  body: string | null;
  occurred_at: string;
};

export function EmailThread({
  contactId,
  interactions,
}: {
  contactId: string;
  interactions: Interaction[];
}) {
  const emails = interactions.filter(
    (i) => i.type === "email_sent" || i.type === "email_received",
  );

  const [logging, setLogging] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function handleLog() {
    setLogging(true);
    setStatus(null);
    const r = await logReceivedEmail(contactId, subject, body);
    setLogging(false);
    if (r.error) {
      setStatus(r.error);
    } else {
      setShowForm(false);
      setSubject("");
      setBody("");
      setStatus(null);
    }
  }

  return (
    <section className="rounded-lg bg-white p-6 ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-slate-900">Emails</h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="text-xs text-slate-500 hover:text-slate-800"
        >
          {showForm ? "Cancel" : "+ Log reply"}
        </button>
      </div>

      {/* Log received email form */}
      {showForm && (
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 space-y-3">
          <p className="text-xs font-medium text-slate-700">Log a received email</p>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Paste their reply here…"
            rows={5}
            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          {status && <p className="text-xs text-red-600">{status}</p>}
          <button
            type="button"
            onClick={handleLog}
            disabled={logging || !body.trim()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {logging ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {emails.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          No emails logged yet. Emails pushed to Outlook Drafts will appear
          here once sent.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {[...emails].reverse().map((email) => (
            <EmailBubble key={email.id} email={email} />
          ))}
        </div>
      )}
    </section>
  );
}

function EmailBubble({ email }: { email: Interaction }) {
  const [expanded, setExpanded] = useState(false);
  const sent = email.type === "email_sent";
  const date = new Date(email.occurred_at);
  const dateStr = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
  const timeStr = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  // Show a preview (first line) when collapsed
  const firstLine = email.body?.split("\n").find((l) => l.trim()) ?? "";
  const preview =
    firstLine.length > 80 ? firstLine.slice(0, 80) + "…" : firstLine;
  const hasBody = !!email.body?.trim();
  const multiLine = (email.body?.split("\n").length ?? 0) > 1 || firstLine.length > 80;

  return (
    <div className={`flex ${sent ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-4 py-3 shadow-sm ${
          sent
            ? "bg-blue-600 text-white"
            : "bg-slate-100 text-slate-900 ring-1 ring-slate-200"
        }`}
      >
        {/* Direction label + date */}
        <div
          className={`mb-1 flex items-center gap-2 text-xs ${sent ? "text-blue-200" : "text-slate-500"}`}
        >
          <span>{sent ? "You →" : "← Them"}</span>
          <span>·</span>
          <span>
            {dateStr} {timeStr}
          </span>
        </div>

        {/* Subject */}
        {email.subject && (
          <p className={`text-sm font-semibold ${sent ? "text-white" : "text-slate-900"}`}>
            {email.subject}
          </p>
        )}

        {/* Body — collapsed to preview unless expanded */}
        {hasBody && (
          <div className="mt-1">
            {expanded || !multiLine ? (
              <p
                className={`whitespace-pre-wrap text-sm ${sent ? "text-blue-50" : "text-slate-700"}`}
              >
                {email.body}
              </p>
            ) : (
              <p className={`text-sm ${sent ? "text-blue-100" : "text-slate-600"}`}>
                {preview}
              </p>
            )}
            {multiLine && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className={`mt-1 text-xs underline underline-offset-2 ${sent ? "text-blue-200 hover:text-white" : "text-slate-400 hover:text-slate-700"}`}
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
