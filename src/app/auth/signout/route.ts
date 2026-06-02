import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * POST /auth/signout
 * Signs the user out and redirects to /login.
 *
 * Triggered by a plain HTML form, so it works without JavaScript.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), {
    status: 302,
  });
}
