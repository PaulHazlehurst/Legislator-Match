import 'dotenv/config';
import { classifyBill } from '../shared/classifier.js';
import { provider, reviewBatch, decide } from './lib/ai-classify.js';

// ============================================================================
// ai-review.js — AI second opinion on the bills the rules were unsure about.
//
//   npm run ai-review -- --eval   measure first: runs only on the 630 hand-
//                                 labelled bills and prints accuracy, no DB
//   npm run ai-review             review medium/low-confidence bills in the DB
//   npm run ai-review -- --all    review every rules-classified bill
//
// Needs ANTHROPIC_API_KEY (preferred) or GEMINI_API_KEY. Resumable: reviewed
// rows become classified_by = 'ai_review' and are not picked up again, and
// reclassify-all leaves them alone unless run with --force.
// ============================================================================

const BATCH = Number(process.env.AI_BATCH || 20);
const MAX = Number(process.env.MAX_PER_RUN || 4000);
const P = provider();
if (!P) { console.error('Set ANTHROPIC_API_KEY or GEMINI_API_KEY.'); process.exit(1); }

async function evalMode() {
  const fs = await import('node:fs');
  const load = f => JSON.parse(fs.readFileSync(new URL('./eval/' + f, import.meta.url)));
  const gold = [...load('gold.json'), ...load('holdout.json')];
  const rows = gold.map(g => ({ ...g, id: String(g.legiscan_bill_id), rules: classifyBill(g) }))
    .filter(g => g.rules.confidence !== 'high');
  console.log(`Evaluating ${P.name} on ${rows.length} medium/low-confidence gold bills…`);
  let rulesOk = 0, finalOk = 0, aiOk = 0, answered = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const answers = await reviewBatch(batch, P.ask);
    for (const g of batch) {
      const ai = answers.get(g.id); const final = decide(g.rules, ai);
      rulesOk += g.rules.topic === g.gold.topic; finalOk += final.topic === g.gold.topic;
      if (ai) { answered++; aiOk += ai.topic === g.gold.topic; }
    }
  }
  const pct = (a, b) => (100 * a / b).toFixed(1) + '%';
  console.log(`  rules alone ....... ${pct(rulesOk, rows.length)}`);
  console.log(`  AI raw ............ ${pct(aiOk, answered)} (${answered} answered)`);
  console.log(`  rules + AI review . ${pct(finalOk, rows.length)}   ← what ai-review would store`);
  console.log(finalOk > rulesOk ? '\nAI review helps on this sample — safe to run without --eval.' : '\nAI review did NOT beat the rules here — don\'t apply it.');
}

async function dbMode() {
  const { db } = await import('./lib/db.js');
  const { loadTaxonomyIds, toBillColumns, hasV2Columns } = await import('./lib/classify.js');
  const tax = await loadTaxonomyIds(db); const v2 = await hasV2Columns(db);
  const bills = [];
  for (let from = 0; bills.length < MAX; from += 1000) {          // PostgREST returns ≤1000 rows per request
    let q = db.from('bills').select('id, title, description, legiscan_subjects, classification_confidence')
      .eq('classified_by', 'rules_v2');
    if (!process.argv.includes('--all')) q = q.in('classification_confidence', ['medium', 'low']);
    const { data, error } = await q.order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    bills.push(...data);
    if (data.length < 1000) break;
  }
  bills.splice(MAX);
  console.log(`Reviewing ${bills.length} bills with ${P.name}…`);
  let changed = 0, done = 0;
  for (let i = 0; i < bills.length; i += BATCH) {
    const batch = bills.slice(i, i + BATCH).map(b => ({ id: b.id, title: b.title, description: b.description,
      subjects: (b.legiscan_subjects || []).map(s => s.subject_name || s), rules: classifyBill({ ...b, subjects: b.legiscan_subjects || [] }) }));
    let answers;
    try { answers = await reviewBatch(batch, P.ask); }
    catch (e) { console.log(`\nProvider unavailable (${e.message}). Stopping; re-run later to continue.`); break; }
    for (const b of batch) {
      if (!answers.has(String(b.id))) continue;               // unanswered → stays rules_v2, retried next run
      const final = decide(b.rules, answers.get(String(b.id)));
      if (final.topic !== b.rules.topic) changed++;
      await db.from('bills').update(toBillColumns(final, tax, { v2, classifiedBy: 'ai_review' })).eq('id', b.id);
      done++;
    }
    process.stdout.write(`\r  ${Math.min(i + BATCH, bills.length)}/${bills.length} (${changed} changed)`);
  }
  console.log(`\nDone: ${done} reviewed, ${changed} moved to a different topic.`);
  await db.from('activity_log').insert({ actor: 'ai-review', action: 'second_opinion', detail: { provider: P.name, reviewed: done, changed } });
}

(process.argv.includes('--eval') ? evalMode() : dbMode()).catch(e => { console.error(e); process.exit(1); });
