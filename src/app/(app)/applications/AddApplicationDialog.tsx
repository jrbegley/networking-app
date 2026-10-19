"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  createApplication,
  readPostingFromUrl,
  readPostingFromText,
  type ActionResult,
  type ReadPostingResult,
} from "./actions";
import {
  APPLICATION_STATUSES,
  STATUS_LABEL,
} from "@/lib/applications";
import { ResumeOptimizerPanel } from "../resumes/ResumeOptimizerPanel";

type Prefill = {
  company_name: string;
  role_title: string;
  location: string;
  deadline: string;
  source: string;
};

const EMPTY_PREFILL: Prefill = {
  company_name: "",
  role_title: "",
  location: "",
  deadline: "",
  source: "",
};

const initialState: ActionResult = { error: null };

// The statuses that make sense to create at. Terminal ones (rejected/etc.)
// are reachable via the row dropdown, not the add form.
const CREATE_STATUSES = APPLICATION_STATUSES.filter(
  (s) => !["rejected", "withdrawn", "ghosted"].includes(s),
);

export function AddApplicationDialog({ hasResumeTex }: { hasResumeTex: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    createApplication,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  // Job-posting autofill state. The URL box lives ABOVE the form so its value
  // is never submitted and survives the form remount that prefill triggers.
  const [url, setUrl] = useState("");
  const [prefill, setPrefill] = useState<Prefill>(EMPTY_PREFILL);
  const [formKey, setFormKey] = useState(0);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  const [reading, startReading] = useTransition();

  // Resume-tailoring handoff. `handoff` is captured at submit time (the form
  // remounts/reset afterwards) and `createdId` flips the dialog to step 2.
  const [tailor, setTailor] = useState(true);
  const [handoff, setHandoff] = useState<{ company: string; role: string; jd?: string } | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  function resetAutofill() {
    setUrl("");
    setPrefill(EMPTY_PREFILL);
    setPasteMode(false);
    setPasteText("");
    setFetchError(null);
    setFilled(false);
  }

  function handleClose() {
    setOpen(false);
    setCreatedId(null);
    setHandoff(null);
    resetAutofill();
  }

  // Apply a read result: on success prefill the fields and remount the form so
  // the new defaults take; on needs_paste swap to the paste box; otherwise show
  // the reason inline and leave the form manually fillable.
  function applyResult(res: ReadPostingResult) {
    if (res.ok) {
      setPrefill({
        company_name: res.fields.company_name ?? "",
        role_title: res.fields.role_title ?? "",
        location: res.fields.location ?? "",
        deadline: res.fields.deadline ?? "",
        source: res.source ?? "",
      });
      setFormKey((k) => k + 1);
      setPasteMode(false);
      setFilled(true);
    } else if (res.reason === "needs_paste") {
      setPasteMode(true);
    } else {
      setFetchError(res.reason);
    }
  }

  function handleFetch() {
    setFetchError(null);
    setFilled(false);
    startReading(async () => {
      try {
        applyResult(await readPostingFromUrl(url));
      } catch {
        setFetchError(
          "Something went wrong reading that posting — fill in below.",
        );
      }
    });
  }

  function handleParse() {
    setFetchError(null);
    setFilled(false);
    startReading(async () => {
      try {
        applyResult(await readPostingFromText(pasteText, url || undefined));
      } catch {
        setFetchError(
          "Something went wrong reading that text — fill in below.",
        );
      }
    });
  }

  // After a successful submit: either hand off to the resume optimizer
  // (box checked, .tex on file, id returned) or close + reset as before.
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      formRef.current?.reset();
      if (hasResumeTex && tailor && state.id && handoff) {
        setCreatedId(state.id);
      } else {
        setOpen(false);
        resetAutofill();
      }
    }
    wasPending.current = pending;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, state.error, state.id]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add application
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm sm:p-8"
          onClick={handleClose}
        >
          <div
            className={`mt-8 w-full ${createdId ? "max-w-4xl" : "max-w-lg"} rounded-xl bg-white shadow-xl ring-1 ring-slate-200`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-base font-semibold text-slate-900">
                {createdId ? "Tailor resume" : "Add application"}
              </h2>
              <button
                type="button"
                onClick={handleClose}
                className="cursor-pointer rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-5 w-5"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {createdId && handoff ? (
              <div className="px-6 py-5">
                <ResumeOptimizerPanel
                  applicationId={createdId}
                  companyName={handoff.company}
                  roleTitle={handoff.role}
                  pastedJd={handoff.jd}
                  onDone={() => handleClose()}
                />
              </div>
            ) : (
              <>
            {/*
              Autofill panel — OUTSIDE the <form> so the URL/paste text are
              never submitted as fields and survive the form remount that
              prefilling triggers. Fetching never saves; only the "Add
              application" submit inside the form writes anything.
            */}
            <div className="border-b border-slate-100 px-6 py-4">
              {!pasteMode ? (
                <>
                  <label
                    htmlFor="posting_url_fetch"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Posting URL{" "}
                    <span className="font-normal text-slate-400">
                      (optional — autofills the form)
                    </span>
                  </label>
                  <div className="mt-1 flex gap-2">
                    <input
                      id="posting_url_fetch"
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://…"
                      autoComplete="off"
                      className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={handleFetch}
                      disabled={reading || !url.trim()}
                      className="shrink-0 cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {reading ? "Reading posting…" : "Fetch"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label
                    htmlFor="posting_paste"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Paste the job description
                  </label>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Couldn&rsquo;t read that page — paste the posting text and
                    we&rsquo;ll pull out the fields.
                  </p>
                  <textarea
                    id="posting_paste"
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    rows={5}
                    placeholder="Paste the full job description here…"
                    className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <div className="mt-2 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setPasteMode(false);
                        setPasteText("");
                        setFetchError(null);
                      }}
                      className="cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleParse}
                      disabled={reading || !pasteText.trim()}
                      className="shrink-0 cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {reading ? "Reading posting…" : "Parse"}
                    </button>
                  </div>
                </>
              )}
              {filled && (
                <p className="mt-2 text-sm font-medium text-emerald-600">
                  ✓ Filled from posting · review below
                </p>
              )}
              {fetchError && (
                <p className="mt-2 text-sm text-red-600">{fetchError}</p>
              )}
            </div>

            <form
              ref={formRef}
              key={formKey}
              action={formAction}
              onSubmit={(e) => {
                const fd = new FormData(e.currentTarget);
                setHandoff({
                  company: String(fd.get("company_name") ?? ""),
                  role: String(fd.get("role_title") ?? ""),
                  jd: pasteMode && pasteText.trim() ? pasteText.trim() : undefined,
                });
              }}
              className="space-y-4 px-6 py-5"
            >
              {/* URL carried into createApplication; set from the box above. */}
              <input type="hidden" name="posting_url" value={url} />
              {state.error && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
                  {state.error}
                </p>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Company"
                  name="company_name"
                  required
                  defaultValue={prefill.company_name}
                  placeholder="Bain & Company"
                />
                <Field
                  label="Role"
                  name="role_title"
                  required
                  defaultValue={prefill.role_title}
                  placeholder="Associate Consultant"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="status"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Status
                  </label>
                  <select
                    id="status"
                    name="status"
                    defaultValue="applied"
                    className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {CREATE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="applied_at"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Applied date
                  </label>
                  <input
                    id="applied_at"
                    name="applied_at"
                    type="date"
                    defaultValue={today}
                    className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Location"
                  name="location"
                  defaultValue={prefill.location}
                  placeholder="Chicago, IL"
                />
                <div>
                  <label
                    htmlFor="deadline"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Deadline{" "}
                    <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <input
                    id="deadline"
                    name="deadline"
                    type="date"
                    defaultValue={prefill.deadline}
                    className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Source"
                  name="source"
                  defaultValue={prefill.source}
                  placeholder="Referral, LinkedIn, career site…"
                />
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
                  rows={2}
                  placeholder="Referral name, comp, anything to remember."
                  className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {hasResumeTex && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={tailor}
                    onChange={(e) => setTailor(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Tailor my resume for this role
                  <span className="text-xs text-slate-400">(opens after saving)</span>
                </label>
              )}

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleClose}
                  className="cursor-pointer rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Add application"}
                </button>
              </div>
            </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        autoComplete="off"
        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>
  );
}
