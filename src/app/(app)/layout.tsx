import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

/**
 * Layout for all protected routes. Server component — auth check runs
 * on the server BEFORE the page renders. Unauthenticated users get
 * redirected to /login before any HTML is sent.
 *
 * Every route placed inside src/app/(app)/ inherits this protection.
 * The (app) folder is a Next.js "route group" — the parens mean it
 * doesn't add a path segment, so /dashboard stays /dashboard.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link
              href="/contacts"
              className="text-lg font-semibold text-slate-900"
            >
              Networking App
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link
                href="/contacts"
                className="text-slate-600 hover:text-slate-900"
              >
                Pipeline
              </Link>
              <Link
                href="/settings"
                className="text-slate-600 hover:text-slate-900"
              >
                Settings
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-slate-600 sm:inline">
              {user.email}
            </span>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
