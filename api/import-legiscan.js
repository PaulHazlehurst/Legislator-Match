// /api/import-legiscan.js
// Two modes, both POST:
//
// 1. { action: "findPerson", stateCode, name }
//    Searches LegiScan for a person matching `name` in the given state
//    and returns candidate matches (people_id, name, party, role, district).
//
// 2. { action: "fetchBills", peopleId, stateAbbrev, knownTopics }
//    Fetches that person's current-session bills from LegiScan, keeps
//    only ones where they're the primary sponsor, then asks Claude to
//    assign each one a topic/subtopic from knownTopics (or suggest a
//    new one), returning a reviewable list — nothing is saved yet.

const LEGISCAN_BASE = 'https://api.legiscan.com/';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const legiscanKey = process.env.LEGISCAN_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!legiscanKey) {
    return res.status(500).json({ error: 'Server is missing LEGISCAN_API_KEY. Set it in Vercel project settings.' });
  }

  try {
    const { action } = req.body;
    if (action === 'findPerson') return await findPerson(req, res, legiscanKey);
    if (action === 'fetchBills') return await fetchBills(req, res, legiscanKey, anthropicKey);
    return res.status(400).json({ error: 'Unknown action. Use "findPerson" or "fetchBills".' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function legiscanGet(operation, params, key) {
  const query = new URLSearchParams({ key, op: operation, ...params }).toString();
  const resp = await fetch(`${LEGISCAN_BASE}?${query}`);
  if (!resp.ok) throw new Error(`LegiScan request failed (${resp.status})`);
  const data = await resp.json();
  if (data.status === 'ERROR') throw new Error(data.alert?.message || 'LegiScan returned an error');
  return data;
}

// ---------------------------------------------------------------------------
// Step 1: find the person's LegiScan people_id by searching the current
// session's roster for that state and matching on name.
// ---------------------------------------------------------------------------
async function findPerson(req, res, legiscanKey) {
  const { stateCode, name } = req.body;
  if (!stateCode || !name) return res.status(400).json({ error: 'stateCode and name are required.' });

  const sessionData = await legiscanGet('getSessionList', { state: stateCode }, legiscanKey);
  const sessions = sessionData.sessions || [];
  if (sessions.length === 0) return res.status(404).json({ error: `No sessions found for state ${stateCode}.` });

  // Most recent session is first in the list returned by LegiScan
  const currentSession = sessions.find(s => s.session_id) || sessions[0];

  const peopleData = await legiscanGet('getSessionPeople', { id: currentSession.session_id }, legiscanKey);
  const people = (peopleData.sessionpeople && peopleData.sessionpeople.people) || [];

  const cleanedQuery = name.toLowerCase().replace(/[.,]/g, '').trim();
  const matches = people.filter(p => {
    const fullName = `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase();
    const lastNameOnly = (p.last_name || '').toLowerCase();
    return fullName.includes(cleanedQuery) || cleanedQuery.includes(lastNameOnly) || (p.name || '').toLowerCase().includes(cleanedQuery);
  });

  return res.status(200).json({
    sessionId: currentSession.session_id,
    sessionName: currentSession.session_name || currentSession.name,
    matches: matches.map(p => ({
      peopleId: p.people_id,
      name: p.name || `${p.first_name} ${p.last_name}`,
      party: p.party,
      role: p.role,
      district: p.district
    }))
  });
}

// ---------------------------------------------------------------------------
// Step 2: pull that person's sponsored bill IDs, then fetch each bill's full
// detail (titles and accurate sponsor roles only exist on getBill, not on
// the lightweight getSponsoredList response), keep primary-sponsor-only,
// then classify each one with Claude against the existing topic list.
// ---------------------------------------------------------------------------
async function fetchBills(req, res, legiscanKey, anthropicKey) {
  const { peopleId, knownTopics } = req.body;
  if (!peopleId) return res.status(400).json({ error: 'peopleId is required.' });

  const sponsoredData = await legiscanGet('getSponsoredList', { id: peopleId }, legiscanKey);
  const sponsoredBills = (sponsoredData.sponsoredbills && sponsoredData.sponsoredbills.bills) || [];

  if (sponsoredBills.length === 0) {
    return res.status(200).json({ bills: [] });
  }

  // getSponsoredList only gives bill_id + number, no title or sponsor role —
  // both require a getBill call per bill. Cap how many we fetch in one
  // import to keep this within a reasonable request budget and runtime.
  const MAX_BILLS = 60;
  const toFetch = sponsoredBills.slice(0, MAX_BILLS);

  const detailed = [];
  for (const b of toFetch) {
    try {
      const billData = await legiscanGet('getBill', { id: b.bill_id }, legiscanKey);
      detailed.push(billData.bill);
    } catch {
      // Skip bills that fail to fetch rather than aborting the whole import
    }
  }

  // Primary sponsor = sponsor_type_id 1, specifically for *this* person_id.
  // (sponsor_order also tends to be 1 for the primary, but sponsor_type_id
  // is the documented, authoritative field for this.)
  const primaryOnly = detailed.filter(bill =>
    Array.isArray(bill.sponsors) &&
    bill.sponsors.some(s => String(s.people_id) === String(peopleId) && Number(s.sponsor_type_id) === 1)
  );

  if (primaryOnly.length === 0) {
    return res.status(200).json({ bills: [] });
  }

  let classified = primaryOnly.map(bill => ({
    title: bill.title || bill.bill_number || 'Untitled bill',
    billNumber: bill.bill_number,
    year: bill.session && bill.session.year_start ? bill.session.year_start : null,
    legiscanUrl: bill.url || bill.state_link,
    statusCode: bill.status, // 4 = Passed, 5 = Vetoed, 6 = Failed, else pending/in-progress
    topicMatch: null,
    subtopicMatch: null,
    suggestedTopicLabel: null,
    suggestedSubtopicLabel: null
  }));

  if (anthropicKey && classified.length > 0) {
    classified = await classifyBillsWithClaude(classified, knownTopics, anthropicKey);
  }

  return res.status(200).json({ bills: classified });
}

async function classifyBillsWithClaude(bills, knownTopics, apiKey) {
  const topicList = Object.entries(knownTopics || {}).map(([code, t]) => {
    const subs = Object.entries(t.subtopics || {}).map(([sc, sl]) => `${sc} (${sl})`).join(', ');
    return `- ${code} (${t.label}): subtopics = ${subs}`;
  }).join('\n');

  const systemPrompt = `You classify a batch of state legislative bill titles into topics/subtopics.

The existing topics and subtopics in this system are:
${topicList || '(none yet)'}

You will receive a JSON array of bills, each with a "title". Respond with ONLY a JSON array, same length and order, no other text, no markdown fences. Each element:
{
  "topicMatch": "an existing topic code if one fits well, otherwise null",
  "subtopicMatch": "an existing subtopic code under that topic if one fits well, otherwise null",
  "suggestedTopicLabel": "if no existing topic fits, a short new topic label, otherwise null",
  "suggestedSubtopicLabel": "if no existing subtopic fits, a short new subtopic label, otherwise null"
}

Prefer matching an existing topic/subtopic over suggesting a new one whenever the fit is reasonable.`;

  const userPayload = bills.map(b => ({ title: b.title }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: JSON.stringify(userPayload) }]
    })
  });

  if (!response.ok) {
    // Classification failing shouldn't block the import — just return
    // bills unclassified so the user can pick topics manually.
    return bills;
  }

  const data = await response.json();
  const rawText = data.content.find(b => b.type === 'text')?.text || '[]';
  const cleaned = rawText.replace(/```json|```/g, '').trim();

  try {
    const classifications = JSON.parse(cleaned);
    return bills.map((b, i) => ({ ...b, ...(classifications[i] || {}) }));
  } catch {
    return bills;
  }
}
