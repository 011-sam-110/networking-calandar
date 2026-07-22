import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { runs, curations, profile } from '../db/schema';
import { ensureProfile, upsertDiscovered, curateAndPersist, verifyLink } from './persist';
import type { DiscoveredEvent } from '../lib/types';

interface EditorialVerdict {
  score: number;
  decision: 'keep' | 'drop';
  rationale: string;
  expectedPayoff: string;
}
interface EditorialFile {
  learnedPreferences?: string;
  verdicts: Record<string, EditorialVerdict>;
}

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

function loadEditorial(): EditorialFile | null {
  const path = join(process.cwd(), 'runner', 'seed-curation.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as EditorialFile;
  } catch {
    return null;
  }
}

async function main() {
  const path = join(process.cwd(), 'runner', 'seed-data.json');
  const list: DiscoveredEvent[] = JSON.parse(readFileSync(path, 'utf-8'));
  console.log(`seed: ${list.length} events from seed-data.json`);

  await ensureProfile();

  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const dates = list.map((e) => e.startAt).sort();
  const to = (dates[dates.length - 1] || from).slice(0, 10);

  const [run] = await db
    .insert(runs)
    .values({ trigger: 'manual', status: 'running', coveredFrom: from, coveredTo: to })
    .returning();

  console.log('verifying booking links…');
  const verified = await verifyAll(list);
  const okCount = [...verified.values()].filter(Boolean).length;
  console.log(`links: ${okCount}/${verified.size} resolved`);

  const { rows, inserted } = await upsertDiscovered(list, run.id, verified);
  console.log(`upserted: ${inserted} new`);

  const editorial = loadEditorial();
  let kept = 0;
  const heuristicRows: typeof rows = [];

  if (editorial) {
    console.log('applying editorial curation (authored as Sam)…');
    for (const e of rows) {
      const v = editorial.verdicts[e.title];
      if (!v) {
        heuristicRows.push(e);
        continue;
      }
      if (v.decision === 'keep') kept += 1;
      await db.insert(curations).values({
        eventId: e.id,
        runId: run.id,
        score: Math.max(0, Math.min(100, Math.round(v.score))),
        decision: v.decision,
        rationale: v.rationale,
        expectedPayoff: v.expectedPayoff,
        model: 'seed-editorial',
      });
    }
    if (editorial.learnedPreferences) {
      await db
        .update(profile)
        .set({ learnedPreferences: editorial.learnedPreferences, updatedAt: new Date() })
        .where(eq(profile.id, 1));
    }
  } else {
    heuristicRows.push(...rows);
  }

  if (heuristicRows.length > 0) {
    console.log(`curating ${heuristicRows.length} remaining event(s) as Sam (heuristic)…`);
    kept += await curateAndPersist(
      heuristicRows.map((e) => ({
        id: e.id,
        title: e.title,
        description: e.description,
        startAt: e.startAt as Date,
        region: e.region,
        city: e.city,
        organizer: e.organizer,
        price: e.price,
        tags: e.tags ?? [],
      })),
      run.id,
    );
  }

  await db
    .update(runs)
    .set({ status: 'success', finishedAt: new Date(), eventsFound: list.length, eventsKept: kept, emailSent: false })
    .where(eq(runs.id, run.id));

  console.log(`✓ seed done: found ${list.length}, kept ${kept}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
