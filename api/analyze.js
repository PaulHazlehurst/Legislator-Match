// /api/analyze — the Proposer's AI analyst.
//   POST { text, context? }  →  { topicCode, subtopicCode, summary, searchTerms, supporters,
//                                 opponents, framing, risks, fiscal, provider }
//
// The page already works without this (it has its own classifier and search);
// this adds judgement a rule engine can't: what the bill really does, who will
// fight it, how to frame it, and extra search terms for finding similar bills.
//
// Vercel → Settings → Environment Variables (either one is enough):
//   ANTHROPIC_API_KEY   preferred (optional ANTHROPIC_MODEL)
//   GEMINI_API_KEY      fallback  (optional GEMINI_MODEL)
import Anthropic from '@anthropic-ai/sdk';
import { TOPICS, TOPIC_CODES, SUBTOPIC_CODES } from '../shared/taxonomy.js';

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const ALL_SUBS = [...new Set(Object.values(SUBTOPIC_CODES).flat())];
const list = (max) => ({ type: 'array', items: { type: 'string' }, maxItems: max });

export const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['topicCode', 'subtopicCode', 'summary', 'searchTerms', 'supporters', 'opponents', 'framing', 'risks', 'fiscal'],
  properties: {
    topicCode: { anyOf: [{ type: 'string', enum: TOPIC_CODES }, { type: 'null' }] },
    subtopicCode: { anyOf: [{ type: 'string', enum: ALL_SUBS }, { type: 'null' }] },
    summary: { type: 'string' },
    searchTerms: list(8), supporters: list(5), opponents: list(5),
    framing: { type: 'string' }, risks: list(4), fiscal: { type: 'string' },
  },
};

export const SYSTEM = `You are a senior Maryland government-relations strategist. A colleague at a lobbying firm gives you a bill idea in their own words: it may be one vague sentence, a client's wish, or a full draft. Return a JSON analysis.

Fields
- topicCode: the single best policy area code from the list, classifying by what the bill would DO. null only if truly unclassifiable.
- subtopicCode: a subtopic code listed under that area, or null.
- summary: one or two plain sentences stating what the bill would do, written as you'd say it to a legislator.
- searchTerms: 4-8 lowercase terms the Maryland General Assembly would use in the TITLE of such a bill (statutory vocabulary, e.g. "transportation network company" not "uber"). These are used to find similar past bills.
- supporters: up to 5 kinds of organisations or constituencies likely to support it.
- opponents: up to 5 likely to oppose it. Be candid.
- framing: two or three sentences on how to pitch it in Annapolis and what kind of sponsor suits it.
- risks: up to 4 short, specific obstacles (e.g. "fiscal note over $1M", "preempts county authority").
- fiscal: one sentence on the likely fiscal note.

Be concrete and practical. Do not invent bill numbers, statistics or the names of legislators.

Policy areas
${TOPICS.map(t => `${t.code} — ${t.label}: ${t.includes}${t.subtopics.length ? `\n   subtopics: ${t.subtopics.map(s => s[0]).join(', ')}` : ''}`).join('\n')}`;

// Keep only values the page can trust.
export function clean(r) {
  const out = r && typeof r === 'object' ? r : {};
  const topicCode = TOPIC_CODES.includes(out.topicCode) ? out.topicCode : null;
  const arr = (v, n) => (Array.isArray(v) ? v : []).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 160)).slice(0, n);
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  return {
    topicCode, subtopicCode: topicCode && SUBTOPIC_CODES[topicCode].includes(out.subtopicCode) ? out.subtopicCode : null,
    summary: str(out.summary, 600), searchTerms: arr(out.searchTerms, 8).map(s => s.toLowerCase()),
    supporters: arr(out.supporters, 5), opponents: arr(out.opponents, 5),
    framing: str(out.framing, 900), risks: arr(out.risks, 4), fiscal: str(out.fiscal, 400),
  };
}

async function askClaude(text) {
  const client = new Anthropic();
  const res = await client.beta.messages.create({
    model: CLAUDE_MODEL, max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: text }],
  });
  if (res.stop_reason === 'refusal') throw new Error('The model declined to analyse this text.');
  return JSON.parse(res.content.filter(b => b.type === 'text').map(b => b.text).join(''));
}

async function askGemini(text) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM + '\n\nRespond with ONLY a JSON object with exactly these keys: ' + SCHEMA.required.join(', ') + '.' }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
    }),
  });
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
  const j = await r.json();
  return JSON.parse((j.candidates?.[0]?.content?.parts?.[0]?.text || '{}').replace(/^```json\s*|\s*```$/g, ''));
}

export default async function handler(req, res) {
  const provider = process.env.ANTHROPIC_API_KEY ? 'claude' : process.env.GEMINI_API_KEY ? 'gemini' : null;
  if (req.method === 'GET') return res.status(200).json({ ok: true, provider });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const text = String(body?.text || '').trim().slice(0, 12000);
  if (text.length < 6) return res.status(400).json({ error: 'Describe the bill idea first.' });
  if (!provider) return res.status(503).json({ error: 'No AI key is configured (ANTHROPIC_API_KEY or GEMINI_API_KEY).', code: 'not_configured' });
  try {
    const raw = provider === 'claude' ? await askClaude(text) : await askGemini(text);
    return res.status(200).json({ ...clean(raw), provider });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'The AI analyst is busy. Try again in a minute.' });
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: 'The AI key was rejected.', code: 'not_configured' });
    return res.status(502).json({ error: 'AI analysis failed: ' + (e.message || 'unknown error') });
  }
}
