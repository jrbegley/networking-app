"use client";

import { useActionState, useState } from "react";
import { authenticate, type AuthState } from "./actions";

const initialState: AuthState = { error: null };

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [state, formAction, pending] = useActionState(
    authenticate,
    initialState,
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">
          {mode === "signin" ? "Sign in" : "Create an account"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {mode === "signin"
            ? "Welcome back to Networking App."
            : "Get started in 10 seconds."}
        </p>

        <form action={formAction} className="mt-6 space-y-4">
          <input type="hidden" name="mode" value={mode} />

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-slate-700"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-slate-700"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {mode === "signup" && (
              <p className="mt-1 text-xs text-slate-500">
                At least 8 characters.
              </p>
            )}
          </div>

          {state.error && (
            <div
              className="rounded-md bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200"
              role="alert"
            >
              {state.error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="flex w-full justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? mode === "signin"
                ? "Signing in…"
                : "Creating account…"
              : mode === "signin"
                ? "Sign in"
                : "Sign up"}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-600">
          {mode === "signin" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={() => setMode("signup")}
                className="font-medium text-indigo-600 hover:underline"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => setMode("signin")}
                className="font-medium text-indigo-600 hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
