/**
 * The curation brain — the "imagine you are Sam" step.
 *
 * Given candidate events + context (persona, goals, learned preferences and
 * Sam's past attendance history with his notes), it scores each candidate
 * 0-100, decides keep/drop, and writes a short "why go, as Sam" rationale plus
 * an expected payoff.
 *
 * Two providers implement the same {@link CurationProvider} contract:
 *   - "claude-curator" — real Claude call (when ANTHROPIC_API_KEY is set)
 *   - "heuristic"      — deterministic keyword/region/history scoring
 *
 * The real provider always falls back to the heuristic scoring on any API or
 * parse error, and both providers always return exactly one verdict per
 * candidate key passed in. `curate` never throws.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  AttendanceHistoryItem,
  CurationCandidate,
  CurationContext,
  CurationProvider,
  CurationResult,
  CurationVerdict,
} from '../lib/types';

/** Scores strictly below this are dropped by the heuristic / fallback logic. */
const DROP_THRESHOLD = 40;

/** Default model when CURATION_MODEL is not set. */
const DEFAULT_MODEL = 'claude-opus-4-8';

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function getCurationProvider(): CurationProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && apiKey.trim().length > 0) {
    return createClaudeCurator();
  }
  return createHeuristicProvider();
}

// ---------------------------------------------------------------------------
// Real provider — "claude-curator"
// ---------------------------------------------------------------------------

const CURATOR_SYSTEM_PROMPT = [
  "You ARE Sam: a second-year Computer Science student based in Brighton, UK.",
  "You are a prolific builder — you ship lots of small software projects — you are",
  "aiming for a job at a big-tech company or a strong software-engineering role, and",
  "you are QA-curious. Right now you are deciding which networking / tech events are",
  "actually worth your time.",
  "",
  "You are ruthlessly practical. Judge every candidate event through ONE lens:",
  '"Will going to this get me a job, a referral, or a genuinely useful professional',
  'connection?"',
  "",
  "Weight your judgement by:",
  "- Career / recruiting value: graduate schemes, internships, hiring events, career",
  "  fairs, recruiter presence, hackathons (great for portfolio AND meeting engineers),",
  "  founder / engineering meetups. These score highest.",
  "- Relevance to software / CS: software engineering, web, AI/ML, data, cloud, dev",
  "  tooling, cybersecurity, startups, QA/testing. Tangential or non-technical events",
  "  score low.",
  "- Travel cost: you live in Brighton. Brighton & Sussex events are cheap to reach and",
  "  score highest. London events are worth the ~1hr train when the payoff is real.",
  "  Events elsewhere in the UK need a high payoff (travel/stay-over) to be worth it.",
  "- Your learned preferences and your own attendance history (given below). If you",
  "  crossed off (did not attend) an event or wrote something negative about a type of",
  "  event, DOWN-WEIGHT similar candidates. If you ticked one off or wrote something",
  "  positive, UP-WEIGHT similar candidates.",
  "",
  "Score each candidate 0-100. Drop clearly-irrelevant or low-value events — a score",
  "below 40 is a reasonable drop threshold, but use your judgement. Keep the ones",
  "genuinely worth Sam's time.",
  "",
  "Respond with STRICT JSON ONLY — no prose, no markdown fences — matching exactly:",
  '{"verdicts":[{"key":"<candidate key>","score":<integer 0-100>,"decision":"keep"|"drop","rationale":"<short first-person why-go-as-Sam>","expectedPayoff":"<what Sam concretely gets>"}],"updatedLearnedPreferences":"<one refreshed paragraph of what Sam values / avoids in events>"}',
  "",
  "Rules: include EXACTLY ONE verdict per candidate. Every verdict.key MUST equal the",
  "key of the candidate it refers to. Write rationale and expectedPayoff in Sam's own",
  "first-person voice and reference the actual event.",
].join('\n');

function createClaudeCurator(): CurationProvider {
  const model = process.env.CURATION_MODEL?.trim() || DEFAULT_MODEL;

  return {
    name: 'claude-curator',

    async curate(
      candidates: CurationCandidate[],
      ctx: CurationContext,
    ): Promise<CurationResult> {
      if (candidates.length === 0) {
        return {
          verdicts: [],
          updatedLearnedPreferences: ctx.learnedPreferences,
          model,
        };
      }

      try {
        const client = new Anthropic();
        // Stream so a large max_tokens (with adaptive thinking) can't hit the
        // SDK's HTTP timeout; finalMessage() aggregates the whole response.
        const message = await client.messages
          .stream({
            model,
            max_tokens: 16000,
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium' },
            system: CURATOR_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: buildUserPrompt(candidates, ctx) }],
          })
          .finalMessage();

        const text = message.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n');

        const parsed = extractJsonObject(text);
        if (!parsed) {
          return heuristicCurate(candidates, ctx, 'heuristic-fallback');
        }
        return reconcileVerdicts(parsed, candidates, ctx, model);
      } catch {
        // Any API / network / parse failure → deterministic fallback so the
        // run still produces a verdict for every candidate.
        return heuristicCurate(candidates, ctx, 'heuristic-fallback');
      }
    },
  };
}

function buildUserPrompt(candidates: CurationCandidate[], ctx: CurationContext): string {
  const payload = {
    myPersona: ctx.personaHeadline,
    myGoals: ctx.goals,
    myLearnedPreferences: ctx.learnedPreferences?.trim() || '(none recorded yet)',
    myPastEventHistory:
      ctx.history.length > 0
        ? ctx.history.map((h) => ({
            title: h.title,
            startAt: h.startAt,
            region: h.region,
            tags: h.tags,
            flaggedGoing: h.going,
            outcome:
              h.attended === null
                ? 'unknown'
                : h.attended
                  ? 'attended (ticked off)'
                  : 'did NOT attend (crossed off)',
            myNotes: h.notes,
          }))
        : '(no history yet)',
    candidatesToJudge: candidates.map((c) => ({
      key: c.key,
      title: c.title,
      startAt: c.startAt,
      region: c.region,
      city: c.city ?? null,
      organizer: c.organizer ?? null,
      price: c.price ?? null,
      tags: c.tags,
      description: c.description,
    })),
  };

  return [
    'Here is who I am, what I want, what I have learned, my past event outcomes, and',
    'the candidate events to judge. Produce exactly one verdict per candidate key.',
    '',
    JSON.stringify(payload, null, 2),
    '',
    'Return the STRICT JSON now.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Robust JSON extraction
// ---------------------------------------------------------------------------

/** Parse a JSON object out of model text even if wrapped in prose or fences. */
function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const trimmed = text.trim();

  // 1. Direct parse.
  const direct = tryParse(trimmed);
  if (direct) return direct;

  // 2. Fenced ```json ... ``` (or bare ``` ... ```) block.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const fenced = tryParse(fence[1].trim());
    if (fenced) return fenced;
  }

  // 3. First balanced {...} span anywhere in the text.
  const balanced = extractBalancedObject(trimmed);
  if (balanced) {
    const obj = tryParse(balanced);
    if (obj) return obj;
  }

  return null;
}

function tryParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Return the first brace-balanced object substring, respecting JSON strings. */
function extractBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Map the parsed model output back onto the full candidate set. Uses the model's
 * verdict where a matching key exists (validated / clamped); otherwise fills the
 * gap with a heuristic verdict. Guarantees exactly one verdict per candidate.
 */
function reconcileVerdicts(
  parsed: Record<string, unknown>,
  candidates: CurationCandidate[],
  ctx: CurationContext,
  model: string,
): CurationResult {
  const byKey = new Map<string, Record<string, unknown>>();
  const rawVerdicts = parsed.verdicts;
  if (Array.isArray(rawVerdicts)) {
    for (const raw of rawVerdicts) {
      if (raw && typeof raw === 'object' && typeof (raw as { key?: unknown }).key === 'string') {
        byKey.set((raw as { key: string }).key, raw as Record<string, unknown>);
      }
    }
  }

  const verdicts: CurationVerdict[] = candidates.map((c) => {
    const raw = byKey.get(c.key);
    return raw ? normalizeVerdict(raw, c) : heuristicVerdict(c, ctx);
  });

  const rawPrefs = parsed.updatedLearnedPreferences;
  const updatedLearnedPreferences =
    typeof rawPrefs === 'string' && rawPrefs.trim().length > 0
      ? rawPrefs.trim()
      : summarizeLearnedPreferences(ctx, verdicts);

  return { verdicts, updatedLearnedPreferences, model };
}

function normalizeVerdict(raw: Record<string, unknown>, c: CurationCandidate): CurationVerdict {
  const score = clampScore(raw.score);
  let decision: 'keep' | 'drop';
  if (raw.decision === 'keep' || raw.decision === 'drop') {
    decision = raw.decision;
  } else {
    decision = score < DROP_THRESHOLD ? 'drop' : 'keep';
  }

  const rationale =
    typeof raw.rationale === 'string' && raw.rationale.trim().length > 0
      ? raw.rationale.trim()
      : `Worth a second look at "${c.title}".`;

  const expectedPayoff =
    typeof raw.expectedPayoff === 'string' && raw.expectedPayoff.trim().length > 0
      ? raw.expectedPayoff.trim()
      : 'A potential professional connection or useful learning.';

  return { key: c.key, score, decision, rationale, expectedPayoff };
}

// ---------------------------------------------------------------------------
// Heuristic provider — "heuristic" (also the real provider's fallback)
// ---------------------------------------------------------------------------

function createHeuristicProvider(): CurationProvider {
  return {
    name: 'heuristic',
    async curate(candidates, ctx) {
      return heuristicCurate(candidates, ctx, 'heuristic');
    },
  };
}

function heuristicCurate(
  candidates: CurationCandidate[],
  ctx: CurationContext,
  modelLabel: string,
): CurationResult {
  const verdicts = candidates.map((c) => heuristicVerdict(c, ctx));
  return {
    verdicts,
    updatedLearnedPreferences: summarizeLearnedPreferences(ctx, verdicts),
    model: modelLabel,
  };
}

// Keyword banks. Multi-word / short terms are padded so they only match on
// word boundaries (the haystack is space-padded below).
const CAREER_TERMS = [
  'career', 'careers', 'recruit', 'recruiting', 'recruiter', 'graduate',
  'grad scheme', 'grad-scheme', 'internship', 'intern', 'placement', 'hiring',
  'hire', ' job ', ' jobs ', 'career fair', 'job fair', 'apprenticeship',
  'employer', 'mentorship', 'referral',
];
const NETWORKING_TERMS = [
  'networking', 'network', 'meetup', 'meet-up', 'meet up', 'mixer', 'social',
  ' connect', 'community',
];
const HACKATHON_TERMS = ['hackathon', 'hack day', 'game jam', 'game-jam', 'hack night'];
const SOFTWARE_TERMS = [
  'software', 'developer', 'development', 'engineer', 'engineering', 'programming',
  'coding', ' code ', 'javascript', 'typescript', ' java ', 'react', ' node',
  ' web ', 'frontend', 'front-end', 'backend', 'back-end', 'full stack', 'fullstack',
  ' ai ', 'artificial intelligence', 'machine learning', ' ml ', ' data ', 'cloud',
  ' aws ', 'devops', 'cyber', 'security', ' tech', 'technology', 'computer science',
  ' cs ', 'startup', 'start-up', 'open source', 'open-source', ' api ', 'database',
];
const QA_TERMS = [
  ' qa ', 'quality assurance', 'testing', 'test automation', 'sdet', 'tester',
];
const BEGINNER_TERMS = [
  'beginner', 'beginners', ' intro', 'introduction', 'introductory', 'basics',
  ' 101', 'getting started', 'no experience', 'newbie', 'first steps',
];
const NEGATIVE_NOTE_TERMS = [
  'boring', 'waste', 'weak', 'not worth', 'nothing', 'skip', ' meh', 'poor',
  'disappoint', 'underwhelm', 'too basic', 'shallow', 'sales pitch', 'salesy',
  'pushy', 'left early', 'pointless', 'dull', 'no value',
];
const POSITIVE_NOTE_TERMS = [
  'great', 'useful', 'valuable', 'worth', 'excellent', 'loved', 'amazing', ' good',
  'insightful', 'met a', 'made a connection', 'recruiter', 'referral', 'landed',
  ' offer', 'helpful', 'fantastic', 'brilliant', 'contact',
];

const STOPWORDS = new Set([
  'with', 'from', 'your', 'this', 'that', 'into', 'over', 'after', 'before',
  'event', 'events', 'night', 'evening', 'meet', 'come', 'join', 'have', 'will',
  'what', 'when', 'where', 'more', 'about', 'their', 'they',
]);

function heuristicVerdict(c: CurationCandidate, ctx: CurationContext): CurationVerdict {
  const { score, factors } = heuristicScore(c, ctx);
  const decision: 'keep' | 'drop' = score < DROP_THRESHOLD ? 'drop' : 'keep';
  return {
    key: c.key,
    score,
    decision,
    rationale: buildRationale(c, decision, factors),
    expectedPayoff: buildPayoff(decision, factors),
  };
}

function heuristicScore(
  c: CurationCandidate,
  ctx: CurationContext,
): { score: number; factors: string[] } {
  const hay = haystack(c.title, c.description, c.tags);
  let score = 30; // neutral baseline
  const factors: string[] = [];

  // Relevance to software / CS.
  const softwareHits = countMatches(hay, SOFTWARE_TERMS);
  if (softwareHits > 0) {
    score += Math.min(20, 8 + softwareHits * 3);
    factors.push('software');
  } else {
    score -= 10;
    factors.push('no-software');
  }

  // Direct career / recruiting value.
  if (containsAny(hay, CAREER_TERMS)) {
    score += 22;
    factors.push('career');
  }
  if (containsAny(hay, NETWORKING_TERMS)) {
    score += 10;
    factors.push('networking');
  }
  if (containsAny(hay, HACKATHON_TERMS)) {
    score += 16;
    factors.push('hackathon');
  }
  if (containsAny(hay, QA_TERMS)) {
    score += 8;
    factors.push('qa');
  }

  // Travel cost by region.
  if (c.region === 'Brighton & Sussex') {
    score += 15;
    factors.push('local');
  } else if (c.region === 'London') {
    score += 6;
    factors.push('london');
  } else {
    score -= 6;
    factors.push('far');
  }

  // Beginner penalty — larger if Sam's history says beginner events are weak.
  if (containsAny(hay, BEGINNER_TERMS)) {
    const weak = historySuggestsBeginnerWeak(ctx);
    score -= weak ? 18 : 8;
    factors.push(weak ? 'beginner-weak' : 'beginner');
  }

  // Learned history sentiment for similar events (by tag / title overlap).
  const sentiment = historySentimentFor(c, ctx);
  if (sentiment > 0) {
    score += Math.min(15, sentiment * 6);
    factors.push('history-pos');
  } else if (sentiment < 0) {
    score += Math.max(-20, sentiment * 8);
    factors.push('history-neg');
  }

  return { score: clampScore(score), factors };
}

const NEG_PHRASE: Record<string, string> = {
  'no-software': "there's not much obvious software/CS relevance for me",
  far: "it's a long way from Brighton for what I'd get out of it",
  beginner: 'it looks beginner-level, probably below where I am now',
  'beginner-weak': "it's beginner-level, and I've found those underwhelming before",
  'history-neg': "it resembles events I've crossed off or didn't rate",
};

// Varied, first-person openers keyed off the event's strongest signal, so two
// different events never read the same. Deterministic pick (no Math.random).
const CAREER_LEADS = [
  'Recruiters and employers will actually be in the room — the kind of event that turns into an internship, a referral, or at least a name to email afterwards.',
  'A direct line to people who hire, which is exactly where turning up in person beats firing off another online application.',
  'Real recruiting value here: the sort of room where one good conversation becomes a referral.',
];
const HACKATHON_LEADS = [
  'A hackathon — the fastest way to put a real, demoable project on my CV and build alongside other engineers.',
  'Pure CV signal: a weekend here means a shipped project and a handful of new contacts who build things.',
];
const QA_LEADS = [
  "There's a clear QA/testing angle worth poking at, given I'm keeping that route into the industry open.",
];
const NETWORK_LEADS = [
  'Worth it for the room — this is the local tech crowd that tips you off about roles before they hit a job board.',
  'A genuine chance to widen my network in the scene, and those are the people who quietly open doors.',
];
const SOFTWARE_LEADS = [
  'Right in my lane technically — good for staying sharp and meeting people who actually ship software.',
  'Relevant to the stack I already work in, and a low-effort way to be around practitioners.',
];
const GENERIC_LEADS = ['A plausible professional opportunity — worth a closer look.'];

function seedPick<T>(arr: T[], seed: string): T {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return arr[Math.abs(h) % arr.length];
}

function isFree(c: CurationCandidate): boolean {
  return !!c.price && /free/i.test(c.price);
}

function buildRationale(
  c: CurationCandidate,
  decision: 'keep' | 'drop',
  factors: string[],
): string {
  if (decision === 'drop') {
    const bits = factors.map((f) => NEG_PHRASE[f]).filter(Boolean);
    const reason =
      bits.length > 0 ? bits.slice(0, 2).join(', and ') : 'the likely payoff is low for the time it would take';
    return `Probably a skip — ${reason}.`;
  }

  let lead: string;
  if (factors.includes('career')) lead = seedPick(CAREER_LEADS, c.key);
  else if (factors.includes('hackathon')) lead = seedPick(HACKATHON_LEADS, c.key);
  else if (factors.includes('qa')) lead = seedPick(QA_LEADS, c.key);
  else if (factors.includes('networking')) lead = seedPick(NETWORK_LEADS, c.key);
  else if (factors.includes('software')) lead = seedPick(SOFTWARE_LEADS, c.key);
  else lead = seedPick(GENERIC_LEADS, c.key);

  const tail: string[] = [];
  if (factors.includes('local')) tail.push("It's on my doorstep in Brighton, so there's little excuse not to.");
  else if (factors.includes('london')) tail.push("London's only a train away and the payoff justifies it.");
  else if (factors.includes('far')) tail.push("It's a fair trek, so only worth it if I build the day around it.");
  if (factors.includes('history-pos')) tail.push("It also looks like the events I've rated well before.");
  if (isFree(c)) tail.push("And it's free.");

  return [lead, ...tail.slice(0, 2)].join(' ');
}

function buildPayoff(decision: 'keep' | 'drop', factors: string[]): string {
  if (decision === 'drop') {
    return 'Little concrete career payoff for the travel and time.';
  }
  const bits: string[] = [];
  if (factors.includes('career')) bits.push('a shot at a recruiter contact or referral');
  if (factors.includes('hackathon')) bits.push('a portfolio project and hands-on time with engineers');
  if (factors.includes('networking')) bits.push('new contacts in the tech scene');
  if (factors.includes('qa')) bits.push('exposure to real QA/testing practice');
  if (bits.length === 0 && factors.includes('software')) {
    bits.push('sharper, job-relevant CS knowledge');
  }
  if (bits.length === 0) {
    return 'A modest chance to meet useful people.';
  }
  return capitalizeFirst(joinList(bits.slice(0, 2))) + '.';
}

function summarizeLearnedPreferences(ctx: CurationContext, verdicts: CurationVerdict[]): string {
  const kept = verdicts.filter((v) => v.decision === 'keep').length;
  const dropped = verdicts.length - kept;

  const parts: string[] = [
    'Sam values events with direct recruiting or referral potential, hackathons, and ' +
      'software/CS-relevant networking; Brighton & Sussex events win on low travel cost, ' +
      'London is worth the train when the payoff is strong, and events further afield ' +
      'need a high payoff to justify the trip.',
  ];
  if (historySuggestsBeginnerWeak(ctx)) {
    parts.push('Beginner / intro sessions have underwhelmed him before, so they are down-weighted.');
  }
  parts.push(`This pass kept ${kept} and dropped ${dropped} of ${verdicts.length} candidate(s).`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// History helpers
// ---------------------------------------------------------------------------

/** −1 / 0 / +1(-ish) sentiment for a single past event, from tick/cross + notes. */
function sentimentOfHistoryItem(h: AttendanceHistoryItem): number {
  let s = 0;
  if (h.attended === false) s -= 1;
  else if (h.attended === true) s += 1;

  const noteHay = ' ' + h.notes.join(' ').toLowerCase() + ' ';
  if (containsAny(noteHay, NEGATIVE_NOTE_TERMS)) s -= 1;
  if (containsAny(noteHay, POSITIVE_NOTE_TERMS)) s += 1;
  return s;
}

/** Aggregate sentiment across past events that resemble this candidate. */
function historySentimentFor(c: CurationCandidate, ctx: CurationContext): number {
  const candTags = new Set(c.tags.map((t) => t.toLowerCase()));
  const candTitleTokens = tokenize(c.title);
  let total = 0;

  for (const h of ctx.history) {
    const tagOverlap = h.tags.some((t) => candTags.has(t.toLowerCase()));
    const titleOverlap = tokensOverlap(candTitleTokens, tokenize(h.title));
    if (tagOverlap || titleOverlap) {
      total += sentimentOfHistoryItem(h);
    }
  }
  return total;
}

/** True if Sam has a beginner-flavoured event in his history that went badly. */
function historySuggestsBeginnerWeak(ctx: CurationContext): boolean {
  return ctx.history.some((h) => {
    const hay = haystack(h.title, '', h.tags);
    return containsAny(hay, BEGINNER_TERMS) && sentimentOfHistoryItem(h) < 0;
  });
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function haystack(title: string, description: string, tags: string[]): string {
  return ' ' + [title, description, tags.join(' ')].join(' ').toLowerCase() + ' ';
}

function containsAny(hay: string, terms: string[]): boolean {
  return terms.some((t) => hay.includes(t));
}

function countMatches(hay: string, terms: string[]): number {
  let n = 0;
  for (const t of terms) if (hay.includes(t)) n++;
  return n;
}

function tokenize(s: string): Set<string> {
  return new Set(
    (s || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
  );
}

function tokensOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const w of a) if (b.has(w)) return true;
  return false;
}

function clampScore(n: unknown): number {
  const num = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function capitalizeFirst(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function joinList(arr: string[]): string {
  if (arr.length <= 1) return arr[0] ?? '';
  return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
}
