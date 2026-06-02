import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the user's Supabase session on every request.
 *
 * Without this, expired access tokens stay expired and the user gets
 * silently signed out. With it, the middleware proactively swaps in a
 * fresh token using the refresh token, transparently to the user.
 *
 * The function is intentionally narrow — it does NOT redirect based on
 * auth state. That's done in the (app) route group's layout via
 * `redirect('/login')`. Keeping responsibilities split makes both pieces
 * easier to reason about.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not put logic between createServerClient and getUser.
  // getUser is what actually triggers the token refresh.
  await supabase.auth.getUser();

  return supabaseResponse;
}
