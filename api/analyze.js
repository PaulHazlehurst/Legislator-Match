// api/analyze.js — Vercel serverless function.
// Holds GEMINI_API_KEY server-side so it never ships to the browser. The Bill
// Proposer POSTs { text }; this returns a structured analysis as JSON.
//
// Setup: in Vercel → Project → Settings → Environment Variables, add
//   GEMINI_API_KEY = your key   (optionally GEMINI_MODEL, default below)
// Then redeploy.

const TOPICS = [
  ['environment', 'Environment & Natural Resources'],
  ['taxation', 'Taxation & Revenue'],
  ['education', 'Education'],
  ['public-safety', 'Public Safety & Criminal Justice'],
  ['firearms', 'Firearms & Weapons'],
  ['labor-employment', 'Labor & Employment'],
  ['workforce', 'Workforce Development'],
  ['health', 'Health & Human Services'],
  ['business-regulation', 'Business & Professional Regulation'],
  ['consumer-protection', 'Consumer Protection'],
  ['land-use-property', 'Land Use & Property Rights'],
  ['transportation', 'Transportation & Motor Vehicles'],
  ['alcohol-licensing', 'Alcoholic Beverages & Licensing'],
  ['government-admin', 'Government Administration & Elections'],
  ['veterans-military', 'Veterans & Military Affairs'],
];

export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, hasKey: !!process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || 'gemini-3.6-flash' });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const text = (body && body.text || '').toString().trim();
  if (text.length < 6) { res.status(400).json({ error: 'Provide a bill title, summary, or idea.' }); return; }

  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) { res.status(500).json({ error: 'GEMINI_API_KEY is not set in Vercel env vars.' }); return; }
  const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

  const topicList = TOPICS.map(([c, l]) => `  ${c} — ${l}`).join('\n');
  const system = `You are a Maryland legislative strategist helping a lobbying firm. The user pastes a bill idea, title, summary, or draft. Analyze it and respond with ONLY a JSON object, no markdown:

{
  "topicCode": one of these codes or null,
  "summary": "1-2 plain sentences on what the bill does",
  "keyThemes": ["3-5 short tags, e.g. 'tax credit', 'apprenticeships'"],
  "searchTerms": ["2-4 lowercase keywords to find similar existing Maryland bills"],
  "strategy": "2-3 sentences of practical strategy: what kind of sponsor and coalition this needs, likely friction, and how to frame it"
}

Topic codes:
${topicList}

Classify by what the bill DOES, not who it mentions. If nothing fits, use null for topicCode but still fill the rest.`;

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
      }),
    });
    if (!r.ok) { res.status(502).json({ error: `Gemini ${r.status}` }); return; }
    const j = await r.json();
    let out = j.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    out = out.replace(/^```json\s*|\s*```$/g, '').trim();
    let parsed; try { parsed = JSON.parse(out); } catch { parsed = { summary: out }; }
    // validate topic code
    if (parsed.topicCode && !TOPICS.some(([c]) => c === parsed.topicCode)) parsed.topicCode = null;
    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: 'Analyzer failed: ' + (e.message || 'unknown') });
  }
}
