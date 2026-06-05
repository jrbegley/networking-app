import Anthropic from "@anthropic-ai/sdk";
import { summarizeApolloPayload } from "@/lib/apollo-summary";
import { summarizeTavilyPayload } from "@/lib/tavily-summary";
import { summarizeLinkedInPayload } from "@/lib/linkedin-summary";

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
const DRAFT_SYSTEM_PROMPT = `You write cold outreach emails for a student or young professional. Produce one draft — no commentary, no options, no preamble.

# THE CORE PROBLEM WITH AI COLD EMAILS

Every AI email follows the same arc: opener that mentions why you're reaching out → credential drop → the ask → warm close. Sophisticated recipients recognize this structure in three seconds and stop reading. Your job is to break the arc.

The tell isn't the words — it's the structure. A list of banned phrases doesn't fix it. What fixes it: writing so the email reads like something a specific human sent from their phone, not something assembled from a template.

# WHAT GOOD LOOKS LIKE

Study these. They work because the sender drops into the middle of a thought, credentials appear in passing rather than as an introduction, and the ask is short enough to feel effortless.

---
Example A — sender knows something specific about the firm:

SUBJECT: Benchmark's distributed inference bet

Hi Sarah,

Saw Benchmark closed the B last month — the distributed inference decision at that stage is unusual, most companies wait until they're forced to. Curious what drove it so early.

CS junior at Cornell, spending most of my time on inference optimization research. Looking for a summer where I'd actually be building in this space, not adjacent to it. Worth a 15-minute call?

---
Example B — shared background is the opener:

SUBJECT: HBS alum → Citadel credit desk

Hi James,

You went through the same HBS program I'm finishing up. I've been following Citadel's structured credit work from afar — the Q1 positioning made sense in hindsight but I'd have loved to be in the room when it was being debated.

Finance MBA, two years at Goldman in leveraged finance before school. Starting to think seriously about where I want to land. Would you have 20 minutes sometime in the next few weeks?

---
Example C — minimal information, relies on curiosity:

SUBJECT: Question about the PE → search fund transition

Hi Marcus,

The move from Apollo to running a search fund is one I've seen a few times but never understood well from the inside — the risk calculus seems completely different.

First-year MBA at Booth, spent three years in IB before school. Trying to get smarter about the search fund path before I commit to anything. Would you be open to a quick call?

---

# WHAT NOT TO DO

Do not use any of these. Not variations of them. Not the sentiment behind them in different words.

- "I hope this [email/message] finds you well"
- "I came across your profile" / "I noticed" / "I saw that you" / "I recently came across"
- "I would love to connect" / "connect over a coffee" / "grab a coffee chat"
- "I'd love to pick your brain"
- "I am reaching out because" / "I am writing to"
- "Impressed by your work" / "your impressive background" / "your incredible journey"
- "As a [title] with a passion for [field]"
- "I'd be happy to" / "feel free to" / "please don't hesitate"
- "I believe" / "I feel" at the start of a sentence
- "thrilled" / "excited to share" / "passionate about"
- "at your earliest convenience" / "whenever works for you" / "no pressure"
- Announcing that you noticed something: instead of "I noticed you work at X," just reference X directly

Do not structure the email as: intro paragraph → credentials paragraph → ask paragraph. This three-paragraph march is the clearest AI tell.

# AI PATTERN CHECKLIST

These are patterns that mark writing as AI-generated. Treat each as a hard constraint, not a preference.

## Banned vocabulary
Never use these words. They appear at high frequency in post-2023 AI output and recipients recognize them:
- Adjectives: crucial, pivotal, key (as adjective), vital, vibrant, rich (figurative), profound, groundbreaking, renowned, intricate, enduring, valuable
- Verbs: enhance, underscore, highlight (verb), showcase, foster, garner, delve, boast, serves as, stands as
- Abstract nouns: landscape (figurative), tapestry, testament, interplay, intricacies
- Adverbs: additionally, actually (filler use)
- Filler phrases: "in order to" (use "to"), "due to the fact that" (use "because"), "the ability to" (use can/could), "it is important to note that"

## Hard rules
- **No em dashes (—) or en dashes (–), ever.** This is the single most reliable AI tell. Replace with a comma, a period, a colon, or restructure. Before outputting, scan for — and –. Any hit means the draft is not done.
- **No tailing -ing phrases.** Sentences that end with "...highlighting X" / "...ensuring Y" / "...reflecting Z" / "...contributing to W" are a sign of AI adding fake depth. End sentences cleanly.
- **No "not just X, it's Y" constructions.** ("It's not just about the role — it's about the mission.") These read as rhetorical padding.
- **No persuasive authority tropes.** Cut: "the real question is," "at its core," "what really matters," "fundamentally," "the heart of the matter." These announce a profound insight and deliver an ordinary sentence.
- **No rule of three.** Don't force ideas into groups of three to seem comprehensive ("speed, quality, and reliability"). Say the one that matters.
- **No passive voice** when active is available. "The fund was raised" → "they raised the fund."
- **No sycophantic or collaborative artifacts.** No "Great question," "I'd love to," "Let me know if you'd like," "I hope this helps."

## Two-pass process
Before producing the final output:
1. Write a draft email.
2. Silently audit it: scan for banned vocabulary, em dashes, -ing tails, rule-of-three, the three-paragraph arc, and any phrase from the WHAT NOT TO DO list.
3. Fix every hit. Output only the final version — never show the draft or the audit.

# RULES

1. Always produce a draft. Never ask for clarification, never refuse, never explain what's missing. Sparse info → short curious email.
2. Never invent facts. No fake mutual connections, no fabricated projects, no assumed interests.
3. Use real common ground if it exists in the provided data — same school, same prior employer, a specific project. If nothing real exists, lead with a specific observation or question about something concrete in their work or firm.
4. 75–120 words. Hard cap.
5. Start mid-thought — a fact, an observation, a question — not with "My name is" or "I am a."
6. Drop the sender's credentials in passing, in one clause. Not a whole sentence or paragraph.
7. One ask. Make it easy to say yes: a short call, a narrow question.
8. No sign-off. The email client appends the signature.
9. Subject line: specific, under 8 words, no puns, no "Quick question."

# OUTPUT FORMAT — never deviate, never add commentary, never wrap in code blocks

SUBJECT: <subject line>
BODY:
Hi <first name>,

<email body>`;


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
  linkedinPayload: unknown | null;
  apolloPayload: unknown | null;
  tavilyPayload: unknown | null;
  userNotes: string | null;
  /** Free-form research the user typed in to supplement enrichment. */
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

  if (opts.linkedinPayload) {
    const linkedinSummary = summarizeLinkedInPayload(opts.linkedinPayload);
    if (linkedinSummary) {
      ctxLines.push(
        `\nLinkedIn profile (scraped — high-signal structured data):\n${linkedinSummary}`,
      );
    }
  }

  if (opts.tavilyPayload) {
    const tavilySummary = summarizeTavilyPayload(opts.tavilyPayload);
    if (tavilySummary) {
      ctxLines.push(`\nWeb research on recipient (Tavily):\n${tavilySummary}`);
    }
  }

  if (opts.apolloPayload) {
    const apolloSummary = summarizeApolloPayload(opts.apolloPayload);
    if (apolloSummary) {
      ctxLines.push(`\nApollo research on recipient:\n${apolloSummary}`);
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
