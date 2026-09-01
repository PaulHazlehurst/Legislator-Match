import 'dotenv/config';
import { db } from './lib/db.js';
import { classifyWithGemini } from './lib/classify.js';

// Free-tier friendly. Gemini free tier is ~10-15 requests/minute and ~1,500/day.
// We stay well under, and because we only ever touch bills with topic_id IS NULL,
// this script is fully resumable — stop it any time, re-run tomorrow, it continues.
const RPM = Number(process.env.GEMINI_RPM || 12);        // requests per minute cap
const MAX_PER_RUN = Number(process.env.MAX_PER_RUN || 1400); // stay under daily cap
const DELAY_MS = Math.ceil(60000 / RPM);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// taxonomy id maps
async function loadTaxonomy() {
  const { data: topics } = await db.from('topics').select('id, code');
  const { data: subs } = await db.from('subtopics').select('id, code, topic_id');
  const topicIdByCode = Object.fromEntries((topics || []).map(t => [t.code, t.id]));
  const subIdByPair = {};
  for (const s of subs || []) {
    const tcode = topics.find(t => t.id === s.topic_id)?.code;
    if (tcode) subIdByPair[`${tcode}::${s.code}`] = s.id;
  }
  return { topicIdByCode, subIdByPair };
}

async function main() {
  if (!process.env.GEMINI_API_KEY) { console.error('Missing GEMINI_API_KEY in .env'); process.exit(1); }
  const tax = await loadTaxonomy();

  // Pull unclassified bills (topic_id null) up to the per-run cap.
  const { data: bills, error } = await db.from('bills')
    .select('id, title, description, legiscan_subjects')
    .is('topic_id', null)
    .limit(MAX_PER_RUN);
  if (error) { console.error(error.message); process.exit(1); }

  if (!bills.length) { console.log('Nothing left to classify. All bills have a topic.'); return; }
  console.log(`Classifying ${bills.length} unclassified bills with Gemini (${RPM}/min)…`);

  let done = 0, matched = 0, stillNull = 0, backoff = DELAY_MS;
  for (const b of bills) {
    try {
      const c = await classifyWithGemini({
        title: b.title, description: b.description, subjects: b.legiscan_subjects,
      });
      const topic_id = c.topicCode ? tax.topicIdByCode[c.topicCode] : null;
      const subtopic_id = (topic_id && c.subtopicCode)
        ? tax.subIdByPair[`${c.topicCode}::${c.subtopicCode}`] || null : null;

      // Only write a topic when the model actually found one; otherwise mark it
      // reviewed-but-unmatched so we don't loop on it forever.
      await db.from('bills').update({
        topic_id, subtopic_id,
        classified_by: topic_id ? 'gemini' : 'gemini_no_match',
        classification_confidence: c.confidence,
        classified_at: new Date().toISOString(),
      }).eq('id', b.id);

      if (topic_id) matched++; else stillNull++;
      done++;
      if (done % 25 === 0) console.log(`  ${done}/${bills.length} (${matched} matched)`);
      backoff = DELAY_MS;
      await sleep(DELAY_MS);
    } catch (e) {
      if (e.code === 429) {
        backoff = Math.min(backoff * 2, 60000);
        console.log(`  rate limited — backing off ${Math.round(backoff/1000)}s (done ${done})`);
        await sleep(backoff);
        // If we're hitting the daily cap repeatedly, bail gracefully; resume later.
        if (backoff >= 60000) { console.log('  Daily cap likely reached. Re-run tomorrow to continue.'); break; }
      } else {
        console.error(`  error on bill ${b.id}: ${e.message}`);
        stillNull++; done++;
      }
    }
  }

  console.log(`\nPass complete: ${matched} newly classified, ${stillNull} left unmatched.`);
  await db.from('activity_log').insert({ actor: 'reclassify', action: 'gemini_pass',
    detail: { processed: done, matched, unmatched: stillNull } });

  const { count } = await db.from('bills').select('*', { count: 'exact', head: true }).is('topic_id', null);
  if (count) console.log(`${count} bills still unclassified — re-run to continue, or classify them by hand.`);
}

main().catch(e => { console.error(e); process.exit(1); });
