// Loads the legislature once, normalises it, and builds the scoring index.
// Everything else in the app reads from STATE.
import { select, selectAll } from './api.js';
import { TOPICS as TAXONOMY } from '../shared/taxonomy.js';
import { buildIndex } from '../shared/scoring.js';

export const STATE = {
  sessions: [], topics: [], topicByCode: {}, topicById: {}, subtopicById: {},
  legislators: [], legById: {}, bills: [], billById: {}, sponsorships: [], sponsorsByBill: new Map(),
  index: null, hasSecondary: false, committees: [], committeeByCode: {}, people: {}, seats: {}, votes: null, mgaDate: null, classifierMix: {}, loadedAt: null,
};

const CACHE_KEY = 'pinnacle_cache_v2';
const CACHE_TTL = 30 * 60 * 1000;

function readCache() {
  try {
    const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    return c && Date.now() - c.t < CACHE_TTL ? c : null;
  } catch (_) { return null; }
}
function writeCache(raw) {
  // Sponsorships are the bulk; store them as index triples to fit the quota.
  try {
    const billIdx = new Map(raw.bills.map((b, i) => [b.id, i]));
    const legIdx = new Map(raw.legislators.map((l, i) => [l.id, i]));
    const sp = raw.sponsorships.map(s => [billIdx.get(s.bill_id), legIdx.get(s.legislator_id), s.role === 'cosponsor' ? 1 : 0])
      .filter(x => x[0] !== undefined && x[1] !== undefined);
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), ...raw, sponsorships: sp }));
  } catch (_) { /* quota or private mode — the app works without the cache */ }
}
function unpackCache(c) {
  return { ...c, sponsorships: c.sponsorships.map(([b, l, r]) => ({ bill_id: c.bills[b].id, legislator_id: c.legislators[l].id, role: r ? 'cosponsor' : 'primary' })) };
}

async function fetchRaw(onProgress) {
  const billCols = 'id,bill_number,title,outcome,status_stage,significance,topic_id,subtopic_id,session_id,classified_by,classification_confidence';
  let hasSecondary = true;
  const billsP = selectAll('bills', `select=${billCols},secondary_topic_id&order=id`, { onProgress: (d, t) => onProgress?.('bills', d, t) })
    .catch(e => { if (e.code === '42703') { hasSecondary = false; return selectAll('bills', `select=${billCols}&order=id`); } throw e; });
  const [sessions, topics, subtopics, legislators, bills, sponsorships, memberships, leadership] = await Promise.all([
    select('sessions', 'select=id,name,year_end,is_current'),
    select('topics', 'select=id,code,label'),
    select('subtopics', 'select=id,code,label,topic_id'),
    selectAll('legislators', 'select=id,name,party,chamber,district&order=name'),
    billsP,
    selectAll('sponsorships', 'select=bill_id,legislator_id,role&order=bill_id', { onProgress: (d, t) => onProgress?.('sponsorships', d, t) }),
    select('committee_memberships', 'select=legislator_id,role,committees(name)').catch(() => []),
    select('leadership_positions', 'select=legislator_id,role').catch(() => []),
  ]);
  return { sessions, topics, subtopics, legislators, bills, sponsorships, memberships, leadership, hasSecondary };
}

// Static files built by ingest/build-data.js. The app works without them
// (no committees, title-matched companions), so failures are tolerated.
const staticJson = (f) => fetch(`data/${f}`).then(r => r.ok ? r.json() : null).catch(() => null);

export async function loadAll({ onProgress, force = false } = {}) {
  const cached = !force && readCache();
  const [raw, mga, votes] = await Promise.all([cached ? unpackCache(cached) : fetchRaw(onProgress), staticJson('mga.json'), staticJson('votes.json')]);
  if (!cached) writeCache(raw);
  normalise(raw, mga);
  STATE.votes = votes?.members || null; STATE.votesMeta = votes ? { contested: votes.contested, generated: votes.generated } : null;
  return STATE;
}

export const committeeName = (code) => STATE.committeeByCode[code]?.name || null;

function normalise(raw, mga) {
  const yearBySession = Object.fromEntries(raw.sessions.map(s => [s.id, s.year_end]));
  STATE.sessions = raw.sessions.slice().sort((a, b) => a.year_end - b.year_end);
  STATE.hasSecondary = raw.hasSecondary;

  // Topics: taxonomy order and wording, ids from the database.
  const dbByCode = Object.fromEntries(raw.topics.map(t => [t.code, t]));
  STATE.topicById = {};
  STATE.topics = [];
  for (const t of TAXONOMY) {
    const db = dbByCode[t.code];
    const topic = { code: t.code, label: t.label, id: db?.id || null, includes: t.includes, subtopics: t.subtopics.map(([code, label, guidance]) => ({ code, label, guidance })) };
    STATE.topics.push(topic);
    if (db) STATE.topicById[db.id] = topic;
  }
  for (const db of raw.topics) if (!STATE.topicById[db.id]) {     // codes in the DB the taxonomy no longer has
    const topic = { code: db.code, label: db.label, id: db.id, subtopics: [], legacy: true };
    STATE.topics.push(topic); STATE.topicById[db.id] = topic;
  }
  STATE.topicByCode = Object.fromEntries(STATE.topics.map(t => [t.code, t]));
  STATE.subtopicById = Object.fromEntries(raw.subtopics.map(s => [s.id, s.code]));

  STATE.legislators = raw.legislators;
  STATE.legById = Object.fromEntries(raw.legislators.map(l => [l.id, l]));

  STATE.classifierMix = {};
  STATE.bills = raw.bills.map(b => {
    STATE.classifierMix[b.classified_by || 'unclassified'] = (STATE.classifierMix[b.classified_by || 'unclassified'] || 0) + 1;
    return {
      id: b.id, bill_number: b.bill_number, title: b.title, outcome: b.outcome, status_stage: b.status_stage,
      significance: b.significance || 'substantive',
      topic: STATE.topicById[b.topic_id]?.code || null,
      subtopic: STATE.subtopicById[b.subtopic_id] || null,
      secondary: b.secondary_topic_id ? STATE.topicById[b.secondary_topic_id]?.code || null : null,
      year: yearBySession[b.session_id], session_id: b.session_id,
      classified_by: b.classified_by, confidence: b.classification_confidence,
      chamber: /^S/i.test(b.bill_number || '') ? 'senate' : 'house',
      ...officialRecord(mga, yearBySession[b.session_id], b.bill_number),
    };
  });
  STATE.sponsorships = raw.sponsorships;
  STATE.sponsorsByBill = new Map();
  for (const s of raw.sponsorships) { if (!STATE.sponsorsByBill.has(s.bill_id)) STATE.sponsorsByBill.set(s.bill_id, []); STATE.sponsorsByBill.get(s.bill_id).push(s); }

  // committees, seats and leadership from the official record
  STATE.committees = (mga?.committees || []).filter(c => !c.former);
  STATE.committeeByCode = Object.fromEntries((mga?.committees || []).map(c => [c.code, c]));
  STATE.people = mga?.people || {};
  STATE.mgaDate = mga?.generated || null;
  const power = {};
  for (const c of STATE.committees) {
    if (/^(sru|hru|exn)$/.test(c.code)) continue;                 // Rules / Nominations seats don't move policy bills
    for (const id of c.members) (power[id] ||= { seats: {} }).seats[c.code] = 'member';
    if (c.chair) (power[c.chair] ||= { seats: {} }).seats[c.code] = 'chair';
    if (c.vice) (power[c.vice] ||= { seats: {} }).seats[c.code] = 'vice';
  }
  for (const [id, p] of Object.entries(STATE.people)) {
    const posts = p.leadership || []; if (!posts.length) continue;
    const e = power[id] ||= { seats: {} };
    e.posts = posts; e.top = posts.some(x => !/^(deputy|assistant|chief deputy)/i.test(x));
  }
  STATE.seats = power;

  STATE.index = buildIndex({ bills: STATE.bills, sponsorships: STATE.sponsorships, legislators: STATE.legislators, power });
  STATE.billById = Object.fromEntries([...STATE.index.billById.values()].map(b => [b.id, b]));
  STATE.loadedAt = new Date();
}

function officialRecord(mga, year, number) {
  const r = mga?.bills?.[`${year}:${number}`];
  if (!r) return {};
  return { stage: r.s, end: r.e || null, xfile: r.x || null, committee: r.c || null, committee2: r.c2 || null, oppCommittee: r.o || null, hearing: r.h || null, chapter: r.ch || null };
}

// Is the database already on the v2 classifier? (Drives an admin banner.)
export function classificationUpgraded() {
  const m = STATE.classifierMix;
  return (m.rules_v2 || 0) + (m.ai_review || 0) + (m.manual || 0) > STATE.bills.length * 0.5;
}

export function topicCounts() {
  const c = {};
  for (const b of STATE.bills) if (b.topic) c[b.topic] = (c[b.topic] || 0) + 1;
  return c;
}
