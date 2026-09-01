import { TOPICS, SUBJECT_TO_TOPIC } from '../taxonomy.js';

// ── significance: keep commemorative/local/procedural noise out of passage rate ──
export function significanceOf(bill) {
  const title = (bill.title || '').toLowerCase();
  const type = String(bill.bill_type || '').toLowerCase();

  if (/commemorat|awareness (month|week|day)|\bmonth\b|\bweek\b|recogniz|honoring|designat/.test(title)
      && /res/.test(type)) return 'ceremonial';
  if (/\b(county|city of|town of|municipal)\b/.test(title)) return 'local';
  if (/task force|- study\b|study on|sunset|- membership\b|- reporting\b|technical correction/.test(title))
    return 'procedural';
  return 'substantive';
}

// ── PASS 1 (used during ingest): official subject tags only. No AI, no cost. ──
// Returns a topic when LegiScan's subjects resolve, otherwise leaves it null
// for the AI pass to pick up later.
export function classifyBySubject(bill) {
  const significance = significanceOf(bill);
  const subjects = bill.subjects || [];
  for (const s of subjects) {
    const name = s.subject_name || s.subject || '';
    if (SUBJECT_TO_TOPIC[name]) {
      return { topicCode: SUBJECT_TO_TOPIC[name], subtopicCode: null,
               significance, classifiedBy: 'legiscan_subject', confidence: 'high' };
    }
  }
  return { topicCode: null, subtopicCode: null, significance,
           classifiedBy: 'unclassified', confidence: null };
}

// ── PASS 2 (used by reclassify.js): constrained Gemini, only on leftovers. ────
const TOPIC_CODES = new Set(TOPICS.map(t => t.code));
const SUBTOPICS_BY_TOPIC = Object.fromEntries(
  TOPICS.map(t => [t.code, new Set(t.subtopics.map(s => s[0]))])
);

function buildPrompt() {
  const list = TOPICS.map(t => {
    const subs = t.subtopics.map(([c, l, g]) => `      - ${c}: ${l}${g ? ` (${g})` : ''}`).join('\n');
    return [
      `TOPIC ${t.code} — ${t.label}`,
      `  Includes: ${t.includes}`,
      `  Does NOT include: ${t.excludes}`,
      subs ? `  Subtopics (choose ONE of these or null):\n${subs}` : '  Subtopics: none',
    ].join('\n');
  }).join('\n\n');
  return `You classify a US state legislative bill for a lobbying firm. Accuracy matters more than coverage: a wrong topic is worse than null.

RULES:
1. Choose topicCode ONLY from the list below, or null if none clearly fit.
2. Choose subtopicCode ONLY from the chosen topic's subtopics, or null.
3. A bill about a POPULATION (veterans, seniors, teachers) is classified by what it DOES, not who it mentions.
4. If not confident, return null topic with confidence "low". Do not force a fit.

${list}

Respond with ONLY a JSON object, no markdown:
{"topicCode": string|null, "subtopicCode": string|null, "confidence": "high"|"low", "reasoning": "one sentence"}`;
}
const PROMPT = buildPrompt();

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Returns { topicCode, subtopicCode, confidence, reasoning } or throws on 429
// so the caller can back off. Validates output against the taxonomy.
export async function classifyWithGemini(bill) {
  const content = `Title: ${bill.title}\n${bill.description ? `Description: ${bill.description}\n` : ''}${
    (bill.subjects || []).length ? `LegiScan subjects: ${(bill.subjects).map(s => s.subject_name || s.subject).join(', ')}` : ''
  }`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: content }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  });

  if (res.status === 429) { const e = new Error('rate_limited'); e.code = 429; throw e; }
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);

  const json = await res.json();
  let raw = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  raw = raw.replace(/^```json\s*|\s*```$/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { topicCode: null, subtopicCode: null, confidence: 'low', reasoning: 'parse failure' }; }

  let { topicCode, subtopicCode, confidence, reasoning } = parsed;
  if (!TOPIC_CODES.has(topicCode)) { topicCode = null; subtopicCode = null; }
  if (topicCode && subtopicCode && !SUBTOPICS_BY_TOPIC[topicCode].has(subtopicCode)) subtopicCode = null;
  return { topicCode, subtopicCode, confidence: confidence === 'high' ? 'high' : 'low', reasoning };
}
