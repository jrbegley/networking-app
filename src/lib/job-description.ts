// Resolve the job-description text for an application. Lives outside the
// "use server" files so it isn't exposed as a public action endpoint.
import { guardUrl, fetchPostingHtml, htmlToText } from "@/lib/job-posting";

export type JobDescriptionResult =
  | { ok: true; text: string }
  | { ok: false; reason: "needs_paste" };

/**
 * Pasted text wins; else fetch posting_url through the same guard/fetch/clean
 * chain as the Add Application autofill. Any failure → paste fallback.
 */
export async function resolveJobDescription(
  postingUrl: string | null,
  pastedJd?: string,
): Promise<JobDescriptionResult> {
  if (pastedJd && pastedJd.trim()) return { ok: true, text: pastedJd.trim() };
  if (!postingUrl) return { ok: false, reason: "needs_paste" };
  const guard = guardUrl(postingUrl);
  if (!guard.ok) return { ok: false, reason: "needs_paste" };
  try {
    const html = await fetchPostingHtml(guard.url);
    const text = htmlToText(html);
    if (!text) return { ok: false, reason: "needs_paste" };
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "needs_paste" };
  }
}
