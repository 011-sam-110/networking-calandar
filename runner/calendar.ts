/**
 * Calendar reconciliation for the local runner.
 *
 * getCalendarClient() returns a real Google Calendar client when creds + a
 * saved token are present, otherwise a mock that logs intended actions. Both
 * implement the frozen CalendarClient contract from lib/types.ts.
 */
import { google, calendar_v3 } from 'googleapis';
import type {
  CalendarClient,
  CalendarEventInput,
  CalendarSyncResult,
} from '../lib/types';
import {
  errorMessage,
  getOAuthClient,
  hasGoogleCreds,
  hasGoogleToken,
} from './google-client';

const TIME_ZONE = 'Europe/London';
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000; // 2h when no endAt is given

type ReconcileResult = CalendarSyncResult & {
  upserts: Record<string, string>;
  removed: string[];
};

function emptyResult(): ReconcileResult {
  return { created: 0, updated: 0, deleted: 0, errors: [], upserts: {}, removed: [] };
}

/** Map our event input onto a Google Calendar event body. */
function toGcalEvent(ev: CalendarEventInput): calendar_v3.Schema$Event {
  const start = new Date(ev.startAt);
  const end = ev.endAt ? new Date(ev.endAt) : new Date(start.getTime() + DEFAULT_DURATION_MS);
  const description = [ev.description?.trim() ?? '', '', `Book / register: ${ev.bookingUrl}`]
    .join('\n')
    .trim();
  return {
    summary: ev.title,
    description,
    // bookingUrl doubles as the location when no venue is known.
    location: ev.location?.trim() || ev.bookingUrl,
    start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
    end: { dateTime: end.toISOString(), timeZone: TIME_ZONE },
    source: { title: ev.title, url: ev.bookingUrl },
  };
}

/** Extract an HTTP status code from a googleapis error, if present. */
function statusOf(e: unknown): number | undefined {
  const anyE = e as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  const c = anyE?.code ?? anyE?.status ?? anyE?.response?.status;
  return typeof c === 'number' ? c : undefined;
}

function googleCalendarClient(): CalendarClient {
  return {
    name: 'google-calendar',
    async reconcile(desired, existing) {
      const result = emptyResult();
      const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
      const desiredIds = new Set(desired.map((d) => d.eventId));

      let cal: calendar_v3.Calendar;
      try {
        const auth = await getOAuthClient();
        cal = google.calendar({ version: 'v3', auth });
      } catch (e) {
        result.errors.push(`auth: ${errorMessage(e)}`);
        return result;
      }

      // Create events new to us; update events we've already synced.
      for (const ev of desired) {
        const body = toGcalEvent(ev);
        const gcalId = existing[ev.eventId];
        try {
          if (gcalId) {
            try {
              const res = await cal.events.update({
                calendarId,
                eventId: gcalId,
                requestBody: body,
              });
              result.updated++;
              result.upserts[ev.eventId] = res.data.id ?? gcalId;
            } catch (e) {
              // The event was deleted on Google's side — recreate it.
              const s = statusOf(e);
              if (s === 404 || s === 410) {
                const res = await cal.events.insert({ calendarId, requestBody: body });
                result.created++;
                if (res.data.id) result.upserts[ev.eventId] = res.data.id;
              } else {
                throw e;
              }
            }
          } else {
            const res = await cal.events.insert({ calendarId, requestBody: body });
            result.created++;
            if (res.data.id) result.upserts[ev.eventId] = res.data.id;
          }
        } catch (e) {
          result.errors.push(`${gcalId ? 'update' : 'create'} ${ev.eventId}: ${errorMessage(e)}`);
        }
      }

      // Delete calendar events whose eventId is no longer desired.
      for (const [eventId, gcalId] of Object.entries(existing)) {
        if (desiredIds.has(eventId)) continue;
        try {
          await cal.events.delete({ calendarId, eventId: gcalId });
          result.deleted++;
          result.removed.push(eventId);
        } catch (e) {
          const s = statusOf(e);
          if (s === 404 || s === 410) {
            // Already gone upstream — still drop the bookkeeping row.
            result.removed.push(eventId);
          } else {
            result.errors.push(`delete ${eventId}: ${errorMessage(e)}`);
          }
        }
      }

      return result;
    },
  };
}

function mockCalendarClient(): CalendarClient {
  return {
    name: 'mock-calendar',
    async reconcile(desired, existing) {
      const result = emptyResult();
      const desiredIds = new Set(desired.map((d) => d.eventId));

      for (const ev of desired) {
        console.log(`[mock-calendar] upsert "${ev.title}" (${ev.eventId}) @ ${ev.startAt}`);
        result.created++;
        result.upserts[ev.eventId] = `mock-${ev.eventId}`;
      }

      for (const eventId of Object.keys(existing)) {
        if (desiredIds.has(eventId)) continue;
        console.log(`[mock-calendar] delete ${eventId}`);
        result.deleted++;
        result.removed.push(eventId);
      }

      return result;
    },
  };
}

/** Real Google Calendar client when configured, otherwise a logging mock. */
export function getCalendarClient(): CalendarClient {
  if (hasGoogleCreds() && hasGoogleToken()) return googleCalendarClient();
  return mockCalendarClient();
}
