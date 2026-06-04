"use client";

import { useActionState } from "react";
import { saveProfile, type ProfileFormState } from "./actions";

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

      <div>
        <label
          htmlFor="display_name"
          className="block text-sm font-medium text-slate-700"
        >
          Your name
        </label>
        <p className="mt-0.5 text-xs text-slate-500">
          Shown in the top nav. Not shown in outreach emails.
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

      <div>
        <label
          htmlFor="bio"
          className="block text-sm font-medium text-slate-700"
        >
          About you
        </label>
        <p className="mt-0.5 text-xs text-slate-500">
          1–3 sentences. School, year, focus area, anything that helps Claude
          place you. Example: &quot;Junior at UIUC studying CS. Building
          consumer ML tools — interned at Stripe last summer working on the
          checkout fraud team.&quot;
        </p>
        <textarea
          id="bio"
          name="bio"
          rows={3}
          defaultValue={initial.bio}
          placeholder="Junior at UIUC studying CS…"
          className="mt-2 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      </div>

      <div>
        <label
          htmlFor="resume_text"
          className="block text-sm font-medium text-slate-700"
        >
          Resume / detailed history
        </label>
        <p className="mt-0.5 text-xs text-slate-500">
          Paste your resume contents or a detailed work history. The more
          specific, the more genuine common ground Claude can surface. Bullet
          points are fine — Claude reads structured text well.
        </p>
        <textarea
          id="resume_text"
          name="resume_text"
          rows={10}
          defaultValue={initial.resumeText}
          placeholder="EDUCATION&#10;University of Illinois Urbana-Champaign — BS Computer Science, expected 2027…&#10;&#10;EXPERIENCE&#10;Stripe — SWE Intern, Summer 2025…"
          className="mt-2 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      </div>

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

      <div>
        <label
          htmlFor="linkedin_url"
          className="block text-sm font-medium text-slate-700"
        >
          Your LinkedIn URL
        </label>
        <p className="mt-0.5 text-xs text-slate-500">
          Optional. Helps Claude reference shared connections or context.
        </p>
        <input
          id="linkedin_url"
          name="linkedin_url"
          type="url"
          defaultValue={initial.linkedinUrl}
          placeholder="https://linkedin.com/in/yourname"
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
