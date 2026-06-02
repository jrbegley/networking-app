"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type AuthState = { error: string | null };

/**
 * Single server action that handles both sign-in and sign-up,
 * dispatched by a hidden form field `mode`.
 *
 * On success: redirects to /dashboard (the redirect() call throws a
 * special Next.js error that's handled by the framework — control does
 * not return to the caller).
 *
 * On failure: returns { error } so the client form can display it.
 */
export async function authenticate(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const supabase = await createClient();

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const mode = String(formData.get("mode") ?? "signin");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const { error } =
    mode === "signup"
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  redirect("/dashboard");
}
