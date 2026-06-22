// /api/save-bills-batch.js
// Saves an entire batch of bills for one legislator in a SINGLE GitHub commit,
// eliminating the race condition that caused "N saved, 1 failed" errors when
// sequential individual saves collided on the same sha.
//
// Accepts:
// {
//   stateCode: "MD",
//   legislator: { mode: "existing", legislatorId: "L001" }
//              | { mode: "new", name, party, chamber, district }
//   bills: [{ title, topic, topicLabel, subtopic, subtopicLabel, year, role, outcome }, ...]
// }
//
// Returns:
// { success: true, billIds: [...], legislatorId, newTopics: [...], newSubtopics: [...] }

const MAX_RETRIES = 4;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { stateCode, legislator, bills } = req.body;
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const filePath = process.env.DATA_FILE_PATH || 'data.json';

  if (!token || !repo) {
    return res.status(500).json({ error: 'Missing GITHUB_TOKEN or GITHUB_REPO env vars.' });
  }
  if (!stateCode || !legislator || !Array.isArray(bills) || bills.length === 0) {
    return res.status(400).json({ error: 'Missing stateCode, legislator, or bills array.' });
  }

  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await attemptBatchSave({ stateCode, legislator, bills, token, repo, branch, filePath });
      return res.status(200).json(result);
    } catch (err) {
      lastError = err;
      if (err.isConflict && attempt < MAX_RETRIES - 1) {
        // Exponential backoff on conflicts so concurrent saves from different
        // team members don't keep colliding on retries either
        await sleep(200 * Math.pow(2, attempt));
        continue;
      }
      break;
    }
  }

  return res.status(500).json({ error: lastError?.message || 'Unknown error' });
}

async function attemptBatchSave({ stateCode, legislator, bills, token, repo, branch, filePath }) {
  // Single read
  const getRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
  );
  if (!getRes.ok) throw new Error(`Could not fetch data.json from GitHub (${getRes.status})`);
  const fileMeta = await getRes.json();
  const content = JSON.parse(Buffer.from(fileMeta.content, 'base64').toString('utf-8'));

  if (!content.states[stateCode]) {
    throw new Error(`State ${stateCode} does not exist in data.json.`);
  }
  content.meta = content.meta || { nextLegislatorId: 1, nextBillId: 1 };

  // Resolve or create the legislator
  let targetLegislator;
  if (legislator.mode === 'existing') {
    targetLegislator = content.states[stateCode].legislators.find(l => l.id === legislator.legislatorId);
    if (!targetLegislator) throw new Error(`Legislator ${legislator.legislatorId} not found.`);
  } else {
    const existingLeg = content.states[stateCode].legislators.find(l =>
      normalizeName(l.name) === normalizeName(legislator.name)
    );
    if (existingLeg) {
      targetLegislator = existingLeg;
    } else {
      const newId = 'L' + String(content.meta.nextLegislatorId).padStart(3, '0');
      targetLegislator = {
        id: newId,
        name: legislator.name,
        party: legislator.party || '',
        chamber: legislator.chamber || '',
        district: legislator.district || '',
        bills: []
      };
      content.states[stateCode].legislators.push(targetLegislator);
      content.meta.nextLegislatorId += 1;
    }
  }

  // Apply all bill additions in memory — no more per-bill network round trips
  const billIds = [];
  const newTopics = [];
  const newSubtopics = [];

  for (const bill of bills) {
    const newBillId = 'B' + String(content.meta.nextBillId).padStart(4, '0');
    content.meta.nextBillId += 1;

    const billRecord = { id: newBillId, ...bill };

    // Resolve topic — check for near-duplicate before creating
    if (billRecord.topic) {
      const existingTopicKey = findCloseMatch(billRecord.topic, Object.keys(content.topics));
      if (existingTopicKey) {
        billRecord.topic = existingTopicKey;
      } else if (!content.topics[billRecord.topic]) {
        content.topics[billRecord.topic] = {
          label: billRecord.topicLabel || billRecord.topic,
          subtopics: {}
        };
        newTopics.push(billRecord.topicLabel || billRecord.topic);
      }

      // Resolve subtopic
      if (billRecord.subtopic && content.topics[billRecord.topic]) {
        const existingSubKey = findCloseMatch(
          billRecord.subtopic,
          Object.keys(content.topics[billRecord.topic].subtopics)
        );
        if (existingSubKey) {
          billRecord.subtopic = existingSubKey;
        } else if (!content.topics[billRecord.topic].subtopics[billRecord.subtopic]) {
          content.topics[billRecord.topic].subtopics[billRecord.subtopic] =
            billRecord.subtopicLabel || billRecord.subtopic;
          newSubtopics.push(billRecord.subtopicLabel || billRecord.subtopic);
        }
      }
    }

    // Clean up helper fields before storing
    delete billRecord.topicLabel;
    delete billRecord.subtopicLabel;

    targetLegislator.bills.push(billRecord);
    billIds.push(newBillId);
  }

  // Single write — the whole batch in one commit
  const updatedContent = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
  const commitParts = [`Add ${bills.length} bill(s) for ${targetLegislator.name}`];
  if (newTopics.length > 0) commitParts.push(`new topics: ${newTopics.join(', ')}`);
  if (newSubtopics.length > 0) commitParts.push(`new subtopics: ${newSubtopics.join(', ')}`);

  const putRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/${filePath}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      body: JSON.stringify({
        message: commitParts.join(' — '),
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

  return {
    success: true,
    billIds,
    legislatorId: targetLegislator.id,
    newTopics,
    newSubtopics
  };
}

function findCloseMatch(candidate, existingCodes) {
  const norm = s => s.toLowerCase().replace(/[\s\-_]+/g, '');
  const n = norm(candidate);
  return existingCodes.find(code => norm(code) === n) || null;
}

function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/^(sen\.|del\.|rep\.|senator|delegate|representative)\s*/i, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
