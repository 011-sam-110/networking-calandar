import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { runs, curations, profile } from '../db/schema';
import { ensureProfile, upsertDiscovered, verifyLink } from './persist';
import { reconcileCalendar, sendDigest } from './sync';
import type { DiscoveredEvent } from '../lib/types';

/**
 * The write path for a scout run. The scheduled Claude Code scout web-searches +
 * curates events *as Sam*, writes them to a JSON file, then runs this to persist.
 *
 *   npm run ingest -- runner/scout-events.json
 *
 * Input JSON: either an array of ScoutEvent, or { events: ScoutEvent[],
 * learnedPreferences?: string }.
 */
interface ScoutEvent extends DiscoveredEvent {
  score: number;
  decision: 'keep' | 'drop';
  rationale: string;
  expectedPayoff: string;
}
interface ScoutFile {
  events: ScoutEvent[];
  learnedPreferences?: string;
}

const HORIZON_DAYS = Number(process.env.DISCOVERY_HORIZON_DAYS || 60);
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

async function verifyAll(list: DiscoveredEvent[]) {
  const map = new Map<string, boolean>();
  const urls = [...new Set(list.map((e) => e.bookingUrl))];
  const CONC = 6;
  for (let i = 0; i < urls.length; i += CONC) {
    const batch = urls.slice(i, i + CONC);
    const res = await Promise.all(batch.map((u) => verifyLink(u)));
    batch.forEach((u, idx) => map.set(u, res[idx]));
  }
  return map;
}

async function main() {
  const arg = process.argv[2];
  if (!arg || arg.startsWith('--')) {
    console.error('usage: npm run ingest -- <path-to-scout-events.json>');
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(resolve(arg), 'utf-8'));
  const scout: ScoutFile = Array.isArray(raw) ? { events: raw } : raw;
  const list = scout.events ?? [];
  console.log(`ingest: ${list.length} curated events from ${arg}`);

  await ensureProfile();

  const trigger = process.argv.includes('--catchup') ? 'boot-catchup' : 'scout';
  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const dates = list.map((e) => e.startAt).sort();
  const to = dates.length
    ? dates[dates.length - 1].slice(0, 10)
    : new Date(today.getTime() + HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10);

  const [run] = await db
    .insert(runs)
    .values({ trigger, status: 'running', coveredFrom: from, coveredTo: to })
    .returning();

  try {
    const verified = list.length ? await verifyAll(list) : new Map<string, boolean>();
    const okCount = [...verified.values()].filter(Boolean).length;
    if (list.length) console.log(`links: ${okCount}/${verified.size} resolved`);

    const { rows, inserted } = await upsertDiscovered(list, run.id, verified);
    const byTitle = new Map(rows.map((r) => [r.title, r]));

    let kept = 0;
    for (const e of list) {
      const row = byTitle.get(e.title);
      if (!row) continue;
      const decision = e.decision === 'drop' ? 'drop' : 'keep';
      if (decision === 'keep') kept += 1;
      await db.insert(curations).values({
        eventId: row.id,
        runId: run.id,
        score: clamp(e.score),
        decision,
        rationale: e.rationale ?? '',
        expectedPayoff: e.expectedPayoff ?? null,
        model: 'claude-code',
      });
    }

    if (scout.learnedPreferences && scout.learnedPreferences.trim()) {
      await db
        .update(profile)
        .set({ learnedPreferences: scout.learnedPreferences.trim(), updatedAt: new Date() })
        .where(eq(profile.id, 1));
    }

    const cal = await reconcileCalendar();
    console.log(`calendar(${cal.client}) → +${cal.created} ~${cal.updated} -${cal.deleted}`);

    const emailed = await sendDigest(run.id, list.length, from, to);

    await db
      .update(runs)
      .set({ status: 'success', finishedAt: new Date(), eventsFound: list.length, eventsKept: kept, emailSent: emailed })
      .where(eq(runs.id, run.id));

    console.log(`✓ ingest complete (${trigger}): ${list.length} events, ${inserted} new, ${kept} kept`);
    process.exit(0);
  } catch (err) {
    await db
      .update(runs)
      .set({ status: 'error', finishedAt: new Date(), error: String((err as Error)?.message ?? err) })
      .where(eq(runs.id, run.id));
    console.error('✗ ingest failed:', err);
    process.exit(1);
  }
}

main();
