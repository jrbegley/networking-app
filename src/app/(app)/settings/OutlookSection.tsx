"use client";

import { useState } from "react";
import { disconnectOutlookAction } from "./actions";

export function OutlookSection({
  connected,
  email,
  flashConnected,
  flashError,
}: {
  connected: boolean;
  email: string | null;
  flashConnected: boolean;
  flashError: string | null;
}) {
  const [disconnecting, setDisconnecting] = useState(false);
  const [status, setStatus] = useState<string | null>(
    flashConnected
      ? `Connected${email ? ` as ${email}` : ""}.`
      : flashError
        ? `Error: ${decodeURIComponent(flashError)}`
        : null,
  );
  const [isConnected, setIsConnected] = useState(connected);
  const [connectedEmail, setConnectedEmail] = useState(email);

  async function handleDisconnect() {
    setDisconnecting(true);
    const r = await disconnectOutlookAction();
    setDisconnecting(false);
    if (r.error) {
      setStatus(`Error: ${r.error}`);
    } else {
      setIsConnected(false);
      setConnectedEmail(null);
      setStatus("Disconnected.");
    }
  }

  return (
    <section className="rounded-lg bg-white p-6 ring-1 ring-slate-200">
      <h2 className="text-base font-semibold text-slate-900">
        Outlook / Email
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Connect your Outlook account to push drafts directly to your Drafts
        folder. Emails are sent from your own address — no tool branding.
      </p>

      {status && (
        <p
          className={`mt-3 text-sm ${
            status.startsWith("Error")
              ? "text-red-600"
              : "text-emerald-700"
          }`}
        >
          {status}
        </p>
      )}

      <div className="mt-4 flex items-center gap-4">
        {isConnected ? (
          <>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-sm text-slate-700">
                {connectedEmail ?? "Connected"}
              </span>
            </div>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </>
        ) : (
          <a
            href="/auth/outlook"
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Connect Outlook
          </a>
        )}
      </div>
    </section>
  );
}
