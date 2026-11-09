// node --test tests/   — scoring rules, on a small synthetic legislature.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, scoreTopic, sessionConcluded } from '../shared/scoring.js';

const NOW = new Date('2026-11-09');
let n = 0;
const bill = (o) => ({ id: 'b' + (++n), bill_number: (o.ch === 'senate' ? 'SB' : 'HB') + n, title: o.title || 'Bill ' + n,
  outcome: o.outcome || 'pending', status_stage: o.stage || 'introduced', significance: o.sig || 'substantive',
  topic: o.topic || 'health', subtopic: o.sub || null, secondary: o.sec || null, year: o.year || 2025 });

function world() {
  n = 0;
  const legislators = [
    { id: 'pro', name: 'Pro', party: 'D', chamber: 'house' },
    { id: 'rookie', name: 'Rookie', party: 'D', chamber: 'house' },
    { id: 'signer', name: 'Signer', party: 'R', chamber: 'house' },
    { id: 'sen', name: 'Senator', party: 'D', chamber: 'senate' },
    ...Array.from({ length: 10 }, (_, i) => ({ id: 'f' + i, name: 'Filler ' + i, party: i % 2 ? 'R' : 'D', chamber: 'house' })),
  ];
  const bills = [], sp = [];
  const lead = (leg, o) => { const b = bill(o); bills.push(b); sp.push({ bill_id: b.id, legislator_id: leg, role: 'primary' }); return b; };
  const cosign = (leg, b) => sp.push({ bill_id: b.id, legislator_id: leg, role: 'cosponsor' });
  for (let i = 0; i < 6; i++) lead('pro', { outcome: i < 5 ? 'passed' : 'pending', stage: i < 5 ? 'passed' : 'introduced' });
  lead('rookie', { outcome: 'pending' });
  bills.slice(0, 6).forEach(b => cosign('signer', b));
  // cross-file: the House bill died, its Senate companion became law
  lead('rookie', { title: 'Twin bill', outcome: 'pending' });
  lead('sen', { title: 'Twin bill', ch: 'senate', outcome: 'passed', stage: 'passed' });
  // a bill from a session still in progress
  lead('rookie', { year: 2027, outcome: 'pending' });
  // secondary-topic bill
  lead('sen', { topic: 'taxation', sec: 'health', outcome: 'passed', stage: 'passed' });
  for (let i = 0; i < 10; i++) for (let j = 0; j < 4; j++) lead('f' + i, { topic: 'education', outcome: j < (i % 4) ? 'passed' : 'pending', stage: j < (i % 4) ? 'passed' : 'introduced' });
  return buildIndex({ bills, sponsorships: sp, legislators, now: NOW });
}

test('session conclusion follows the Maryland calendar', () => {
  assert.equal(sessionConcluded(2026, new Date('2026-03-01')), false);
  assert.equal(sessionConcluded(2026, new Date('2026-07-01')), true);
  assert.equal(sessionConcluded(2025, new Date('2026-03-01')), true);
});

test('a dead bill whose cross-filed companion became law earns full credit', () => {
  const idx = world();
  const twin = [...idx.billById.values()].find(b => b.title === 'Twin bill' && b.bill_number.startsWith('HB'));
  assert.equal(twin.result, 'law-companion'); assert.equal(twin.credit, 1);
});

test('bills still in flight do not count against anyone', () => {
  const idx = world();
  const inflight = [...idx.billById.values()].find(b => b.year === 2027);
  assert.equal(inflight.result, 'in-flight'); assert.equal(inflight.credit, null);
});

test('leading beats co-sponsoring, and co-sponsor-only is capped', () => {
  const rows = scoreTopic(world(), 'health');
  const by = Object.fromEntries(rows.map(r => [r.legislator_id, r]));
  assert.ok(by.pro.willingness > by.rookie.willingness);
  assert.ok(by.signer.willingness <= 34, `co-sponsor-only W ${by.signer.willingness}`);
  assert.equal(by.signer.bills_led, 0);
});

test('a strong record beats a thin one, and shrinkage tempers small samples', () => {
  const rows = scoreTopic(world(), 'health');
  const by = Object.fromEntries(rows.map(r => [r.legislator_id, r]));
  assert.ok(by.pro.effectiveness > by.rookie.effectiveness);
  assert.ok(by.pro.breakdown.overallRate < 5 / 6, 'shrunk below the raw 5-of-6');
  assert.equal(by.pro.rank, 1);
});

test('secondary-topic bills count at half weight', () => {
  const rows = scoreTopic(world(), 'health');
  const sen = rows.find(r => r.legislator_id === 'sen');
  assert.ok(sen, 'senator appears via a secondary-topic bill');
  assert.equal(sen.led_primary, 1);
  assert.equal(sen.bills_led, 2);
});

test('scores stay within 0–100 and relative scores exist', () => {
  for (const t of ['health', 'education', 'taxation']) for (const r of scoreTopic(world(), t)) {
    for (const k of ['willingness', 'effectiveness', 'champion', 'rel_willingness', 'rel_effectiveness'])
      assert.ok(r[k] >= 0 && r[k] <= 100, `${t} ${r.name} ${k}=${r[k]}`);
  }
});
