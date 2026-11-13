// ============================================================================
// build-data.js — builds the two static data files the app loads next to the
// database:
//
//   data/mga.json    official Maryland General Assembly data: standing
//                    committees (chair, vice chair, members, issue areas),
//                    each member's committees, leadership posts and contact
//                    details, and for every bill its committees of referral,
//                    cross-file, hearing date and how far it got.
//   data/votes.json  who votes alike on CONTESTED roll calls, and how often
//                    each member votes with their own party.
//
//   npm run build-data             both files
//   npm run build-data -- --mga    only data/mga.json
//   npm run build-data -- --votes  only data/votes.json
//
// Everything read here is public (mgaleg.maryland.gov and the read-only anon
// key), so this needs no secrets. No dependencies. Re-run it whenever rosters
// change or during session to refresh bill progress.
// ============================================================================
import fs from 'node:fs';
import { SB_URL, SB_ANON } from '../js/api.js';

const MGA = 'https://mgaleg.maryland.gov';
const OUT = new URL('../data/', import.meta.url);
const args = process.argv.slice(2);
const only = (f) => !args.some(a => a === '--mga' || a === '--votes') || args.includes(f);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function get(url, { json = false, headers = {}, tries = 4 } = {}) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'pinnacle-bill-intelligence data refresh', ...headers }, signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return json ? await res.json() : await res.text();
    } catch (e) {
      if (i >= tries - 1) throw new Error(`${url}: ${e.message}`);
      await sleep(1500 * 2 ** i);
    }
  }
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}
const sb = (path, range) => get(`${SB_URL}/rest/v1/${path}`, { json: true, headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}`, ...(range ? { Range: `${range[0]}-${range[1]}` } : {}) } });
async function sbAll(path) {
  const rows = [];
  for (let from = 0; ; from += 1000) { const page = await sb(path, [from, from + 999]); rows.push(...page); if (page.length < 1000) break; }
  return rows;
}

// ── HTML helpers (the MGA pages are simple server-rendered markup) ───────────
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const text = (h) => decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const tokens = (h) => decode(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '|')).split('|').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
const between = (toks, a, b) => { const i = toks.lastIndexOf(a); if (i < 0) return []; const j = toks.findIndex((t, k) => k > i && b.includes(t)); return toks.slice(i + 1, j < 0 ? i + 40 : j); };
const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
export const billKey = (year, num) => `${year}:${String(num).replace(/^([A-Z]+)0*/, '$1')}`;
const cmteSlug = (name) => name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]+/g, ' ').trim().split(' ').map(w => w[0]).join('');

// ── MGA: members ─────────────────────────────────────────────────────────────
const LEADERSHIP_RE = /^(senate president|president of the senate|president pro tem(pore)?|speaker of the house|speaker|speaker pro tem(pore)?|(deputy |assistant |chief deputy )?(majority|minority) (leader|whip)|(house|senate) (majority|minority) (leader|whip)|(deputy |assistant )?(majority|minority) (floor leader|caucus chair)|parliamentarian)\b/i;

async function memberIndex(chamber) {
  const html = await get(`${MGA}/mgawebsite/Members/Index/${chamber}`);
  const seen = new Map();
  for (const m of html.matchAll(/<a[^>]+href="\/mgawebsite\/Members\/Details\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const t = text(m[2]);
    if (t.includes(',') && !seen.has(m[1])) seen.set(m[1], t);
  }
  return [...seen].map(([slug, name]) => ({ slug, chamber, listed: name }));
}
function parseMember(html, m) {
  const tk = tokens(html);
  const after = (label) => { const i = tk.lastIndexOf(label); return i >= 0 ? tk[i + 1] : null; };
  const [last, ...rest] = m.listed.split(',').map(s => s.trim());
  const cur = (html.split(/<dt>\s*Current Assignments\s*<\/dt>/)[1] || '').split(/<dt>/)[0];
  const assignments = [...cur.matchAll(/<dd>\s*(?:\d{4})?\s*([^<]+?)\s*<\/dd>/g)].map(x => decode(x[1]).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const phone = (html.match(/Phone:?\s*(\d{3}-\d{3}-\d{4})/) || [])[1] || null;
  return {
    slug: m.slug, chamber: m.chamber, last, first: (rest[0] || '').split(' ')[0], listed: m.listed,
    district: after('District'), party: (after('Party') || '')[0] || null,
    email: (html.match(/[\w.'-]+@(?:senate|house)\.maryland\.gov/i) || [])[0] || null, phone,
    committees: between(tk, 'Committee Assignment(s)', ['Annapolis Info', 'Interim Info', 'Contact']).filter(t => /Committee|Rules/.test(t)).map(t => t.replace(/\s+Committee$/, '')),
    leadership: assignments.filter(a => LEADERSHIP_RE.test(a)).map(a => a.replace(/\s*\(.*$/, '')),
  };
}

// ── MGA: standing committees ─────────────────────────────────────────────────
async function committeeIndex(chamber) {
  const html = await get(`${MGA}/mgawebsite/Committees/Index/${chamber}`);
  const seen = new Map();
  for (const m of html.matchAll(/href="\/mgawebsite\/Committees\/Details\?cmte=([^"]+)"[^>]*>([^<]+)/g)) {
    const name = decode(m[2]).trim();
    if (/Committee$/.test(name) && !seen.has(m[1])) seen.set(m[1], name);
  }
  return [...seen].map(([q, name]) => ({ q, chamber, name: name.replace(/\s+Committee$/, '') }));
}
function parseCommittee(html, c) {
  const tk = tokens(html);
  const who = (label) => { const i = tk.indexOf(label); const t = i >= 0 ? tk[i + 1] : ''; return /^(Senator|Delegate)\s/.test(t) ? t.replace(/^(Senator|Delegate)\s+/, '') : null; };
  const slugs = new Map();
  for (const m of html.matchAll(/<a[^>]+href="\/mgawebsite\/Members\/Details\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const t = text(m[2]);
    if (/^[^,]+,\s*\S+/.test(t) && !/District/.test(t)) slugs.set(m[1], t);
  }
  const chairSlug = (label) => { const m = html.match(new RegExp(`${label}\\s*</[^>]+>[\\s\\S]{0,400}?Members/Details/([^"]+)"`)); return m ? m[1] : null; };
  return {
    code: decodeURIComponent(c.q).toLowerCase(), name: c.name, chamber: c.chamber,
    chairName: who('Chair'), viceName: who('Vice Chair'), chairSlug: chairSlug('>Chair'), viceSlug: chairSlug('>Vice Chair'),
    memberSlugs: [...slugs.keys()],
    issues: between(tk, 'Issue Areas', ['Further Information', 'Witness Guidelines and Committee FAQs', 'Subscribe', 'Legislation']).filter(t => t.length < 90),
  };
}

// ── MGA: bills ───────────────────────────────────────────────────────────────
function billRecord(b, now) {
  const fav = (s) => /^Favorable/.test(s || '');
  const heard = b.HearingDateTimePrimaryHouseOfOrigin && new Date(b.HearingDateTimePrimaryHouseOfOrigin) <= now && !/Hearing canceled/i.test(b.Status || '');
  const law = !!b.ChapterNumber || /^(Approved by the Governor|Enacted under|Became law)/i.test(b.Status || '');
  let stage = 1;
  if (heard || (b.ReportActionHouseOfOrigin || '').trim()) stage = 2;
  if (fav(b.ReportActionHouseOfOrigin)) stage = 3;
  if (/^Passed/.test(b.ThirdReadingActionHouseOfOrigin || '')) stage = 4;
  if (stage >= 4 && fav(b.ReportActionOppositeHouse)) stage = 5;
  if (b.PassedByMGA || /^Passed/.test(b.ThirdReadingActionOppositeHouse || '')) stage = 6;
  if (law) stage = 7;
  const r = { s: stage };
  if (b.CrossfileBillNumber) r.x = b.CrossfileBillNumber.replace(/^([A-Z]+)0*/, '$1');
  if (b.HearingDateTimePrimaryHouseOfOrigin) r.h = b.HearingDateTimePrimaryHouseOfOrigin.slice(0, 10);
  if (b.ChapterNumber) r.ch = String(b.ChapterNumber).replace(/^CH0*/i, '');
  const act = (b.ReportActionHouseOfOrigin || '').trim();
  if (act === 'Withdrawn') r.e = 'w'; else if (act === 'Unfavorable') r.e = 'u';
  if (/^Vetoed/i.test(b.Status || '')) r.e = /Duplicative/i.test(b.Status) ? 'vd' : 'v';
  return r;
}

async function buildMga() {
  console.log('MGA: members…');
  const legs = await sbAll('legislators?select=id,name,party,chamber,district&order=id');
  const index = [...await memberIndex('senate'), ...await memberIndex('house')];
  const members = await pool(index, 5, async (m) => { const html = await get(`${MGA}/mgawebsite/Members/Details/${m.slug}`); await sleep(120); return parseMember(html, m); });

  // match MGA members to our legislator ids: chamber + district number + last name
  const idBySlug = new Map(); const unmatched = [];
  for (const m of members) {
    const dn = parseInt(m.district, 10);
    const pool_ = legs.filter(l => l.chamber === m.chamber && fold(l.name).includes(fold(m.last)));
    const hit = pool_.find(l => parseInt(String(l.district).replace(/\D/g, ''), 10) === dn && fold(l.name).startsWith(fold(m.first).slice(0, 2)))
      || pool_.find(l => parseInt(String(l.district).replace(/\D/g, ''), 10) === dn)
      || (pool_.length === 1 ? pool_[0] : null);
    if (hit) idBySlug.set(m.slug, hit.id); else unmatched.push(m.listed);
  }
  console.log(`  ${members.length} members, ${idBySlug.size} matched to the database${unmatched.length ? ` (unmatched: ${unmatched.join('; ')})` : ''}`);

  console.log('MGA: committees…');
  const cIndex = [...await committeeIndex('senate'), ...await committeeIndex('house')];
  const committees = [];
  for (const c of cIndex) {
    const p = parseCommittee(await get(`${MGA}/mgawebsite/Committees/Details?cmte=${c.q}`), c);
    committees.push({
      code: p.code, name: p.name, chamber: p.chamber, issues: p.issues,
      chair: idBySlug.get(p.chairSlug) || null, vice: idBySlug.get(p.viceSlug) || null, chairName: p.chairName, viceName: p.viceName,
      members: p.memberSlugs.map(s => idBySlug.get(s)).filter(Boolean),
      url: `${MGA}/mgawebsite/Committees/Details?cmte=${c.q}`,
    });
    console.log(`  ${p.name} (${p.chamber}): ${p.memberSlugs.length} members, chair ${p.chairName || '—'}`);
    await sleep(150);
  }
  const byName = new Map(committees.map(c => [c.chamber + '|' + c.name, c.code]));

  console.log('MGA: bills…');
  const sessions = await sb('sessions?select=year_end&order=year_end');
  const bills = {}; const former = new Map(); const now = new Date();
  for (const { year_end: year } of sessions) {
    const list = await get(`${MGA}/${year}RS/misc/billsmasterlist/legislation.json`, { json: true });
    for (const b of list) {
      const origin = /^S/.test(b.BillNumber) ? 'senate' : 'house', opp = origin === 'senate' ? 'house' : 'senate';
      const codeOf = (name, ch) => {
        if (!name) return null;
        const hit = byName.get(ch + '|' + name) || byName.get((ch === 'senate' ? 'house' : 'senate') + '|' + name);
        if (hit) return hit;
        const code = 'x-' + cmteSlug(name);                        // committee that no longer exists under this name
        if (!former.has(code)) former.set(code, { code, name, chamber: ch, former: true, members: [], issues: [] });
        return code;
      };
      const rec = billRecord(b, now);
      const c = codeOf(b.CommitteePrimaryOrigin, origin), c2 = codeOf(b.CommitteeSecondaryOrigin, origin), o = codeOf(b.CommitteePrimaryOpposite, opp);
      if (c) rec.c = c; if (c2) rec.c2 = c2; if (o) rec.o = o;
      bills[billKey(year, b.BillNumber)] = rec;
    }
    console.log(`  ${year}: ${list.length} bills`);
  }

  const people = {};
  for (const m of members) {
    const id = idBySlug.get(m.slug); if (!id) continue;
    people[id] = { slug: m.slug, email: m.email, phone: m.phone, leadership: m.leadership, committees: m.committees };
  }
  const out = { generated: now.toISOString(), source: MGA, committees: [...committees, ...former.values()], people, bills };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(new URL('mga.json', OUT), JSON.stringify(out));
  console.log(`Wrote data/mga.json: ${committees.length} committees, ${Object.keys(people).length} people, ${Object.keys(bills).length} bills`);
}

// ── votes: who votes alike on contested roll calls ───────────────────────────
// A roll call is "contested" when at least 10% of yea/nay votes were on the
// losing side. Unanimous votes are skipped: they make everyone look alike.
export function alignment(rollCalls, votesByRoll, legs) {
  const L = new Map(legs.map(l => [l.id, l]));
  const pair = new Map();      // "a|b" -> [agree, shared]
  const loyal = new Map();     // id -> [withParty, counted]
  for (const rc of rollCalls) {
    const vs = (votesByRoll.get(rc.id) || []).filter(v => (v.position === 'yea' || v.position === 'nay') && L.has(v.legislator_id));
    if (vs.length < 10) continue;
    const tally = {};
    for (const v of vs) { const p = L.get(v.legislator_id).party; (tally[p] ||= { yea: 0, nay: 0 })[v.position]++; }
    for (const v of vs) {
      const t = tally[L.get(v.legislator_id).party];
      if (t.yea === t.nay) continue;
      const l = loyal.get(v.legislator_id) || [0, 0];
      l[1]++; if ((t.yea > t.nay ? 'yea' : 'nay') === v.position) l[0]++;
      loyal.set(v.legislator_id, l);
    }
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const a = vs[i], b = vs[j]; const k = a.legislator_id < b.legislator_id ? a.legislator_id + '|' + b.legislator_id : b.legislator_id + '|' + a.legislator_id;
      const p = pair.get(k) || [0, 0]; p[1]++; if (a.position === b.position) p[0]++; pair.set(k, p);
    }
  }
  const per = new Map();
  for (const [k, [agree, shared]] of pair) {
    if (shared < 25) continue;
    const [a, b] = k.split('|'); const pct = Math.round(100 * agree / shared);
    (per.get(a) || per.set(a, []).get(a)).push([b, pct, shared]);
    (per.get(b) || per.set(b, []).get(b)).push([a, pct, shared]);
  }
  const out = {};
  for (const [id, list] of per) {
    const me = L.get(id); list.sort((x, y) => y[1] - x[1] || y[2] - x[2]);
    const cross = list.filter(x => L.get(x[0]).party !== me.party);
    const own = list.filter(x => L.get(x[0]).party === me.party);
    const lo = loyal.get(id) || [0, 0];
    out[id] = { n: lo[1], loyal: lo[1] ? Math.round(100 * lo[0] / lo[1]) : null, alike: list.slice(0, 6), cross: cross.slice(0, 4), unlikeOwn: own.slice(-3).reverse() };
  }
  return out;
}

async function buildVotes() {
  console.log('Votes: roll calls…');
  const legs = await sbAll('legislators?select=id,name,party,chamber&order=id');
  const rolls = await sbAll('roll_calls?select=id,chamber,yea,nay&order=id');
  const contested = rolls.filter(r => { const t = (r.yea || 0) + (r.nay || 0); return t >= 10 && Math.min(r.yea || 0, r.nay || 0) / t >= 0.1; });
  console.log(`  ${rolls.length} roll calls, ${contested.length} contested`);
  const chunks = []; for (let i = 0; i < contested.length; i += 6) chunks.push(contested.slice(i, i + 6));
  const votesByRoll = new Map(); let done = 0;
  await pool(chunks, 8, async (ch) => {
    const rows = await sb(`votes?select=roll_call_id,legislator_id,position&roll_call_id=in.(${ch.map(r => r.id).join(',')})`, [0, 999]);
    for (const v of rows) (votesByRoll.get(v.roll_call_id) || votesByRoll.set(v.roll_call_id, []).get(v.roll_call_id)).push(v);
    if (++done % 40 === 0) console.log(`  ${done}/${chunks.length} batches`);
  });
  const members = alignment(contested, votesByRoll, legs);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(new URL('votes.json', OUT), JSON.stringify({ generated: new Date().toISOString(), contested: contested.length, members }));
  console.log(`Wrote data/votes.json: ${Object.keys(members).length} members compared on ${contested.length} contested votes`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => { if (only('--mga')) await buildMga(); if (only('--votes')) await buildVotes(); })().catch(e => { console.error(e); process.exit(1); });
}
