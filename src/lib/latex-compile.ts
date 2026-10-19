// The only module that knows about the LaTeX compile service.
// Default is YtoTech's public LaTeX-on-HTTP; point LATEX_COMPILE_URL at a
// self-hosted instance of the same API to keep resume source private.
import type { Compiler } from "./resume-optimizer-types";

export type CompileResult =
  | { ok: true; pdf: Uint8Array }
  | { ok: false; log: string };

const DEFAULT_URL = "https://latex.ytotech.com/builds/sync";
const TIMEOUT_MS = 60_000;
const LOG_TAIL_LINES = 40;

export function logTail(text: string, lines = LOG_TAIL_LINES): string {
  const all = text.trimEnd().split("\n");
  return all.slice(Math.max(0, all.length - lines)).join("\n");
}

export async function compileLatex(source: string, compiler: Compiler): Promise<CompileResult> {
  const url = process.env.LATEX_COMPILE_URL || DEFAULT_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/pdf, application/json" },
      body: JSON.stringify({
        compiler,
        resources: [{ main: true, content: source }],
        options: { compiler: { halt_on_error: true } },
      }),
      signal: controller.signal,
    });
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && type.includes("application/pdf")) {
      return { ok: true, pdf: new Uint8Array(await res.arrayBuffer()) };
    }
    const body = await res.text();
    // The service returns {"logs": "..."} on compile errors; fall back to raw text.
    let log = body;
    try {
      const parsed = JSON.parse(body) as { logs?: unknown; error?: unknown };
      if (typeof parsed.logs === "string") log = parsed.logs;
      else if (typeof parsed.error === "string") log = parsed.error;
    } catch { /* not JSON */ }
    return { ok: false, log: logTail(log || `Compile service returned HTTP ${res.status}`) };
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError"
      ? `Compile service timed out after ${TIMEOUT_MS / 1000}s`
      : e instanceof Error ? e.message : String(e);
    return { ok: false, log: msg };
  } finally {
    clearTimeout(timer);
  }
}
