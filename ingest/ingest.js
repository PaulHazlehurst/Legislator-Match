import 'dotenv/config';
import { db } from './lib/db.js';
import { SESSION_CONTROL } from './taxonomy.js';
import {
  getDatasetList, getSessionData,
  PARTY, VOTE, mapStatus, sponsorRole, chamberFromBody,
} from './lib/legiscan.js';
import { classifyBill, toBillColumns, loadTaxonomyIds, hasV2Columns } from './lib/classify.js';

const STATE = process.env.STATE || 'MD';
const YEARS = (process.env.YEARS || '2024,2025,2026').split(',').map(s => s.trim());
const CHUNK = 500;          // batch upsert size

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function ingestSession(dataset, tax, v2) {
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

  // ── people → legislators (only real legislators: role_id 1=Rep, 2=Sen) ──
  const legRows = data.people
    .filter(p => p.role_id === 1 || p.role_id === 2)
    .map(p => ({
    state_code: STATE,
    legiscan_people_id: p.people_id,
    name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' '),
    party: PARTY[p.party_id] || (p.party ? p.party[0] : null),
    chamber: p.role_id === 2 ? 'senate' : p.role_id === 1 ? 'house' : chamberFromBody(p.role),
    district: p.district || null,
  }));
  for (const c of chunk(legRows, CHUNK)) {
    await db.from('legislators').upsert(c, { onConflict: 'state_code,legiscan_people_id' });
  }
  const { data: legs } = await db.from('legislators')
    .select('id, legiscan_people_id').eq('state_code', STATE);
  const legByPeople = Object.fromEntries(legs.map(l => [l.legiscan_people_id, l.id]));

  // ── classify + build bill rows. Low-confidence results are revisited by
  //  reclassify.js (AI review) if you run it.
  console.log('  classifying (shared/classifier.js rules v2)…');
  const billRows = data.bills.map((b) => {
    const c = classifyBill(b);
    const { outcome, stage } = mapStatus(b.status);
    return {
      state_code: STATE, session_id: sessionId,
      legiscan_bill_id: b.bill_id,
      bill_number: b.bill_number,
      title: b.title, description: b.description || null,
      legiscan_subjects: b.subjects || null,
      outcome, status_stage: stage,
      ...toBillColumns(c, tax, { v2 }),
    };
  });
  for (const c of chunk(billRows, CHUNK)) {
    // insert-only-new: backfills missing bills without overwriting the topic
    // classification already stored on existing bills (preserves reclassify).
    const { error } = await db.from('bills').upsert(c, { onConflict: 'legiscan_bill_id', ignoreDuplicates: true });
    if (error) console.log('  bill insert error:', error.message);
  }
  // Existing bills: refresh ONLY outcome + stage (classification untouched),
  // so the weekly run actually keeps statuses current.
  const statusNow = Object.fromEntries(billRows.map(r => [r.legiscan_bill_id, r]));
  let statusUpdates = 0;
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await db.from('bills')
      .select('id, legiscan_bill_id, outcome, status_stage').eq('session_id', sessionId)
      .order('id').range(from, from + 999);
    if (error || !page?.length) break;
    const changed = page.filter(b => statusNow[b.legiscan_bill_id] &&
      (statusNow[b.legiscan_bill_id].outcome !== b.outcome || statusNow[b.legiscan_bill_id].status_stage !== b.status_stage));
    for (let i = 0; i < changed.length; i += 20) {
      await Promise.all(changed.slice(i, i + 20).map(b => db.from('bills').update({
        outcome: statusNow[b.legiscan_bill_id].outcome, status_stage: statusNow[b.legiscan_bill_id].status_stage,
      }).eq('id', b.id)));
    }
    statusUpdates += changed.length;
    if (page.length < 1000) break;
  }
  if (statusUpdates) console.log(`  refreshed outcome/status on ${statusUpdates} existing bills`);
  const unclassified = billRows.filter(r => !r.topic_id).length;
  console.log(`  processed ${billRows.length} bills this session (${unclassified} had no subject topic)`);

  // Page through ALL bills in the session (Supabase caps a query at 1000 rows,
  // so without this the sponsorship/vote maps only saw the first 1000 bills and
  // silently dropped links for the rest).
  const billByLegiscan = {};
  for (let from = 0; ; from += 1000) {
    const { data: page } = await db.from('bills')
      .select('id, legiscan_bill_id').eq('session_id', sessionId)
      .order('id').range(from, from + 999);
    if (!page || !page.length) break;
    for (const b of page) billByLegiscan[b.legiscan_bill_id] = b.id;
    if (page.length < 1000) break;
  }

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
    const { error } = await db.from('sponsorships').upsert(c, { onConflict: 'bill_id,legislator_id' });
    if (error) console.log('  sponsorship error:', error.message);
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
  const tax = await loadTaxonomyIds(db);
  const v2 = await hasV2Columns(db);
  if (!v2) console.log('  (v2 columns missing — run ingest/sql/v2_migration.sql to store secondary topics)');
  if (!Object.keys(tax.topicIdByCode).length) {
    console.error('No topics found. Run `npm run seed` first.'); process.exit(1);
  }

  for (const year of YEARS) {
    const list = await getDatasetList(STATE, year);
    // Prefer the Regular Session dataset for the year.
    const ds = list.find(d => /regular/i.test(d.session_name)) || list[0];
    if (!ds) { console.log(`  no dataset for ${year}`); continue; }
    console.log(`\n${year}: ${ds.session_name} (session ${ds.session_id})`);
    await ingestSession(ds, tax, v2);
  }
  console.log('\nDone. Log an ingest event.');
  await db.from('activity_log').insert({ actor: 'ingest', action: 'backfill',
    detail: { state: STATE, years: YEARS } });
}

main().catch(e => { console.error(e); process.exit(1); });
