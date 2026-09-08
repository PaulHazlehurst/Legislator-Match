import 'dotenv/config';
import { db } from './lib/db.js';
import { classifyBySubject } from './lib/classify.js';

// ============================================================================
// classify-subjects.js — free, instant pass over UNCLASSIFIED bills.
//
// Re-runs the improved subject + title keyword classifier against bills already
// in the database (using their stored title + legiscan_subjects). No LegiScan
// download, no AI, no rate limits. Run this BEFORE the Gemini reclassify — it
// clears out the easy majority so Gemini only handles the genuinely ambiguous
// remainder.
// ============================================================================

async function main() {
  const { data: topics } = await db.from('topics').select('id, code');
  const topicIdByCode = Object.fromEntries((topics || []).map(t => [t.code, t.id]));

  // page through all bills with no topic
  const size = 1000; let from = 0; let updated = 0, still = 0;
  for (;;) {
    const { data: bills, error } = await db.from('bills')
      .select('id, title, legiscan_subjects')
      .is('topic_id', null)
      .order('id').range(from, from + size - 1);
    if (error) { console.error(error.message); process.exit(1); }
    if (!bills.length) break;

    for (const b of bills) {
      const c = classifyBySubject({ title: b.title, subjects: b.legiscan_subjects || [] });
      if (!c.topicCode) { still++; continue; }
      await db.from('bills').update({
        topic_id: topicIdByCode[c.topicCode],
        classified_by: c.classifiedBy,
        classification_confidence: c.confidence,
        classified_at: new Date().toISOString(),
      }).eq('id', b.id);
      updated++;
    }
    from += size;
    if (bills.length < size) break;
  }

  console.log(`Classified ${updated} more bills from subjects/title. ${still} still need the AI pass.`);
  await db.from('activity_log').insert({ actor: 'classify-subjects', action: 'keyword_pass',
    detail: { classified: updated, remaining: still } });

  const { count } = await db.from('bills').select('*', { count: 'exact', head: true }).is('topic_id', null);
  console.log(`Total still unclassified: ${count}`);
}

main().catch(e => { console.error(e); process.exit(1); });
