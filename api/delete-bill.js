// /api/delete-bill.js
// Removes a single bill from a legislator's bills array and commits
// the updated data.json back to GitHub.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { stateCode, legislatorId, billId } = req.body;
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const filePath = process.env.DATA_FILE_PATH || 'data.json';

  if (!token || !repo) {
    return res.status(500).json({ error: 'Server is missing GITHUB_TOKEN or GITHUB_REPO env vars.' });
  }
  if (!stateCode || !legislatorId || !billId) {
    return res.status(400).json({ error: 'Missing stateCode, legislatorId, or billId.' });
  }

  try {
    const getRes = await fetch(
      `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
    );
    if (!getRes.ok) throw new Error(`Could not fetch data.json from GitHub (${getRes.status})`);
    const fileMeta = await getRes.json();
    const content = JSON.parse(Buffer.from(fileMeta.content, 'base64').toString('utf-8'));

    const stateData = content.states[stateCode];
    if (!stateData) return res.status(400).json({ error: `State ${stateCode} not found.` });

    const legislator = stateData.legislators.find(l => l.id === legislatorId);
    if (!legislator) return res.status(400).json({ error: 'Legislator not found.' });

    const beforeCount = legislator.bills.length;
    legislator.bills = legislator.bills.filter(b => b.id !== billId);
    if (legislator.bills.length === beforeCount) {
      return res.status(400).json({ error: 'Bill not found for that legislator.' });
    }

    const updatedContent = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
    const putRes = await fetch(
      `https://api.github.com/repos/${repo}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        body: JSON.stringify({
          message: `Delete bill ${billId} from ${legislator.name}`,
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

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
