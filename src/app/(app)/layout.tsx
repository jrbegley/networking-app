import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { NavLinks } from "./NavLinks";

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
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link
              href="/contacts"
              className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-6 w-6"
                aria-hidden="true"
              >
                <circle cx="6" cy="12" r="2.5" className="fill-indigo-600" />
                <circle cx="17" cy="5.5" r="2.5" className="fill-indigo-400" />
                <circle cx="17" cy="18.5" r="2.5" className="fill-indigo-400" />
                <path
                  d="M8 11l7-4.5M8 13l7 4.5"
                  className="stroke-indigo-300"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              Networking
            </Link>
            <NavLinks />
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-slate-500 sm:inline">
              {user.email}
            </span>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="cursor-pointer rounded-md px-3 py-1.5 text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
