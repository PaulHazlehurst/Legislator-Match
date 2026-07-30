// /api/bulk-audit.js
// Reclassifies every bill in the database using the current Claude + Gemini
// dual-classifier and the latest topic guidance, then saves all corrections
// in a single GitHub commit.
//
// POST { stateCode, knownTopics, dryRun? }
// Returns { updated, unchanged, failed, changes: [{legName, billTitle, oldTopic, newTopic}] }

const LEGISCAN_BASE = 'https://api.legiscan.com/';
const MAX_BATCH = 40; // bills per AI call
const MAX_RETRIES = 4;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || null;
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  const filePath = process.env.DATA_FILE_PATH || 'data.json';

  if (!anthropicKey) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });
  if (!token || !repo) return res.status(500).json({ error: 'Missing GitHub env vars' });

  const { stateCode, knownTopics, dryRun = false } = req.body;
  if (!stateCode || !knownTopics) {
    return res.status(400).json({ error: 'stateCode and knownTopics are required' });
  }

  // Read current data
  const getRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
  );
  if (!getRes.ok) return res.status(500).json({ error: `GitHub fetch failed (${getRes.status})` });
  const fileMeta = await getRes.json();
  const content = JSON.parse(Buffer.from(fileMeta.content, 'base64').toString('utf-8'));

  const stateData = content.states[stateCode];
  if (!stateData) return res.status(400).json({ error: `State ${stateCode} not found` });

  // Collect all bills that need review — those without a topic or with only 1 signal
  const allBillsFlat = [];
  stateData.legislators.forEach(l => {
    l.bills.forEach(b => {
      allBillsFlat.push({ leg: l, bill: b });
    });
  });

  if (allBillsFlat.length === 0) {
    return res.status(200).json({ updated: 0, unchanged: 0, failed: 0, changes: [] });
  }

  // Build topic guidance prompt
  const topicList = Object.entries(knownTopics)
    .sort((a, b) => a[1].label.localeCompare(b[1].label))
    .map(([code, t]) => {
      const subs = Object.entries(t.subtopics || {}).map(([sc, sl]) => `  • ${sc}: ${sl}`).join('\n');
      const g = t.guidance || {};
      return [
        `TOPIC: ${code} — "${t.label}"`,
        g.includes ? `  Includes: ${g.includes}` : '',
        g.excludes ? `  Does NOT include: ${g.excludes}` : '',
        subs ? `  Subtopics:\n${subs}` : ''
      ].filter(Boolean).join('\n');
    }).join('\n\n');

  const systemPrompt = `You are reclassifying existing bills in a lobbying firm's database to fix misclassifications.

For each bill you receive: title, current topic (may be wrong), and any available description or committee.
Determine the CORRECT topic based on what the bill actually does.

CRITICAL: A null is correct when the bill doesn't fit any topic (procedural, ceremonial, administrative).
Never force a classification. A bill touching veterans as a population isn't automatically "veterans" — it depends on what it DOES.

${topicList}

Respond ONLY with a JSON array, same length and order:
[{
  "topicMatch": "topic code or null",
  "subtopicMatch": "subtopic code or null",
  "confidence": "high" | "low" | null,
  "reasoning": "one sentence"
}]`;

  // Process in batches
  const changes = [];
  let updated = 0, unchanged = 0, failed = 0;

  for (let i = 0; i < allBillsFlat.length; i += MAX_BATCH) {
    const batch = allBillsFlat.slice(i, i + MAX_BATCH);
    const payload = batch.map(({ bill }) => ({
      title: bill.title,
      currentTopic: bill.topic || 'unclassified',
      description: bill.description || null,
      committeeName: bill.committeeName || null
    }));

    const [claudeResults, geminiResults] = await Promise.all([
      callClaude(payload, systemPrompt, anthropicKey),
      geminiKey ? callGemini(payload, systemPrompt, geminiKey) : Promise.resolve(null)
    ]);

    batch.forEach(({ leg, bill }, j) => {
      const c = claudeResults[j] || {};
      const g = geminiResults ? (geminiResults[j] || {}) : null;

      let newTopic = c.topicMatch || null;
      let newSubtopic = c.subtopicMatch || null;
      let confidence = c.confidence || null;

      // Consensus logic — same as import classifier
      if (g) {
        const cTopic = c.topicMatch || null;
        const gTopic = g.topicMatch || null;
        if (cTopic && gTopic && cTopic === gTopic) {
          newTopic = cTopic;
          newSubtopic = c.subtopicMatch || g.subtopicMatch || null;
          confidence = 'high';
        } else if (cTopic && !gTopic) {
          confidence = 'low';
        } else if (!cTopic && gTopic) {
          newTopic = gTopic;
          newSubtopic = g.subtopicMatch || null;
          confidence = 'low';
        } else if (cTopic && gTopic && cTopic !== gTopic) {
          // Disagreement — keep current topic rather than introducing a new wrong one
          newTopic = bill.topic || null;
          newSubtopic = bill.subtopic || null;
          confidence = null;
        }
      }

      const topicChanged = newTopic !== bill.topic;
      const subtopicChanged = newSubtopic !== bill.subtopic;

      if ((topicChanged || subtopicChanged) && confidence !== null) {
        if (!dryRun) {
          bill.topic = newTopic;
          bill.subtopic = newSubtopic;
        }
        changes.push({
          legName: leg.name,
          billTitle: bill.title,
          oldTopic: bill.topic !== newTopic ? (DATA_topics_lookup(knownTopics, bill.topic) || bill.topic || 'unclassified') : null,
          newTopic: DATA_topics_lookup(knownTopics, newTopic) || newTopic || 'unclassified',
          confidence,
          reasoning: c.reasoning || g?.reasoning || null
        });
        updated++;
      } else {
        unchanged++;
      }
    });
  }

  // Save if not a dry run and there were changes
  if (!dryRun && updated > 0) {
    let lastError;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const updatedContent = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
        const putRes = await fetch(
          `https://api.github.com/repos/${repo}/contents/${filePath}`,
          {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
            body: JSON.stringify({
              message: `Bulk re-audit: reclassified ${updated} bills in ${stateCode}`,
              content: updatedContent,
              sha: fileMeta.sha,
              branch
            })
          }
        );
        if (putRes.ok) break;
        const err = new Error(`GitHub commit failed (${putRes.status})`);
        err.isConflict = putRes.status === 409 || putRes.status === 422;
        lastError = err;
        if (!err.isConflict) break;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError) return res.status(500).json({ error: lastError.message });
  }

  return res.status(200).json({ updated, unchanged, failed, changes, dryRun });
}

function DATA_topics_lookup(topics, code) {
  return topics[code]?.label || null;
}

async function callClaude(payload, systemPrompt, apiKey) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: JSON.stringify(payload) }]
      })
    });
    if (!res.ok) return payload.map(() => ({}));
    const data = await res.json();
    const text = data.content.find(b => b.type === 'text')?.text || '[]';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch { return payload.map(() => ({})); }
}

async function callGemini(payload, systemPrompt, geminiKey) {
  try {
    const prompt = `${systemPrompt}\n\nReclassify these bills:\n${JSON.stringify(payload)}`;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4000 }
        })
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch { return null; }
}
