import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchIndex, search, inferArea, expand, tokenize } from '../shared/search.js';
import { clean } from '../api/analyze.js';
import { alignment } from '../ingest/build-data.js';
import { buildIndex, scoreTopic, withAccess, topicCommittees } from '../shared/scoring.js';

const docs = [
  { id: 'a', title: 'Cannabis - Dispensary Licenses - Alterations', topic: 'cannabis-gaming' },
  { id: 'b', title: 'Landlord and Tenant - Rent Increases - Limitation', topic: 'housing' },
  { id: 'c', title: 'Transportation Network Companies - Operator Deactivation', topic: 'transportation' },
  { id: 'd', title: 'Income Tax - Credit for Employers of Apprentices', topic: 'taxation' },
  { id: 'e', title: 'Landlord and Tenant - Eviction Procedures', topic: 'housing' },
];
const idx = buildSearchIndex(docs); const by = Object.fromEntries(docs.map(d => [d.id, d]));

test('plain words are expanded to bill vocabulary', () => {
  assert.ok(expand('legalize weed delivery').join(' ').includes('cannabis'));
  assert.equal(search(idx, 'let uber drivers appeal')[0].id, 'c');
  assert.equal(search(idx, 'more pot shops')[0].id, 'a');
});
test('area comes from similar bills even when the wording is informal', () => {
  const r = inferArea(idx, 'stop my landlord jacking up the rent', id => by[id]);
  assert.equal(r.areas[0].topic, 'housing');
  assert.ok(r.areas[0].share > 0.4);
});
test('nonsense returns nothing rather than a guess', () => {
  assert.equal(search(idx, 'zzzz qqqq').length, 0);
  assert.deepEqual(tokenize('the of and'), []);
});
test('AI output is sanitised against the taxonomy', () => {
  const c = clean({ topicCode: 'made-up', subtopicCode: 'income-tax', summary: 5, searchTerms: ['A', 7, ''], opponents: 'x' });
  assert.equal(c.topicCode, null); assert.equal(c.subtopicCode, null); assert.equal(c.summary, '');
  assert.deepEqual(c.searchTerms, ['a']); assert.deepEqual(c.opponents, []);
  assert.equal(clean({ topicCode: 'taxation', subtopicCode: 'income-tax' }).subtopicCode, 'income-tax');
  assert.equal(clean({ topicCode: 'health', subtopicCode: 'income-tax' }).subtopicCode, null);
});
test('vote alignment: party loyalty and cross-party agreement', () => {
  const legs = [...Array(8)].map((_, i) => ({ id: 'd' + i, party: 'D' })).concat([...Array(4)].map((_, i) => ({ id: 'r' + i, party: 'R' })));
  const rolls = [...Array(30)].map((_, i) => ({ id: 'rc' + i }));
  const votes = new Map(rolls.map((rc, i) => [rc.id, legs.map(l => ({ legislator_id: l.id, position:
    l.id === 'd7' && i < 15 ? 'nay' : l.party === 'D' ? 'yea' : 'nay' }))]));
  const out = alignment(rolls, votes, legs);
  assert.equal(out.d0.loyal, 100); assert.equal(out.d7.loyal, 50);
  assert.equal(out.r0.cross[0][0], 'd7');           // the Democrat who sides with Republicans half the time
  assert.equal(out.d0.alike[0][1], 100);
});
test('committee seats and relationships lift the right people', () => {
  const legislators = [{ id: 'chair', party: 'D', chamber: 'house', name: 'C' }, { id: 'plain', party: 'D', chamber: 'house', name: 'P' }, ...[...Array(6)].map((_, i) => ({ id: 'f' + i, party: 'D', chamber: 'house', name: 'F' + i }))];
  const bills = [], sp = []; let n = 0;
  const add = (leg, law) => { const id = 'b' + (++n); bills.push({ id, bill_number: 'HB' + n, title: 'T' + n, year: 2025, topic: 'health', significance: 'substantive', outcome: law ? 'passed' : 'pending', stage: law ? 7 : 2, committee: 'hlt' }); sp.push({ bill_id: id, legislator_id: leg, role: 'primary' }); };
  for (const l of legislators) { add(l.id, true); add(l.id, false); }
  const index = buildIndex({ bills, sponsorships: sp, legislators, power: { chair: { seats: { hlt: 'chair' } } }, now: new Date('2026-11-01') });
  assert.equal(topicCommittees(index, 'health').house[0].code, 'hlt');
  const rows = Object.fromEntries(scoreTopic(index, 'health').map(r => [r.legislator_id, r]));
  assert.ok(rows.chair.effectiveness > rows.plain.effectiveness);
  assert.equal(rows.chair.seat.role, 'chair'); assert.equal(rows.plain.seat, null);
  assert.equal(withAccess(80, 0), 80); assert.equal(withAccess(80, 3), 100); assert.equal(withAccess(60, 1), 66);
});
test('official cross-file gives companion credit; withdrawn bills are labelled', () => {
  const bills = [
    { id: 'h', bill_number: 'HB1', title: 'House wording', year: 2025, topic: 'health', significance: 'substantive', outcome: 'pending', stage: 4, xfile: 'SB9' },
    { id: 's', bill_number: 'SB9', title: 'Different Senate wording', year: 2025, topic: 'health', significance: 'substantive', outcome: 'passed', stage: 7, xfile: 'HB1' },
    { id: 'w', bill_number: 'HB2', title: 'Other', year: 2025, topic: 'health', significance: 'substantive', outcome: 'pending', stage: 2, end: 'w' },
  ];
  const index = buildIndex({ bills, sponsorships: [], legislators: [], now: new Date('2026-11-01') });
  assert.equal(index.billById.get('h').result, 'law-companion');
  assert.equal(index.billById.get('w').result, 'withdrawn');
});
