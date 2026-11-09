// Measures shared/classifier.js against the hand-labelled gold set.
//   node ingest/eval/evaluate.js            summary
//   node ingest/eval/evaluate.js --errors   also list every miss
//
// gold.json    480 bills drawn at random (seeded) from the 2024–2026 Maryland
//              sessions, labelled by hand against shared/taxonomy.js. Rows
//              0–319 = DEV (rules were tuned on these), 320–479 = TEST (looked
//              at once, for systematic bugs only).
// holdout.json 150 further random bills labelled AFTER tuning finished and
//              never used to change a rule. Quote this number.
// Every label is checked against the taxonomy, so a renamed code fails loudly.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyBill } from '../../shared/classifier.js';
import { TOPIC_CODES, SUBTOPIC_CODES } from '../../shared/taxonomy.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const gold = JSON.parse(fs.readFileSync(here + 'gold.json', 'utf8'));
const holdout = JSON.parse(fs.readFileSync(here + 'holdout.json', 'utf8'));
for (const g of [...gold, ...holdout]) {
  const { topic, subtopic, secondary } = g.gold;
  if (!TOPIC_CODES.includes(topic) || (subtopic && !SUBTOPIC_CODES[topic].includes(subtopic)) ||
      (secondary && (!TOPIC_CODES.includes(secondary) || secondary === topic)))
    throw new Error(`Invalid gold label on ${g.bill_number} (${g.year}): ${JSON.stringify(g.gold)}`);
}
const showErrors = process.argv.includes('--errors');

function evaluate(rows) {
  const m = { n: rows.length, primary: 0, lenient: 0, v1: 0, subN: 0, sub: 0, secPred: 0, secHit: 0,
              conf: { high: [0, 0], medium: [0, 0], low: [0, 0] }, misses: [] };
  for (const g of rows) {
    const r = classifyBill(g);
    const ok = r.topic === g.gold.topic;
    const len = ok || r.topic === g.gold.secondary || (r.secondary && r.secondary === g.gold.topic);
    m.primary += ok; m.lenient += len; m.v1 += g.v1_topic === g.gold.topic;
    m.conf[r.confidence][0] += ok; m.conf[r.confidence][1] += 1;
    if (ok && g.gold.subtopic) { m.subN++; m.sub += r.subtopic === g.gold.subtopic; }
    if (r.secondary) { m.secPred++; m.secHit += r.secondary === g.gold.secondary || r.secondary === g.gold.topic; }
    if (!ok) m.misses.push({ g, r });
  }
  return m;
}
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—';
function report(name, m) {
  console.log(`\n${name}  (n=${m.n})`);
  console.log(`  primary topic exact ........ ${pct(m.primary, m.n)}   (v1 classifier in DB today: ${pct(m.v1, m.n)})`);
  console.log(`  primary or secondary match . ${pct(m.lenient, m.n)}`);
  console.log(`  subtopic | topic correct ... ${pct(m.sub, m.subN)}  (n=${m.subN})`);
  console.log(`  secondary precision ........ ${pct(m.secHit, m.secPred)}  (n=${m.secPred})`);
  for (const c of ['high', 'medium', 'low']) console.log(`  confidence ${c.padEnd(6)} ....... ${pct(...m.conf[c])} of ${m.conf[c][1]}`);
}
const dev = evaluate(gold.slice(0, 320)), test = evaluate(gold.slice(320)), hold = evaluate(holdout);
const all = evaluate([...gold, ...holdout]);
report('DEV (tuned on)', dev); report('TEST', test); report('FINAL HOLDOUT (never tuned on)', hold); report('ALL 630', all);
if (process.argv.includes('--json')) console.log(JSON.stringify({ holdout: { n: hold.n, primary: hold.primary / hold.n, lenient: hold.lenient / hold.n, v1: hold.v1 / hold.n, subtopic: hold.sub / hold.subN }, all: { n: all.n, primary: all.primary / all.n, lenient: all.lenient / all.n, v1: all.v1 / all.n, subtopic: all.sub / all.subN, conf: all.conf } }));
if (showErrors) {
  console.log('\nMisses:');
  for (const { g, r } of all.misses)
    console.log(`  ${g.bill_number} ${g.year} | gold ${g.gold.topic}${g.gold.secondary ? '+' + g.gold.secondary : ''} | got ${r.topic}${r.secondary ? '+' + r.secondary : ''} (${r.confidence}) | ${g.title.slice(0, 90)} | ${JSON.stringify(r.scores)}`);
}
