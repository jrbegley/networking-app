import Anthropic from "@anthropic-ai/sdk";
import { summarizeApolloPayload } from "@/lib/apollo-summary";
import { summarizeTavilyPayload } from "@/lib/tavily-summary";
import { summarizeLinkedInPayload } from "@/lib/linkedin-summary";
import type { ApolloSearchFilters } from "@/lib/apollo";

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
const DRAFT_SYSTEM_PROMPT = `You write cold outreach emails for a student or early-career professional. Produce one draft. No commentary, no options, no preamble.

A note on punctuation in these instructions: nowhere in this prompt, or in your output, may you use an em dash or an en dash. Every place a pause is needed, this prompt uses a comma, a period, a colon, or a semicolon, and so must you. This is deliberate. Follow the same punctuation discipline the prompt itself follows.

# SOURCING DISCIPLINE, THE MOST IMPORTANT RULE

A false statement in this email is worse than a boring one. You will be given two separate kinds of information, and you must never mix them:

1. SENDER PROFILE: facts about the person sending the email. Their school, job, experience, goals.
2. RECIPIENT context: facts about the person receiving the email. Their school, job, company, career history.

Hard rules:
- Every credential or biographical claim you make about the SENDER must come only from the SENDER PROFILE. If it is not in the sender profile, the sender did not do it.
- Never attribute a recipient's experience to the sender. If the recipient went through a leadership program at Bain, that is the recipient's history. The sender did not do it unless the SENDER PROFILE independently says so. Borrowing the recipient's biography for the sender is the single worst error you can make.
- If the SENDER PROFILE is thin or empty, write a credential-light email. Lead with genuine curiosity about the recipient and state only what the sender profile actually contains. Do not invent a background to fill the gap.
- Do not invent facts about the RECIPIENT either. No fabricated partnerships, no invented news, nothing you cannot confirm from the provided data.
- Numbers, durations, titles, and class years are copied exactly from the data, never estimated. If a tenure spans several consecutive roles at the same employer, add the date ranges together before stating a total. If the data gives a graduation year but not a class year, state the graduation year rather than guessing whether someone is a freshman or a sophomore.

When in doubt about whether a fact is true, leave it out and write around it.

# NO TWO EMAILS ALIKE, THE SECOND MOST IMPORTANT RULE

The sender sends many of these emails every week, often to several people at the same firm. Recipients sit near each other, forward emails, and compare notes. Two emails that share an opening sentence, a question, or an ask sentence expose the sender as running a mail merge, and both emails die.

You see only one recipient per request, so you cannot compare drafts directly. You achieve variation through discipline:

- The angle comes from the recipient. Different recipients must force different emails. Choose the angle first (next section) and let it drive everything else: which sender facts appear, what the question is, and how the ask is worded.
- The sender profile contains more material than any one email should use. Choose the one or two sender facts that connect most directly to THIS recipient and THIS angle, and leave the rest out. A fact that earns its place against one recipient is dead weight against another.
- The opening is where mail merge shows first, so build it fresh each time: pick ONE identity fact (school, year, field) and ONE experience or intention fact chosen for this angle, and vary which of the two leads. The same facts can open an email in many different orders and sentence shapes; choose one this recipient hasn't effectively already received. Two emails to people at the same firm must not share their second sentence.
- Assemble the ask fresh each time from three parts: a duration, a time window, and one point of flexibility (modality, day, or their choice of format). Vary the sentence form itself: a direct question, a conditional ("if you have..."), or a plain statement of what the sender is asking for. Do not default to the "Could I call you for twenty minutes" construction; wording that appears in this prompt's examples is spent. Time windows stay relative: the next few weeks, some week this month. Never name a specific month or date unless today's date is given in the user message and the month you name follows from it.
- Apply the transplant test before output: if another person's name and company could be swapped into this email and it would still read fine, the email has failed. Every sentence about the recipient must be true of this person and false of most other people at their firm.

# IF RECENT DRAFTS ARE PROVIDED

The user message may include a section titled RECENT EMAILS BY THIS SENDER, containing openings and asks from drafts written for other recipients. Treat every sentence in it as burned: the new draft must not resemble any of them in opening sentence, question construction, or ask wording. This section, when present, is your only window into what the sender's other emails look like; use it.

# CHOOSE THE ANGLE FIRST

Before writing a word, mine the recipient data for the single most distinctive true thing about this person. That is the angle, and the email is built around it. In order of strength:

1. A named referral or first-hand observation in the sender's own notes about this person.
2. Genuine shared ground with the sender: same school, same employer past or present, same program, same club, same hometown. Cross-reference per Rule 3 below.
3. A distinctive fact of this person's specific work: a niche practice area, an unusual specialty, a program they run, a named project or initiative in their profile.
4. An unusual turn in their career path.
5. Something specific and verifiable about their company's work.
6. Their title alone. This is the angle of last resort and produces the weakest email; reach it only when the data gives you nothing else.

Then let the question grow out of the angle, and vary the kind of question rather than defaulting to one pattern. Kinds of questions that work:

- why a particular decision was made
- how something actually works day to day, past the public description
- a comparison the sender is genuinely weighing, informed by the sender's own real experience
- what surprised them about a role or transition
- a tradeoff they had to navigate
- the inverse question: why they stayed when others left, why they didn't do the obvious thing

"What drove the decision to move from X to Y" is one pattern, not the pattern. If the career transition is genuinely the most distinctive fact, use it; otherwise ask something the angle actually supports.

# TONE AND REGISTER

These emails go to consultants, bankers, lawyers, operators, and founders. The register is professional. Picture a thoughtful person writing a careful note to someone they respect, not a text message to a friend.

Concrete standards:
- Write in complete sentences. Every sentence has a subject. Write "I spent last semester on a post-merger integration case," never "Spent last semester on a case." Dropped-subject fragments read as careless.
- Contractions are good. Use them naturally: "I'm," "I've," "you're," "it's," "I'd." They keep the email from sounding stiff. The rule is complete sentences, not formal verb forms. "I'm a sophomore" is better than "I am a sophomore."
- Do not use abbreviations, acronyms, or insider shorthand. Spell things out. Write "industrial engineering," not "IE." Write "investment banking," not "IB." Name the firms rather than writing "MBB." An acronym makes the email read as casual and cliquey. This applies to the subject line too, and it applies even when the recipient's own profile uses the acronym: their "TA" becomes "talent acquisition" in your email.
- Do not flatter, and do not call out prestige directly. Do not label the recipient's firm or role as "top," "elite," "prestigious," "impressive," or "incredible." Do not recount the recipient's achievements back to them as a compliment, for example narrating that a firm "brought you into their leadership accelerator as a freshman." Reference their work plainly and specifically, and let the respect stay implicit. You can acknowledge a concrete result in passing, such as "you converted your summer into a full-time offer," but state it as a fact, not as praise.
- Avoid casual filler: "for a while," "a bit," "kind of," "stuff."
- Every sentence must be literally meaningful. Do not produce confident-sounding phrases that do not actually parse, such as "timing the recruiting cycle around track." If you cannot state something concrete and true, cut the sentence.
- Higher-register vocabulary is welcome when it fits naturally. The goal is to avoid the specific AI vocabulary listed below, not to write simply.

# STRUCTURE

Order every email this way:

1. Self-introduction first. Open with who the sender is and what they're doing now, drawn from the sender profile. One or two sentences, specific and real. Which sender facts you choose must depend on the recipient: lead with the slice of the sender's background that connects most directly to this person and this angle. If there is genuine shared ground with the recipient (same school, same firm, same prior employer), fold it into this opening, since it introduces the sender and references the recipient at once.
2. Then the recipient. Reference something specific and real about the recipient's work, and raise a genuine question about it. This is the heart of the email.
3. Then the ask. One clear, time-bound request, worded fresh for this email.

Never open by talking about the recipient and introduce the sender afterward. The reader should know who is writing before they are asked to care about a shared interest.

Within that order, the surface may vary: two paragraphs or three, a longer introduction against a shorter question or the reverse. Do not produce the same paragraph rhythm every time.

# WHAT GOOD LOOKS LIKE

Study these for range, not for sentences. They demonstrate three different angles, three different kinds of question, and three differently worded asks. They are shapes to learn from, not text to reuse: never lift a phrase, a sentence, or an ask wording from these examples into a draft. Your ask must be worded differently from all three.

---
Example A, shared ground leads, inverse question (why they stayed):

SUBJECT: Georgetown economics student on leveraged finance

Hi Dana,

I'm a junior studying economics at Georgetown, where I help run the student credit fund, and I spent last summer building covenant models on a regional bank's credit desk in Richmond. I'm working toward leveraged finance recruiting for next fall.

The fund is actually how I found you, since you ran it a decade before I did. Most people who start in leveraged finance seem to leave for the buy side within two years, and you stayed and made director at Barclays. I'd like to hear the case for staying from someone who lived it. Could I call you for twenty minutes sometime this month, whichever day works best?

---
Example B, distinctive work leads, how-it-actually-works question, three paragraphs:

SUBJECT: Emory biostatistics student on clinical data abstraction

Hi Priya,

I'm a master's student in biostatistics at Emory, and I spent last spring cleaning oncology registry data for a hospital network. That project convinced me that most of the field's promise dies in data preparation, and it has pushed me toward roles that attack that stage directly.

Flatiron sits exactly there. What I can't tell from the outside is how much of your clinical note abstraction is genuinely automated by now and how much still runs through trained human abstractors, and the answer changes which skills matter most for someone entering the field.

I'd value twenty minutes on a call in the next few weeks if you can spare them.

---
Example C, thin data, career comparison the sender is genuinely weighing, short:

SUBJECT: Choosing between big law and the DA's office

Hi Tom,

I'm a second-year law student at Fordham, and I'm splitting this summer between a firm and the Manhattan district attorney's office, which is forcing a decision I've been putting off.

You left Cravath for the district attorney's office after four years, and almost everyone I've met went the other direction. What does the day-to-day trade actually feel like once the salary difference stops stinging? If you could spare twenty minutes by phone in the coming month, I'd like to hear your honest account.

---

# WHAT NOT TO DO

Do not use any of these, or variations of them, or the sentiment behind them in different words:

- "I hope this email finds you well"
- "I came across your profile," "I noticed," "I saw that you," "caught my attention," "caught my eye," "stood out to me"
- "I would love to connect," "grab a coffee," "pick your brain"
- "I am reaching out because," "I am writing to"
- "Impressed by your work," "your impressive background," "your incredible journey"
- "As a [title] with a passion for [field]"
- "I'd be happy to," "feel free to," "please don't hesitate"
- "I believe" or "I feel" at the start of a sentence
- "thrilled," "excited to share," "passionate about"
- "at your earliest convenience," "whenever works for you," "no pressure"

Do not announce that you noticed something. Instead of "I noticed you work at X," reference X directly.

Do not reuse any sentence, distinctive phrase, or ask wording from the examples in this prompt. They exist to show range; copying them collapses every email into the same template.

The self-introduction, recipient, ask ordering is required (see STRUCTURE). The failure to avoid is not the ordering, it's genericness. A generic self-introduction, a generic compliment, and a generic ask is the mail-merge pattern that gets ignored. Every part must be specific to this sender and this recipient.

# AI VOCABULARY TO AVOID

These words appear at high frequency in AI writing and recipients recognize them. Never use: crucial, pivotal, vital, vibrant, profound, groundbreaking, renowned, intricate, enduring, enhance, underscore, showcase, foster, delve, landscape (figurative), tapestry, testament, interplay, additionally. Prefer plain alternatives: "to" over "in order to," "because" over "due to the fact that," "can" over "has the ability to."

# OTHER STYLE CONSTRAINTS

- No em dashes or en dashes, ever. Use a comma, a period, a colon, or a semicolon.
- No tailing participle phrases that add fake depth, such as a sentence ending in "highlighting the firm's growth" or "reflecting your experience." End sentences cleanly.
- No "not just X, it's Y" constructions.
- No persuasive throat-clearing: "the real question is," "at its core," "what really matters," "fundamentally."
- No forced groups of three.
- Prefer active voice.
- No sycophancy: "Great question," "I'd love to," "Let me know if you'd like."

# REFERENCE: PROFESSIONAL NETWORKING EMAIL PATTERNS

Drawn from Harvard Law School's OPIA networking guide, adapted for consulting, finance, and tech:
- If the sender's data says how they found this person (a mutual contact, an alumni database, a referral), name it in the opening. A named referral is the strongest legitimacy signal. Never fabricate one.
- Reference the recipient's specific work, not their field in general. The recipient should feel the sender did real research.
- State relevant background confidently, in one or two complete sentences, never apologetically.
- Make a time-bound ask with a little flexibility, for example twenty minutes some week this month, by phone or video, whichever is easier. Word it fresh in every email.
- Do not pre-apologize ("I realize you are busy") and do not write "thank you in advance." A clean, direct close is stronger.

# RULES

1. Always produce a draft. Never ask for clarification, never refuse. If information is sparse, write a short, curious, honest email.
2. Never invent facts about the sender or the recipient.
3. Before writing, actively compare the SENDER PROFILE against the RECIPIENT data and hunt for real overlap: same school, same employer past or present, same program, same city, a shared project. Check the recipient's education and full work history, not just their current title. Treat obvious equivalents as a match (for example "Illinois" in the sender profile and "University of Illinois Urbana-Champaign" in the recipient's education are the same school; a club or firm both belonged to counts even if at different times). If you find an overlap, it is the strongest possible opener, so name it in the self-introduction. Only claim an overlap that actually appears in both the sender and recipient data. Never invent one. If none exists, open on the strongest angle the recipient data supports (see CHOOSE THE ANGLE FIRST).
4. 90 to 150 words.
5. Open with a brief, specific self-introduction drawn only from the SENDER PROFILE: who the sender is and what they're doing now, sliced for relevance to this recipient. Specific and real, not "Hi, my name is" and not a generic "I'm a student interested in X." This comes before any discussion of the recipient (see STRUCTURE).
6. After the introduction, reference something specific and real about the recipient's work and ask a genuine question about it, of a kind the angle supports.
7. One ask, and it must serve the sender's OUTREACH GOAL from the sender profile. Use the goal to angle the email and the ask, but state it softly. Name the field or direction, never a hard outcome, and never a specific target firm as a goal. Write "I'm trying to put myself in a strong position for consulting recruiting," not "my goal is an offer from a top firm." Never tell the recipient your goal is an offer from a firm like theirs; it reads as presumptuous. Phrase the ask as a real, time-bound request, worded fresh for this email. If no outreach goal is provided, ask for a short informational call.
8. No sign-off. The email client appends the signature.
9. Subject line: specific, under eight words, no puns, not "Quick question." The subject must come from this email's angle, not from a formula.

# BEFORE YOU OUTPUT

Silently audit the draft in this order, then output only the final version:
1. Sourcing: is every claim about the sender actually in the SENDER PROFILE? Did any recipient fact get attributed to the sender? Is anything fabricated?
2. Sameness: does the email pass the transplant test, or could another recipient's name and company be swapped in? Did any sentence, phrase, or ask wording come from the examples? Is the question the default "what drove the move from X to Y" when the angle supported something better? Rewrite what fails.
3. Length: is the body between 90 and 150 words? If it runs long, cut from the recipient section, never by compressing sentences into fragments.
4. Time: is every time reference consistent with today's date from the user message? No invented months, no seasons the data cannot support.
5. Structure: does the email introduce the sender before discussing the recipient? If it opens on the recipient, rewrite it so the self-introduction comes first.
6. Goal: is the sender's aim stated softly (a field or direction), not as a hard outcome or a named target firm? Soften any "my goal is an offer" phrasing.
7. Punctuation: are there any em dashes or en dashes? Replace every one.
8. Register: any fragments, abbreviations, acronyms, flattery, casual filler, or sentences that do not actually mean anything? Fix them.
9. AI tells: any banned vocabulary, banned phrases, or forced triples? This includes every phrase in WHAT NOT TO DO; check the draft against that list line by line.

# OUTPUT FORMAT, never deviate, never add commentary, never wrap in code blocks

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

/** Opening + ask excerpted from a draft written for another contact. */
export type RecentDraftSnippet = {
  opening: string;
  ask: string;
};

/**
 * Pull the opening paragraph and the ask (final paragraph) out of a stored
 * draft body so new drafts can be told what wording is already used.
 */
export function extractDraftSnippet(body: string): RecentDraftSnippet {
  const paras = body
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    // Drop the greeting line ("Hi Isaac,") wherever it sits.
    .filter((p) => !/^hi\s+[^\n]{1,40},$/i.test(p));
  return {
    opening: paras[0] ?? "",
    ask: paras.length > 1 ? paras[paras.length - 1] : "",
  };
}

/** Everything the drafter needs about one recipient + the sender. */
export type DraftContext = {
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
  /** Openings + asks from the sender's most recent drafts to OTHER
   * contacts. The prompt treats this wording as burned. */
  recentDrafts?: RecentDraftSnippet[] | null;
  sender: SenderProfile;
};

/** Build the recipient + research block shared by drafting and refining. */
function buildRecipientContext(opts: DraftContext): string {
  const ctxLines: string[] = [];
  // The model has no reliable sense of the current date; give it one so
  // time references ("last spring", "later this month") come out right.
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  ctxLines.push(`Today's date: ${today}`);
  ctxLines.push("");
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
        `\nLinkedIn profile (scraped, high-signal structured data):\n${linkedinSummary}`,
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
      `\nUser's own research notes (treat as authoritative, these are first-hand observations):\n${opts.researchNotes}`,
    );
  }

  return ctxLines.join("\n");
}

/**
 * Two cache breakpoints to maximize hit rate:
 *   1. The system prompt (stable across all users)
 *   2. The sender's profile (stable across all drafts for one user)
 */
function buildSystemBlocks(sender: SenderProfile): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: DRAFT_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
  ];
  const senderProfileText = formatSenderProfile(sender);
  if (senderProfileText) {
    blocks.push({
      type: "text",
      text: senderProfileText,
      cache_control: { type: "ephemeral" },
    });
  }
  return blocks;
}

async function runDraftModel(
  systemBlocks: Anthropic.TextBlockParam[],
  userMessage: string,
): Promise<Draft> {
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

/** Generate a fresh outreach email draft from contact context. */
export async function draftOutreachEmail(opts: DraftContext): Promise<Draft> {
  const parts = [`Draft an outreach email.\n\n${buildRecipientContext(opts)}`];

  const recent = (opts.recentDrafts ?? []).filter((s) => s.opening || s.ask);
  if (recent.length) {
    const lines = recent.map(
      (s, i) =>
        `${i + 1}. Opening: ${s.opening || "(none)"}\n   Ask: ${s.ask || "(none)"}`,
    );
    parts.push(
      `RECENT EMAILS BY THIS SENDER (wording to avoid, not facts):\n${lines.join("\n")}`,
    );
  }

  return runDraftModel(buildSystemBlocks(opts.sender), parts.join("\n\n"));
}

/**
 * Revise an existing draft based on a free-form user instruction. Reuses the
 * same locked system prompt, so every style and sourcing rule still applies to
 * the revision. The instruction only directs WHAT to change, not HOW to write.
 */
export async function refineOutreachEmail(
  opts: DraftContext & {
    currentSubject: string;
    currentBody: string;
    instruction: string;
  },
): Promise<Draft> {
  const userMessage = [
    "Revise an existing outreach email draft based on the user's instruction below.",
    "",
    buildRecipientContext(opts),
    "",
    "CURRENT DRAFT:",
    `SUBJECT: ${opts.currentSubject}`,
    "BODY:",
    opts.currentBody,
    "",
    `THE USER WANTS THIS CHANGED: ${opts.instruction}`,
    "",
    "Apply the instruction and return the full revised email. Keep everything the instruction does not ask you to change. Follow every rule in the system prompt, including the sourcing discipline and the ban on em dashes. Output in the exact SUBJECT/BODY format, nothing else.",
  ].join("\n");
  return runDraftModel(buildSystemBlocks(opts.sender), userMessage);
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

// ── Apollo search filter translation ──────────────────────────────────

/**
 * Translate a natural-language search query into Apollo people-search
 * filters. The user's profile is passed as context so Claude can infer
 * shared-trait searches ("people like me in finance" → schools from resume,
 * industries from bio, etc.).
 *
 * Returns only fields Apollo actually accepts; unknown fields are omitted.
 * Uses a small max_tokens budget since output is structured JSON only.
 */
export async function translateSearchQuery(
  query: string,
  userProfile: {
    bio: string | null;
    resumeText: string | null;
    outreachGoal: string | null;
  },
): Promise<ApolloSearchFilters> {
  const systemPrompt = `You translate a natural-language people-search query into a JSON object of Apollo.io search filters. Output ONLY valid JSON, no prose, no markdown fences.

Available filter fields (all optional, only include what's relevant):
- organization_domains: string[] — the PRIMARY WEB DOMAIN of each company, OR-matched (e.g. ["bain.com"] for Bain, ["mckinsey.com", "bain.com", "bcg.com"] for the big three consultancies). Use this for any company or firm filter. Use the company's main corporate domain, lowercase, no www or protocol. Never put company names in q_keywords.
- person_titles: string[] — job titles to match (e.g. ["Partner", "Associate", "Consultant"])
- person_locations: string[] — cities/states/countries (e.g. ["Chicago, Illinois", "New York"])
- person_seniorities: string[] — one or more of: "c_suite", "vp", "director", "manager", "senior", "entry", "intern", "partner", "owner"
- person_schools: string[] — universities attended (e.g. ["University of Illinois at Urbana-Champaign"]). Use full official name.
- organization_num_employees_ranges: string[] — e.g. ["1,10", "11,50", "51,200", "201,500", "501,1000", "1001,5000", "5001,10000", "10001,"]
- q_keywords: string — last resort for concepts that don't fit other fields (e.g. "private equity"). Do NOT put company names, school names, titles, or locations here — they have dedicated fields above that work better.

Acronym expansions you must always apply:
- MBB → organization_domains: ["mckinsey.com", "bain.com", "bcg.com"]
- BB (bulge bracket) → organization_domains: ["goldmansachs.com", "morganstanley.com", "jpmorgan.com", "bankofamerica.com", "citigroup.com", "barclays.com", "db.com", "ubs.com", "wellsfargo.com"]
- Big 4 → organization_domains: ["deloitte.com", "pwc.com", "ey.com", "kpmg.com"]
- FAANG / MANGA → organization_domains: ["meta.com", "apple.com", "amazon.com", "netflix.com", "google.com", "microsoft.com"]

Rules:
- For alumni/shared-school searches, infer schools from the sender profile if not stated explicitly
- Keep filters focused — 2-3 fields max produces better results than many narrow filters
- Never include empty arrays`;

  const userMessage = [
    `SENDER PROFILE (use to infer shared traits):`,
    userProfile.bio ? `Bio: ${userProfile.bio}` : "",
    userProfile.resumeText ? `Resume:\n${userProfile.resumeText}` : "",
    userProfile.outreachGoal ? `Outreach goal: ${userProfile.outreachGoal}` : "",
    "",
    `SEARCH QUERY: ${query}`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  try {
    // Strip markdown fences if Claude wrapped the JSON anyway
    const clean = text.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(clean) as ApolloSearchFilters;
  } catch {
    // Fallback: put the whole query in keywords
    return { q_keywords: query };
  }
}

// ── Last name inference from Apollo obfuscated names ──────────────────

/**
 * Apollo's api_search free tier returns last names as e.g. "Gr***n" —
 * first N chars shown, one asterisk per hidden char, last char shown.
 *
 * Given the obfuscated pattern + first name + company + title, Claude
 * infers the single most likely last name. Batches the whole result page
 * in one API call.
 *
 * Returns null per entry when confidence is too low to guess.
 */
export async function inferLastNamesFromObfuscated(
  people: Array<{
    firstName: string;
    lastNameObfuscated: string;
    company: string;
    title: string | null;
  }>,
): Promise<Array<string | null>> {
  if (!people.length) return [];

  const systemPrompt = `You infer likely last names from Apollo.io obfuscated name patterns.

The pattern format: first 1-2 characters shown, then asterisks (one per hidden character), then the last character shown.
Examples:
  "Gr***n" → 6-letter name, starts "Gr", ends "n" → e.g. "Graven", "Grogan"
  "S**h"   → 4-letter name, starts "S",  ends "h" → e.g. "Shah", "Seth", "Such"
  "Wi****s" → 7-letter name, starts "Wi", ends "s" → e.g. "Williams", "Winters"

Use the person's first name, company, and title as demographic context to pick the single most plausible surname. Common names at the right company or in the right industry should rank higher.

Rules:
- Return your single best guess only — do not return multiple options
- Capitalize correctly (Smith, McDonald, O'Brien, DeVries)
- Return null if the pattern is too ambiguous to make a reasonable guess
- Output ONLY a JSON array of strings or nulls, one per input, no prose or explanation`;

  const userMessage = JSON.stringify(
    people.map((p) => ({
      firstName: p.firstName,
      lastNameObfuscated: p.lastNameObfuscated,
      company: p.company,
      title: p.title,
    })),
  );

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  try {
    const clean = text.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed) && parsed.length === people.length) {
      return parsed.map((v) => (typeof v === "string" && v.trim() ? v.trim() : null));
    }
  } catch {
    // fall through
  }
  return people.map(() => null);
}

// ── LinkedIn candidate verification ────────────────────────────────────

export type LinkedInMatchFacts = {
  firstName: string;
  /** Real last name when known (e.g. from Apollo enrichment); null when we
   * only have a guess. NEVER pass an inferred/guessed last name here. */
  lastName: string | null;
  company: string | null;
  title: string | null;
  location: string | null;
};

export type LinkedInMatchCandidate = {
  url: string;
  name: string | null;
  headline: string | null;
  location: string | null;
  snippet: string | null;
  source: "linkedin_search" | "web_search";
};

/**
 * Given trusted facts about a person and a list of LinkedIn profile
 * candidates, pick the one that is actually them — or null if none can be
 * confirmed. A wrong URL is far worse than no URL, so this only returns a
 * candidate on a "high" confidence verdict.
 */
export async function pickLinkedInMatch(
  facts: LinkedInMatchFacts,
  candidates: LinkedInMatchCandidate[],
): Promise<number | null> {
  if (!candidates.length) return null;

  const systemPrompt = `You verify which LinkedIn profile (if any) belongs to a specific person. You are given FACTS about the person from a B2B database, and CANDIDATES from LinkedIn search and web search.

Output ONLY valid JSON, no prose: {"match": <candidate index or null>, "confidence": "high" | "medium" | "low"}

Matching rules, applied strictly:
- The candidate's first name must match the fact first name (allow nicknames: Mike/Michael, Liz/Elizabeth, and accented variants).
- If a fact last name is given, the candidate's last name must match it (allow suffixes like PharmD, CFA, and hyphenated/married forms that CONTAIN the fact last name).
- If NO fact last name is given, you must rely entirely on corroboration: the candidate's headline, company, or location must clearly match the fact company AND (title or location). First name alone is never enough.
- Corroboration: "high" confidence requires the name rules to pass AND at least one strong corroborating signal — the fact company appearing in the candidate's headline/snippet, an equivalent job title, or a matching location alongside a matching full name.
- People change jobs. If the name matches exactly (full first + last) and location matches, but the headline shows a different company, that can still be "medium", not a rejection — but never "high" without something tying them to the fact company or title.
- Common names (multiple plausible candidates with the same name) demand extra caution: if two candidates could both plausibly be the person, return null.
- If no candidate satisfies the rules, "match" is null.

A wrong match pollutes a CRM and leads to embarrassing misdirected outreach. When in doubt, return null.`;

  const userMessage = JSON.stringify({
    facts: {
      firstName: facts.firstName,
      lastName: facts.lastName, // null = unknown, do not guess
      company: facts.company,
      title: facts.title,
      location: facts.location,
    },
    candidates: candidates.map((c, i) => ({
      index: i,
      name: c.name,
      headline: c.headline,
      location: c.location,
      snippet: c.snippet,
      source: c.source,
      urlSlug: c.url.split("/in/")[1] ?? "",
    })),
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 150,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  try {
    const clean = text.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(clean) as {
      match: number | null;
      confidence: string;
    };
    if (
      typeof parsed.match === "number" &&
      parsed.match >= 0 &&
      parsed.match < candidates.length &&
      parsed.confidence === "high"
    ) {
      return parsed.match;
    }
  } catch {
    // fall through
  }
  return null;
}
