# Orbit

A private calendar that finds the **networking events actually worth your time** and ranks them as if it were you - so a graduate careers fair or a relevant hackathon rises to the top and a beginner meetup in the wrong city sinks. Built for a job-seeking CS student, but the persona is configurable.

![The ranked feed](docs/screenshots/feed.png)

## What it does

- **Finds events for you.** A scheduled Claude Code run - the "scout" - searches the web *itself* (no model API key) for in-person networking events across Brighton & Sussex, London, and the occasional high-value UK trip.
- **Ranks them as you.** Each event is scored 0-100 *in your shoes* - weighting hiring value, relevance to your field, and travel cost - with a short "why go" and the likely payoff.
- **Learns from you.** A ✓/✗ on whether you actually attended, plus free-text notes, feed back into the next run so the picks get sharper over time.
- **Puts them on your calendar.** Anything you mark "going" is pushed to your real Google Calendar, booking link attached.
- **Emails you a daily digest.** New finds + what's coming up, straight to your inbox.
- **Never misses days.** The runner detects and backfills any gap since its last successful run - so if your laptop was off for a week, one run catches you up.

## How it works

Three pieces meet at one database. The scout and the app never talk directly - they share Postgres - so the app works fine between scout runs, and vice-versa.

```
  CLAUDE CODE SCOUT (scheduled, your laptop)      VERCEL APP (Next.js)
   • daily run + catch-up on boot                  • in-app calendar (feed + month)
   • web-searches for events ITSELF (no API key)   • tick/cross attendance
   • ranks them as you, ingests to the DB          • notes per event
   • a sync step pushes "going" -> Google Cal       • booking links + "why go"
     and emails the daily digest (as you)          • sign in with Google / password
            \                                            /
             \--------------->  POSTGRES  <-------------/
                     events · curations · attendance
                     notes · runs · profile · gcal_sync
```

### The "imagine you're Sam" brain

The scout **is** Claude Code, running with a persona (stored on the `profile` row) and your full history - every ✓/✗ and note. It searches and ranks directly for *"will this get me a job, a referral, or a genuinely useful connection?"* - no model API key. (A small keyword heuristic lives in the repo only as an offline fallback for the seed.) The initial demo ships with hand-authored editorial verdicts so you can see the quality bar immediately. The runbook the scout follows each run is `runner/SCOUT.md`.

![An event, with the verdict, tick/cross and notes](docs/screenshots/event.png)

## Tech stack

Next.js 16 (App Router, Server Actions) · React 19 · TypeScript · Tailwind v4 · Drizzle ORM + Postgres (Neon in prod) · Auth.js · googleapis (Calendar + Gmail). Discovery/curation is Claude Code itself - no LLM SDK.

## Getting started (local)

Requires Node 20+ and Docker (for a local Postgres).

```bash
# 1. Postgres
docker run -d --name networking-cal-db \
  -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=networking_cal \
  -p 5434:5432 postgres:16

# 2. Env + deps
cp .env.example .env      # sane local defaults are already filled in
npm install

# 3. Schema + real seed data (20 genuine Brighton/London events)
npm run db:migrate
npm run db:seed

# 4. Run it
npm run dev               # http://localhost:3000  (dev password: "dev")
```

## Going live

Discovery and curation need **no keys** - the scheduled Claude Code scout does the web search and ranking itself. The only optional keys are Google's, for the calendar push + email:

| Capability | Env | Notes |
|---|---|---|
| Discovery + curation | none | The scheduled Claude Code scout web-searches and ranks as you. See `runner/SCOUT.md`. |
| Calendar + email | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | One OAuth grant covers both. Then run `npm run google:auth` once to authorise (writes `runner/.google-token.json`). |
| Sign in with Google | same Google creds | The app shows a Google button; locked to `ALLOWED_EMAIL`. |

Deploy the **app** to Vercel (point `DATABASE_URL` at Neon). Schedule the **scout** on your laptop - the tasks run `claude` headless per `runner/SCOUT.md` (needs the `claude` CLI on PATH and signed in):

```powershell
# from the repo root, registers a daily 07:00 scout + a catch-up at logon
powershell -ExecutionPolicy Bypass -File scripts/register-tasks.ps1
```

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run db:migrate` | Apply Drizzle migrations |
| `npm run db:seed` | Load the 20 real seed events + editorial curation |
| `npm run context` | Print the persona + history + known events for a scout run |
| `npm run ingest -- <file>` | Persist the scout's curated events; sync calendar + email |
| `npm run sync` | Push "going" events to Google Calendar on demand |
| `npm run google:auth` | One-time Google OAuth for calendar + gmail |

## Project structure

```
app/            Next.js app - (app)/ is auth-gated; login/ is public
components/      UI (feed, calendar, event dialog, chrome)
db/             Drizzle schema, client, migrations
lib/            queries, serialization, shared runner<->app types
runner/         scout runbook (SCOUT.md) + context, ingest, sync, calendar, email
scripts/        Windows Task Scheduler setup
docs/           design spec + screenshots
```

## Status

The app and full pipeline are built and verified end-to-end against a local database (auth, ranked feed, month calendar, attendance ✓/✗, notes, live stats, calendar reconcile, digest email). Discovery + curation run as a scheduled Claude Code scout (no key); Google Calendar push and Gmail sending activate when Google creds are supplied - see *Going live*. The seed events are real and their booking links were checked at seed time (19/20 resolved).
