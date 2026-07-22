# Orbit scout — runbook for the scheduled Claude Code run

You (Claude Code) **are** Orbit's scout. On a schedule (Windows Task Scheduler: daily +
at logon) you find new networking events for Sam and rank them as him. There is **no
model API key** anywhere in this project — the web search is done by *you*, here, using
your own web-search tool.

**Which database?** The scheduled tasks use the `:live` script variants, which target
the deployed Neon database (via `.env.scout`) so finds land on the live site. The plain
`context` / `ingest` scripts target the local dev database instead. Use whichever pair
the invoking command told you to — don't mix them.

One run:

1. **Get context.** Run `npm run context:live` (or `npm run context` for local). It
   prints JSON: Sam's persona + goals + learned preferences, the date window to cover,
   the event titles already in the DB (`knownUpcoming` — don't re-add these), and his
   attendance ✓/✗ + notes history.

2. **Search the web** for NEW in-person networking events in the window across
   Brighton & Sussex, London, and high-value UK (in-person only). Favour real, bookable
   events (Meetup / Eventbrite / Luma / official sites). Skip anything already in
   `knownUpcoming`. Verify booking links resolve.

3. **Curate as Sam.** For each event, decide keep/drop and score 0-100 through one lens:
   *"will this get Sam a job, a referral, or a genuinely useful connection?"* Weight
   hiring value, relevance to software/CS, and travel cost (Brighton > London
   worth-the-train > far UK only if the payoff is high). **Factor the history/notes**: if
   he crossed off or wrote something negative about an event type, down-weight similar
   ones; ticks / positive notes up-weight. Write a short first-person "why go" and the
   expected payoff. Optionally refresh `learnedPreferences`.

4. **Write** the result to `runner/scout-events.json`:

   ```json
   {
     "learnedPreferences": "optional refreshed summary",
     "events": [
       {
         "title": "...", "description": "...",
         "startAt": "2026-08-14T18:30:00+01:00", "endAt": null,
         "venueName": "...", "address": "...", "city": "...",
         "region": "Brighton & Sussex | London | UK",
         "isOnline": false, "bookingUrl": "https://...",
         "price": "Free | £10 | ...", "organizer": "...",
         "tags": ["..."], "source": "web-search",
         "score": 0, "decision": "keep | drop",
         "rationale": "...", "expectedPayoff": "..."
       }
     ]
   }
   ```

5. **Ingest.** Run `npm run ingest:live -- runner/scout-events.json` (or `npm run ingest`
   for local; add `--catchup` if this is the boot catch-up run). It dedupes + persists,
   records your verdicts, pushes any "going" events to Google Calendar, and emails Sam
   the daily digest.

That's the whole loop. The Vercel app just reads the database.
