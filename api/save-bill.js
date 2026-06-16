// /api/save-bill.js
// Adds a bill to an existing legislator, or creates a new legislator with
// this bill, then commits the updated data.json back to GitHub.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { stateCode, legislator, bill } = req.body;
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;       // e.g. "yourname/legislator-matcher"
  const branch = process.env.GITHUB_BRANCH || 'main';
  const filePath = process.env.DATA_FILE_PATH || 'data.json';

  if (!token || !repo) {
    return res.status(500).json({ error: 'Server is missing GITHUB_TOKEN or GITHUB_REPO env vars.' });
  }
  if (!stateCode || !legislator || !bill || !bill.title) {
    return res.status(400).json({ error: 'Missing stateCode, legislator, or bill data.' });
  }

  try {
    // 1. Fetch current data.json + its sha (required to update a file via GitHub API)
    const getRes = await fetch(
      `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
    );
    if (!getRes.ok) throw new Error(`Could not fetch data.json from GitHub (${getRes.status})`);
    const fileMeta = await getRes.json();
    const content = JSON.parse(Buffer.from(fileMeta.content, 'base64').toString('utf-8'));

    if (!content.states[stateCode]) {
      return res.status(400).json({ error: `State ${stateCode} does not exist in data.json.` });
    }

    content.meta = content.meta || { nextLegislatorId: 1, nextBillId: 1 };
    const newBillId = 'B' + String(content.meta.nextBillId).padStart(4, '0');
    const billRecord = { id: newBillId, ...bill };

    let targetLegislator;
    if (legislator.mode === 'existing') {
      targetLegislator = content.states[stateCode].legislators.find(l => l.id === legislator.legislatorId);
      if (!targetLegislator) return res.status(400).json({ error: 'Legislator not found.' });
    } else {
      const newId = 'L' + String(content.meta.nextLegislatorId).padStart(3, '0');
      targetLegislator = {
        id: newId,
        name: legislator.name,
        party: legislator.party,
        chamber: legislator.chamber,
        district: legislator.district || '',
        bills: []
      };
      content.states[stateCode].legislators.push(targetLegislator);
      content.meta.nextLegislatorId += 1;
    }

    targetLegislator.bills.push(billRecord);
    content.meta.nextBillId += 1;

    // 2. Commit updated file back to GitHub
    const updatedContent = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
    const putRes = await fetch(
      `https://api.github.com/repos/${repo}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        body: JSON.stringify({
          message: `Add bill: ${bill.title}`,
          content: updatedContent,
          sha: fileMeta.sha,
          branch
        })
      }
    );
    if (!putRes.ok) {
      const errText = await putRes.text();
      throw new Error(`GitHub commit failed: ${errText}`);
    }

    return res.status(200).json({ success: true, billId: newBillId, legislatorId: targetLegislator.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
