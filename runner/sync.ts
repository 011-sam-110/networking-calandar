import 'dotenv/config';
import { and, eq, gte } from 'drizzle-orm';
import { db } from '../db';
import { events, attendance, curations, gcalSync } from '../db/schema';
import { getCalendarClient } from './calendar';
import { getEmailSender } from './email';
import type { CalendarEventInput, DigestEvent, DigestPayload, Region } from '../lib/types';

/** Push events Sam marked "going" onto Google Calendar (create/update/delete). */
export async function reconcileCalendar() {
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

/** Email Sam the daily digest: what was newly found this run + what he's going to. */
export async function sendDigest(runId: string, found: number, from: string, to: string) {
  const recipient = process.env.DIGEST_TO_EMAIL || process.env.ALLOWED_EMAIL;
  if (!recipient) {
    console.log('no digest recipient configured — skipping email');
    return false;
  }

  const runCurations = await db.select().from(curations).where(eq(curations.runId, runId));
  const curByEvent = new Map(runCurations.map((c) => [c.eventId, c]));

  const toDigest = (e: typeof events.$inferSelect): DigestEvent => {
    const c = curByEvent.get(e.id);
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

  const newRows = await db.select().from(events).where(eq(events.firstSeenRunId, runId));
  const newEvents = newRows
    .filter((e) => (curByEvent.get(e.id)?.decision ?? 'keep') !== 'drop')
    .map(toDigest)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const goingRows = await db
    .select()
    .from(events)
    .innerJoin(attendance, eq(attendance.eventId, events.id))
    .where(and(eq(attendance.going, true), gte(events.startAt, new Date())));
  const upcoming = goingRows
    .map(({ events: e }) => toDigest(e))
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

// Run standalone (`npm run sync`) to push "going" changes to Google Calendar.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('runner/sync.ts')) {
  reconcileCalendar()
    .then((r) => {
      console.log(`calendar(${r.client}) → +${r.created} ~${r.updated} -${r.deleted} (${r.errors} errors)`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
