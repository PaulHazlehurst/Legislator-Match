# Pinnacle Bill Intelligence

Find the Maryland legislators most likely to **carry** a bill and most able to **pass** it, and see who on the Pinnacle team already knows them.

- **Champions**: pick one of 24 policy areas (and a subtopic) to get members ranked by willingness, effectiveness and champion score, with their bills, outcomes and our relationships. Includes a W×E map, compare, a printable strategy brief and CSV export.
- **Bills**: search all bills from 2024–2026. Each bill shows its summary, sponsors, votes, cross-filed companion, and *why* it sits in its policy area. Colleagues can fix a classification.
- **Relationships**: the staff relationship web. Pick a policy area to see which of its top champions someone on the team knows, and the gaps.
- **Insights**: what moves a bill in Annapolis (cross-filing, bipartisan sponsors, majority leads), session funnels, policy-area table, leaderboards, and how reliable the classifications are.
- **Proposer**: describe a bill to get its policy area, the best champions, our warm paths to them, and similar bills.

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
- **Effectiveness** is the share of their led bills that became law in completed sessions.
  - A dead bill whose **cross-filed companion** became law counts as a win; v1 counted it as a failure.
  - Passing one chamber earns partial credit.
  - Small samples are shrunk toward the chamber average.
  - Majority-party status is added at its measured weight.
  - The result is placed on a bell curve: 50 is typical, 84 is one standard deviation better.
  - Validation: a member's 2024–25 record correlates 0.61 with their 2026 results.
- **Champion** is the geometric mean of the two, so you need both.

## Layout

```
index.html, css/, js/          the app (vanilla ES modules, no build step)
shared/                        taxonomy, classifier, scoring (used by app AND pipeline)
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
