// /api/save-bill.js
// Adds a bill to an existing legislator, or creates a new legislator with
// this bill, then commits the updated data.json back to GitHub.
//
// Wrapped in a retry loop: if two people save at nearly the same time,
// GitHub will reject the second commit because the file changed underneath
// it (a 409/sha-mismatch). When that happens we refetch the latest file and
// reapply this same change on top of it, up to a few times, instead of
// just failing and losing the user's work.

const MAX_RETRIES = 3;

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

  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await attemptSave({ stateCode, legislator, bill, token, repo, branch, filePath });
      return res.status(200).json(result);
    } catch (err) {
      lastError = err;
      if (err.isConflict && attempt < MAX_RETRIES - 1) {
        continue; // someone else saved in between — refetch and try again
      }
      break;
    }
  }

  return res.status(500).json({ error: lastError.message });
}

async function attemptSave({ stateCode, legislator, bill, token, repo, branch, filePath }) {
  // 1. Fetch current data.json + its sha (required to update a file via GitHub API)
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
  const newBillId = 'B' + String(content.meta.nextBillId).padStart(4, '0');
  const billRecord = { id: newBillId, ...bill };

  // If the topic and/or subtopic on this bill don't exist yet, create them —
  // but first check for a near-duplicate (case/whitespace-insensitive match)
  // so "Insurance" and "insurance" don't become two separate topics.
  let topicWasNew = false, subtopicWasNew = false;

  if (billRecord.topic) {
    const existingTopicMatch = findCloseMatch(billRecord.topic, Object.keys(content.topics));
    if (existingTopicMatch) {
      billRecord.topic = existingTopicMatch; // reuse the existing one instead of creating a near-duplicate
    } else if (!content.topics[billRecord.topic]) {
      content.topics[billRecord.topic] = {
        label: billRecord.topicLabel || billRecord.topic,
        subtopics: {}
      };
      topicWasNew = true;
    }

    if (billRecord.subtopic) {
      const subtopicCodes = Object.keys(content.topics[billRecord.topic].subtopics);
      const existingSubtopicMatch = findCloseMatch(billRecord.subtopic, subtopicCodes);
      if (existingSubtopicMatch) {
        billRecord.subtopic = existingSubtopicMatch;
      } else if (!content.topics[billRecord.topic].subtopics[billRecord.subtopic]) {
        content.topics[billRecord.topic].subtopics[billRecord.subtopic] =
          billRecord.subtopicLabel || billRecord.subtopic;
        subtopicWasNew = true;
      }
    }
  }

  // Don't store the helper label fields on the bill record itself
  delete billRecord.topicLabel;
  delete billRecord.subtopicLabel;

  let targetLegislator;
  if (legislator.mode === 'existing') {
    targetLegislator = content.states[stateCode].legislators.find(l => l.id === legislator.legislatorId);
    if (!targetLegislator) throw new Error('Legislator not found.');
  } else {
    // Avoid creating a duplicate legislator if one with a very similar name
    // already exists (e.g. saved twice from two different browser tabs).
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
        party: legislator.party,
        chamber: legislator.chamber,
        district: legislator.district || '',
        bills: []
      };
      content.states[stateCode].legislators.push(targetLegislator);
      content.meta.nextLegislatorId += 1;
    }
  }

  targetLegislator.bills.push(billRecord);
  content.meta.nextBillId += 1;

  // 2. Commit updated file back to GitHub
  const updatedContent = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
  const commitNote = topicWasNew
    ? ` (new topic: ${billRecord.topic})`
    : subtopicWasNew
      ? ` (new subtopic: ${billRecord.subtopic})`
      : '';
  const putRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/${filePath}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      body: JSON.stringify({
        message: `Add bill: ${bill.title}${commitNote}`,
        content: updatedContent,
        sha: fileMeta.sha,
        branch
      })
    }
  );

  if (!putRes.ok) {
    const errText = await putRes.text();
    const err = new Error(`GitHub commit failed: ${errText}`);
    // 409 = sha mismatch, meaning someone else committed in between our
    // read and write. 422 can also indicate a stale sha in some cases.
    err.isConflict = putRes.status === 409 || putRes.status === 422;
    throw err;
  }

  return {
    success: true,
    billId: newBillId,
    legislatorId: targetLegislator.id,
    topicWasNew,
    subtopicWasNew
  };
}

// Returns the existing code if `candidate` is a near-duplicate of one
// already in `existingCodes` (case/whitespace/hyphen-insensitive), else null.
function findCloseMatch(candidate, existingCodes) {
  const norm = s => s.toLowerCase().replace(/[\s-]+/g, '');
  const candidateNorm = norm(candidate);
  return existingCodes.find(code => norm(code) === candidateNorm) || null;
}

function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/^(sen\.|del\.|rep\.|senator|delegate|representative)\s*/i, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
