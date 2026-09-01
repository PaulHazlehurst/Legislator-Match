# Ingestion pipeline — one-time backfill

Loads the last three Maryland regular sessions (bills, sponsors, co-sponsors,
roll-call votes, people) into your Supabase database, classifying each bill as
it goes. Run it once to backfill; re-run any time to refresh (it upserts, so
nothing duplicates).

## Prerequisites
- You've run `schema.sql` in the Supabase SQL editor.
- Node.js 18 or newer (has built-in `fetch`). Check with `node --version`.

## Setup
```bash
cd ingest
cp .env.example .env        # then paste your real keys into .env
npm install
```

Your `.env` needs: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (the service-role key,
not anon), `LEGISCAN_API_KEY`, `GEMINI_API_KEY` (free — get it at
https://aistudio.google.com/apikey). `OPENSTATES_API_KEY` is for the next
script, not these.

## Run
```bash
npm run seed         # loads the state + topic/subtopic taxonomy. Run once.
npm run ingest       # pulls the 3 sessions + classifies from subjects. Free, ~minutes.
npm run reclassify   # Gemini pass over the leftover bills. Free, rate-limited, resumable.
```

Classification happens in two passes:
- `ingest` classifies every bill it can from LegiScan's official subject tags.
  No AI, no cost, no rate limits.
- `reclassify` runs Gemini ONLY on bills that had no subject match. It's throttled
  to the free tier and resumable: if it hits the daily cap it stops cleanly, and
  re-running continues where it left off (it only touches bills with no topic).

## What each step costs — nothing
- LegiScan: ~6 API calls total (one list + one dataset per year). Free tier is
  30,000/month.
- Gemini: free tier (~1,500 requests/day, no credit card). Only the unmatched
  bills hit it, and `reclassify` stays under the cap. If there are more leftovers
  than the daily cap allows, run `reclassify` again the next day.

## After it runs — sanity checks
In the Supabase table editor or SQL editor:
```sql
select count(*) from bills;
select classified_by, count(*) from bills group by 1;      -- how many needed AI
select significance, count(*) from bills group by 1;        -- ceremonial/local split
select count(*) from votes;                                 -- individual votes loaded
select role, count(*) from sponsorships group by 1;         -- primary vs cosponsor
```
If `classified_by = 'unclassified'` is a large share after `ingest`, that's
expected — those are the bills `reclassify` will handle. If it's still large
after `reclassify`, extend `SUBJECT_TO_TOPIC` in `taxonomy.js` with the subject
names you see in `bills.legiscan_subjects` and re-run; that moves more bills onto
the free, high-trust subject path and off the AI.

Provenance values you'll see in `classified_by`:
- `legiscan_subject` — matched an official subject tag (highest trust)
- `gemini` — the AI found a confident topic
- `gemini_no_match` — the AI reviewed it and found no clear fit (classify by hand)
- `unclassified` — not yet run through the AI pass

## Re-classifying later
Because provenance and confidence are stored, you can safely re-run just the
low-confidence bills later without touching human-verified ones — a small
follow-up once you've reviewed the first results.
