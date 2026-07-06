"use client";

import { useActionState, useState } from "react";
import { editContact, type EditContactState } from "./actions";
import { PIPELINE_STAGES, STAGE_LABEL } from "@/lib/pipeline";

const initialState: EditContactState = { error: null, saved: false };

type Initial = {
  contactId: string;
  name: string;
  title: string;
  email: string;
  linkedinUrl: string;
  company: string;
  stage: string;
  notes: string;
};

export function EditContact({ initial }: { initial: Initial }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(editContact, initialState);

  // Close on successful save
  if (state.saved && open) setOpen(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        {open ? "Cancel" : "Edit"}
      </button>

      {open && (
        <form
          action={formAction}
          className="mt-4 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-5"
        >
          <input type="hidden" name="contactId" value={initial.contactId} />

          {state.error && (
            <p className="text-sm text-red-600">{state.error}</p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name *" name="name" defaultValue={initial.name} required />
            <Field label="Title" name="title" defaultValue={initial.title} />
            <Field label="Company" name="company" defaultValue={initial.company} />
            <Field label="Email" name="email" type="email" defaultValue={initial.email} />
            <Field label="LinkedIn URL" name="linkedin_url" type="url" defaultValue={initial.linkedinUrl} />

            <div>
              <label htmlFor="edit-stage" className="block text-sm font-medium text-slate-700">
                Stage
              </label>
              <select
                id="edit-stage"
                name="stage"
                defaultValue={initial.stage}
                className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {PIPELINE_STAGES.map((s) => (
                  <option key={s} value={s}>{STAGE_LABEL[s]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="edit-notes" className="block text-sm font-medium text-slate-700">
              Notes
            </label>
            <textarea
              id="edit-notes"
              name="notes"
              rows={3}
              defaultValue={initial.notes}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Field({
  label, name, type = "text", defaultValue = "", required = false,
}: {
  label: string; name: string; type?: string; defaultValue?: string; required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={`edit-${name}`} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={`edit-${name}`}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>
  );
}
