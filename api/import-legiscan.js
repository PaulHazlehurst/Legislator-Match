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

  // Pick the session that actually covers 2026, not just whichever is listed
  // first — LegiScan can list a multi-year session (e.g. 2025-2026) where
  // "most recent" doesn't necessarily mean "this year's session."
  const TARGET_YEAR = 2026;
  const currentSession = sessions.find(s =>
    (s.year_start <= TARGET_YEAR && s.year_end >= TARGET_YEAR) || s.year_start === TARGET_YEAR
  ) || sessions.find(s => s.session_id) || sessions[0];

  const peopleData = await legiscanGet('getSessionPeople', { id: currentSession.session_id }, legiscanKey);
  const people = (peopleData.sessionpeople && peopleData.sessionpeople.people) || [];

  const cleanedQuery = name.toLowerCase().replace(/[.,]/g, '').trim();
  const matches = people.filter(p => {
    const fullName = `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase();
    const lastNameOnly = (p.last_name || '').toLowerCase();
    const nameMatch = fullName.includes(cleanedQuery) || cleanedQuery.includes(lastNameOnly) || (p.name || '').toLowerCase().includes(cleanedQuery);
    if (!nameMatch) return false;
    // Filter out clearly inactive members: no district usually means
    // they've left the chamber mid-session or are former members carried
    // over in LegiScan's roster from a prior year.
    if (!p.district && !p.role) return false;
    return true;
  });

  return res.status(200).json({
    sessionId: currentSession.session_id,
    sessionName: currentSession.session_name || currentSession.name,
    matches: matches.map(p => ({
      peopleId: p.people_id,
      name: p.name || `${p.first_name} ${p.last_name}`,
      party: normalizeParty(p.party),
      chamber: normalizeChamber(p.role),
      district: p.district,
      // Keep raw values for display purposes in the match list
      partyRaw: p.party,
      roleRaw: p.role
    }))
  });
}

function normalizeParty(raw) {
  if (!raw) return '';
  const r = raw.toLowerCase();
  if (r.startsWith('d') || r === 'dem') return 'D';
  if (r.startsWith('r') || r === 'rep' || r === 'gop') return 'R';
  return ''; // Independent or unknown — leave blank for manual fill
}

function normalizeChamber(role) {
  if (!role) return '';
  const r = role.toLowerCase();
  if (r.includes('sen')) return 'senate';
  if (r.includes('del') || r.includes('rep') || r.includes('asm') || r.includes('house')) return 'house';
  return '';
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

  // Use the bill's own introduced/status date for its year, not the
  // session's year_start — a 2025-2026 biennial session always reports
  // year_start as 2025 even for bills introduced in 2026, which is what
  // was causing 2025 bills to show up when only 2026 was wanted.
  const TARGET_YEAR = 2026;
  function billYear(bill) {
    const dateStr = bill.status_date || bill.introduced_date || (bill.history && bill.history[0] && bill.history[0].date);
    if (dateStr) {
      const y = parseInt(String(dateStr).slice(0, 4), 10);
      if (!isNaN(y)) return y;
    }
    return bill.session && bill.session.year_end ? bill.session.year_end : null;
  }

  const inTargetYear = primaryOnly.filter(bill => billYear(bill) === TARGET_YEAR);

  if (inTargetYear.length === 0) {
    return res.status(200).json({ bills: [], note: `No primary-sponsored bills found specifically in ${TARGET_YEAR} (some may exist in prior years of this session).` });
  }

  let classified = inTargetYear.map(bill => {
    // Item 4: Map LegiScan status codes to granular outcome stages
    // 1=Introduced, 2=Engrossed, 3=Enrolled, 4=Passed, 5=Vetoed,
    // 6=Failed, 7=Override, 8=Chaptered, 9=Refer, 10=Report Pass,
    // 11=Report DNP (Did Not Pass committee), 12=Draft
    const statusCode = bill.status;
    let statusStage = 'introduced'; // default
    if (statusCode === 4 || statusCode === 8) statusStage = 'passed';
    else if (statusCode === 5) statusStage = 'vetoed';
    else if (statusCode === 6 || statusCode === 11) statusStage = 'failed';
    else if (statusCode === 10) statusStage = 'committee_passed'; // passed committee but not yet floor
    else if (statusCode === 11) statusStage = 'committee_failed'; // died in committee
    else if (statusCode === 2 || statusCode === 3) statusStage = 'advancing'; // engrossed/enrolled = moving forward

    // Item 1: Extract committee name from getBill — extremely informative
    // for classification. A bill in "House Health and Government Operations
    // Committee" is almost certainly healthcare regardless of title ambiguity.
    const committeeObj = bill.committee || {};
    const committeeName = committeeObj.name || null;

    return {
      title: bill.title || bill.bill_number || 'Untitled bill',
      billNumber: bill.bill_number,
      year: billYear(bill) || TARGET_YEAR,
      legiscanUrl: bill.url || bill.state_link,
      statusCode,
      statusStage,
      description: bill.description || null,
      committeeName,
      legiscanSubjects: Array.isArray(bill.subjects)
        ? bill.subjects.map(s => s.subject_name).filter(Boolean)
        : [],
      topicMatch: null,
      subtopicMatch: null,
      suggestedTopicLabel: null,
      suggestedSubtopicLabel: null
    };
  });

  if (anthropicKey && classified.length > 0) {
    classified = await classifyBillsWithClaude(classified, knownTopics, anthropicKey);
  }

  return res.status(200).json({ bills: classified });
}

async function classifyBillsWithClaude(bills, knownTopics, apiKey) {
  // Build topic guidance dynamically from whatever is stored in data.json
  // under each topic's `guidance` field — this means guidance stays accurate
  // as the user's taxonomy grows and evolves, no code changes needed.
  const topicList = Object.entries(knownTopics || {}).map(([code, t]) => {
    const subs = Object.entries(t.subtopics || {}).map(([sc, sl]) => `  • ${sc}: ${sl}`).join('\n');
    const g = t.guidance || {};
    return [
      `TOPIC: ${code} — "${t.label}"`,
      g.includes ? `  Includes: ${g.includes}` : '',
      g.excludes ? `  Does NOT include: ${g.excludes}` : '',
      subs ? `  Subtopics:\n${subs}` : ''
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const systemPrompt = `You are classifying Maryland state legislative bills for a professional lobbying firm. Your classifications directly affect which legislators get recommended to clients, so accuracy is critical.

You will receive bills with FOUR pieces of information:
1. The official bill TITLE (can be misleading — formal/legal language often obscures the real subject)
2. The DESCRIPTION — a plain-language summary of what the bill actually does (more reliable than the title)
3. LEGISCAN SUBJECT TAGS — LegiScan's own classification (strong prior signal — trust this heavily)
4. COMMITTEE NAME — which legislative committee reviewed this bill (extremely informative: "Health and Government Operations Committee" = healthcare bill, "Economic Matters Committee" = business/workforce, "Environment and Transportation Committee" = environment)

Use ALL FOUR signals. Prioritize: committee name > LegiScan subjects > description > title.
When committee name clearly maps to a topic, that's almost always correct.
When description and LegiScan subjects agree, that's high confidence.
When they conflict with the title alone, trust the other signals over the title.

CRITICAL RULES:
1. Only match a topic if the bill CLEARLY belongs there based on its actual policy content.
2. A bill affecting a particular population (veterans, seniors, teachers) does NOT automatically belong in any topic — what matters is what the bill DOES, not who it affects.
3. If a bill clearly belongs in a topic we don't have defined yet, suggest a new topic label.
4. If a bill doesn't fit any topic at all (procedural bills, administrative changes, naming bills), return null — do NOT force a fit.
5. Return confidence: "high" = clearly fits (especially when committee name matches), "low" = loosely fits or uncertain, null = no match.
6. A null is far better than a wrong classification — the user will classify unmatched bills manually.

${topicList ? `THE AVAILABLE TOPICS:\n\n${topicList}` : 'No topics defined yet — return null for all.'}

Respond with ONLY a JSON array (same length and order as the input), no markdown fences, no explanation:
[{
  "topicMatch": "existing topic code or null",
  "subtopicMatch": "existing subtopic code or null",
  "confidence": "high" | "low" | null,
  "suggestedTopicLabel": "short label for a new topic if needed, otherwise null",
  "suggestedSubtopicLabel": "short label for a new subtopic if needed, otherwise null",
  "reasoning": "one sentence explaining your classification or why you returned null"
}]`;

  // Send all four signals per bill
  const userPayload = bills.map(b => ({
    title: b.title,
    description: b.description || null,
    legiscanSubjects: b.legiscanSubjects && b.legiscanSubjects.length > 0 ? b.legiscanSubjects : null,
    committeeName: b.committeeName || null
  }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000, // more output needed now that each response includes reasoning
      system: systemPrompt,
      messages: [{ role: 'user', content: JSON.stringify(userPayload) }]
    })
  });

  if (!response.ok) return bills;

  const data = await response.json();
  const rawText = data.content.find(b => b.type === 'text')?.text || '[]';
  const cleaned = rawText.replace(/```json|```/g, '').trim();

  try {
    const classifications = JSON.parse(cleaned);
    return bills.map((b, i) => {
      const c = classifications[i] || {};
      return {
        ...b,
        topicMatch: c.topicMatch || null,
        subtopicMatch: c.subtopicMatch || null,
        confidence: c.confidence || null,
        reasoning: c.reasoning || null, // surface this in the UI so users can see why
        suggestedTopicLabel: c.suggestedTopicLabel || null,
        suggestedSubtopicLabel: c.suggestedSubtopicLabel || null,
        needsReview: !c.topicMatch || c.confidence === 'low'
      };
    });
  } catch {
    return bills.map(b => ({ ...b, needsReview: true }));
  }
}
