// AI second opinion for bills the rules were unsure about.
//
// Design: the model never sees "free choice". It gets the full taxonomy with
// include/exclude rules, plus the rule engine's top candidates for each bill,
// and must answer with a code from the taxonomy (enforced by a JSON schema).
// `decide()` then only accepts a change of topic when the model is confident
// or agrees with one of the rule candidates, so a single odd answer can't
// drag a bill somewhere implausible.
//
// Providers: Claude (ANTHROPIC_API_KEY) preferred; Gemini (GEMINI_API_KEY) as
// a fallback because the ingest workflow already has that secret.
import Anthropic from '@anthropic-ai/sdk';
import { TOPICS, TOPIC_CODES, SUBTOPIC_CODES } from '../../shared/taxonomy.js';

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const ALL_SUBTOPICS = [...new Set(Object.values(SUBTOPIC_CODES).flat())];

export const SYSTEM_PROMPT = `You classify Maryland General Assembly bills for a government-relations firm that uses the result to find legislative champions. Accuracy matters more than anything else.

Rules
- Classify each bill by what it DOES, not who it mentions. A tax credit for veterans is taxation (secondary: veterans-military).
- topic: exactly one code from the list. secondary: a second code only if the bill substantially belongs to another area too, else null. subtopic: a code listed under the chosen topic, or null.
- Local bills (one county or city) go to their policy area; use local-government only for county governance, local officials' pay, and local finance.
- Commemorative days/months go to the area they commemorate when it names one, otherwise government-admin.
- "candidates" are a keyword engine's best guesses with scores. They are often right, but override them when the bill clearly belongs elsewhere.
- confidence "high" only when the right area is unambiguous.

Taxonomy
${TOPICS.map(t => `${t.code} — ${t.label}
  includes: ${t.includes}
  excludes: ${t.excludes}${t.subtopics.length ? `\n  subtopics: ${t.subtopics.map(s => `${s[0]} (${s[2]})`).join('; ')}` : ''}`).join('\n')}`;

export const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'topic', 'subtopic', 'secondary', 'confidence'],
        properties: {
          id: { type: 'string' },
          topic: { type: 'string', enum: TOPIC_CODES },
          subtopic: { anyOf: [{ type: 'string', enum: ALL_SUBTOPICS }, { type: 'null' }] },
          secondary: { anyOf: [{ type: 'string', enum: TOPIC_CODES }, { type: 'null' }] },
          confidence: { type: 'string', enum: ['high', 'low'] },
        },
      },
    },
  },
};

// bills: [{ id, title, description, subjects: string[], rules: classifyBill() result }]
export function buildUserMessage(bills) {
  return 'Classify these bills. Return one result per id.\n\n' + JSON.stringify(bills.map(b => ({
    id: String(b.id),
    title: b.title,
    summary: (b.description || '').slice(0, 600),
    subjects: (b.subjects || []).slice(0, 6),
    candidates: Object.entries(b.rules?.scores || {}).slice(0, 3).map(([t, s]) => `${t} (${s})`),
  })), null, 1);
}

// Validate one model answer against the taxonomy; returns a clean object or null.
export function validate(r) {
  if (!r || !TOPIC_CODES.includes(r.topic)) return null;
  const subtopic = r.subtopic && SUBTOPIC_CODES[r.topic].includes(r.subtopic) ? r.subtopic : null;
  const secondary = r.secondary && TOPIC_CODES.includes(r.secondary) && r.secondary !== r.topic ? r.secondary : null;
  return { topic: r.topic, subtopic, secondary, confidence: r.confidence === 'high' ? 'high' : 'low' };
}

// Merge the rule result with the AI answer.
export function decide(rules, ai) {
  if (!ai) return { ...rules, source: 'rules' };
  const candidates = Object.keys(rules.scores || {}).slice(0, 3);
  const accept = ai.topic === rules.topic || ai.confidence === 'high' || candidates.includes(ai.topic);
  if (!accept) return { ...rules, source: 'rules', aiDisagreed: ai.topic };
  const agreed = ai.topic === rules.topic;
  return {
    ...rules,
    topic: ai.topic,
    subtopic: ai.subtopic ?? (agreed ? rules.subtopic : null),
    secondary: ai.secondary ?? (agreed ? rules.secondary : null),
    confidence: agreed || ai.confidence === 'high' ? 'high' : 'medium',
    evidence: [[ai.topic, 0, agreed ? 'AI review agreed' : `AI review (rules said ${rules.topic})`], ...(rules.evidence || [])].slice(0, 6),
    source: 'ai',
  };
}

// ── providers ────────────────────────────────────────────────────────────────
let _claude;
async function askClaude(bills) {
  _claude ||= new Anthropic();
  const res = await _claude.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
    messages: [{ role: 'user', content: buildUserMessage(bills) }],
  });
  if (res.stop_reason === 'refusal') throw Object.assign(new Error('model declined this batch'), { retryable: false });
  if (res.stop_reason === 'max_tokens') throw Object.assign(new Error('response truncated'), { retryable: false });
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text).results;
}

async function askGemini(bills) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT + '\n\nRespond with JSON: {"results":[{"id","topic","subtopic","secondary","confidence"}]}' }] },
        contents: [{ role: 'user', parts: [{ text: buildUserMessage(bills) }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (res.ok) {
      const j = await res.json();
      const raw = (j.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/^```json\s*|\s*```$/g, '');
      return JSON.parse(raw).results;
    }
    if ([429, 500, 503].includes(res.status) && attempt < 5) { await new Promise(r => setTimeout(r, 2000 * 2 ** attempt)); continue; }
    throw Object.assign(new Error(`Gemini HTTP ${res.status}`), { retryable: [429, 500, 503].includes(res.status) });
  }
}

export function provider() {
  if (process.env.ANTHROPIC_API_KEY) return { name: `Claude (${CLAUDE_MODEL})`, ask: askClaude };
  if (process.env.GEMINI_API_KEY) return { name: `Gemini (${GEMINI_MODEL})`, ask: askGemini };
  return null;
}

// Classify a batch; returns Map(id -> validated answer). Unparseable or
// missing answers are simply absent (the rules result stands).
export async function reviewBatch(bills, ask) {
  const out = new Map();
  let results = [];
  try { results = await ask(bills); } catch (e) { if (e.retryable) throw e; console.log(`  batch skipped: ${e.message}`); return out; }
  for (const r of results || []) { const v = validate(r); if (v) out.set(String(r.id), v); }
  return out;
}
