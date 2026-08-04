export type ParagraphRole =
  | "letterhead" | "date" | "recipient" | "salutation" | "body" | "closing" | "signature";

const ROLES: readonly ParagraphRole[] = [
  "letterhead", "date", "recipient", "salutation", "body", "closing", "signature",
];

export type LetterClassification = { roles: ParagraphRole[]; bodyStart: number; bodyEnd: number };
export type CoverLetterContent = { date: string; recipient: string[]; salutation: string; body: string[] };
export type CoverLetterContext = {
  templateText: string; resumeText: string | null; jobDescription: string;
  companyName: string; roleTitle: string; location: string | null; today: string;
};

function clampInt(v: unknown, lo: number, hi: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Never throws. Unknown/missing roles become "letterhead" (safest: untouched). */
export function validateClassification(raw: unknown, paragraphCount: number): LetterClassification {
  const safe = (): LetterClassification => ({
    roles: Array.from({ length: paragraphCount }, () => "letterhead" as ParagraphRole),
    bodyStart: -1, bodyEnd: -1,
  });
  try {
    const o = raw as { roles?: unknown; bodyStart?: unknown; bodyEnd?: unknown };
    if (!o || !Array.isArray(o.roles)) return safe();
    const rolesArray = o.roles as unknown[];
    const roles: ParagraphRole[] = Array.from({ length: paragraphCount }, (_, i) => {
      const r = rolesArray[i];
      return ROLES.includes(r as ParagraphRole) ? (r as ParagraphRole) : "letterhead";
    });
    const hasBody = roles.includes("body");
    const bodyStart = hasBody ? clampInt(o.bodyStart, 0, paragraphCount - 1) : -1;
    const bodyEnd = hasBody ? clampInt(o.bodyEnd, 0, paragraphCount - 1) : -1;
    return { roles, bodyStart: Math.min(bodyStart, bodyEnd), bodyEnd: Math.max(bodyStart, bodyEnd) };
  } catch {
    return safe();
  }
}

/** Never throws. body is always >= 1 paragraph. */
export function validateCoverLetterContent(raw: unknown): CoverLetterContent {
  const safe: CoverLetterContent = { date: "", recipient: [], salutation: "", body: [""] };
  try {
    const o = raw as Partial<CoverLetterContent>;
    if (!o || typeof o !== "object") return safe;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const body = arr(o.body);
    return {
      date: str(o.date),
      recipient: arr(o.recipient),
      salutation: str(o.salutation),
      body: body.length ? body : [""],
    };
  } catch {
    return safe;
  }
}
