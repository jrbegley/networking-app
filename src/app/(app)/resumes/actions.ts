"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { resolveJobDescription } from "@/lib/job-description";
import { segmentResumeTex, extractJobKeywords, rewriteResumeSegments } from "@/lib/claude";
import { compileLatex } from "@/lib/latex-compile";
import {
  locateSegments, validateRewrite, spliceSegments, plainTextOf, markPresent, pdfPageCount,
} from "@/lib/latex-resume";
import {
  isCompiler, validateKeywords,
  type Change, type Compiler, type OptimizerResult, type Rewrite,
} from "@/lib/resume-optimizer-types";

// ── Result shapes ──────────────────────────────────────────────────────
export type OptimizeResult =
  | { ok: true; result: OptimizerResult; pdfBase64: string | null; compileLog: string | null }
  | { ok: false; reason: string; log?: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;

type ResumeProfile = {
  resume_tex: string | null;
  resume_tex_compiler: string | null;
  resume_tex_pages: number | null;
  resume_text: string | null;
};

type ApplicationRow = { company_name: string; role_title: string; posting_url: string | null };

/** True when the error looks like migration 010 hasn't been applied. */
function isNotSetUpError(message: string): boolean {
  return (
    (/resume_tex|tailored_resumes|tailored-resumes/i.test(message) &&
      /column|schema cache|does not exist|could not find|relation/i.test(message)) ||
    /bucket not found/i.test(message)
  );
}

function errorReason(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return isNotSetUpError(message) ? "not_set_up" : message;
}

async function requireUser(supabase: Supabase): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function loadResumeProfile(supabase: Supabase, userId: string): Promise<ResumeProfile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("resume_tex, resume_tex_compiler, resume_tex_pages, resume_text")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data as ResumeProfile;
}

async function loadApplicationRow(supabase: Supabase, applicationId: string): Promise<ApplicationRow> {
  const { data, error } = await supabase
    .from("applications")
    .select("company_name, role_title, posting_url")
    .eq("id", applicationId)
    .single();
  if (error) throw error;
  return data as ApplicationRow;
}

/**
 * Validate each proposed rewrite against its segment; failures keep the
 * original. With `keepReverted` (chat refinement), a bullet the user reverted
 * stays reverted unless the model returned a fresh rewrite for it, so a chat
 * edit doesn't silently undo earlier Revert clicks.
 */
function applyRewrites(changes: Change[], rewrites: Rewrite[], keepReverted = false): Change[] {
  const byId = new Map(rewrites.map((r) => [r.id, r]));
  return changes.map((c) => {
    const r = byId.get(c.segment.id);
    if (!r) {
      if (keepReverted && c.rewrite && !c.accepted) return c;
      return { ...c, rewrite: null, accepted: true, droppedReason: null };
    }
    if (r.text === c.segment.text) return { ...c, rewrite: null, accepted: true, droppedReason: null };
    const v = validateRewrite(c.segment.text, r.text);
    return v.ok
      ? { ...c, rewrite: r, accepted: true, droppedReason: null }
      : { ...c, rewrite: null, accepted: true, droppedReason: v.reason };
  });
}

/**
 * The client round-trips the OptimizerResult, so never trust it: rebuild it
 * from the stored .tex (source of truth). Every segment must still sit
 * verbatim at its offsets (else the resume changed since the run → null),
 * rewrites are re-validated, keywords re-derived, and `tex` re-spliced.
 */
function reconcileResult(result: OptimizerResult, profile: ResumeProfile): OptimizerResult | null {
  const source = profile.resume_tex;
  if (!source || !result || !Array.isArray(result.changes)) return null;
  const changes: Change[] = [];
  let prevEnd = 0;
  const ordered = [...result.changes].sort((a, b) => (a?.segment?.start ?? 0) - (b?.segment?.start ?? 0));
  for (const c of ordered) {
    const seg = c?.segment;
    if (
      !seg || typeof seg.text !== "string" ||
      !Number.isInteger(seg.start) || !Number.isInteger(seg.end) ||
      seg.start < prevEnd || source.slice(seg.start, seg.end) !== seg.text
    ) return null;
    prevEnd = seg.end;
    let rewrite: Rewrite | null = null;
    let droppedReason: string | null = null;
    if (c.rewrite && typeof c.rewrite.text === "string") {
      const v = validateRewrite(seg.text, c.rewrite.text);
      if (v.ok) {
        rewrite = {
          id: String(seg.id),
          text: c.rewrite.text,
          keywords: Array.isArray(c.rewrite.keywords)
            ? c.rewrite.keywords.filter((k): k is string => typeof k === "string")
            : [],
        };
      } else {
        droppedReason = v.reason;
      }
    }
    changes.push({
      segment: { id: String(seg.id), section: String(seg.section ?? ""), entry: String(seg.entry ?? ""), text: seg.text, start: seg.start, end: seg.end },
      rewrite,
      accepted: c.accepted !== false,
      droppedReason,
    });
  }
  const compiler: Compiler = isCompiler(profile.resume_tex_compiler) ? profile.resume_tex_compiler : "pdflatex";
  const keywords = markPresent(validateKeywords({ keywords: result.keywords }), plainTextOf(source));
  return {
    originalTex: source,
    tex: spliceSegments(source, changes),
    compiler,
    keywords,
    changes,
    pageWarning: !!result.pageWarning,
  };
}

/** Splice + compile; compile failure is reported, not thrown, so .tex download still works. */
async function compileResult(
  result: OptimizerResult, originalPages: number | null,
): Promise<{ result: OptimizerResult; pdfBase64: string | null; compileLog: string | null }> {
  const tex = spliceSegments(result.originalTex, result.changes);
  const compiled = await compileLatex(tex, result.compiler);
  if (!compiled.ok) {
    return { result: { ...result, tex, pageWarning: false }, pdfBase64: null, compileLog: compiled.log };
  }
  const pages = pdfPageCount(compiled.pdf);
  const pageWarning = originalPages != null && pages > originalPages;
  return {
    result: { ...result, tex, pageWarning },
    pdfBase64: Buffer.from(compiled.pdf).toString("base64"),
    compileLog: null,
  };
}

/**
 * Full pipeline for an application. Read-only: no DB write, no revalidate.
 * `pastedJd` supplies the listing when the posting URL can't be fetched (or
 * when the add dialog already had the text pasted).
 */
export async function optimizeResumeForApplication(
  applicationId: string,
  pastedJd?: string,
): Promise<OptimizeResult> {
  try {
    const supabase = await createClient();
    const userId = await requireUser(supabase);
    if (!userId) return { ok: false, reason: "Not signed in." };

    const profile = await loadResumeProfile(supabase, userId);
    if (!profile.resume_tex) return { ok: false, reason: "no_resume_tex" };
    const compiler: Compiler = isCompiler(profile.resume_tex_compiler) ? profile.resume_tex_compiler : "pdflatex";

    const row = await loadApplicationRow(supabase, applicationId);
    const jd = await resolveJobDescription(row.posting_url, pastedJd);
    if (!jd.ok) return { ok: false, reason: "needs_paste" };

    const source = profile.resume_tex;
    const [candidates, rawKeywords] = await Promise.all([
      segmentResumeTex(source),
      extractJobKeywords(jd.text, row.role_title),
    ]);
    const segments = locateSegments(source, candidates);
    if (segments.length === 0) return { ok: false, reason: "no_segments" };

    const keywords = markPresent(rawKeywords, plainTextOf(source));
    const rewrites = await rewriteResumeSegments({
      segments, keywords, resumeText: profile.resume_text, jobDescription: jd.text,
      companyName: row.company_name, roleTitle: row.role_title,
    });
    const changes = applyRewrites(
      segments.map((segment) => ({ segment, rewrite: null, accepted: true, droppedReason: null })),
      rewrites,
    );
    const base: OptimizerResult = { originalTex: source, tex: source, compiler, keywords, changes, pageWarning: false };
    return { ok: true, ...(await compileResult(base, profile.resume_tex_pages)) };
  } catch (e) {
    return { ok: false, reason: errorReason(e) };
  }
}

/** Apply a chat instruction on top of the current rewrites, then recompile. No DB write. */
export async function refineResumeRewrites(
  applicationId: string,
  result: OptimizerResult,
  instruction: string,
  pastedJd?: string,
): Promise<OptimizeResult> {
  try {
    const supabase = await createClient();
    const userId = await requireUser(supabase);
    if (!userId) return { ok: false, reason: "Not signed in." };

    const profile = await loadResumeProfile(supabase, userId);
    const clean = reconcileResult(result, profile);
    if (!clean) return { ok: false, reason: "resume_changed" };
    result = clean;
    const row = await loadApplicationRow(supabase, applicationId);
    const jd = await resolveJobDescription(row.posting_url, pastedJd);

    const currentRewrites = result.changes
      .filter((c) => c.accepted && c.rewrite)
      .map((c) => c.rewrite!);
    const rewrites = await rewriteResumeSegments({
      segments: result.changes.map((c) => c.segment),
      keywords: result.keywords,
      resumeText: profile.resume_text,
      jobDescription: jd.ok ? jd.text : "",
      companyName: row.company_name, roleTitle: row.role_title,
      instruction, currentRewrites,
    });
    const changes = applyRewrites(result.changes, rewrites, true);
    return { ok: true, ...(await compileResult({ ...result, changes }, profile.resume_tex_pages)) };
  } catch (e) {
    return { ok: false, reason: errorReason(e) };
  }
}

/** Recompile after the user reverts/restores bullets. No DB write. */
export async function recompileResume(result: OptimizerResult): Promise<OptimizeResult> {
  try {
    const supabase = await createClient();
    const userId = await requireUser(supabase);
    if (!userId) return { ok: false, reason: "Not signed in." };
    const profile = await loadResumeProfile(supabase, userId);
    const clean = reconcileResult(result, profile);
    if (!clean) return { ok: false, reason: "resume_changed" };
    return { ok: true, ...(await compileResult(clean, profile.resume_tex_pages)) };
  } catch (e) {
    return { ok: false, reason: errorReason(e) };
  }
}

/** The only writer: inserts the row, uploads the PDF, revalidates /resumes. */
export async function saveTailoredResume(
  applicationId: string,
  result: OptimizerResult,
  pdfBase64: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  try {
    const supabase = await createClient();
    const userId = await requireUser(supabase);
    if (!userId) return { ok: false, reason: "Not signed in." };

    const profile = await loadResumeProfile(supabase, userId);
    const clean = reconcileResult(result, profile);
    if (!clean) return { ok: false, reason: "resume_changed" };
    result = clean;

    const bytes = Buffer.from(pdfBase64, "base64");
    if (bytes.length < 8 || bytes.length > 10 * 1024 * 1024 || bytes.subarray(0, 4).toString("latin1") !== "%PDF") {
      return { ok: false, reason: "That doesn't look like a compiled PDF — regenerate and try again." };
    }

    const row = await loadApplicationRow(supabase, applicationId);
    const { data: inserted, error } = await supabase
      .from("tailored_resumes")
      .insert({
        owner_id: userId,
        application_id: applicationId,
        company_name: row.company_name,
        role_title: row.role_title,
        compiler: result.compiler,
        tex: result.tex,
        keywords: result.keywords,
        changes: result.changes,
        page_warning: result.pageWarning,
      })
      .select("id")
      .single();
    if (error) throw error;
    const id = (inserted as { id: string }).id;

    const { error: uploadError } = await supabase.storage
      .from("tailored-resumes")
      .upload(`${userId}/${id}.pdf`, bytes, { upsert: true, contentType: "application/pdf" });
    if (uploadError) {
      await supabase.from("tailored_resumes").delete().eq("id", id);
      throw uploadError;
    }

    revalidatePath("/resumes");
    return { ok: true, id };
  } catch (e) {
    return { ok: false, reason: errorReason(e) };
  }
}

export async function deleteTailoredResume(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const supabase = await createClient();
    const userId = await requireUser(supabase);
    if (!userId) return { ok: false, reason: "Not signed in." };
    await supabase.storage.from("tailored-resumes").remove([`${userId}/${id}.pdf`]);
    const { error } = await supabase.from("tailored_resumes").delete().eq("id", id);
    if (error) throw error;
    revalidatePath("/resumes");
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: errorReason(e) };
  }
}

/** Short-lived signed URL for a saved PDF. */
export async function tailoredResumePdfUrl(id: string): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  try {
    const supabase = await createClient();
    const userId = await requireUser(supabase);
    if (!userId) return { ok: false, reason: "Not signed in." };
    const { data, error } = await supabase.storage
      .from("tailored-resumes")
      .createSignedUrl(`${userId}/${id}.pdf`, 60);
    if (error) throw error;
    return { ok: true, url: data.signedUrl };
  } catch (e) {
    return { ok: false, reason: errorReason(e) };
  }
}

/** The saved .tex for a tailored resume (download button on the Resumes tab). */
export async function tailoredResumeTex(id: string): Promise<{ ok: true; tex: string } | { ok: false; reason: string }> {
  try {
    const supabase = await createClient();
    const userId = await requireUser(supabase);
    if (!userId) return { ok: false, reason: "Not signed in." };
    const { data, error } = await supabase.from("tailored_resumes").select("tex").eq("id", id).single();
    if (error) throw error;
    return { ok: true, tex: (data as { tex: string }).tex };
  } catch (e) {
    return { ok: false, reason: errorReason(e) };
  }
}
