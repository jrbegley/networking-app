import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * Root route. Sends authenticated users to the dashboard,
 * everyone else to the login page.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }
  redirect("/login");
}
