import 'dotenv/config';
import { db } from './lib/db.js';
import { SESSION_CONTROL } from './taxonomy.js';
import {
  getDatasetList, getSessionData,
  PARTY, VOTE, mapStatus, sponsorRole, chamberFromBody,
} from './lib/legiscan.js';
import { classifyBySubject } from './lib/classify.js';

const STATE = process.env.STATE || 'MD';
const YEARS = (process.env.YEARS || '2024,2025,2026').split(',').map(s => s.trim());
const CHUNK = 500;          // batch upsert size

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// Load taxonomy id maps once.
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

async function ingestSession(dataset, tax) {
  const data = await getSessionData(dataset);
  console.log(`  parsed ${data.bills.length} bills, ${data.people.length} people, ${data.votes.length} roll calls`);

  // ── session row ──
  const s0 = data.bills[0]?.session || {};
  const { data: sessionRow } = await db.from('sessions').upsert({
    state_code: STATE,
    legiscan_session_id: dataset.session_id,
    name: dataset.session_name || s0.session_name || `${dataset.session_id}`,
    year_start: s0.year_start || Number(YEARS[0]),
    year_end: s0.year_end || Number(YEARS.at(-1)),
    is_current: String(s0.year_end || '').includes(YEARS.at(-1)),
  }, { onConflict: 'legiscan_session_id' }).select('id').single();
  const sessionId = sessionRow.id;

  // party control of both chambers for this session
  for (const chamber of ['house', 'senate']) {
    await db.from('session_control').upsert(
      { session_id: sessionId, chamber, majority_party: SESSION_CONTROL[chamber] },
      { onConflict: 'session_id,chamber' });
  }

  // ── people → legislators ──
  const legRows = data.people.map(p => ({
    state_code: STATE,
    legiscan_people_id: p.people_id,
    name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' '),
    party: PARTY[p.party_id] || (p.party ? p.party[0] : null),
    chamber: chamberFromBody(p.role || p.role_id === 2 ? 'S' : 'H'),
    district: p.district || null,
  }));
  for (const c of chunk(legRows, CHUNK)) {
    await db.from('legislators').upsert(c, { onConflict: 'state_code,legiscan_people_id' });
  }
  const { data: legs } = await db.from('legislators')
    .select('id, legiscan_people_id').eq('state_code', STATE);
  const legByPeople = Object.fromEntries(legs.map(l => [l.legiscan_people_id, l.id]));

  // ── classify from official subjects (free, instant) + build bill rows ──
  //  Bills with no subject match get topic_id=null and are picked up later by
  //  reclassify.js (the rate-limited Gemini pass).
  console.log('  classifying from LegiScan subjects…');
  const billRows = data.bills.map((b) => {
    const c = classifyBySubject(b);
    const { outcome, stage } = mapStatus(b.status);
    const topic_id = c.topicCode ? tax.topicIdByCode[c.topicCode] : null;
    const subtopic_id = (topic_id && c.subtopicCode)
      ? tax.subIdByPair[`${c.topicCode}::${c.subtopicCode}`] || null : null;
    return {
      state_code: STATE, session_id: sessionId,
      legiscan_bill_id: b.bill_id,
      bill_number: b.bill_number,
      title: b.title, description: b.description || null,
      legiscan_subjects: b.subjects || null,
      topic_id, subtopic_id,
      outcome, status_stage: stage, significance: c.significance,
      classified_by: c.classifiedBy, classification_confidence: c.confidence,
      classified_at: new Date().toISOString(),
    };
  });
  for (const c of chunk(billRows, CHUNK)) {
    await db.from('bills').upsert(c, { onConflict: 'legiscan_bill_id' });
  }
  const unclassified = billRows.filter(r => !r.topic_id).length;
  console.log(`  loaded ${billRows.length} bills (${unclassified} unclassified → run reclassify.js next)`);

  const { data: billsBack } = await db.from('bills')
    .select('id, legiscan_bill_id').eq('session_id', sessionId);
  const billByLegiscan = Object.fromEntries(billsBack.map(b => [b.legiscan_bill_id, b.id]));

  // ── sponsorships (primary + co-sponsors) ──
  const sponRows = [];
  for (const b of data.bills) {
    const billId = billByLegiscan[b.bill_id];
    if (!billId) continue;
    for (const s of b.sponsors || []) {
      const legId = legByPeople[s.people_id];
      if (!legId) continue;
      sponRows.push({ bill_id: billId, legislator_id: legId,
                      role: sponsorRole(s), sponsor_order: s.sponsor_order || null });
    }
  }
  for (const c of chunk(sponRows, CHUNK)) {
    await db.from('sponsorships').upsert(c, { onConflict: 'bill_id,legislator_id' });
  }
  console.log(`  loaded ${sponRows.length} sponsorships`);

  // ── roll calls + individual votes ──
  let voteCount = 0;
  for (const rc of data.votes) {
    const billId = billByLegiscan[rc.bill_id];
    if (!billId) continue;
    const { data: rcRow } = await db.from('roll_calls').upsert({
      bill_id: billId,
      legiscan_roll_call_id: rc.roll_call_id,
      chamber: chamberFromBody(rc.chamber),
      vote_date: rc.date || null,
      description: rc.desc || null,
      yea: rc.yea, nay: rc.nay, nv: rc.nv, absent: rc.absent,
      passed: rc.passed === 1 || rc.passed === true,
    }, { onConflict: 'legiscan_roll_call_id' }).select('id').single();
    if (!rcRow) continue;

    const voteRows = (rc.votes || []).map(v => ({
      roll_call_id: rcRow.id,
      legislator_id: legByPeople[v.people_id],
      position: VOTE[v.vote_id] || 'nv',
    })).filter(v => v.legislator_id);
    for (const c of chunk(voteRows, CHUNK)) {
      await db.from('votes').upsert(c, { onConflict: 'roll_call_id,legislator_id' });
    }
    voteCount += voteRows.length;
  }
  console.log(`  loaded ${voteCount} individual votes`);
}

async function main() {
  console.log(`Ingesting ${STATE} for years: ${YEARS.join(', ')}`);
  const tax = await loadTaxonomy();
  if (!Object.keys(tax.topicIdByCode).length) {
    console.error('No topics found. Run `npm run seed` first.'); process.exit(1);
  }

  for (const year of YEARS) {
    const list = await getDatasetList(STATE, year);
    // Prefer the Regular Session dataset for the year.
    const ds = list.find(d => /regular/i.test(d.session_name)) || list[0];
    if (!ds) { console.log(`  no dataset for ${year}`); continue; }
    console.log(`\n${year}: ${ds.session_name} (session ${ds.session_id})`);
    await ingestSession(ds, tax);
  }
  console.log('\nDone. Log an ingest event.');
  await db.from('activity_log').insert({ actor: 'ingest', action: 'backfill',
    detail: { state: STATE, years: YEARS } });
}

main().catch(e => { console.error(e); process.exit(1); });
