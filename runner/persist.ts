import { createHash } from 'node:crypto';
import { and, desc, eq, gte, inArray, lt, or, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { events, curations, attendance, notes, profile } from '../db/schema';
import type {
  DiscoveredEvent,
  CurationCandidate,
  CurationContext,
  AttendanceHistoryItem,
  Region,
} from '../lib/types';
import { getCurationProvider } from './curation';

const DEFAULT_PROFILE = {
  id: 1,
  displayName: 'Sam',
  headline:
    '2nd-year Computer Science student in Brighton, UK. Targeting big-tech / strong software engineering roles (also open to QA). A prolific builder with real shipped projects: a live EV-charging analytics tool used by a paying client, a multi-user student notebook app, and a personal-finance app. Comfortable with Python, TypeScript/React, Git, Linux, and AI-assisted development.',
  goals:
    'Find work: internships, graduate schemes, referrals, and genuinely useful industry connections. Strongly prefer events with real recruiters or working engineers present and clear career value over generic beginner meetups. Based in Brighton (low friction); will travel to London for high-value events; occasional big UK events only if the payoff is clearly worth the trip. In-person only.',
  learnedPreferences: '',
  homeCity: 'Brighton',
  regions: ['Brighton & Sussex', 'London', 'UK'] as string[],
};

export async function ensureProfile() {
  const [existing] = await db.select().from(profile).where(eq(profile.id, 1)).limit(1);
  if (!existing) {
    await db.insert(profile).values(DEFAULT_PROFILE);
    return DEFAULT_PROFILE;
  }
  return existing;
}

export function dedupeHash(e: { title: string; startAt: string; region: string }): string {
  const norm = `${e.title.trim().toLowerCase()}|${e.startAt.slice(0, 10)}|${e.region}`;
  return createHash('sha1').update(norm).digest('hex');
}

/** Best-effort HTTP check that a booking URL resolves. Never throws. */
export async function verifyLink(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal }).catch(
      () => null,
    );
    if (!res || res.status >= 400 || res.status === 405) {
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal }).catch(
        () => null,
      );
    }
    clearTimeout(t);
    return !!res && res.status < 400;
  } catch {
    return false;
  }
}

/**
 * Upsert discovered events (idempotent on dedupeHash). Returns the DB rows for
 * this batch (both freshly inserted and pre-existing) plus the count of new ones.
 */
export async function upsertDiscovered(
  list: DiscoveredEvent[],
  runId: string,
  verified: Map<string, boolean>,
) {
  let inserted = 0;
  const hashes: string[] = [];
  for (const e of list) {
    const hash = dedupeHash(e);
    hashes.push(hash);
    const res = await db
      .insert(events)
      .values({
        source: e.source || 'web-search',
        title: e.title,
        description: e.description ?? '',
        startAt: new Date(e.startAt),
        endAt: e.endAt ? new Date(e.endAt) : null,
        venueName: e.venueName ?? null,
        address: e.address ?? null,
        city: e.city ?? null,
        region: e.region,
        isOnline: e.isOnline ?? false,
        bookingUrl: e.bookingUrl,
        linkVerified: verified.get(e.bookingUrl) ?? false,
        price: e.price ?? null,
        organizer: e.organizer ?? null,
        tags: e.tags ?? [],
        dedupeHash: hash,
        firstSeenRunId: runId,
      })
      .onConflictDoNothing({ target: events.dedupeHash })
      .returning({ id: events.id });
    if (res.length > 0) inserted += 1;
  }
  const rows = hashes.length
    ? await db.select().from(events).where(inArray(events.dedupeHash, hashes))
    : [];
  return { rows, inserted };
}

/** Build the attendance + notes history that feeds the curation brain. */
export async function loadHistory(): Promise<AttendanceHistoryItem[]> {
  const rows = await db.query.events.findMany({
    with: { attendance: true, notes: true },
  });
  const items: AttendanceHistoryItem[] = [];
  for (const r of rows) {
    const hasSignal =
      r.attendance && (r.attendance.attended !== null || r.attendance.going) ||
      (r.notes && r.notes.length > 0);
    if (!hasSignal) continue;
    items.push({
      title: r.title,
      startAt: (r.startAt as Date).toISOString(),
      region: r.region as Region,
      tags: r.tags ?? [],
      going: r.attendance?.going ?? false,
      attended: r.attendance?.attended ?? null,
      notes: (r.notes ?? []).map((n) => n.body),
    });
  }
  return items;
}

/**
 * Curate a set of event rows (score/keep/drop as Sam) and persist verdicts.
 * Returns the number kept.
 */
export async function curateAndPersist(
  eventRows: { id: string; title: string; description: string; startAt: Date; region: string; city: string | null; organizer: string | null; price: string | null; tags: string[] }[],
  runId: string,
): Promise<number> {
  if (eventRows.length === 0) return 0;
  const prof = await ensureProfile();
  const history = await loadHistory();

  const candidates: CurationCandidate[] = eventRows.map((e) => ({
    key: e.id,
    title: e.title,
    description: e.description,
    startAt: e.startAt.toISOString(),
    region: e.region as Region,
    city: e.city,
    organizer: e.organizer,
    price: e.price,
    tags: e.tags ?? [],
  }));

  const ctx: CurationContext = {
    personaHeadline: prof.headline,
    goals: prof.goals,
    learnedPreferences: prof.learnedPreferences,
    history,
  };

  const provider = getCurationProvider();
  const result = await provider.curate(candidates, ctx);

  let kept = 0;
  for (const v of result.verdicts) {
    if (v.decision === 'keep') kept += 1;
    await db.insert(curations).values({
      eventId: v.key,
      runId,
      score: Math.max(0, Math.min(100, Math.round(v.score))),
      decision: v.decision,
      rationale: v.rationale,
      expectedPayoff: v.expectedPayoff,
      model: result.model,
    });
  }

  if (result.updatedLearnedPreferences && result.updatedLearnedPreferences.trim()) {
    await db
      .update(profile)
      .set({ learnedPreferences: result.updatedLearnedPreferences.trim(), updatedAt: new Date() })
      .where(eq(profile.id, 1));
  }
  return kept;
}
