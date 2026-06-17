# Legislator bill matcher — Pinnacle Strategies LLC

Pick a state, issue, and subtopic, and the app surfaces legislators with
the strongest track record on that issue — interest score, passage rate,
full bill history. Includes an in-app "+" button to add new bills/
legislators (with optional AI auto-fill from a title or PDF) and a
trash button to delete recent mistakes.

## How it's put together

This is two small pieces working together:

1. **The website** (`index.html`, `app.js`, `data.json`) — a static
   site. This is what you already have on GitHub Pages.
2. **A tiny backend** (the `api/` folder) — three small functions that
   do the things a static site can't do on its own: call Claude to
   read a bill PDF, and write changes back into `data.json` on GitHub.
   This deploys separately, to a free service called Vercel.

You need both pieces running for the + and 🗑 buttons to work. Without
the backend deployed, the site still works perfectly as a browsing
tool — you just can't add/delete from the browser (you'd edit
`data.json` by hand like before).

---

## Part 1 — Push the updated site to GitHub

1. Replace your existing `index.html` and `data.json` in the repo with
   the new versions here, and add `app.js` alongside them (same folder).
2. Commit and push. GitHub Pages will redeploy automatically within
   about a minute.
3. At this point the site loads and browses fine, but the + and 🗑
   buttons will show an alert saying the backend isn't configured yet.
   That's expected — set up Part 2 next.

---

## Part 2 — Deploy the backend on Vercel

### 2a. Create a GitHub personal access token

This lets the backend write to your `data.json` file on your behalf.

1. Go to https://github.com/settings/tokens → "Generate new token" →
   "Fine-grained tokens"
2. Name it something like `legislator-matcher-bot`
3. Under "Repository access," select only your legislator-matcher repo
4. Under "Permissions" → "Repository permissions" → set **Contents**
   to **Read and write**
5. Generate the token and copy it somewhere safe — you won't see it again

### 2b. Get an Anthropic API key

1. Go to https://console.anthropic.com → "API Keys" → "Create key"
2. Copy the key. Add a few dollars of credit on the "Billing" page —
   parsing a bill title or PDF costs a small fraction of a cent, so
   even heavy use by your 8 users will run well under a dollar a month
3. Optional but recommended: under "Limits," set a monthly spend cap
   (e.g. $5) so there's no chance of a surprise bill

### 2c. Get a free LegiScan API key (powers the "Import" button)

This lets you import a legislator's current-session, primary-sponsored
bills automatically instead of typing each one in by hand.

1. Go to https://legiscan.com/legiscan and register for a free API key
2. The free tier includes 30,000 requests/month — far more than 8
   people will ever use just importing legislators occasionally
3. Copy the key

### 2d. Deploy to Vercel

1. Go to https://vercel.com and sign up (free) — sign in with GitHub,
   it's the easiest path
2. Click "Add New" → "Project," and import your legislator-matcher
   GitHub repo
3. Vercel will detect the `api/` folder automatically and deploy each
   file in it as a serverless function — you don't need to configure
   the build settings, the defaults work
4. Before clicking deploy, expand "Environment Variables" and add:

   | Name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | the key from step 2b |
   | `LEGISCAN_API_KEY` | the key from step 2c |
   | `GITHUB_TOKEN` | the token from step 2a |
   | `GITHUB_REPO` | your repo, formatted like `yourusername/legislator-matcher` |
   | `GITHUB_BRANCH` | `main` (or whatever your default branch is called) |
   | `DATA_FILE_PATH` | `data.json` (or the path to it if it's in a subfolder) |

5. Click Deploy. After it finishes, Vercel gives you a URL like
   `https://legislator-matcher-xyz.vercel.app`

### 2e. Connect the frontend to the backend

1. Open `app.js` in your GitHub repo (you can edit directly on
   github.com — click the file, click the pencil icon)
2. Find this line near the top:
   ```js
   const API_BASE = "PASTE_YOUR_VERCEL_FUNCTION_URL_HERE";
   ```
3. Replace it with your actual Vercel URL from step 2c, no trailing
   slash:
   ```js
   const API_BASE = "https://legislator-matcher-xyz.vercel.app";
   ```
4. Commit directly to your main branch. GitHub Pages redeploys in
   about a minute, and the + / 🗑 buttons will start working.

That's the whole setup. You won't need to touch Vercel again unless
you want to rotate keys or change the spend cap.

---

## Using the app day to day

### Browsing (what your 8 coworkers will mostly do)

Pick a state, issue, subtopic, party, and chamber. The list ranks
legislators by interest score — bills they've sponsored or co-sponsored
on that exact subtopic, weighted toward sponsorships and recent years.
Click "Show bill history" on any card to see the underlying bills and
which passed.

### Adding a bill (the + button, bottom right)

1. Click +
2. Optional: paste a bill title into the AI box and click "Fill," or
   drop a bill PDF onto the drop zone. Claude will try to fill in the
   title, year, sponsor name, and topic/subtopic — review everything
   it fills in, since it can guess wrong on ambiguous bills
3. Choose the topic and subtopic. If the bill doesn't fit any existing
   one, pick **"+ Add new topic…"** (or **"+ Add new subtopic…"** if
   only the subtopic is missing) and type a name — it gets created
   automatically the moment you save, and will appear in the filter
   dropdowns for everyone from then on. The AI auto-fill will also
   suggest a new topic/subtopic name on its own when nothing existing
   fits, which you can edit before saving
4. Choose whether this bill belongs to an existing legislator or a
   brand new one
5. Fill in/confirm the remaining fields and click "Save to GitHub"
6. The app automatically watches for your new bill to go live and
   refreshes itself the moment it does — usually 30-90 seconds, with no
   manual reload needed. If GitHub Pages is unusually slow, you'll see
   a message saying so after about 2 minutes; the bill is already
   safely saved either way, it'll just take a bit longer to appear)

### Importing a legislator's bills (the "Import ⇩" button)

This is the fastest way to populate someone's bill history, and it's
what answers the original ask: paste in a name instead of typing every
bill by hand.

1. Click "Import ⇩"
2. Pick the state, type the legislator's name (full name, last name
   only, or with "Sen."/"Del." — the search is forgiving), and click
   "Search LegiScan"
3. Pick the correct match if more than one comes back
4. The app fetches every bill from the **current legislative session**
   where that person is the **primary sponsor** (co-sponsored bills are
   excluded automatically) and asks Claude to suggest a topic/subtopic
   for each one
5. Review the list — each bill shows an editable topic/subtopic
   dropdown (with "+ Add new topic/subtopic…" available same as the
   manual form), a year, and an outcome. Uncheck any bill you don't
   want to import
6. Click "Save selected to GitHub." If this is a brand-new legislator,
   one gets created automatically using the name LegiScan returned —
   note that party, chamber, and district aren't filled in by this
   flow, since LegiScan's "current session roster" lookup is kept
   simple here; you may want to fill those three fields in by editing
   `data.json` directly afterward, or building on this flow later
7. The app waits for the bills to go live, same as the manual add flow,
   then refreshes automatically

A few limitations worth knowing:

- Only the bills LegiScan itself has indexed for the current session
  show up — if a state's legislature is slow to report to LegiScan,
  very recent bills might be missing for a few days
- A legislator's bill titles and primary-sponsor status require one
  LegiScan lookup per bill, so the import caps out at the first 60
  bills found for a person in a session. This is generous for nearly
  any legislator in a single session — if someone genuinely has more
  than 60 primary-sponsored bills in one session, the rest can be
  added through the manual flow
- The AI topic/subtopic suggestions are a starting point, not gospel —
  skim them before saving, the same way you'd review the AI auto-fill
  in the manual add flow
- This pulls the **current** session only by design (per your original
  ask) — older sessions aren't included, so a legislator's full
  historical track record will still need the manual add flow or a
  future enhancement to this importer
- The review screen always shows you exactly how many bills were
  found before you save anything — if that number ever looks
  unexpectedly high, it's worth double-checking before saving rather
  than after

### Deleting a mistake (the 🗑 button, bottom right)

Click the trash icon to see the 15 most recently added bills across
all legislators, each with a "Delete" button. The app watches for the
deletion to go live and refreshes automatically, same as adding a
bill. This only removes bills — if you accidentally created a
brand-new legislator by mistake, delete their (likely only) bill, then
manually remove the empty legislator entry from `data.json` on GitHub
directly. That's intentionally a slightly bigger speed bump, since it
is the most destructive action available.

Everything saved or deleted goes through a normal GitHub commit, so
the full history of changes lives in your repo's commit log if you
ever need to look back further than the 15 most recent bills.

---

## Editing topics and subtopics

The easiest way to add a topic or subtopic is now right in the add-bill
form — pick "+ Add new topic…" or "+ Add new subtopic…" and type a
name. No GitHub editing required.

If you ever want to rename, merge, or remove a topic, that still
requires editing `data.json` directly. Topics and subtopics live there
under the `topics` key:

```json
"topics": {
  "workforce": {
    "label": "Workforce development",
    "subtopics": {
      "training-programs": "Training programs",
      "employer-incentives": "Employer incentives",
      "grants": "Workforce grants"
    }
  }
}
```

The internal codes (like `training-programs`) are generated automatically
from whatever label you type when creating one through the + button, so
they'll look a little different from these hand-written examples, but
work exactly the same way.

---

## Adding a new state

Add a new entry under `states` in `data.json`:

```json
"states": {
  "VA": {
    "name": "Virginia",
    "legislators": []
  }
}
```

It will show up in the state dropdown immediately, and you can start
adding legislators to it through the + button.

---

## A note on the legislator roster

The Maryland data shipped with this project is sample data for
demonstration, not a verified current roster. Maryland's legislature
has had several mid-term appointments recently, so before relying on
this for real outreach, it's worth pulling the official current roster
from https://mgaleg.maryland.gov/mgawebsite/Members/Index/house and
replacing the sample legislators with real ones (keeping their bill
histories empty until you fill them in via the + button or by hand).

## Reliability notes (worth knowing before rolling out to the team)

A few things were added once more than one person started using this at
the same time:

- **Concurrent edits no longer silently fail.** If two people save or
  delete a bill within a second or two of each other, GitHub will
  reject the second write because the file changed underneath it. The
  backend now automatically retries that write a couple of times by
  refetching the latest data and reapplying the change, so this should
  be invisible in practice. If both people are editing the exact same
  bill at the exact same instant, last-write-wins still applies — but
  that's a much narrower window than before.
- **Duplicate topics/subtopics are caught automatically.** If someone
  types "Insurance" and someone else later types "insurance," the
  second one reuses the first instead of creating a near-duplicate
  topic. The check is case- and whitespace-insensitive.
- **Duplicate legislators are caught the same way.** Creating "Sen. J.
  Carter" twice (say, from two browser tabs) now attaches the second
  bill to the existing legislator instead of creating a second entry.
- **The existing-legislator picker in the add form is now searchable**
  — type a few letters to filter the list instead of scrolling, useful
  once you have a full chamber's roster loaded.

**Known follow-up, not yet done:** a dedicated pass on small mobile
screens (the add/import panels were built and tested at desktop and
typical mobile widths, but haven't been checked on a wide range of
actual phones). Worth a quick check if your team will be using this
from their phones day to day — flag anything cramped and it's a fast fix.

## Troubleshooting

**"Could not load data.json"** — usually a JSON syntax error (missing
comma, unescaped quote). Paste the file into jsonlint.com to find it.

**+/🗑/Import buttons show an alert about the backend** — `API_BASE`
in `app.js` is still the placeholder text. Revisit Part 2e.

**AI fill or saving fails with an error message** — check the Vercel
project's "Logs" tab for the specific error. The most common causes
are an expired/wrong GitHub token, a missing Anthropic API key, or the
`GITHUB_REPO` value not exactly matching `username/repo-name`.

**"No matching legislator found" when importing** — double check the
spelling, try just the last name, or confirm the person is actually
serving in the current session (LegiScan may not have indexed someone
newly appointed yet). Also check that `LEGISCAN_API_KEY` is set
correctly in Vercel's environment variables.

**Changes don't appear after saving** — the app polls automatically
for up to 2 minutes and refreshes itself the moment GitHub Pages
publishes your change, so you shouldn't need to do anything. If it
still hasn't shown up after that, GitHub Pages itself may be having a
slow moment — check your repo's "Actions" tab to see if the Pages
deployment succeeded, then just refresh the page.
