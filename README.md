# Pinnacle Bill Intelligence

Find the Maryland legislators most likely to **carry** a bill and most able to **pass** it, and see who on the Pinnacle team already knows them.

- **Game plan** (the home page and Proposer): describe a bill in your own words. You get its policy area, the odds, the committees that will decide it and who chairs them, who to ask to lead, cross-file and co-sponsor, who on our team knows each of them, and who has tried it before. With an AI key it adds likely allies, opposition and framing.
- **Champions**: pick one of 24 policy areas (and a subtopic). Each member gets one number and a plain word (Top pick, Strong, Solid…), lifted when someone on our team knows them. Shows the committees that hear the area's bills, a map, compare and CSV export with contact details.
- **Bills**: search all bills from 2024–2026. Each bill shows how far it got (filed, hearing, out of committee, passed a chamber, law), its committee, summary, sponsors, votes, cross-filed companion, and *why* it sits in its policy area. Colleagues can fix a classification.
- **Relationships**: the staff relationship web. Pick a policy area to see which of its top champions someone on the team knows, and the gaps.
- **Insights**: what moves a bill, where bills die (the committee vote), a scorecard for every standing committee, swing votes, policy-area table and leaderboards.

## Turning on v2 (one-time, about 10 minutes)

1. **Supabase → SQL editor**: run `ingest/sql/v2_migration.sql`. It adds secondary topics and classifier provenance to `bills`, and creates the private `staff` / `staff_relationships` tables.
2. **GitHub → Actions → Data ingest → Run workflow**, step `reclassify-all`. This seeds the 24-area taxonomy and reclassifies every bill (free, a few minutes). It never overwrites a bill a colleague fixed by hand.
3. Optional AI second opinion on the ~25% of bills the rules are unsure about:
   - Add an `ANTHROPIC_API_KEY` repository secret. Without it, the existing `GEMINI_API_KEY` is used.
   - Run step `ai-review-eval` first. It measures AI review on the hand-labelled bills and writes nothing.
   - If the eval reports that AI review helps, run step `ai-review`.
4. **Vercel → Settings → Environment Variables** (to turn on the shared relationship web and classification fixes). After adding them, redeploy.
   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | `https://<project>.supabase.co` |
   | `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → service-role key (server only, never in the page) |
   | `TEAM_PASSCODE` | a passphrase you share with colleagues |

Until step 4 is done, the Relationships page saves in each person's browser, with Export/Import so nothing is lost. Until step 2 is done, the app shows a notice that bills still use the old classifier.

## Official General Assembly data

`npm run build-data` (or the **build-data** step of the Data ingest workflow) reads mgaleg.maryland.gov and the public database and writes two files the app loads:

- `data/mga.json`: the 14 standing committees with chairs, vice chairs, members and issue areas; every member's leadership posts, email and phone; and for every bill its committees of referral, hearing date, official cross-file and how far it got.
- `data/votes.json`: how often each member votes with their party, and who they vote most like, on contested roll calls only (unanimous votes are skipped).

It needs no secrets. Run it when rosters change (always after an election, once new committee assignments are posted in January) and weekly during session; the `ingest` step runs it automatically.

## The AI analyst (optional)

The game plan works without AI. To add the "politics" section (allies, opposition, framing, fiscal note), set `ANTHROPIC_API_KEY` in Vercel (or `GEMINI_API_KEY`, used if no Anthropic key is set) and redeploy. Check it at `/api/analyze`: it reports which provider is active.

## Classification: how accurate, and how we know

Every bill gets a primary policy area, a subtopic, an optional secondary area, a confidence level and the evidence behind it.

- The rules engine is `shared/classifier.js`. It weighs:
  - the Department of Legislative Services' own broad subject (always listed first on a bill);
  - Maryland's title convention ("Income Tax – …", with county prefixes stripped);
  - specialist vocabularies (firearms, cannabis, alcohol, gaming);
  - the bill summary.
- v1 took the first matching subject tag, so a credit-insurance licensing bill landed in Health and a firearms waiting-period bill in Business Regulation.
- Accuracy is measured against 630 hand-labelled bills in `ingest/eval/`. The final 150 were labelled after tuning was frozen.

| | v1 (old) | v2 rules |
|---|---|---|
| Correct policy area (holdout) | 61% | **88%** |
| Correct as primary or secondary | — | **97%** |
| Correct subtopic, given the right area | ~4% had one | **88%** |
| High-confidence bills (75% of all) | — | **~95%** correct |

Run it yourself: `npm run eval`. The **Tests** workflow fails any change that drops accuracy below the floor.

To improve accuracy, use the **Needs review** filter on the Bills page to see the medium/low-confidence bills, open any one, and use **Fix this classification**. Fixes are permanent.

## How the scores work

Computed in the browser from raw bills and sponsorships (`shared/scoring.js`), so every number traces back to bills.

- **Willingness** is driven by bills a member *leads*. Co-sponsoring adds a little and is capped, so someone who only co-signs tops out around 33. Recent sessions and substantive bills weigh most; a bill whose *secondary* area matches counts half. The curve never saturates, so the most active members stay distinguishable.
- **Passes it (effectiveness)** is the share of their led bills that became law in completed sessions.
  - A dead bill whose **cross-filed companion** became law counts as a win.
  - Passing one chamber earns partial credit.
  - Small samples are shrunk toward the chamber average; majority-party status is added at its measured weight.
  - **Committee seats count, per policy area.** In 2026, bills became law 60% of the time when the sponsor chaired the committee of referral, 46% for vice chairs, 38% for members and 30% for non-members. A seat on the committee that hears an area's bills raises the score in proportion to its share of them.
  - Validation: a member's 2024–25 record correlates 0.61 with their 2026 results.
- **Champion** is the geometric mean of the two, so you need both.
- **Best for us** is the number shown: the champion score raised by up to 25% when someone on our team knows the member (10% acquaintance, 17.5% working relationship, 25% close). It can be switched off under Filters. The weights are in `shared/scoring.js`.

## Layout

```
index.html, css/, js/          the app (vanilla ES modules, no build step)
shared/                        taxonomy, classifier, scoring, idea search (used by app AND pipeline)
data/                          committees, bill progress, vote comparisons (built by npm run build-data)
api/                           Vercel functions: analyze (Proposer AI), relationships, bill-topic
ingest/                        LegiScan/OpenStates pipeline, reclassify-all, ai-review, eval/
ingest/sql/v2_migration.sql    run once (see above)
tests/                         scoring + API tests   (npm test runs everything)
vendor/                        d3 7.9.0 for the relationship graph (no CDN dependency)
```

Run locally: `npm run serve`, then open http://localhost:8765. Data loads live from Supabase; the `/api/*` routes only run on Vercel.

## Data refresh

The weekly schedule in `.github/workflows/ingest.yml` is commented out between sessions. Uncomment it when the 2027 session starts.

Each `ingest` run:
- adds new bills, already classified with v2;
- refreshes the outcome and status of existing bills (v1 never updated these after first load).

## Security notes

- The page uses the public Supabase anon key; `ingest/rls.sql` makes it read-only.
- Staff relationships are **not** readable with that key. They are served only by `/api/relationships`, which checks `TEAM_PASSCODE`.
- The old `/api/save-bill`, `delete-bill`, `import-legiscan` and similar endpoints were removed. They were unauthenticated and committed to this repository with a stored GitHub token, and nothing used them since the move to Supabase. If `GITHUB_TOKEN` is still set in Vercel, it can be deleted.
