import 'dotenv/config';
import { db } from './lib/db.js';
import {
  getDatasetList, getSessionData,
  PARTY, VOTE, sponsorRole, chamberFromBody,
} from './lib/legiscan.js';

// ============================================================================
// relink.js — repair the roster + sponsorships WITHOUT re-importing bills.
//
// Fixes the chamber-flattening damage and restores missing senator
// sponsorships/votes by re-reading the LegiScan session datasets and re-linking
// against the bills you ALREADY have. Bills and their topic classifications are
// never written here, so all reclassify work is preserved.
//
// Idempotent: upserts by natural keys. Only real legislators (role_id 1/2) are
// loaded, so committee junk is not re-created.
// ============================================================================

const STATE = process.env.STATE || 'MD';
const YEARS = (process.env.YEARS || '2024,2025,2026').split(',').map(s => s.trim());
const CHUNK = 500;
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function relinkSession(dataset) {
  const data = await getSessionData(dataset);
  console.log(`  ${dataset.session_name}: ${data.bills.length} bills, ${data.people.length} people`);

  // find the existing session row
  const { data: sess } = await db.from('sessions')
    .select('id').eq('legiscan_session_id', dataset.session_id).single();
  if (!sess) { console.log('   (no matching session in DB — skipping)'); return; }

  // 1. upsert real legislators with CORRECT chamber
  const legRows = data.people
    .filter(p => p.role_id === 1 || p.role_id === 2)
    .map(p => ({
      state_code: STATE,
      legiscan_people_id: p.people_id,
      name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' '),
      party: PARTY[p.party_id] || (p.party ? p.party[0] : null),
      chamber: p.role_id === 2 ? 'senate' : 'house',
      district: p.district || null,
    }));
  for (const c of chunk(legRows, CHUNK))
    await db.from('legislators').upsert(c, { onConflict: 'state_code,legiscan_people_id' });

  const { data: legs } = await db.from('legislators')
    .select('id, legiscan_people_id').eq('state_code', STATE);
  const legByPeople = Object.fromEntries(legs.map(l => [l.legiscan_people_id, l.id]));

  // 2. map existing bills by legiscan id (we do NOT write bills)
  const bills = [];
  const billByLegiscan = {};
  for (let from = 0; ; from += 1000) {
    const { data: page } = await db.from('bills')
      .select('id, legiscan_bill_id').eq('session_id', sess.id).order('id').range(from, from + 999);
    if (!page || !page.length) break;
    for (const b of page) { bills.push(b); billByLegiscan[b.legiscan_bill_id] = b.id; }
    if (page.length < 1000) break;
  }

  // 3. rebuild sponsorships from the dataset, linking to existing bills only
  const sponRows = [];
  for (const b of data.bills) {
    const billId = billByLegiscan[b.bill_id];
    if (!billId) continue;
    for (const s of b.sponsors || []) {
      const legId = legByPeople[s.people_id];
      if (!legId) continue; // skips committee/non-legislator sponsors
      sponRows.push({ bill_id: billId, legislator_id: legId,
                      role: sponsorRole(s), sponsor_order: s.sponsor_order || null });
    }
  }
  for (const c of chunk(sponRows, CHUNK))
    await db.from('sponsorships').upsert(c, { onConflict: 'bill_id,legislator_id' });
  console.log(`   re-linked ${sponRows.length} sponsorships`);

  // 4. restore individual votes for existing roll calls
  let voteCount = 0;
  const rollByLegiscan = {};
  for (let from = 0; ; from += 1000) {
    const { data: page } = await db.from('roll_calls')
      .select('id, legiscan_roll_call_id').order('id').range(from, from + 999);
    if (!page || !page.length) break;
    for (const r of page) rollByLegiscan[r.legiscan_roll_call_id] = r.id;
    if (page.length < 1000) break;
  }

  for (const rc of data.votes) {
    const rcId = rollByLegiscan[rc.roll_call_id];
    if (!rcId) continue;
    const voteRows = (rc.votes || []).map(v => ({
      roll_call_id: rcId,
      legislator_id: legByPeople[v.people_id],
      position: VOTE[v.vote_id] || 'nv',
    })).filter(v => v.legislator_id);
    for (const c of chunk(voteRows, CHUNK))
      await db.from('votes').upsert(c, { onConflict: 'roll_call_id,legislator_id' });
    voteCount += voteRows.length;
  }
  console.log(`   re-linked ${voteCount} votes`);
}

async function main() {
  console.log(`Re-linking ${STATE} roster + sponsorships (bills/topics untouched)`);
  for (const year of YEARS) {
    const list = await getDatasetList(STATE, year);
    const ds = list.find(d => /regular/i.test(d.session_name)) || list[0];
    if (!ds) { console.log(`  ${year}: no dataset`); continue; }
    await relinkSession(ds);
  }
  await db.from('activity_log').insert({ actor: 'relink', action: 'roster_sponsorship_repair',
    detail: { state: STATE, years: YEARS } });
  console.log('\nDone. Now run the junk cleanup SQL, then refresh the scoring views.');
}

main().catch(e => { console.error(e); process.exit(1); });
