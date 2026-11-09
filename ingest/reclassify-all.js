import 'dotenv/config';
import { db } from './lib/db.js';
import { seedTaxonomy } from './lib/seedTaxonomy.js';
import { classifyBill, toBillColumns, loadTaxonomyIds, hasV2Columns, CLASSIFIER_VERSION } from './lib/classify.js';
import { TOPICS } from '../shared/taxonomy.js';

// ============================================================================
// reclassify-all.js — apply the v2 taxonomy + classifier to EVERY bill.
//
//   npm run reclassify-all              write changes
//   npm run reclassify-all -- --dry-run show what would change, write nothing
//   npm run reclassify-all -- --force   also overwrite AI-reviewed rows
//
// Never overwrites rows a person fixed by hand (classified_by = 'manual').
// AI-reviewed rows (classified_by = 'ai_review') are kept unless --force.
// Free and fast: no API calls, ~8k bills in a few minutes.
// ============================================================================

const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const KEEP = new Set(['manual', ...(FORCE ? [] : ['ai_review'])]);
const PARALLEL = 12;

async function main() {
  console.log(`Reclassifying with ${CLASSIFIER_VERSION}${DRY ? ' (dry run)' : ''}…`);
  if (!DRY) {
    const s = await seedTaxonomy(db);
    console.log(`  taxonomy seeded: ${s.topics} topics, ${s.subtopics} subtopics`);
  }
  const tax = await loadTaxonomyIds(db);
  const v2 = await hasV2Columns(db);
  if (!v2) console.log('  NOTE: v2 columns not found — run ingest/sql/v2_migration.sql to also store secondary topics + evidence.');

  const codeById = Object.fromEntries(tax.topics.map(t => [t.id, t.code]));
  const bills = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('bills')
      .select('id, bill_number, title, description, legiscan_subjects, topic_id, classified_by')
      .order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    bills.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`  ${bills.length} bills loaded`);

  const stats = { kept: 0, changedTopic: 0, unchanged: 0, byTopic: {}, byConf: {} };
  const updates = [];
  for (const b of bills) {
    if (KEEP.has(b.classified_by)) { stats.kept++; continue; }
    const c = classifyBill({ title: b.title, description: b.description, subjects: b.legiscan_subjects || [] });
    const cols = toBillColumns(c, tax, { v2 });
    if (cols.topic_id !== b.topic_id) stats.changedTopic++; else stats.unchanged++;
    stats.byTopic[c.topic || '(none)'] = (stats.byTopic[c.topic || '(none)'] || 0) + 1;
    stats.byConf[c.confidence] = (stats.byConf[c.confidence] || 0) + 1;
    updates.push([b.id, cols, b, c]);
  }

  if (DRY) {
    const sample = updates.filter(([, cols, b]) => cols.topic_id !== b.topic_id).slice(0, 25);
    for (const [, , b, c] of sample)
      console.log(`  ${b.bill_number}: ${codeById[b.topic_id] || '—'} → ${c.topic}${c.secondary ? ' (+' + c.secondary + ')' : ''} [${c.confidence}]  ${b.title.slice(0, 70)}`);
  } else {
    let done = 0, failed = 0;
    for (let i = 0; i < updates.length; i += PARALLEL) {
      const res = await Promise.all(updates.slice(i, i + PARALLEL).map(([id, cols]) => db.from('bills').update(cols).eq('id', id)));
      res.forEach(r => { if (r.error) { failed++; if (failed < 5) console.log('  update error:', r.error.message); } });
      done += res.length;
      if (done % 1000 < PARALLEL) console.log(`  ${done}/${updates.length}`);
    }
    console.log(`  wrote ${done - failed} rows (${failed} failed)`);

    // Retire subtopics that are no longer in the taxonomy.
    const valid = new Set(TOPICS.flatMap(t => t.subtopics.map(s => `${t.code}::${s[0]}`)));
    const stale = tax.subs.filter(s => !valid.has(`${codeById[s.topic_id]}::${s.code}`));
    if (stale.length) {
      const ids = stale.map(s => s.id);
      await db.from('bills').update({ subtopic_id: null }).in('subtopic_id', ids);
      const { error } = await db.from('subtopics').delete().in('id', ids);
      console.log(`  retired ${stale.length} old subtopics${error ? ' (error: ' + error.message + ')' : ''}`);
    }
    await db.from('activity_log').insert({ actor: 'reclassify-all', action: 'rules_v2',
      detail: { version: CLASSIFIER_VERSION, written: done - failed, kept: stats.kept, changed_topic: stats.changedTopic, confidence: stats.byConf } });
  }

  console.log(`\n  topic changed on ${stats.changedTopic}, unchanged ${stats.unchanged}, kept (manual/AI) ${stats.kept}`);
  console.log('  confidence:', stats.byConf);
  console.log('  by topic:', Object.entries(stats.byTopic).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
  console.log('\nNext (optional): npm run ai-review  — AI second opinion on the medium/low-confidence bills.');
}

main().catch(e => { console.error(e); process.exit(1); });
