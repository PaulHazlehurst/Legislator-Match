// Classification for the ingest pipeline. All rules live in
// ../../shared/classifier.js (measured by ingest/eval/evaluate.js); this file
// adapts its output to the database row shape and keeps the old entry point
// name so ingest.js keeps working.
import { classifyBill, significanceOf, CLASSIFIER_VERSION } from '../../shared/classifier.js';

export { classifyBill, significanceOf, CLASSIFIER_VERSION };

// Topic/subtopic id lookups, loaded once per run.
export async function loadTaxonomyIds(db) {
  const { data: topics, error: te } = await db.from('topics').select('id, code');
  if (te) throw new Error('topics: ' + te.message);
  const { data: subs, error: se } = await db.from('subtopics').select('id, code, topic_id');
  if (se) throw new Error('subtopics: ' + se.message);
  const topicIdByCode = Object.fromEntries(topics.map(t => [t.code, t.id]));
  const codeByTopicId = Object.fromEntries(topics.map(t => [t.id, t.code]));
  const subIdByPair = {};
  for (const s of subs) if (codeByTopicId[s.topic_id]) subIdByPair[`${codeByTopicId[s.topic_id]}::${s.code}`] = s.id;
  return { topicIdByCode, subIdByPair, topics, subs };
}

// Does the v2 migration's secondary_topic_id column exist yet?
export async function hasV2Columns(db) {
  const { error } = await db.from('bills').select('secondary_topic_id').limit(1);
  return !error;
}

// classification → columns to write on `bills`
export function toBillColumns(c, tax, { v2 = true, classifiedBy = 'rules_v2' } = {}) {
  const topic_id = c.topic ? tax.topicIdByCode[c.topic] || null : null;
  const subtopic_id = topic_id && c.subtopic ? tax.subIdByPair[`${c.topic}::${c.subtopic}`] || null : null;
  const row = {
    topic_id, subtopic_id,
    significance: c.significance,
    classified_by: topic_id ? classifiedBy : 'unclassified',
    classification_confidence: c.confidence,
    classified_at: new Date().toISOString(),
  };
  if (v2) {
    row.secondary_topic_id = c.secondary ? tax.topicIdByCode[c.secondary] || null : null;
    row.classification_score = c.score;
    row.classification_evidence = c.evidence;
    row.classifier_version = c.version || CLASSIFIER_VERSION;
  }
  return row;
}

// Back-compat for scripts written against v1.
export function classifyBySubject(bill) {
  const c = classifyBill(bill);
  return { topicCode: c.topic, subtopicCode: c.subtopic, secondaryCode: c.secondary,
           significance: c.significance, classifiedBy: c.topic ? 'rules_v2' : 'unclassified',
           confidence: c.confidence, raw: c };
}
