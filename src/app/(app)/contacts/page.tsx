import { createClient } from "@/lib/supabase/server";
import { PipelineView, type ContactRow } from "./PipelineView";
import type { PipelineStage } from "@/lib/pipeline";

export default async function ContactsPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contacts")
    .select(
      "id, name, title, email, linkedin_url, current_stage, company:companies(id, name, industry)",
    )
    .order("current_stage")
    .order("name");

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 ring-1 ring-red-200">
        <p className="text-sm text-red-900">
          Couldn&apos;t load contacts: {error.message}
        </p>
      </div>
    );
  }

  const contacts: ContactRow[] = (data ?? []).map((c) => {
    const co = Array.isArray(c.company) ? (c.company[0] ?? null) : c.company;
    return {
      id: c.id as string,
      name: c.name as string,
      title: c.title as string | null,
      email: c.email as string | null,
      linkedin_url: c.linkedin_url as string | null,
      current_stage: c.current_stage as PipelineStage,
      company: co
        ? {
            id: (co as { id: string; name: string; industry: string | null }).id,
            name: (co as { id: string; name: string; industry: string | null }).name,
            industry: (co as { id: string; name: string; industry: string | null }).industry,
          }
        : null,
    };
  });

  return <PipelineView contacts={contacts} />;
}
