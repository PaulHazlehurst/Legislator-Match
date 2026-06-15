# Legislator bill matcher

A simple, self-contained web tool: pick a state, an issue area, a party,
and a chamber, and it surfaces legislators with the strongest track
record on that issue, including an "interest score" and their bill
passage rate.

## Files

- `index.html` — the entire app (no build step, no dependencies)
- `data.json` — all legislator and bill data

That's it. No server, no database, no installation.

## How to share it with your team (pick one)

### Option 1: Netlify Drop (easiest, ~2 minutes)

1. Go to https://app.netlify.com/drop
2. Drag the whole `legislator-matcher` folder (containing both
   `index.html` and `data.json`) onto the page
3. Netlify gives you a URL like `https://random-name-123.netlify.app`
4. Send that URL to your 8 coworkers — done

To update the data later, drag the folder onto the same Netlify Drop
page again (or use "Site settings" to redeploy).

### Option 2: GitHub Pages (best if you'll update it often)

1. Create a new GitHub repo, upload `index.html` and `data.json`
2. In the repo, go to Settings → Pages → set source to your main branch
3. GitHub gives you a URL like `https://yourname.github.io/legislator-matcher/`

To update data, edit `data.json` directly in GitHub (the web UI lets
you click "Edit" on the file, make changes, and commit) — the live
site updates automatically within a minute or two.

### Option 3: Just email the folder

Because everything runs in the browser, you can technically zip the
folder and email it. Each person double-clicks `index.html` to open it
locally. This works but isn't as clean as a shared URL, and everyone
would have an out-of-date copy whenever you update the data — not
recommended for a team tool, but useful for testing.

## How to add or update legislators and bills

Open `data.json` in any text editor. Everything lives under
`states.<STATE_CODE>.legislators`. Each legislator looks like this:

```json
{
  "name": "Sen. J. Carter",
  "party": "D",
  "chamber": "senate",
  "district": "13",
  "bills": [
    {
      "title": "Workforce Apprenticeship Expansion Act",
      "topic": "workforce",
      "year": 2025,
      "role": "sponsor",
      "outcome": "passed"
    }
  ]
}
```

Field notes:

- `party`: `"D"` or `"R"`
- `chamber`: `"senate"` or `"house"`
- `topic`: must match one of the keys under `topics` at the bottom of
  the file (e.g. `workforce`, `healthcare`, `environment`, `education`)
- `role`: `"sponsor"` or `"co-sponsor"` — sponsorships count more
  toward the interest score
- `outcome`: `"passed"` or `"failed"` (use `"failed"` for any bill that
  did not pass, including ones still pending if you want them excluded
  from the passage rate — or wait until the session ends to add them)

### Adding a new issue/topic

Add a new entry to the `topics` object at the bottom of `data.json`,
e.g.:

```json
"topics": {
  "workforce": "Workforce development",
  "housing": "Housing affordability"
}
```

Then use `"housing"` as the `topic` value on any bill. It will
automatically appear in the issue dropdown.

### Adding a new state

Add a new key under `states`, e.g.:

```json
"states": {
  "VA": {
    "name": "Virginia",
    "legislators": [ ... ]
  }
}
```

It will automatically appear in the state dropdown.

### A note on valid JSON

`data.json` is strict JSON — watch out for:
- every entry except the last in a list/object needs a trailing comma
- all keys and string values need double quotes (not single quotes)
- numbers (like `year`) should NOT be in quotes

If the page shows "Could not load data.json," it usually means there's
a small syntax error — paste the file into a JSON validator
(e.g. jsonlint.com) to find it quickly.

## How the interest score works

For each bill a legislator has on the selected issue:
- Sponsoring counts more than co-sponsoring (full weight vs. half weight)
- More recent bills count more than older ones (recency decays ~15% per year, with a floor)

These weighted values are summed and scaled to a 0–100 score. A
legislator with several recent sponsorships on an issue will score
near 100; someone with a single old co-sponsorship will score low.

The passage rate is simply: bills on this issue that passed ÷ total
bills on this issue, shown as a percentage.
