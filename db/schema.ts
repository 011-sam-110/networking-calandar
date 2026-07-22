import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  date,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * runs — one row per discovery run. Powers gap-detection / catch-up-on-boot
 * and gives the app an observability trail of what happened each day.
 */
export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  trigger: text('trigger').notNull().default('daily'), // daily | boot-catchup | manual
  status: text('status').notNull().default('running'), // running | success | error
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  coveredFrom: date('covered_from'),
  coveredTo: date('covered_to'),
  eventsFound: integer('events_found').notNull().default(0),
  eventsKept: integer('events_kept').notNull().default(0),
  emailSent: boolean('email_sent').notNull().default(false),
  error: text('error'),
});

/**
 * events — the canonical, de-duplicated networking events surfaced to Sam.
 * `dedupeHash` makes the daily upsert idempotent (safe to re-run / backfill).
 * `bookingUrl` is always the verified place to grab a ticket.
 */
export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull().default('web-search'), // web-search | seed | manual
  externalId: text('external_id'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }),
  timezone: text('timezone').notNull().default('Europe/London'),
  venueName: text('venue_name'),
  address: text('address'),
  city: text('city'),
  region: text('region').notNull().default('UK'), // Brighton & Sussex | London | UK
  isOnline: boolean('is_online').notNull().default(false),
  bookingUrl: text('booking_url').notNull(),
  linkVerified: boolean('link_verified').notNull().default(false),
  price: text('price'),
  organizer: text('organizer'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  imageUrl: text('image_url'),
  dedupeHash: text('dedupe_hash').notNull().unique(),
  discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
  firstSeenRunId: uuid('first_seen_run_id'),
});

/**
 * curations — the "imagine you're Sam" verdict for an event, kept per run so we
 * retain the reasoning history and can see how a score changed over time.
 */
export const curations = pgTable('curations', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  runId: uuid('run_id'),
  score: integer('score').notNull().default(0), // 0-100, higher = more worth attending
  decision: text('decision').notNull().default('keep'), // keep | drop
  rationale: text('rationale').notNull().default(''), // short "why go, as Sam"
  expectedPayoff: text('expected_payoff'), // what Sam plausibly gets out of it
  model: text('model'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * attendance — Sam's signals per event. `going` (intent) drives the Google
 * Calendar push; `attended` is the after-the-fact tick (true) / cross (false)
 * that feeds back into the next run's curation.
 */
export const attendance = pgTable('attendance', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => events.id, { onDelete: 'cascade' }),
  going: boolean('going').notNull().default(false),
  attended: boolean('attended'), // null = unknown, true = tick, false = cross
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * notes — Sam's freeform notes on an event. Every note is fed back to the
 * curation brain on the next run so preferences are learned over time.
 */
export const notes = pgTable('notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * profile — singleton (id = 1). The persona the curation brain wears when it
 * imagines it is Sam, plus a learned-preferences summary it maintains.
 */
export const profile = pgTable('profile', {
  id: integer('id').primaryKey().default(1),
  displayName: text('display_name').notNull().default('Sam'),
  headline: text('headline').notNull().default(''),
  goals: text('goals').notNull().default(''),
  learnedPreferences: text('learned_preferences').notNull().default(''),
  homeCity: text('home_city').notNull().default('Brighton'),
  regions: jsonb('regions').$type<string[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * gcal_sync — maps an app event to the Google Calendar event created for it,
 * so the runner can reconcile (create / update / delete) once per run.
 */
export const gcalSync = pgTable('gcal_sync', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => events.id, { onDelete: 'cascade' }),
  gcalEventId: text('gcal_event_id').notNull(),
  calendarId: text('calendar_id').notNull().default('primary'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  lastAction: text('last_action').notNull().default('created'), // created | updated | deleted
});

// ---- relations (for convenient nested queries) ----

export const eventsRelations = relations(events, ({ many, one }) => ({
  curations: many(curations),
  notes: many(notes),
  attendance: one(attendance, {
    fields: [events.id],
    references: [attendance.eventId],
  }),
  gcalSync: one(gcalSync, {
    fields: [events.id],
    references: [gcalSync.eventId],
  }),
}));

export const curationsRelations = relations(curations, ({ one }) => ({
  event: one(events, { fields: [curations.eventId], references: [events.id] }),
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
  event: one(events, { fields: [attendance.eventId], references: [events.id] }),
}));

export const notesRelations = relations(notes, ({ one }) => ({
  event: one(events, { fields: [notes.eventId], references: [events.id] }),
}));

export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type CurationRow = typeof curations.$inferSelect;
export type AttendanceRow = typeof attendance.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type ProfileRow = typeof profile.$inferSelect;
