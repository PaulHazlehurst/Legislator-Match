// /api/update-outcomes.js
// Session-end bulk outcome updater.
// Takes a list of { billId, outcome } pairs and applies them all in one commit.
// Also supports a "mark all pending in state as failed" sweep for session end.
//
// Modes:
// { mode: "bulk", updates: [{ billId, outcome }] }
// { mode: "sweep", stateCode, fromOutcome: "pending", toOutcome: "failed" }

const MAX_RETRIES = 4;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const filePath = process.env.DATA_FILE_PATH || 'data.json';

  if (!token || !repo) return res.status(500).json({ error: 'Missing GITHUB_TOKEN or GITHUB_REPO.' });

  const { mode, updates, stateCode, fromOutcome, toOutcome } = req.body;
  if (!mode) return res.status(400).json({ error: 'mode is required (bulk or sweep).' });

  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await attemptUpdate({ mode, updates, stateCode, fromOutcome, toOutcome, token, repo, branch, filePath });
      return res.status(200).json(result);
    } catch (err) {
      lastError = err;
      if (err.isConflict && attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt)));
        continue;
      }
      break;
    }
  }
  return res.status(500).json({ error: lastError?.message || 'Unknown error' });
}

async function attemptUpdate({ mode, updates, stateCode, fromOutcome, toOutcome, token, repo, branch, filePath }) {
  const getRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
  );
  if (!getRes.ok) throw new Error(`GitHub fetch failed (${getRes.status})`);
  const fileMeta = await getRes.json();
  const content = JSON.parse(Buffer.from(fileMeta.content, 'base64').toString('utf-8'));

  let changedCount = 0;
  let commitMessage = '';

  if (mode === 'sweep') {
    // Mark all bills in a state matching fromOutcome -> toOutcome
    const st = content.states[stateCode];
    if (!st) throw new Error(`State ${stateCode} not found.`);
    st.legislators.forEach(l => {
      l.bills.forEach(b => {
        if (!fromOutcome || b.outcome === fromOutcome) {
          b.outcome = toOutcome;
          changedCount++;
        }
      });
    });
    commitMessage = `Session end sweep: marked ${changedCount} bills as ${toOutcome} in ${stateCode}`;

  } else if (mode === 'bulk') {
    if (!Array.isArray(updates) || updates.length === 0) {
      throw new Error('updates array required for bulk mode.');
    }
    // Build a fast lookup: billId -> bill object
    const billMap = {};
    Object.values(content.states).forEach(st => {
      st.legislators.forEach(l => {
        l.bills.forEach(b => { billMap[b.id] = b; });
      });
    });
    updates.forEach(({ billId, outcome }) => {
      if (billMap[billId]) {
        billMap[billId].outcome = outcome;
        changedCount++;
      }
    });
    commitMessage = `Bulk outcome update: ${changedCount} bill(s) updated`;

  } else if (mode === 'save-guidance') {
    // Save topic guidance edits from the UI
    const { topicCode, guidance } = req.body;
    if (!content.topics[topicCode]) throw new Error(`Topic ${topicCode} not found.`);
    content.topics[topicCode].guidance = guidance;
    changedCount = 1;
    commitMessage = `Update guidance for topic: ${topicCode}`;
  }

  if (changedCount === 0) {
    return { success: true, changedCount: 0, message: 'No bills matched — nothing changed.' };
  }

  const updatedContent = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
  const putRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/${filePath}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      body: JSON.stringify({ message: commitMessage, content: updatedContent, sha: fileMeta.sha, branch })
    }
  );

  if (!putRes.ok) {
    const errText = await putRes.text();
    const err = new Error(`GitHub commit failed: ${errText}`);
    err.isConflict = putRes.status === 409 || putRes.status === 422;
    throw err;
  }

  return { success: true, changedCount, message: commitMessage };
}
