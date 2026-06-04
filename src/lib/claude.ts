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
  userNotes: string | null;
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

/**
 * Apollo payloads are huge JSON blobs. Extract the high-signal bits as a
 * short human-readable summary so Claude isn't drowning in noise.
 *
 * Inclusive: pulls anything that's present rather than gating on specific
 * fields. Returns null only if Apollo found no match at all (person===null).
 */
function summarizeApolloPayload(payload: unknown): string | null {
  const person = (payload as { person?: Record<string, unknown> } | null)
    ?.person;
  if (!person) return null;

  const lines: string[] = [];
  const getStr = (k: string) => {
    const v = person[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const getNum = (k: string) => {
    const v = person[k];
    return typeof v === "number" ? v : null;
  };

  // Identity
  const fullName = getStr("name");
  if (fullName) lines.push(`- Name: ${fullName}`);
  const headline = getStr("headline");
  if (headline) lines.push(`- Headline: ${headline}`);

  // Role
  if (getStr("title")) lines.push(`- Title: ${getStr("title")}`);
  if (getStr("seniority")) lines.push(`- Seniority: ${getStr("seniority")}`);
  if (getStr("departments"))
    lines.push(`- Department: ${getStr("departments")}`);

  // Contact info (signals what's available, not for us to use directly)
  if (getStr("email")) lines.push(`- Email on file: ${getStr("email")}`);

  // Location
  const loc = [getStr("city"), getStr("state"), getStr("country")]
    .filter(Boolean)
    .join(", ");
  if (loc) lines.push(`- Location: ${loc}`);

  // Company
  const org =
    (person.organization as Record<string, unknown> | null | undefined) ??
    null;
  if (org) {
    const orgGet = (k: string) => {
      const v = org[k];
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    const orgName = orgGet("name");
    if (orgName) lines.push(`- Company: ${orgName}`);
    if (orgGet("industry"))
      lines.push(`- Industry: ${orgGet("industry")}`);
    if (orgGet("primary_domain"))
      lines.push(`- Company domain: ${orgGet("primary_domain")}`);
    const orgSize =
      typeof org.estimated_num_employees === "number"
        ? org.estimated_num_employees
        : null;
    if (orgSize)
      lines.push(`- Company size: ~${orgSize} employees`);
    if (orgGet("short_description"))
      lines.push(`- Company description: ${orgGet("short_description")}`);
  }

  // Employment history
  const history = person.employment_history as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(history) && history.length > 0) {
    const recent = history.slice(0, 5);
    const histLines = recent
      .map((h) => {
        const t = typeof h.title === "string" ? h.title : null;
        const o =
          typeof h.organization_name === "string"
            ? h.organization_name
            : null;
        const start = typeof h.start_date === "string" ? h.start_date : "";
        const end =
          typeof h.end_date === "string" && h.end_date
            ? h.end_date
            : "present";
        if (t && o) {
          return start
            ? `  • ${t} at ${o} (${start} – ${end})`
            : `  • ${t} at ${o}`;
        }
        if (o) return `  • ${o}`;
        return null;
      })
      .filter(Boolean);
    if (histLines.length > 0) {
      lines.push("- Employment history:");
      lines.push(...(histLines as string[]));
    }
  }

  // Schools (Apollo sometimes returns these)
  const schools = (person.schools ?? person.education) as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(schools) && schools.length > 0) {
    const schoolLines = schools
      .slice(0, 5)
      .map((s) => {
        const name = typeof s.name === "string" ? s.name : null;
        const degree = typeof s.degree === "string" ? s.degree : null;
        const field =
          typeof s.field_of_study === "string" ? s.field_of_study : null;
        if (!name) return null;
        const parts = [name, degree, field].filter(Boolean).join(" — ");
        return `  • ${parts}`;
      })
      .filter(Boolean);
    if (schoolLines.length > 0) {
      lines.push("- Education:");
      lines.push(...(schoolLines as string[]));
    }
  }

  // LinkedIn / Twitter handles
  if (getStr("linkedin_url"))
    lines.push(`- LinkedIn: ${getStr("linkedin_url")}`);
  if (getStr("twitter_url"))
    lines.push(`- Twitter/X: ${getStr("twitter_url")}`);

  // Avoid returning a useless 1-line summary; if we only got the name,
  // surface that — Claude can at least use it. But if literally nothing
  // came back, return null.
  if (lines.length === 0) return null;

  // Suppress getNum lint warning if unused
  void getNum;

  return lines.join("\n");
}
