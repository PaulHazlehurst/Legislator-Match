// /api/save-sponsors.js
// Replaces the `sponsors` key in data.json with the provided sponsors object,
// committing back to GitHub. Uses same retry-on-conflict pattern as save-bill.js.

const MAX_RETRIES = 3;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sponsors } = req.body;
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const filePath = process.env.DATA_FILE_PATH || 'data.json';

  if (!token || !repo) return res.status(500).json({ error: 'Missing GITHUB_TOKEN or GITHUB_REPO.' });
  if (typeof sponsors !== 'object') return res.status(400).json({ error: 'sponsors must be an object.' });

  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const getRes = await fetch(
        `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
      );
      if (!getRes.ok) throw new Error(`GitHub fetch failed (${getRes.status})`);
      const fileMeta = await getRes.json();
      const content = JSON.parse(Buffer.from(fileMeta.content, 'base64').toString('utf-8'));

      content.sponsors = sponsors;

      const updatedContent = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
      const putRes = await fetch(
        `https://api.github.com/repos/${repo}/contents/${filePath}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
          body: JSON.stringify({
            message: `Update sponsor list (${Object.keys(sponsors).length} sponsors)`,
            content: updatedContent,
            sha: fileMeta.sha,
            branch
          })
        }
      );
      if (!putRes.ok) {
        const errText = await putRes.text();
        const err = new Error(`GitHub commit failed: ${errText}`);
        err.isConflict = putRes.status === 409 || putRes.status === 422;
        throw err;
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      lastError = err;
      if (err.isConflict && attempt < MAX_RETRIES - 1) continue;
      break;
    }
  }
  return res.status(500).json({ error: lastError.message });
}
