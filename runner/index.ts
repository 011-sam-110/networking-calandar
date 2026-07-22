import 'dotenv/config';
import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '../db';
import { events, runs, attendance, curations, gcalSync } from '../db/schema';
import { getDiscoveryProvider } from './discovery';
import { getCalendarClient } from './calendar';
import { getEmailSender } from './email';
import {
  ensureProfile,
  upsertDiscovered,
  curateAndPersist,
  verifyLink,
} from './persist';
import type {
  DiscoveredEvent,
  Region,
  DigestEvent,
  DigestPayload,
  CalendarEventInput,
} from '../lib/types';

const HORIZON_DAYS = Number(process.env.DISCOVERY_HORIZON_DAYS || 60);

async function verifyLinks(list: DiscoveredEvent[]) {
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

async function reconcileCalendar() {
  const goingRows = await db
    .select()
    .from(events)
    .innerJoin(attendance, eq(attendance.eventId, events.id))
    .where(and(eq(attendance.going, true), gte(events.startAt, new Date())));

  const desired: CalendarEventInput[] = goingRows.map(({ events: e }) => ({
    eventId: e.id,
    title: e.title,
    description: `${e.description}\n\nBook / register: ${e.bookingUrl}`,
    startAt: (e.startAt as Date).toISOString(),
    endAt: e.endAt ? (e.endAt as Date).toISOString() : null,
    location: [e.venueName, e.address, e.city].filter(Boolean).join(', ') || null,
    bookingUrl: e.bookingUrl,
  }));

  const existingRows = await db.select().from(gcalSync);
  const existing: Record<string, string> = {};
  existingRows.forEach((r) => (existing[r.eventId] = r.gcalEventId));

  const client = getCalendarClient();
  const res = await client.reconcile(desired, existing);

  for (const [eventId, gcalId] of Object.entries(res.upserts)) {
    await db
      .insert(gcalSync)
      .values({
        eventId,
        gcalEventId: gcalId,
        calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
        lastAction: 'created',
      })
      .onConflictDoUpdate({
        target: gcalSync.eventId,
        set: { gcalEventId: gcalId, syncedAt: new Date(), lastAction: 'updated' },
      });
  }
  for (const eventId of res.removed) {
    await db.delete(gcalSync).where(eq(gcalSync.eventId, eventId));
  }
  return { created: res.created, updated: res.updated, deleted: res.deleted, errors: res.errors.length, client: client.name };
}

async function sendDigest(runId: string, found: number, inserted: number, from: string, to: string) {
  const recipient = process.env.DIGEST_TO_EMAIL || process.env.ALLOWED_EMAIL;
  if (!recipient) {
    console.log('no digest recipient configured — skipping email');
    return false;
  }

  // curations produced this run, keyed by eventId
  const thisRunCurations = await db.select().from(curations).where(eq(curations.runId, runId));
  const scoreByEvent = new Map(thisRunCurations.map((c) => [c.eventId, c]));

  const toDigestEvent = (e: typeof events.$inferSelect): DigestEvent => {
    const c = scoreByEvent.get(e.id);
    return {
      title: e.title,
      startAt: (e.startAt as Date).toISOString(),
      region: e.region as Region,
      venueName: e.venueName,
      city: e.city,
      price: e.price,
      bookingUrl: e.bookingUrl,
      score: c?.score ?? 0,
      rationale: c?.rationale ?? '',
    };
  };

  // newly discovered this run, kept, ranked
  const newRows = await db.select().from(events).where(eq(events.firstSeenRunId, runId));
  const newEvents = newRows
    .map(toDigestEvent)
    .filter((d) => (scoreByEvent.get(newRows.find((r) => r.title === d.title)!.id)?.decision ?? 'keep') !== 'drop')
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  // upcoming things Sam is going to
  const goingRows = await db
    .select()
    .from(events)
    .innerJoin(attendance, eq(attendance.eventId, events.id))
    .where(and(eq(attendance.going, true), gte(events.startAt, new Date())));
  const upcoming = goingRows
    .map(({ events: e }) => toDigestEvent(e))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  const payload: DigestPayload = {
    to: recipient,
    date: from,
    newEvents,
    upcoming,
    runSummary: { found, kept: newEvents.length, coveredFrom: from, coveredTo: to },
  };

  const sender = getEmailSender();
  const res = await sender.send(payload);
  console.log(`email(${sender.name}) → ${res.ok ? 'sent' : 'failed: ' + res.error}`);
  return res.ok;
}

async function main() {
  const trigger = process.argv.includes('--catchup')
    ? 'boot-catchup'
    : process.argv.includes('--manual')
      ? 'manual'
      : 'daily';

  const prof = await ensureProfile();

  const [lastSuccess] = await db
    .select()
    .from(runs)
    .where(eq(runs.status, 'success'))
    .orderBy(desc(runs.finishedAt))
    .limit(1);

  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const to = new Date(today.getTime() + HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10);

  if (lastSuccess?.finishedAt) {
    const days = Math.floor((today.getTime() - new Date(lastSuccess.finishedAt).getTime()) / 86_400_000);
    if (days >= 1) {
      console.log(
        `↺ catch-up: ${days} day(s) since the last successful run — one horizon scan backfills the gap.`,
      );
    }
  }

  const [run] = await db
    .insert(runs)
    .values({ trigger, status: 'running', coveredFrom: from, coveredTo: to })
    .returning();

  try {
    const knownTitles = (await db.select({ t: events.title }).from(events)).map((r) => r.t);
    const provider = getDiscoveryProvider();
    console.log(`discovery(${provider.name}) scanning ${from} → ${to}…`);
    const discovered = await provider.discover({
      from,
      to,
      regions: prof.regions as Region[],
      personaHeadline: prof.headline,
      goals: prof.goals,
      knownTitles,
    });
    console.log(`discovered ${discovered.length} events`);

    const verified = await verifyLinks(discovered);
    const { inserted } = await upsertDiscovered(discovered, run.id, verified);
    console.log(`upserted ${inserted} new events`);

    // Re-rank all upcoming events each run so fresh attendance/notes feedback applies.
    const upcoming = await db.select().from(events).where(gte(events.startAt, today));
    const kept = await curateAndPersist(
      upcoming.map((e) => ({
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
    console.log(`curated ${upcoming.length}, kept ${kept}`);

    const cal = await reconcileCalendar();
    console.log(`calendar(${cal.client}) → +${cal.created} ~${cal.updated} -${cal.deleted}`);

    const emailed = await sendDigest(run.id, discovered.length, inserted, from, to);

    await db
      .update(runs)
      .set({
        status: 'success',
        finishedAt: new Date(),
        eventsFound: discovered.length,
        eventsKept: kept,
        emailSent: emailed,
      })
      .where(eq(runs.id, run.id));

    console.log(`✓ run complete (${trigger}): found ${discovered.length}, new ${inserted}, kept ${kept}`);
    process.exit(0);
  } catch (err) {
    await db
      .update(runs)
      .set({ status: 'error', finishedAt: new Date(), error: String((err as Error)?.message ?? err) })
      .where(eq(runs.id, run.id));
    console.error('✗ run failed:', err);
    process.exit(1);
  }
}

main();
