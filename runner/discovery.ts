/**
 * runner/discovery.ts
 *
 * Discovery module for the local runner. Finds in-person professional networking
 * events for a given date window / regions / persona.
 *
 * getDiscoveryProvider() picks one of two providers:
 *   - "claude-web-search": real provider, used when ANTHROPIC_API_KEY is set. It
 *     drives the Anthropic SDK with Claude's server-side web-search tool to find
 *     genuine events the way Sam (persona + goals) would, and asks Claude for a
 *     strict JSON array of DiscoveredEvents which it parses robustly.
 *   - "mock": deterministic synthetic provider, used when there is no key. It
 *     keeps the whole pipeline runnable without credentials.
 *
 * discover() is defensive on both providers: it never throws — on any API or
 * parse failure it logs a warning and returns [].
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  DiscoveredEvent,
  DiscoveryInput,
  DiscoveryProvider,
  Region,
} from '../lib/types';

/** Default curation/discovery model (overridable via CURATION_MODEL). */
const DEFAULT_MODEL = 'claude-opus-4-8';

/**
 * Web-search server tool `type`. `web_search_20260209` (dynamic filtering) is the
 * variant that pairs with the default model (claude-opus-4-8) — per the Anthropic
 * server-tools guidance — and is a fully-typed member of the installed
 * @anthropic-ai/sdk (0.112.x) ToolUnion. If a future model/SDK rejects it, the
 * API call throws and discover() catches it and returns [] (graceful fallback).
 */
const WEB_SEARCH_TOOL_TYPE = 'web_search_20260209' as const;

const VALID_REGIONS: readonly Region[] = ['Brighton & Sussex', 'London', 'UK'];

export function getDiscoveryProvider(): DiscoveryProvider {
  if (process.env.ANTHROPIC_API_KEY) {
    return createClaudeWebSearchProvider();
  }
  return createMockProvider();
}

/* ------------------------------------------------------------------ *
 * Real provider — Claude + server-side web search
 * ------------------------------------------------------------------ */

function createClaudeWebSearchProvider(): DiscoveryProvider {
  return {
    name: 'claude-web-search',
    async discover(input: DiscoveryInput): Promise<DiscoveredEvent[]> {
      try {
        const client = new Anthropic(); // resolves ANTHROPIC_API_KEY from env
        const model = process.env.CURATION_MODEL || DEFAULT_MODEL;
        const system = buildSystemPrompt(input);

        const tools: Anthropic.ToolUnion[] = [
          { type: WEB_SEARCH_TOOL_TYPE, name: 'web_search', max_uses: 8 },
        ];

        const messages: Anthropic.MessageParam[] = [
          { role: 'user', content: buildUserPrompt(input) },
        ];

        const create = (msgs: Anthropic.MessageParam[]) =>
          client.messages.create({
            model,
            max_tokens: 16000,
            thinking: { type: 'adaptive' },
            system,
            tools,
            messages: msgs,
          });

        let response: Anthropic.Message = await create(messages);

        // The server-side web-search loop can hit its iteration cap and return
        // stop_reason "pause_turn"; re-send to let it resume (bounded).
        let guard = 0;
        while (response.stop_reason === 'pause_turn' && guard < 6) {
          messages.push({ role: 'assistant', content: response.content });
          response = await create(messages);
          guard++;
        }

        const text = extractText(response);
        const parsed = extractJsonArray(text);
        return normalizeEvents(parsed, input);
      } catch (err) {
        warn('claude-web-search', err);
        return [];
      }
    },
  };
}

function buildSystemPrompt(input: DiscoveryInput): string {
  return [
    'You are a diligent research assistant helping Sam discover real, in-person professional networking events worth attending.',
    '',
    `Sam's profile: ${input.personaHeadline}`,
    `Sam's goals: ${input.goals}`,
    '',
    'Search the web the way Sam would to find genuine, currently-listed events (Meetup, Eventbrite, Lu.ma, official organiser pages, university and community listings, etc.). Only include an event if you can back it with a real registration/booking URL you actually found during the search.',
  ].join('\n');
}

function buildUserPrompt(input: DiscoveryInput): string {
  const regionList = input.regions.join(', ');
  const known = input.knownTitles.length
    ? input.knownTitles.map((t) => `- ${t}`).join('\n')
    : '(none)';
  return [
    `Find in-person networking events for Sam happening between ${input.from} and ${input.to} (inclusive).`,
    `Restrict the search to these regions: ${regionList}.`,
    '',
    'Requirements for every event you return:',
    '- In-person only (never online / virtual / livestream).',
    `- Its date/time must fall within ${input.from}..${input.to}.`,
    '- A real, working bookingUrl (the actual page where Sam can register or get a ticket).',
    `- "region" must be exactly one of: ${regionList}.`,
    '',
    'Do NOT include any event whose title matches one of these already-known titles:',
    known,
    '',
    'Return ONLY a JSON array (no prose, no explanation, no markdown code fences). Each element must be an object with these fields:',
    '{',
    '  "title": string,',
    '  "description": string,',
    '  "startAt": string,   // ISO 8601 with timezone offset, e.g. "2026-08-14T18:30:00+01:00"',
    '  "endAt": string | null,',
    '  "venueName": string | null,',
    '  "address": string | null,',
    '  "city": string | null,',
    `  "region": ${VALID_REGIONS.map((r) => JSON.stringify(r)).join(' | ')},`,
    '  "isOnline": false,',
    '  "bookingUrl": string,',
    '  "price": string | null,',
    '  "organizer": string | null,',
    '  "tags": string[]',
    '}',
    '',
    'If you find no suitable events, return [].',
  ].join('\n');
}

function extractText(message: Anthropic.Message): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('\n');
}

/**
 * Pull a JSON array out of the model's text: strip markdown fences, then take the
 * outermost [ ... ] span so surrounding prose is tolerated.
 */
function extractJsonArray(text: string): unknown[] {
  if (!text) return [];
  let cleaned = text.trim();

  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];

  try {
    const val: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(val) ? val : [];
  } catch {
    return [];
  }
}

function normalizeEvents(
  raw: unknown[],
  input: DiscoveryInput,
): DiscoveredEvent[] {
  const known = new Set(input.knownTitles.map((t) => t.trim().toLowerCase()));
  const fallbackRegion: Region = input.regions.includes('UK')
    ? 'UK'
    : input.regions[0] ?? 'UK';
  const fromMs = Date.parse(`${input.from}T00:00:00Z`);
  const toMs = Date.parse(`${input.to}T23:59:59Z`);

  const out: DiscoveredEvent[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    const title = asString(rec.title);
    const startAt = asString(rec.startAt);
    const bookingUrl = asString(rec.bookingUrl);
    if (!title || !startAt || !bookingUrl) continue;

    // In-person only.
    if (rec.isOnline === true) continue;

    // Within [from, to] (only enforce when all dates parse).
    const startMs = Date.parse(startAt);
    if (
      !Number.isNaN(fromMs) &&
      !Number.isNaN(toMs) &&
      !Number.isNaN(startMs) &&
      (startMs < fromMs || startMs > toMs)
    ) {
      continue;
    }

    // Drop already-known titles and in-batch duplicates.
    const key = title.trim().toLowerCase();
    if (known.has(key) || seen.has(key)) continue;
    seen.add(key);

    out.push({
      title,
      description: asString(rec.description) ?? '',
      startAt,
      endAt: asStringOrNull(rec.endAt),
      venueName: asStringOrNull(rec.venueName),
      address: asStringOrNull(rec.address),
      city: asStringOrNull(rec.city),
      region: coerceRegion(rec.region, input, fallbackRegion),
      isOnline: false,
      bookingUrl,
      price: asStringOrNull(rec.price),
      organizer: asStringOrNull(rec.organizer),
      tags: asStringArray(rec.tags),
      source: 'web-search',
    });
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Mock provider — deterministic synthetic events (no API key)
 * ------------------------------------------------------------------ */

const MOCK_TOPICS: ReadonlyArray<{
  title: string;
  tag: string;
  organizerSuffix: string;
}> = [
  { title: 'Tech Networking Meetup', tag: 'tech', organizerSuffix: 'Tech Community' },
  { title: 'AI & Machine Learning Meetup', tag: 'ai', organizerSuffix: 'AI Group' },
  { title: 'Startup Founders & Developers Social', tag: 'startups', organizerSuffix: 'Startup Network' },
  { title: 'Software Engineering Talks & Mixer', tag: 'engineering', organizerSuffix: 'Engineering Guild' },
  { title: 'Cloud & DevOps Meetup', tag: 'cloud', organizerSuffix: 'Cloud Collective' },
  { title: 'Graduate Careers in Tech Evening', tag: 'careers', organizerSuffix: 'Careers Hub' },
  { title: 'Product & Design Networking Mixer', tag: 'product', organizerSuffix: 'Product People' },
  { title: 'Women & Allies in Tech Social', tag: 'community', organizerSuffix: 'Tech Alliance' },
];

const UK_CITIES: readonly string[] = ['Manchester', 'Bristol', 'Cambridge', 'Leeds'];

function createMockProvider(): DiscoveryProvider {
  return {
    name: 'mock',
    async discover(input: DiscoveryInput): Promise<DiscoveredEvent[]> {
      try {
        return synthesizeMockEvents(input);
      } catch (err) {
        warn('mock', err);
        return [];
      }
    },
  };
}

function synthesizeMockEvents(input: DiscoveryInput): DiscoveredEvent[] {
  const regions: Region[] = input.regions.length ? input.regions : ['UK'];
  const known = new Set(input.knownTitles.map((t) => t.trim().toLowerCase()));

  // Deterministic: variety derives only from the input, never from randomness.
  const seed = hashString(
    `${input.from}|${input.to}|${regions.join(',')}|${input.personaHeadline}|${input.goals}`,
  );
  const count = 4 + (seed % 3); // 4, 5, or 6

  const fromMs = Date.parse(`${input.from}T00:00:00Z`);
  const toMs = Date.parse(`${input.to}T00:00:00Z`);
  const windowDays =
    Number.isNaN(fromMs) || Number.isNaN(toMs)
      ? 30
      : Math.max(1, Math.round((toMs - fromMs) / 86_400_000));

  const events: DiscoveredEvent[] = [];
  for (let i = 0; i < count; i++) {
    const topic = MOCK_TOPICS[i % MOCK_TOPICS.length];
    const region = regions[i % regions.length];
    const city = cityForRegion(region, i);

    // Spread evenly and strictly inside the window.
    const dayOffset = Math.floor(((i + 1) * windowDays) / (count + 1));
    const { dateStr, month } = addDaysISO(input.from, dayOffset);
    const offset = ukOffsetForMonth(month);
    const startAt = `${dateStr}T18:30:00${offset}`;
    const endAt = `${dateStr}T20:30:00${offset}`;

    let title = `${topic.title} — ${city}`;
    if (known.has(title.trim().toLowerCase())) {
      title = `${topic.title} (${monthName(month)} ${dateStr.slice(0, 4)}) — ${city}`;
    }

    const slug = `${slugify(topic.title)}-${slugify(city)}`;
    const eventId = 300_000_000 + ((seed + i * 7919) % 89_999_999);

    events.push({
      title,
      description: `A ${topic.tag} networking evening in ${city} — short talks plus time to meet other people working in and around software. A good fit for ${firstClause(input.goals)}.`,
      startAt,
      endAt,
      venueName: `${city} Innovation Hub`,
      address: `${10 + i} ${city} High Street, ${city}`,
      city,
      region,
      isOnline: false,
      bookingUrl: `https://www.meetup.com/${slug}/events/${eventId}/`,
      price: mockPrice(i),
      organizer: `${city} ${topic.organizerSuffix}`,
      tags: ['networking', 'in-person', topic.tag, regionTag(region)],
      source: 'mock',
    });
  }

  return events;
}

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

function coerceRegion(
  v: unknown,
  input: DiscoveryInput,
  fallback: Region,
): Region {
  if (typeof v === 'string') {
    const match = VALID_REGIONS.find((r) => r === v);
    if (match && input.regions.includes(match)) return match;
  }
  return fallback;
}

function warn(provider: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[discovery:${provider}] discover failed: ${msg}`);
}

/** Deterministic FNV-1a hash → unsigned 32-bit int. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function addDaysISO(
  isoDate: string,
  days: number,
): { dateStr: string; month: number } {
  const base = Date.parse(`${isoDate}T00:00:00Z`);
  const d = new Date(Number.isNaN(base) ? 0 : base);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return { dateStr: `${y}-${pad2(m)}-${pad2(day)}`, month: m };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Rough UK DST: BST (+01:00) Apr–Oct, GMT (+00:00) otherwise. */
function ukOffsetForMonth(month: number): string {
  return month >= 4 && month <= 10 ? '+01:00' : '+00:00';
}

function monthName(month: number): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[Math.max(0, Math.min(11, month - 1))];
}

function cityForRegion(region: Region, i: number): string {
  switch (region) {
    case 'London':
      return 'London';
    case 'Brighton & Sussex':
      return 'Brighton';
    case 'UK':
    default:
      return UK_CITIES[i % UK_CITIES.length];
  }
}

function regionTag(region: Region): string {
  switch (region) {
    case 'London':
      return 'london';
    case 'Brighton & Sussex':
      return 'brighton';
    default:
      return 'uk';
  }
}

function mockPrice(i: number): string {
  return ['Free', 'Free', '£5', '£10', 'Free', '£8'][i % 6];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function firstClause(goals: string): string {
  const c = goals.split(/[.;\n]/)[0]?.trim();
  return c && c.length > 1 ? c.toLowerCase() : 'growing a professional network in tech';
}
