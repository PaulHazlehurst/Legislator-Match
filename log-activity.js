// /api/log-activity.js
// Appends an activity event to data.activityLog in data.json, capped at 100 entries.
// Called fire-and-forget after successful saves/edits/deletes.
// Uses the same retry-on-conflict pattern as other write functions.

const MAX_RETRIES = 3;
const MAX_LOG_ENTRIES = 100;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, detail, user } = req.body;
  // action: 'add_bill' | 'edit_bill' | 'delete_bill' | 'import' | 'add_sponsor' | 'add_note'
  // detail: short human-readable string, e.g. "Added HB 0412 for Del. Nkongolo (workforce)"
  // user: optional team member name from user prefs

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const filePath = process.env.DATA_FILE_PATH || 'data.json';

  if (!token || !repo) return res.status(500).json({ error: 'Missing env vars.' });
  if (!action || !detail) return res.status(400).json({ error: 'action and detail required.' });

  const entry = {
    id: Date.now().toString(36),
    ts: new Date().toISOString(),
    action,
    detail,
    user: user || 'Team member'
  };

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

      if (!Array.isArray(content.activityLog)) content.activityLog = [];
      content.activityLog.unshift(entry); // newest first
      if (content.activityLog.length > MAX_LOG_ENTRIES) {
        content.activityLog = content.activityLog.slice(0, MAX_LOG_ENTRIES);
      }

      const updatedContent = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
      const putRes = await fetch(
        `https://api.github.com/repos/${repo}/contents/${filePath}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
          body: JSON.stringify({
            message: `Activity log: ${action}`,
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
