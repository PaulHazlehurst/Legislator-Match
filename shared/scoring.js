// ─────────────────────────────────────────────────────────────────────────────
// SCORING v2 — computed in the browser from raw bills + sponsorships, so every
// number on screen can be traced back to bills, and tuning a weight below is
// a one-line change with no SQL to re-run.
//
// Two questions, two scores (0–100), one blend:
//
//   WILLINGNESS   "Will they carry a bill on this?"
//     effort  = Σ weight(led bills) + min(0.2 × Σ weight(co-sponsored), ½·led + 1)
//               (co-sponsoring is cheap in Annapolis: it can amplify a record of
//               leading bills, never replace one — co-sponsor-only tops out ≈ 33)
//     weight  = recency × significance × topic match
//               recency      latest session 1.0 · prior 0.85 · two back 0.7
//               significance substantive 1 · procedural 0.5 · local 0.4 · ceremonial 0.15
//               topic match  primary topic 1 · secondary topic 0.5
//               (+50% when it matches the subtopic you picked)
//     W       = 100 · effort / (effort + 2) + focus bonus (≤ 6) when this area is
//               a big share of what they lead. Never saturates, so the most
//               active members stay distinguishable: 1 led bill ≈ 33, 2 ≈ 50,
//               4 ≈ 67, 8 ≈ 80, 20 ≈ 91.
//
//   EFFECTIVENESS "If they carry it, can they pass it?"
//     credit  per bill they LED in a completed session:
//               became law 1 · its cross-filed companion became law 1 ·
//               passed its first chamber 0.35 · died 0
//     rate    = their record, shrunk toward the chamber average (Bayesian,
//               6 bills of prior) so a 1-for-1 rookie isn't "100%"; then the
//               topic rate is shrunk toward their overall rate (4 bills of prior)
//     expect  = 0.83·rate + 0.10·(in majority)        ← fitted on 2024–25 → 2026
//     E       = 100 · Φ(z), z = how far `expect` sits above the average member
//               (in standard deviations), + chair / vice-chair / leadership
//               bonuses when committee data exists. E 50 = a typical member;
//               E 84 = one standard deviation better at getting bills enacted.
//     Validation: a member's 2024–25 record correlates 0.61 with their 2026
//     results (R² 0.41 with majority status) — real predictive signal.
//
//   CHAMPION = √(W × E). A lopsided profile can't top the list.
// ─────────────────────────────────────────────────────────────────────────────

export const SCORING_VERSION = 'v2.0';

export const WEIGHTS = {
  recency: [1.0, 0.85, 0.7],                     // by session age (0 = latest)
  significance: { substantive: 1, procedural: 0.5, local: 0.4, ceremonial: 0.15 },
  secondaryTopic: 0.5,
  subtopicBoost: 1.5,
  cosponsor: 0.2,
  willingK: 2,
  focusMax: 6,
  credit: { passed: 1, companionPassed: 1, passedChamber: 0.35, died: 0 },
  priorOverall: 6,
  priorTopic: 4,
  fit: { intercept: -0.009, rate: 0.83, majority: 0.10 },
  power: { chair: 8, vice: 4, leadership: 6 },
};

// Maryland's session runs January–April; outcomes (including vetoes) are
// final by June. Before then, the current session's bills are "in flight".
export function sessionConcluded(year, now = new Date()) {
  return year < now.getFullYear() || (year === now.getFullYear() && now.getMonth() >= 5);
}

const norm = s => String(s || '').toLowerCase().replace(/[\s–—-]+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();

// ── index: everything the scores need, built once per page load ─────────────
// bills:        [{ id, bill_number, title, outcome, status_stage, significance,
//                  topic, subtopic, secondary, year }]   (topic codes, not ids)
// sponsorships: [{ bill_id, legislator_id, role: 'primary'|'cosponsor' }]
// legislators:  [{ id, name, party, chamber, district }]
// power:        { [legislator_id]: { chair, vice, leadership } }
// majority:     { house: 'D', senate: 'D' }
export function buildIndex({ bills, sponsorships, legislators, power = {}, majority = { house: 'D', senate: 'D' }, now = new Date() }) {
  const years = [...new Set(bills.map(b => b.year).filter(Boolean))].sort((a, b) => b - a);
  const recencyOf = y => WEIGHTS.recency[Math.max(0, years.indexOf(y))] ?? WEIGHTS.recency.at(-1);

  // cross-filed companions: same session, same title, opposite chamber
  const groups = new Map();
  for (const b of bills) {
    const k = b.year + '|' + norm(b.title);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  const billById = new Map();
  for (const b of bills) {
    const sibs = groups.get(b.year + '|' + norm(b.title)).filter(x => x.id !== b.id && chamberOf(x) !== chamberOf(b));
    const companionPassed = sibs.some(x => x.outcome === 'passed');
    const concluded = sessionConcluded(b.year, now);
    let credit = null, result;
    if (b.outcome === 'passed') { credit = WEIGHTS.credit.passed; result = 'law'; }
    else if (companionPassed) { credit = WEIGHTS.credit.companionPassed; result = 'law-companion'; }
    else if (b.outcome === 'failed' && b.status_stage === 'vetoed') { credit = 0; result = 'vetoed'; }
    else if (!concluded) { credit = null; result = 'in-flight'; }
    else if (b.status_stage === 'on_floor' || b.status_stage === 'advancing') { credit = WEIGHTS.credit.passedChamber; result = 'passed-chamber'; }
    else { credit = WEIGHTS.credit.died; result = 'died'; }
    billById.set(b.id, {
      ...b, companions: sibs.map(x => x.id), companionPassed, credit, result, concluded,
      w: recencyOf(b.year) * (WEIGHTS.significance[b.significance] ?? 1),
    });
  }

  const legById = new Map(legislators.map(l => [l.id, { ...l, led: [], co: [] }]));
  for (const s of sponsorships) {
    const l = legById.get(s.legislator_id), b = billById.get(s.bill_id);
    if (!l || !b) continue;
    (s.role === 'cosponsor' ? l.co : l.led).push(b);
  }

  // overall track record → expected passage rate → percentile
  const scored = (b) => b.credit !== null && b.significance !== 'ceremonial';
  const chamberBase = {};
  for (const ch of ['house', 'senate']) {
    const cs = [...legById.values()].filter(l => l.chamber === ch).flatMap(l => l.led.filter(scored).map(b => b.credit));
    chamberBase[ch] = cs.length ? cs.reduce((a, c) => a + c, 0) / cs.length : 0.38;
  }
  for (const l of legById.values()) {
    const rec = l.led.filter(scored);
    const base = chamberBase[l.chamber] ?? 0.38;
    l.record = { n: rec.length, credit: rec.reduce((a, b) => a + b.credit, 0),
      laws: rec.filter(b => b.result === 'law' || b.result === 'law-companion').length };
    l.rate = (l.record.credit + WEIGHTS.priorOverall * base) / (l.record.n + WEIGHTS.priorOverall);
    l.inMajority = !!l.party && majority[l.chamber] === l.party;
    l.power = power[l.id] || {};
    l.expect = expected(l.rate, l.inMajority);
    l.ledWeight = l.led.reduce((a, b) => a + b.w, 0);
  }
  const expects = [...legById.values()].map(l => l.expect);
  const mean = expects.reduce((a, b) => a + b, 0) / (expects.length || 1);
  const sd = Math.sqrt(expects.reduce((a, b) => a + (b - mean) ** 2, 0) / (expects.length || 1)) || 0.1;
  return { billById, legById, years, chamberBase, expectDist: { mean, sd }, now };
}

const chamberOf = b => /^S/i.test(b.bill_number || '') ? 'senate' : 'house';
const expected = (rate, maj) => WEIGHTS.fit.intercept + WEIGHTS.fit.rate * rate + WEIGHTS.fit.majority * (maj ? 1 : 0);

// standard normal CDF (Abramowitz–Stegun 7.1.26), |error| < 1.5e-7
function phi(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
export const effectivenessOf = (index, expect) => 100 * phi((expect - index.expectDist.mean) / index.expectDist.sd);

function percentile(sorted, v) {
  if (!sorted.length) return 50;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
  let eq = lo; while (eq < sorted.length && sorted[eq] === v) eq++;
  return Math.round(100 * ((lo + eq) / 2) / sorted.length);
}
const clamp = v => Math.max(0, Math.min(100, Math.round(v)));

// ── per-topic scores ─────────────────────────────────────────────────────────
// Returns one row per legislator with any activity on the topic, sorted by
// champion score. Every row carries the bills and a breakdown for the UI.
export function scoreTopic(index, topic, { subtopic = null } = {}) {
  const rows = [];
  for (const l of index.legById.values()) {
    const match = b => {
      if (b.topic === topic) return 1;
      if (b.secondary === topic) return WEIGHTS.secondaryTopic;
      return 0;
    };
    const sub = b => (subtopic && b.topic === topic && b.subtopic === subtopic ? WEIGHTS.subtopicBoost : 1);
    const led = l.led.filter(b => match(b) > 0), co = l.co.filter(b => match(b) > 0);
    if (!led.length && !co.length) continue;
    if (subtopic && ![...led, ...co].some(b => b.topic === topic && b.subtopic === subtopic)) continue;

    const ledW = led.reduce((a, b) => a + b.w * match(b) * sub(b), 0);
    const coW = co.reduce((a, b) => a + b.w * match(b) * sub(b), 0);
    const coContribution = Math.min(WEIGHTS.cosponsor * coW, 0.5 * ledW + 1);
    const effort = ledW + coContribution;
    const focusShare = l.ledWeight ? ledW / l.ledWeight : 0;
    const focus = led.length ? Math.min(WEIGHTS.focusMax, WEIGHTS.focusMax * focusShare / 0.25) : 0;
    const willingness = clamp(100 * effort / (effort + WEIGHTS.willingK) + focus);

    // topic record shrunk toward their overall record
    const tRec = led.filter(b => b.credit !== null && b.significance !== 'ceremonial');
    const tCredit = tRec.reduce((a, b) => a + b.credit * match(b), 0);
    const tN = tRec.reduce((a, b) => a + match(b), 0);
    const topicRate = (tCredit + WEIGHTS.priorTopic * l.rate) / (tN + WEIGHTS.priorTopic);
    const expect = expected(topicRate, l.inMajority);
    const base = Math.round(effectivenessOf(index, expect));
    const pw = (l.power.chair ? WEIGHTS.power.chair : l.power.vice ? WEIGHTS.power.vice : 0) + (l.power.leadership ? WEIGHTS.power.leadership : 0);
    const effectiveness = clamp(base + pw);
    const champion = Math.round(Math.sqrt(willingness * effectiveness));

    const laws = tRec.filter(b => b.result === 'law' || b.result === 'law-companion');
    rows.push({
      legislator_id: l.id, name: l.name, party: l.party, chamber: l.chamber, district: l.district,
      willingness, effectiveness, champion,
      bills_led: led.length, bills_cosponsored: co.length,
      led_primary: led.filter(b => b.topic === topic).length,
      decided: tRec.length, laws: laws.length,
      laws_via_companion: laws.filter(b => b.result === 'law-companion').length,
      passed_chamber: tRec.filter(b => b.result === 'passed-chamber').length,
      in_flight: led.filter(b => b.result === 'in-flight').length,
      latest_year: Math.max(...[...led, ...co].map(b => b.year || 0)),
      in_majority: l.inMajority, power: l.power,
      overall: { led: l.record.n, laws: l.record.laws, rate: l.rate },
      expected_rate: expect,
      quality: tRec.length >= 4 && led.length >= 3 ? 'solid' : led.length >= 1 ? 'thin' : 'minimal',
      breakdown: {
        effort: +effort.toFixed(2), ledWeight: +ledW.toFixed(2), coWeight: +coW.toFixed(2), coContribution: +coContribution.toFixed(2), focus: Math.round(focus),
        topicRate: +topicRate.toFixed(3), overallRate: +l.rate.toFixed(3), chamberBase: +(index.chamberBase[l.chamber] || 0).toFixed(3),
        percentile: base, power: pw,
      },
      bills: { led, co },
    });
  }
  rows.sort((a, b) => b.champion - a.champion || b.willingness - a.willingness);
  rows.forEach((r, i) => { r.rank = i + 1; r.total = rows.length; });
  // relative (within this topic) versions for the "relative" toggle
  const relW = rows.map(r => r.willingness).sort((a, b) => a - b);
  const relE = rows.map(r => r.effectiveness).sort((a, b) => a - b);
  for (const r of rows) {
    r.rel_willingness = percentile(relW, r.willingness);
    r.rel_effectiveness = percentile(relE, r.effectiveness);
    r.rel_champion = Math.round(Math.sqrt(r.rel_willingness * r.rel_effectiveness));
  }
  return rows;
}

// A legislator's profile across all topics (for the detail drawer + directory).
export function legislatorProfile(index, legislatorId, topicCodes) {
  const out = [];
  for (const t of topicCodes) {
    const r = scoreTopic(index, t).find(x => x.legislator_id === legislatorId);
    if (r) out.push({ topic: t, ...r });
  }
  return out.sort((a, b) => b.champion - a.champion);
}

// Every member's profile at once: one scoreTopic per topic, not per member.
export function allProfiles(index, topicCodes) {
  const out = new Map();
  for (const t of topicCodes) for (const r of scoreTopic(index, t)) {
    if (!out.has(r.legislator_id)) out.set(r.legislator_id, []);
    out.get(r.legislator_id).push({ topic: t, ...r });
  }
  for (const list of out.values()) list.sort((a, b) => b.champion - a.champion);
  return out;
}

// Topic-wide statistics for the Insights tab.
export function topicStats(index, topic) {
  const bills = [...index.billById.values()].filter(b => b.topic === topic);
  const done = bills.filter(b => b.credit !== null && b.significance === 'substantive');
  const laws = done.filter(b => b.result === 'law' || b.result === 'law-companion');
  return { bills: bills.length, decided: done.length, laws: laws.length, rate: done.length ? laws.length / done.length : null };
}
