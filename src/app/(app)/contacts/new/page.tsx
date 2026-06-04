"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  createContact,
  previewLinkedIn,
  type CreateContactState,
  type PreviewResult,
} from "./actions";
import type { ApolloPerson } from "@/lib/apollo";

const initialState: CreateContactState = { error: null, success: null };

const STAGES: { value: string; label: string }[] = [
  { value: "identified", label: "Identified" },
  { value: "researched", label: "Researched" },
  { value: "drafted", label: "Drafted" },
  { value: "sent", label: "Sent" },
  { value: "replied", label: "Replied" },
  { value: "meeting_scheduled", label: "Meeting scheduled" },
  { value: "meeting_held", label: "Meeting held" },
  { value: "nurture", label: "Nurture" },
  { value: "dormant", label: "Dormant" },
];

type Defaults = {
  name: string;
  title: string;
  company: string;
  email: string;
  linkedinUrl: string;
  stage: string;
};

const BLANK_DEFAULTS: Defaults = {
  name: "",
  title: "",
  company: "",
  email: "",
  linkedinUrl: "",
  stage: "identified",
};

export default function NewContactPage() {
  const [state, formAction, pending] = useActionState(
    createContact,
    initialState,
  );

  // Local state for the form's default values. Initialized blank; replaced
  // wholesale when a lookup succeeds. We bump `formKey` to force the form to
  // remount with the new defaultValue values when this changes.
  const [defaults, setDefaults] = useState<Defaults>(BLANK_DEFAULTS);
  const [formKey, setFormKey] = useState(0);
  const [apolloPayload, setApolloPayload] = useState<string>(""); // JSON string

  // Lookup-specific transient state.
  const [lookupUrl, setLookupUrl] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupMsg, setLookupMsg] = useState<{
    kind: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const formRef = useRef<HTMLFormElement>(null);

  // Reset form after a successful add
  useEffect(() => {
    if (state.success && formRef.current) {
      formRef.current.reset();
      setDefaults(BLANK_DEFAULTS);
      setFormKey((k) => k + 1);
      setApolloPayload("");
      setLookupUrl("");
      setLookupMsg(null);
    }
  }, [state.success]);

  async function handleLookup() {
    setLookingUp(true);
    setLookupMsg(null);
    const result: PreviewResult = await previewLinkedIn(lookupUrl);
    setLookingUp(false);

    if (result.error) {
      setLookupMsg({ kind: "error", text: result.error });
      // If Apollo returned no person but did respond, we still want to keep
      // the URL in the LinkedIn field so the user doesn't have to retype it.
      setDefaults((d) => ({ ...d, linkedinUrl: lookupUrl }));
      setFormKey((k) => k + 1);
      return;
    }
    if (!result.person || !result.payload) {
      setLookupMsg({
        kind: "info",
        text: "No match — you can still fill in manually.",
      });
      return;
    }

    const person: ApolloPerson = result.person;
    setDefaults({
      name: person.name ?? "",
      title: person.title ?? "",
      company: person.organization?.name ?? "",
      email: person.email ?? "",
      linkedinUrl: person.linkedin_url ?? lookupUrl,
      stage: "researched",
    });
    setApolloPayload(JSON.stringify(result.payload));
    setFormKey((k) => k + 1);
    setLookupMsg({
      kind: "success",
      text: `Found ${person.name ?? "person"} — review and add.`,
    });
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link
          href="/contacts"
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          ← Pipeline
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
          Add contact
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Paste a LinkedIn URL to auto-fill, or just type everything manually.
        </p>
      </div>

      {state.success && (
        <div className="mb-6 rounded-md bg-emerald-50 p-4 ring-1 ring-emerald-200">
          <p className="text-sm text-emerald-900">
            <span className="font-medium">Added {state.success.name}.</span>{" "}
            Form cleared — add another,{" "}
            <Link
              href={`/contacts/${state.success.contactId}`}
              className="font-medium underline underline-offset-2"
            >
              open this contact
            </Link>
            , or{" "}
            <Link
              href="/contacts"
              className="font-medium underline underline-offset-2"
            >
              go to pipeline
            </Link>
            .
          </p>
        </div>
      )}

      {state.error && (
        <div className="mb-6 rounded-md bg-red-50 p-4 ring-1 ring-red-200">
          <p className="text-sm text-red-900">{state.error}</p>
        </div>
      )}

      {/* ── Lookup section ──────────────────────────────────────────── */}
      <div className="mb-6 rounded-lg bg-slate-900 p-5 text-white">
        <label htmlFor="lookup-url" className="block text-sm font-medium">
          Auto-fill from LinkedIn URL
        </label>
        <p className="mt-1 text-xs text-slate-300">
          Pastes the URL → calls Apollo → pre-fills the form below. Burns 1
          Apollo credit per lookup.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            id="lookup-url"
            type="url"
            value={lookupUrl}
            onChange={(e) => setLookupUrl(e.target.value)}
            placeholder="https://linkedin.com/in/..."
            className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          <button
            type="button"
            onClick={handleLookup}
            disabled={lookingUp || !lookupUrl.trim()}
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {lookingUp ? "Looking up…" : "Look up"}
          </button>
        </div>
        {lookupMsg && (
          <p
            className={`mt-3 text-xs ${
              lookupMsg.kind === "success"
                ? "text-emerald-300"
                : lookupMsg.kind === "error"
                  ? "text-red-300"
                  : "text-slate-300"
            }`}
          >
            {lookupMsg.text}
          </p>
        )}
      </div>

      {/* ── Main form ──────────────────────────────────────────────── */}
      <form
        key={formKey}
        ref={formRef}
        action={formAction}
        className="space-y-5 rounded-lg bg-white p-6 ring-1 ring-slate-200"
      >
        {/* Hidden: full Apollo payload, persisted as research_artifact on save */}
        {apolloPayload && (
          <input
            type="hidden"
            name="apollo_payload"
            value={apolloPayload}
          />
        )}

        <Field
          label="Name"
          name="name"
          required
          autoComplete="off"
          placeholder="Jane Doe"
          defaultValue={defaults.name}
        />

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field
            label="Title"
            name="title"
            placeholder="Senior PM"
            autoComplete="off"
            defaultValue={defaults.title}
          />
          <Field
            label="Company"
            name="company"
            placeholder="Acme Corp"
            autoComplete="off"
            help="If new, we'll create it for you."
            defaultValue={defaults.company}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field
            label="Email"
            name="email"
            type="email"
            placeholder="jane@acme.com"
            autoComplete="off"
            defaultValue={defaults.email}
          />
          <Field
            label="LinkedIn URL"
            name="linkedin_url"
            type="url"
            placeholder="https://linkedin.com/in/janedoe"
            autoComplete="off"
            defaultValue={defaults.linkedinUrl}
          />
        </div>

        <div>
          <label
            htmlFor="stage"
            className="block text-sm font-medium text-slate-700"
          >
            Initial stage
          </label>
          <select
            id="stage"
            name="stage"
            defaultValue={defaults.stage}
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          >
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="notes"
            className="block text-sm font-medium text-slate-700"
          >
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            placeholder="How you found them, mutual connections, etc."
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link
            href="/dashboard"
            className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Saving…" : "Add contact"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Form field component ──────────────────────────────────────────────────

type FieldProps = {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  help?: string;
  defaultValue?: string;
};

function Field({
  label,
  name,
  type = "text",
  required = false,
  placeholder,
  autoComplete,
  help,
  defaultValue,
}: FieldProps) {
  return (
    <div>
      <label
        htmlFor={name}
        className="block text-sm font-medium text-slate-700"
      >
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
      />
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}
