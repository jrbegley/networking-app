import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses RLS. For trusted server contexts
 * that run OUTSIDE a user session (cron jobs, webhooks). Never import this
 * into anything reachable from client code, and never use it where a
 * session-scoped client (lib/supabase/server.ts) would do.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
