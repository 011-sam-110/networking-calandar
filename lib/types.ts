/**
 * Shared contracts between the local runner's modules and the app.
 * These are frozen interfaces — the discovery / curation / email / calendar
 * modules implement them so they can be built and tested independently.
 */

export type Region = 'Brighton & Sussex' | 'London' | 'UK';

/** Raw event as returned by a discovery provider (before dedupe / persistence). */
export interface DiscoveredEvent {
  title: string;
  description: string;
  /** ISO 8601 with timezone offset, e.g. "2026-08-14T18:30:00+01:00". */
  startAt: string;
  endAt?: string | null;
  venueName?: string | null;
  address?: string | null;
  city?: string | null;
  region: Region;
  isOnline: boolean;
  /** The page where Sam can register / grab a ticket. */
  bookingUrl: string;
  price?: string | null;
  organizer?: string | null;
  tags: string[];
  /** Which provider produced this (e.g. "web-search", "seed"). */
  source: string;
}

export interface DiscoveryInput {
  /** Inclusive date window to search over (ISO date, e.g. "2026-07-22"). */
  from: string;
  to: string;
  regions: Region[];
  /** Persona + goals so discovery searches the way Sam would. */
  personaHeadline: string;
  goals: string;
  /** Titles already known, so the provider can avoid obvious repeats. */
  knownTitles: string[];
}

export interface DiscoveryProvider {
  readonly name: string;
  discover(input: DiscoveryInput): Promise<DiscoveredEvent[]>;
}

/** One past event's outcome, fed back into curation. */
export interface AttendanceHistoryItem {
  title: string;
  startAt: string;
  region: Region;
  tags: string[];
  going: boolean;
  attended: boolean | null; // tick / cross / unknown
  notes: string[];
}

export interface CurationCandidate {
  /** Stable key so we can map the verdict back to the DB row. */
  key: string;
  title: string;
  description: string;
  startAt: string;
  region: Region;
  city?: string | null;
  organizer?: string | null;
  price?: string | null;
  tags: string[];
}

export interface CurationContext {
  personaHeadline: string;
  goals: string;
  learnedPreferences: string;
  history: AttendanceHistoryItem[];
}

export interface CurationVerdict {
  key: string;
  score: number; // 0-100
  decision: 'keep' | 'drop';
  rationale: string; // short "why go, as Sam"
  expectedPayoff: string;
}

export interface CurationResult {
  verdicts: CurationVerdict[];
  /** Optional refreshed learned-preferences summary to persist on the profile. */
  updatedLearnedPreferences?: string;
  model: string;
}

export interface CurationProvider {
  readonly name: string;
  curate(candidates: CurationCandidate[], ctx: CurationContext): Promise<CurationResult>;
}

/** A single event as it appears in the daily digest email. */
export interface DigestEvent {
  title: string;
  startAt: string;
  region: Region;
  venueName?: string | null;
  city?: string | null;
  price?: string | null;
  bookingUrl: string;
  score: number;
  rationale: string;
}

export interface DigestPayload {
  to: string;
  date: string; // ISO date the digest covers
  newEvents: DigestEvent[];
  upcoming: DigestEvent[]; // things Sam already flagged "going" that are soon
  runSummary: { found: number; kept: number; coveredFrom: string; coveredTo: string };
}

export interface EmailSender {
  readonly name: string;
  send(payload: DigestPayload): Promise<{ ok: boolean; id?: string; error?: string }>;
}

/** What the calendar module needs to create/update an event on Google Calendar. */
export interface CalendarEventInput {
  eventId: string;
  title: string;
  description: string;
  startAt: string;
  endAt?: string | null;
  location?: string | null;
  bookingUrl: string;
}

export interface CalendarSyncResult {
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
}

export interface CalendarClient {
  readonly name: string;
  /**
   * Reconcile Google Calendar with the set of events Sam marked "going".
   * `desired` = events that should be on the calendar now.
   * `existing` = map of eventId -> gcalEventId already synced.
   */
  reconcile(
    desired: CalendarEventInput[],
    existing: Record<string, string>,
  ): Promise<
    CalendarSyncResult & {
      /** eventId -> gcalEventId for rows to upsert into gcal_sync. */
      upserts: Record<string, string>;
      /** eventIds whose gcal_sync rows should be removed. */
      removed: string[];
    }
  >;
}
