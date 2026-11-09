// /api/bill-topic — a colleague corrects a bill's classification.
//   POST { billId, topic, subtopic?, secondary?, user? }   (codes from shared/taxonomy.js)
// Marks the bill classified_by = 'manual' so no automated pass overwrites it.
import { guard, sb, readBody, isUuid, clip } from './_lib/team.js';
import { TOPIC_CODES, SUBTOPIC_CODES } from '../shared/taxonomy.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  const { billId, topic, subtopic, secondary, user } = readBody(req);
  if (!isUuid(billId)) return res.status(400).json({ error: 'Unknown bill.' });
  if (!TOPIC_CODES.includes(topic)) return res.status(400).json({ error: 'Pick a policy area.' });
  if (subtopic && !SUBTOPIC_CODES[topic].includes(subtopic)) return res.status(400).json({ error: 'That subtopic belongs to another area.' });
  if (secondary && (!TOPIC_CODES.includes(secondary) || secondary === topic)) return res.status(400).json({ error: 'Pick a different secondary area.' });
  try {
    const topics = await sb('topics?select=id,code');
    const idOf = Object.fromEntries(topics.map(t => [t.code, t.id]));
    let subtopic_id = null;
    if (subtopic) {
      const s = await sb(`subtopics?select=id&topic_id=eq.${idOf[topic]}&code=eq.${encodeURIComponent(subtopic)}`);
      subtopic_id = s[0]?.id || null;
    }
    const patch = { topic_id: idOf[topic], subtopic_id, classified_by: 'manual', classification_confidence: 'high', classified_at: new Date().toISOString() };
    try { await sb(`bills?id=eq.${billId}`, { method: 'PATCH', body: { ...patch, secondary_topic_id: secondary ? idOf[secondary] : null } }); }
    catch (e) { if (!/secondary_topic_id/.test(e.message)) throw e; await sb(`bills?id=eq.${billId}`, { method: 'PATCH', body: patch }); }
    await sb('activity_log', { method: 'POST', body: { actor: clip(user, 80) || 'team', action: 'bill_topic_fix', detail: { billId, topic, subtopic, secondary } } }).catch(() => {});
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
