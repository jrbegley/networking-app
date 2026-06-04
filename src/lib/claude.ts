import Anthropic from "@anthropic-ai/sdk";
import { summarizeApolloPayload } from "@/lib/apollo-summary";
import { summarizeTavilyPayload } from "@/lib/tavily-summary";

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

You will be given:
1. A profile of the SENDER (the user) — their background, resume, goals.
2. A profile of the RECIPIENT — name, possibly title, company, research notes.

# CRITICAL OPERATING RULES

1. You MUST ALWAYS produce a draft in the SUBJECT/BODY format below. NEVER ask the user clarifying questions. NEVER refuse. NEVER explain what you'd need to do better. If the recipient info is sparse, write the best short, curious email you can with what's available.
2. NEVER invent specific facts about the recipient (no fake school, no fake project, no fake mutual connection). If you don't have a fact, write around it.
3. Real common ground between sender and recipient is the strongest opener. If a genuine overlap exists in the provided data — same school, same prior employer, same field, same city, a project that connects — use it. If no genuine overlap is provided, default to specific curiosity about the recipient's role or company instead, without claiming knowledge you don't have.

# CRAFT RULES

Drafts must:
- Be SHORT. 80–130 words max. Recipients are busy and scan inboxes.
- Sound like a real human wrote them, not an AI. No stock phrases like "I hope this email finds you well," "I came across your profile," or "I'd love to pick your brain."
- Have a clear, specific subject line — never generic like "Hello" or "Quick question."
- Reference at least one specific thing about the recipient: their role, their company, their industry, their title — whatever IS given.
- Have a single, low-friction ask. Most often: a 15-minute call, an introduction, or advice on a narrow topic. Never multiple asks.
- Open with something other than "My name is..." or "I am a..." — a real human starts mid-thought. Save the credential drop for the second sentence, if at all.
- Close with a soft, specific call to action — a proposed time window, an offer to make it easy, or a thank-you that doesn't demand a response.
- Use the recipient's first name only.

Style:
- Active voice. Concrete nouns. No hedging adverbs ("really," "just," "actually").
- No exclamation marks unless quoting someone.
- Vary sentence length, but lean shorter than longer.
- Don't sign off with the user's name — the email client adds the signature.

# OUTPUT FORMAT (strict — never deviate, never wrap in code blocks, never preface)

SUBJECT: <subject line>
BODY:
Hi <first name>,

<the email body, two-to-five short paragraphs.>

That is the ONLY acceptable output. No commentary before, after, or around it.`;

export type Draft = {
  subject: string;
  body: string;
  /** Token usage from the response — useful for billing transparency. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

export type SenderProfile = {
  bio: string | null;
  resumeText: string | null;
  outreachGoal: string | null;
  linkedinUrl: string | null;
};

function formatSenderProfile(p: SenderProfile): string | null {
  const sections: string[] = [];
  if (p.bio) sections.push(`# Background\n${p.bio}`);
  if (p.outreachGoal) sections.push(`# Outreach goal\n${p.outreachGoal}`);
  if (p.resumeText) sections.push(`# Resume / detailed history\n${p.resumeText}`);
  if (p.linkedinUrl) sections.push(`# Sender's LinkedIn\n${p.linkedinUrl}`);
  return sections.length > 0
    ? `SENDER PROFILE:\n\n${sections.join("\n\n")}`
    : null;
}

/**
 * Generate an outreach email draft given contact context.
 *
 * Two cache breakpoints to maximize hit rate:
 *   1. The system prompt (stable across all users)
 *   2. The sender's profile (stable across all drafts for one user)
 * The per-contact context is fresh per request.
 */
export async function draftOutreachEmail(opts: {
  contactName: string;
  contactTitle: string | null;
  companyName: string | null;
  companyIndustry: string | null;
  linkedinUrl: string | null;
  apolloPayload: unknown | null;
  tavilyPayload: unknown | null;
  userNotes: string | null;
  /** Free-form research the user typed in to supplement Apollo / Tavily. */
  researchNotes: string | null;
  sender: SenderProfile;
}): Promise<Draft> {
  const ctxLines: string[] = [];
  ctxLines.push("RECIPIENT:");
  ctxLines.push(`- Name: ${opts.contactName}`);
  if (opts.contactTitle) ctxLines.push(`- Title: ${opts.contactTitle}`);
  if (opts.companyName) ctxLines.push(`- Company: ${opts.companyName}`);
  if (opts.companyIndustry)
    ctxLines.push(`- Industry: ${opts.companyIndustry}`);
  if (opts.linkedinUrl) ctxLines.push(`- LinkedIn: ${opts.linkedinUrl}`);
  if (opts.userNotes) ctxLines.push(`\nUser's notes about this person:\n${opts.userNotes}`);

  if (opts.apolloPayload) {
    const apolloSummary = summarizeApolloPayload(opts.apolloPayload);
    if (apolloSummary) {
      ctxLines.push(`\nApollo research on recipient:\n${apolloSummary}`);
    }
  }

  if (opts.tavilyPayload) {
    const tavilySummary = summarizeTavilyPayload(opts.tavilyPayload);
    if (tavilySummary) {
      ctxLines.push(`\nWeb research on recipient (Tavily):\n${tavilySummary}`);
    }
  }

  if (opts.researchNotes) {
    ctxLines.push(
      `\nUser's own research notes (treat as authoritative — these are first-hand observations):\n${opts.researchNotes}`,
    );
  }

  const userMessage = `Draft an outreach email.\n\n${ctxLines.join("\n")}`;
  const senderProfileText = formatSenderProfile(opts.sender);

  // Build system array. Always include the base prompt (cached). If the user
  // has a profile, append it as a second cached block.
  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: DRAFT_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
  ];
  if (senderProfileText) {
    systemBlocks.push({
      type: "text",
      text: senderProfileText,
      cache_control: { type: "ephemeral" },
    });
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: systemBlocks,
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

// summarizeApolloPayload now lives in src/lib/apollo-summary.ts so the
// detail page and the drafting prompt share one implementation.
