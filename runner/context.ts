import 'dotenv/config';
import { gte } from 'drizzle-orm';
import { db } from '../db';
import { events } from '../db/schema';
import { ensureProfile, loadHistory } from './persist';

/**
 * Dumps everything the scheduled Claude Code scout needs before it web-searches:
 * the persona to search/rank as, the date window, the titles already in the DB
 * (so it doesn't re-add them), and Sam's attendance ✓/✗ + notes history (so the
 * feedback loop actually applies). Printed as JSON to stdout.
 */
const HORIZON_DAYS = Number(process.env.DISCOVERY_HORIZON_DAYS || 60);

async function main() {
  const prof = await ensureProfile();
  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const to = new Date(today.getTime() + HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10);

  const upcoming = await db.select().from(events).where(gte(events.startAt, today));
  const knownUpcoming = upcoming.map((e) => ({
    title: e.title,
    startAt: (e.startAt as Date).toISOString(),
    region: e.region,
  }));

  const history = await loadHistory();

  const out = {
    persona: {
      displayName: prof.displayName,
      headline: prof.headline,
      goals: prof.goals,
      learnedPreferences: prof.learnedPreferences,
      homeCity: prof.homeCity,
      regions: prof.regions,
    },
    window: { from, to },
    knownUpcoming,
    history,
    instructions:
      'Web-search for NEW in-person networking events in these regions and window that are not in knownUpcoming. Rank each as this persona (score 0-100, keep/drop, a short first-person "why go", and expected payoff), factoring history/notes. Verify booking links resolve. Write the result to runner/scout-events.json and run: npm run ingest -- runner/scout-events.json',
  };

  process.stdout.write(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
