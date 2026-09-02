import 'dotenv/config';
import { db } from './lib/db.js';

// ─────────────────────────────────────────────────────────────────────────────
// Enriches the database with the institutional-power layer from OpenStates:
//   • reconciles our LegiScan roster with OpenStates (verified party/district,
//     marks who is currently active, stores openstates_id)
//   • committees + who sits on them + their role (chair / vice / member)
//   • committee chairs recorded as leadership positions
//
// OpenStates committees are an EXPERIMENTAL endpoint; Maryland coverage may be
// partial. This script reports exactly what it found so gaps are visible.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = process.env.OPENSTATES_API_KEY;
const JURISDICTION = process.env.OPENSTATES_JURISDICTION || 'Maryland';
const BASE = 'https://v3.openstates.org';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

if (!KEY) { console.error('Missing OPENSTATES_API_KEY in .env / secrets'); process.exit(1); }

async function os(path, params = {}) {
  const qs = new URLSearchParams(params);
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${BASE}${path}?${qs}`, { headers: { 'x-api-key': KEY, accept: 'application/json' } });
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`OpenStates ${path} HTTP ${res.status}: ${await res.text()}`);
    await sleep(400); // stay under ~1 req/sec free-tier limit
    return res.json();
  }
  throw new Error(`OpenStates ${path} rate-limited repeatedly`);
}

// ── name normalization for matching OpenStates people to our LegiScan roster ──
function norm(name = '') {
  return name.toLowerCase().normalize('NFKD')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv|dr|hon)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}
function lastFirst(name = '') {
  const p = norm(name).split(' ').filter(Boolean);
  if (p.length < 2) return null;
  return `${p[p.length - 1]}|${p[0][0]}`; // last name + first initial
}
const chamberOf = (org) => org === 'upper' ? 'senate' : org === 'lower' ? 'house' : null;
const roleOf = (r = '') => {
  const s = r.toLowerCase();
  if (s.includes('vice')) return 'vice_chair';
  if (s.includes('chair')) return 'chair';
  return 'member';
};

async function currentSession() {
  let { data } = await db.from('sessions').select('id, name').eq('is_current', true).limit(1);
  if (!data?.length) ({ data } = await db.from('sessions').select('id, name').order('year_end', { ascending: false }).limit(1));
  if (!data?.length) { console.error('No sessions found — run ingest first.'); process.exit(1); }
  return data[0];
}

async function loadOurRoster() {
  const { data } = await db.from('legislators').select('id, name, party, district, chamber');
  const byFull = new Map(), byLF = new Map();
  for (const l of data) {
    byFull.set(norm(l.name), l);
    const k = lastFirst(l.name); if (k) byLF.set(k, l);
  }
  return { list: data, byFull, byLF };
}
function match(roster, name) {
  return roster.byFull.get(norm(name)) || (lastFirst(name) && roster.byLF.get(lastFirst(name))) || null;
}

async function main() {
  const session = await currentSession();
  console.log(`Enriching against current session: ${session.name}\n`);
  const roster = await loadOurRoster();
  console.log(`Our roster: ${roster.list.length} legislators`);

  // ── 1. people: pull OpenStates roster, reconcile ──
  let people = [], page = 1, pages = 1;
  do {
    const r = await os('/people', { jurisdiction: JURISDICTION, org_classification: 'legislature', page, per_page: 50 });
    people.push(...(r.results || []));
    pages = r.pagination?.max_page || 1; page++;
  } while (page <= pages);
  console.log(`OpenStates returned ${people.length} current legislators`);

  let matched = 0, unmatched = [];
  for (const p of people) {
    const me = match(roster, p.name);
    if (!me) { unmatched.push(p.name); continue; }
    matched++;
    const patch = { openstates_id: p.id, active: true };
    if (!me.party && p.party) patch.party = p.party[0]; // 'Democratic' -> 'D'
    const ch = chamberOf(p.current_role?.org_classification);
    if (!me.chamber && ch) patch.chamber = ch;
    if (!me.district && p.current_role?.district) patch.district = String(p.current_role.district);
    await db.from('legislators').update(patch).eq('id', me.id);
  }
  console.log(`  matched ${matched}/${people.length} to our roster` +
    (unmatched.length ? ` (unmatched: ${unmatched.slice(0, 8).join(', ')}${unmatched.length > 8 ? '…' : ''})` : ''));

  // ── 2. committees + memberships ──
  let committees = [];
  try {
    const r = await os('/committees', { jurisdiction: JURISDICTION, classification: 'committee', per_page: 50 });
    committees = r.results || [];
  } catch (e) {
    console.log(`  committees list failed (${e.message}). MD coverage may be unavailable.`);
  }
  console.log(`\nCommittees found: ${committees.length}`);
  if (!committees.length) {
    console.log('  No committee data from OpenStates for this jurisdiction.');
    console.log('  Institutional-power scoring will use majority status only until this is filled.');
    await db.from('activity_log').insert({ actor: 'enrich', action: 'openstates', detail: { people_matched: matched, committees: 0 } });
    return;
  }

  // refresh chair leadership for this session so re-runs stay clean
  await db.from('leadership_positions').delete()
    .eq('session_id', session.id).in('role', ['committee_chair', 'committee_vice_chair']);

  let memRows = 0, chairRows = 0, memUnmatched = 0;
  for (const c of committees) {
    const chamber = chamberOf(c.classification === 'committee' ? c.chamber : null) || chamberOf(c.chamber) || null;
    const { data: comRow } = await db.from('committees').upsert(
      { state_code: 'MD', chamber, name: c.name, openstates_id: c.id },
      { onConflict: 'state_code,chamber,name' }).select('id').single();
    if (!comRow) continue;

    // fetch memberships for this committee
    let memberships = c.memberships;
    if (!memberships) {
      try { memberships = (await os(`/committees/${c.id}`, { include: 'memberships' })).memberships || []; }
      catch { memberships = []; }
    }
    for (const m of memberships) {
      const nm = m.person_name || m.person?.name;
      const me = nm && match(roster, nm);
      if (!me) { memUnmatched++; continue; }
      const role = roleOf(m.role);
      await db.from('committee_memberships').upsert(
        { committee_id: comRow.id, legislator_id: me.id, session_id: session.id, role },
        { onConflict: 'committee_id,legislator_id,session_id' });
      memRows++;
      if (role === 'chair' || role === 'vice_chair') {
        await db.from('leadership_positions').insert({
          legislator_id: me.id, session_id: session.id,
          role: role === 'chair' ? 'committee_chair' : 'committee_vice_chair',
          committee_id: comRow.id });
        chairRows++;
      }
    }
  }
  console.log(`  loaded ${memRows} committee memberships (${chairRows} chairs/vice-chairs, ${memUnmatched} unmatched names)`);

  await db.from('activity_log').insert({ actor: 'enrich', action: 'openstates',
    detail: { people_matched: matched, committees: committees.length, memberships: memRows, chairs: chairRows } });
  console.log('\nEnrichment complete.');
}

main().catch(e => { console.error(e); process.exit(1); });
