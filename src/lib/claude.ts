import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Pin the model so behavior is predictable; bump when we want to upgrade.
const MODEL = "claude-sonnet-4-5-20250929";

/**
 * System prompt for cold-email drafting. Kept in its own constant + flagged
 * with cache_control so subsequent drafts in the same window are cheap.
 *
 * The hard token threshold for prompt caching is 1024 — keep this long
 * enough to clear it. (It already does.)
 */
const DRAFT_SYSTEM_PROMPT = `You are an expert at writing networking outreach emails for a student or young professional. The user is reaching out to people they want to network with — recruiters, founders, people at companies they're interested in, alumni, etc.

Your drafts must:
- Be SHORT. 80-130 words max. Recipients are busy and scan inboxes.
- Sound like a real human wrote them, not an AI. No stock phrases like "I hope this email finds you well," "I came across your profile," or "I'd love to pick your brain."
- Have a clear, specific subject line — never generic like "Hello" or "Quick question."
- Reference one specific thing about the recipient (their role, company, a project, a recent piece of work, mutual context). The user will provide research context — use it. If nothing specific is given, ask the user a clarifying question rather than make something up.
- Have a single, low-friction ask. Most often: a 15-minute call, an introduction, advice on a narrow topic. Never multiple asks.
- Open with something other than "My name is..." or "I am a..." — a real human starts mid-thought. Save the credential drop for the second sentence, if at all.
- Close with a soft, specific call to action — a proposed time window, an offer to make it easy, or a thank-you that doesn't demand a response.
- Use the recipient's first name only.

Style rules:
- Active voice. Concrete nouns. No hedging adverbs ("really," "just," "actually").
- No exclamation marks unless quoting someone.
- Vary sentence length, but lean shorter than longer.
- Don't sign off with the user's name — the email client adds the signature.

OUTPUT FORMAT (strict — do not deviate):
SUBJECT: <subject line>
BODY:
<email body, no greeting prefix beyond "Hi <first name>," — the body starts on the next line after BODY:>

Do not add any commentary before, after, or around this format.`;

export type Draft = {
  subject: string;
  body: string;
  /** Token usage from the response — useful for billing transparency. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

/**
 * Generate an outreach email draft given contact context.
 *
 * The system prompt is cache-flagged. The per-contact context lives in the
 * user message; it's small so caching it wouldn't help much.
 */
export async function draftOutreachEmail(opts: {
  contactName: string;
  contactTitle: string | null;
  companyName: string | null;
  companyIndustry: string | null;
  linkedinUrl: string | null;
  apolloPayload: unknown | null;
  userNotes: string | null;
}): Promise<Draft> {
  const ctxLines: string[] = [];
  ctxLines.push(`Recipient name: ${opts.contactName}`);
  if (opts.contactTitle) ctxLines.push(`Title: ${opts.contactTitle}`);
  if (opts.companyName) ctxLines.push(`Company: ${opts.companyName}`);
  if (opts.companyIndustry)
    ctxLines.push(`Industry: ${opts.companyIndustry}`);
  if (opts.linkedinUrl) ctxLines.push(`LinkedIn: ${opts.linkedinUrl}`);
  if (opts.userNotes) ctxLines.push(`\nUser's notes:\n${opts.userNotes}`);

  if (opts.apolloPayload) {
    const apolloSummary = summarizeApolloPayload(opts.apolloPayload);
    if (apolloSummary) {
      ctxLines.push(`\nApollo research:\n${apolloSummary}`);
    }
  }

  const userMessage = `Draft an outreach email to this person.\n\n${ctxLines.join("\n")}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: [
      {
        type: "text",
        text: DRAFT_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();

  const { subject, body } = parseDraft(text);

  return {
    subject,
    body,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
  };
}

function parseDraft(text: string): { subject: string; body: string } {
  // Tolerant parser: case-insensitive, handles leading whitespace, allows the
  // SUBJECT/BODY headers in any reasonable casing.
  const subjectMatch = text.match(/^\s*SUBJECT:\s*(.+?)\s*$/im);
  const bodyMatch = text.match(/BODY:\s*([\s\S]+)$/i);
  return {
    subject: subjectMatch?.[1]?.trim() ?? "(no subject)",
    body: bodyMatch?.[1]?.trim() ?? text.trim(),
  };
}

/**
 * Apollo payloads are huge JSON blobs. Extract the high-signal bits as a
 * short human-readable summary so Claude isn't drowning in noise.
 */
function summarizeApolloPayload(payload: unknown): string | null {
  const person = (payload as { person?: Record<string, unknown> })?.person;
  if (!person) return null;

  const lines: string[] = [];
  const get = (k: string) => {
    const v = person[k];
    return typeof v === "string" ? v : null;
  };
  if (get("title")) lines.push(`- Title: ${get("title")}`);
  const loc = [get("city"), get("state"), get("country")]
    .filter(Boolean)
    .join(", ");
  if (loc) lines.push(`- Location: ${loc}`);

  const org = (person.organization as Record<string, unknown>) ?? null;
  if (org) {
    if (typeof org.name === "string") lines.push(`- Company: ${org.name}`);
    if (typeof org.industry === "string")
      lines.push(`- Industry: ${org.industry}`);
    if (typeof org.estimated_num_employees === "number")
      lines.push(`- Company size: ~${org.estimated_num_employees} employees`);
  }

  const history = person.employment_history as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(history) && history.length > 0) {
    const recent = history.slice(0, 3);
    const lines2 = recent
      .map((h) => {
        const t = typeof h.title === "string" ? h.title : null;
        const o =
          typeof h.organization_name === "string"
            ? h.organization_name
            : null;
        return t && o ? `  • ${t} at ${o}` : null;
      })
      .filter(Boolean);
    if (lines2.length > 0) {
      lines.push("- Recent roles:");
      lines.push(...(lines2 as string[]));
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}
