# Orbit - Networking Calendar - Design

**Date:** 2026-07-22
**Status:** built & verified (v1)

## Problem

Sam (2nd-year CompSci, Brighton, job-seeking) wants a calendar that automatically finds
networking events worth attending, ranks them *as him*, learns from whether he actually
went, pushes chosen events to his real calendar, and emails him a daily summary - with a
booking link for each.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| How are events discovered? | **Claude web-search only** (dropped the structured-API backbone). |
| Where's the calendar? | **In-app calendar** (feed + month) is primary; **one-way push** of "going" events to real Google Calendar. |
| Compute location | **Local runner** on Sam's laptop (daily + catch-up on boot); Vercel hosts the UI. |
| Geography | Brighton & Sussex, London, and occasional high-value UK. In-person only. |
| Daily email | Yes - sent by the runner via **Gmail API, as Sam** (one Google grant covers calendar + send). |
| Auth | Single-user. Sign in with Google (or a dev password locally), locked to `ALLOWED_EMAIL`. |

## Architecture

Three components share one Postgres database; the runner and app never talk directly.

- **Local runner** (TypeScript, run via `tsx` under Windows Task Scheduler): gap-detect →
  Claude web-search discovery → verify booking links → upsert (idempotent on a dedupe
  hash) → curate all upcoming events *as Sam* → reconcile "going" events onto Google
  Calendar → send the digest email → stamp the run.
- **Vercel app** (Next.js 16, Server Actions): auth-gated feed + month calendar, event
  detail with the verdict, attendance ✓/✗, notes, booking links, live stats.
- **Postgres** (Neon in prod, Docker locally): `events`, `curations` (history), `attendance`,
  `notes`, `runs`, `profile` (persona + learned prefs), `gcal_sync`.

### The curation brain

Runs with the `profile` persona + full attendance/notes history. Scores each candidate
0-100 for *"will this get Sam a job, referral, or useful connection?"*, keeps/drops,
writes a "why go" + expected payoff, and refreshes a learned-preferences summary. Claude
when `ANTHROPIC_API_KEY` is set; a transparent keyword/region/history heuristic otherwise.

### Feedback loop

The ✓/✗ (`attendance.attended`) and free-text `notes` are read back into the curator on
every run, so a crossed-off "too beginner" event down-weights similar ones next time.

### Catch-up

Each run records the event-date window it covered. On boot (or any run), it checks the
last successful run; because discovery always scans the upcoming horizon, a single run
after downtime fully backfills the gap.

## Data model

`events(dedupeHash unique, bookingUrl, linkVerified, region, tags…)` ·
`curations(eventId, runId, score, decision, rationale, expectedPayoff, model)` ·
`attendance(eventId pk, going, attended)` · `notes(eventId, body)` ·
`runs(trigger, status, coveredFrom/To, eventsFound/Kept, emailSent)` ·
`profile(id=1, headline, goals, learnedPreferences, regions)` ·
`gcal_sync(eventId pk, gcalEventId)`.

## Honest boundaries

- Live discovery / good curation needs `ANTHROPIC_API_KEY`; without it the runner uses
  mock discovery + heuristic curation so the pipeline still runs.
- Google Calendar push + Gmail send need a Google OAuth grant (`npm run google:auth`).
- "Two-way" Google Calendar was scoped down to a one-way push; attendance stays in-app
  because personal Google Calendar events have no attendance concept to read back.
- The 20 seed events are real; booking links checked at seed time (19/20 resolved). Some
  recurring-meetup dates are projected from cadence - flagged in each description.

## Build notes

Backend modules (discovery, curation, Google calendar+email) were built in parallel
against the frozen `lib/types.ts` contract, then integrated. Verified end-to-end with
Playwright: auth flow, ranked feed, month calendar, event dialog, going/attended/notes
persistence + live stat updates, dark mode, mock runner (calendar reconcile picked up a
"going" flag), and the rendered digest email.
