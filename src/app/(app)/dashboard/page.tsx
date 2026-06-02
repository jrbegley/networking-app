import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  // Quick count to give the dashboard at least one number while we
  // haven't built the list view yet. RLS scopes this to the user.
  const { count } = await supabase
    .from("contacts")
    .select("*", { count: "exact", head: true });

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Dashboard
          </h1>
          <p className="mt-1 text-slate-600">
            {count === 0
              ? "Add your first contact to get started."
              : `${count} contact${count === 1 ? "" : "s"} in your pipeline.`}
          </p>
        </div>
        <Link
          href="/contacts/new"
          className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
        >
          + Add contact
        </Link>
      </div>

      <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
        <p className="text-sm text-slate-500">
          Pipeline list view coming next (task 14).
        </p>
      </div>
    </div>
  );
}
