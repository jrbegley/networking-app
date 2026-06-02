"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  createContact,
  type CreateContactState,
} from "./actions";

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

export default function NewContactPage() {
  const [state, formAction, pending] = useActionState(
    createContact,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the form after a successful add so the next contact can be entered
  // immediately. The success banner stays until they start typing.
  useEffect(() => {
    if (state.success && formRef.current) {
      formRef.current.reset();
    }
  }, [state.success]);

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
          Add contact
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Drop in what you know. You can enrich and edit later.
        </p>
      </div>

      {state.success && (
        <div className="mb-6 rounded-md bg-emerald-50 p-4 ring-1 ring-emerald-200">
          <p className="text-sm text-emerald-900">
            <span className="font-medium">Added {state.success.name}.</span>{" "}
            Form cleared — add another, or{" "}
            <Link
              href="/dashboard"
              className="font-medium underline underline-offset-2"
            >
              go to dashboard
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

      <form
        ref={formRef}
        action={formAction}
        className="space-y-5 rounded-lg bg-white p-6 ring-1 ring-slate-200"
      >
        <Field
          label="Name"
          name="name"
          required
          autoComplete="off"
          placeholder="Jane Doe"
        />

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field
            label="Title"
            name="title"
            placeholder="Senior PM"
            autoComplete="off"
          />
          <Field
            label="Company"
            name="company"
            placeholder="Acme Corp"
            autoComplete="off"
            help="If new, we'll create it for you."
          />
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field
            label="Email"
            name="email"
            type="email"
            placeholder="jane@acme.com"
            autoComplete="off"
          />
          <Field
            label="LinkedIn URL"
            name="linkedin_url"
            type="url"
            placeholder="https://linkedin.com/in/janedoe"
            autoComplete="off"
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
            defaultValue="identified"
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
// Kept inline because it's only used here and the abstraction is shallow.

type FieldProps = {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  help?: string;
};

function Field({
  label,
  name,
  type = "text",
  required = false,
  placeholder,
  autoComplete,
  help,
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
        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
      />
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}
