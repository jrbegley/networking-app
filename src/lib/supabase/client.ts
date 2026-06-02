import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for use in Client Components ("use client").
 * Reads/writes auth cookies via document.cookie.
 *
 * Usage:
 *   "use client"
 *   import { createClient } from "@/lib/supabase/client"
 *   const supabase = createClient()
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
