import { STATE } from '../store.js';
import { scoreTopic } from '../../shared/scoring.js';
import { $, esc, pct, num, sparkline, partyChip, topicLabel, on, bar } from '../ui.js';
import { openLegislator } from './legislator.js';

let computed = null, sortKey = 'bills', sortDir = -1;

function compute() {
  const bills = [...STATE.index.billById.values()];
  const spBy = new Map();
  for (const s of STATE.sponsorships) { if (!spBy.has(s.bill_id)) spBy.set(s.bill_id, []); spBy.get(s.bill_id).push(s); }
  const isLaw = b => b.result === 'law' || b.result === 'law-companion';
  const decided = bills.filter(b => b.credit !== null && b.significance === 'substantive');
  const rate = arr => arr.length ? arr.filter(isLaw).length / arr.length : null;
  const info = b => {
    const sp = spBy.get(b.id) || [];
    const lead = sp.find(s => s.role !== 'cosponsor'), leadL = lead && STATE.index.legById.get(lead.legislator_id);
    const parties = new Set(sp.map(s => STATE.legById[s.legislator_id]?.party).filter(Boolean));
    return { lead: leadL, cos: sp.filter(s => s.role === 'cosponsor').length, bipartisan: parties.has('D') && parties.has('R') };
  };
  const I = new Map(decided.map(b => [b.id, info(b)]));
  const split = (label, pred, a, b) => {
    const yes = decided.filter(x => pred(x, I.get(x.id)) === true), no = decided.filter(x => pred(x, I.get(x.id)) === false);
    return { label, rows: [[a, rate(yes), yes.length], [b, rate(no), no.length]] };
  };
  const drivers = [
    split('Cross-filed in both chambers', b => b.companions.length > 0, 'Cross-filed', 'Filed in one chamber'),
    split('Co-sponsors from both parties', (b, i) => i.cos + (i.lead ? 1 : 0) > 1 ? i.bipartisan : undefined, 'Bipartisan', 'One party only'),
    split('Lead sponsor in the majority party', (b, i) => i.lead ? i.lead.inMajority : undefined, 'Majority-party lead', 'Minority-party lead'),
    split('Chamber of origin', b => b.chamber === 'senate', 'Senate bill', 'House bill'),
    { label: 'Size of the co-sponsor coalition', rows: [[0, 0], [1, 4], [5, 19], [20, 999]].map(([lo, hi]) => {
      const xs = decided.filter(b => { const c = I.get(b.id).cos; return c >= lo && c <= hi; });
      return [hi === 0 ? 'No co-sponsors' : hi === 999 ? `${lo} or more` : `${lo}–${hi} co-sponsors`, rate(xs), xs.length];
    }) },
  ];

  const years = STATE.index.years.slice().sort();
  const funnel = years.map(y => {
    const xs = bills.filter(b => b.year === y);
    return { y, filed: xs.length, chamber: xs.filter(b => ['on_floor', 'advancing', 'passed', 'vetoed'].includes(b.status_stage)).length,
      law: xs.filter(b => b.outcome === 'passed').length, inFlight: xs.some(b => b.result === 'in-flight') };
  });

  const areas = STATE.topics.filter(t => !t.legacy).map(t => {
    const xs = bills.filter(b => b.topic === t.code);
    if (!xs.length) return null;
    const d = decided.filter(b => b.topic === t.code);
    const bip = d.filter(b => I.get(b.id).bipartisan).length;
    const top = scoreTopic(STATE.index, t.code)[0];
    return { code: t.code, label: t.label, bills: xs.length, perYear: years.map(y => xs.filter(b => b.year === y).length),
      enacted: rate(d), bipartisan: d.length ? bip / d.length : null, local: xs.filter(b => b.significance === 'local').length / xs.length, top };
  }).filter(Boolean);

  const L = [...STATE.index.legById.values()];
  const coBills = new Map(); for (const s of STATE.sponsorships) if (s.role === 'cosponsor') coBills.set(s.legislator_id, (coBills.get(s.legislator_id) || 0) + 1);
  const crossShare = l => {
    const led = l.led.filter(b => b.significance !== 'ceremonial');
    if (led.length < 8) return null;
    return led.filter(b => (spBy.get(b.id) || []).some(s => STATE.legById[s.legislator_id]?.party && STATE.legById[s.legislator_id].party !== l.party)).length / led.length;
  };
  const boards = [
    { title: 'Most laws enacted', note: 'Bills they led that became law, completed sessions, counting cross-filed companions', rows: L.map(l => [l, l.record.laws, `${l.record.laws} of ${l.record.n}`]).sort((a, b) => b[1] - a[1]).slice(0, 8) },
    { title: 'Best passage record', note: 'Expected passage rate, at least 10 bills led', rows: L.filter(l => l.record.n >= 10).map(l => [l, l.expect, pct(l.expect)]).sort((a, b) => b[1] - a[1]).slice(0, 8) },
    { title: 'Coalition builders', note: 'Share of the bills they lead with a co-sponsor from the other party, at least 8 bills', rows: L.map(l => [l, crossShare(l)]).filter(r => r[1] != null).map(r => [...r, pct(r[1])]).sort((a, b) => b[1] - a[1]).slice(0, 8) },
    { title: 'Most active co-sponsors', note: 'Bills co-sponsored across all sessions', rows: L.map(l => [l, coBills.get(l.id) || 0, num(coBills.get(l.id) || 0)]).sort((a, b) => b[1] - a[1]).slice(0, 8) },
  ];

  const conf = { high: 0, medium: 0, low: 0, none: 0 };
  for (const b of bills) conf[b.topic ? (b.confidence || 'none') : 'none'] = (conf[b.topic ? (b.confidence || 'none') : 'none'] || 0) + 1;
  return { bills, decided, rate, isLaw, drivers, funnel, areas, boards, conf, years };
}

export function renderInsights() {
  computed ||= compute();
  const c = computed;
  const laws = c.bills.filter(b => b.outcome === 'passed').length;
  const cross = c.bills.filter(b => b.companions.length).length;
  $('s-kpis').innerHTML = [
    [num(c.bills.length), `bills filed, ${c.years[0]}–${c.years.at(-1)}`],
    [num(laws), 'became law'],
    [pct(c.rate(c.decided)), 'of substantive bills in completed sessions became law, counting companions'],
    [pct(cross / c.bills.length), 'were cross-filed in both chambers'],
    [num(STATE.legislators.length), 'current members tracked'],
  ].map(([n, l]) => `<div class="kpi"><b>${n}</b><span>${l}</span></div>`).join('');

  const maxR = Math.max(...c.drivers.flatMap(d => d.rows.map(r => r[1] || 0)), 0.01);
  $('s-drivers').innerHTML = c.drivers.map(d => `<div class="drv"><h4>${esc(d.label)}</h4>${d.rows.map(([l, r, n], i) => `
      <div class="drv-row" title="${esc(l)}: ${pct(r, 1)} of ${num(n)} bills became law"><span class="drv-l">${esc(l)}</span>${bar(r || 0, d.rows.length === 2 ? (i === 0 ? 'e' : 'n') : 'w', maxR)}<span class="drv-v">${pct(r)}</span><span class="drv-n">${num(n)}</span></div>`).join('')}</div>`).join('');

  const fmax = Math.max(...c.funnel.map(f => f.filed));
  $('s-funnel').innerHTML = `<div class="funnel">${c.funnel.map(f => `<div class="fy"><h4>${f.y}${f.inFlight ? ' <span class="muted">(in progress)</span>' : ''}</h4>
    ${[['Filed', f.filed, 'n'], ['Passed one chamber', f.chamber, 'w'], ['Became law', f.law, 'e']].map(([l, v, k]) => `<div class="drv-row" title="${l}: ${num(v)}"><span class="drv-l">${l}</span>${bar(v, k, fmax)}<span class="drv-v">${num(v)}</span><span class="drv-n">${pct(v / f.filed)}</span></div>`).join('')}</div>`).join('')}</div>`;

  renderAreas();

  $('s-boards').innerHTML = c.boards.map(b => `<section class="board"><h4>${esc(b.title)}</h4><p class="fine">${esc(b.note)}</p><ol>${b.rows.map(([l, , v]) => `<li><button class="linkish" data-leg="${l.id}">${partyChip(l.party)} ${esc(l.name)}</button><span class="bv">${v}</span></li>`).join('')}</ol></section>`).join('');

  const tot = c.bills.length, m = STATE.classifierMix;
  $('s-quality').innerHTML = `<div class="stackbar" role="img" aria-label="Classification confidence">${[['high', 'e'], ['medium', 'w'], ['low', 'n'], ['none', 'x']].map(([k, cls]) => c.conf[k] ? `<span class="sb-${cls}" style="flex:${c.conf[k]}" title="${k}: ${num(c.conf[k])}"></span>` : '').join('')}</div>
    <p class="legend-row">${[['high', 'e', 'High confidence'], ['medium', 'w', 'Medium'], ['low', 'n', 'Low'], ['none', 'x', 'Unclassified']].map(([k, cls, l]) => `<span class="lg"><i class="sb-${cls}"></i>${l} ${pct(c.conf[k] / tot)}</span>`).join('')}</p>
    <p class="fine">${num(m.manual || 0)} fixed by colleagues, ${num(m.ai_review || 0)} AI-reviewed, ${num(m.rules_v2 || 0)} by rules v2${(m.legiscan_subject || m.subject_keyword || m.gemini) ? `, ${num((m.legiscan_subject || 0) + (m.subject_keyword || 0) + (m.gemini || 0))} still on the old v1 classifier` : ''}. On 150 hand-checked bills the v2 rules pick the right area 88% of the time, and the right area or its listed secondary 97%. <a href="#/bills" data-review>Review the uncertain ones</a>.</p>`;
}

function renderAreas() {
  const c = computed;
  const rows = c.areas.slice().sort((a, b) => {
    const k = { bills: 'bills', enacted: 'enacted', bipartisan: 'bipartisan', label: 'label' }[sortKey];
    return (k === 'label' ? a.label.localeCompare(b.label) : (a[k] ?? -1) - (b[k] ?? -1)) * (k === 'label' ? -sortDir : sortDir);
  });
  const th = (k, l, cls = '') => `<th scope="col" class="${cls}"><button class="sort ${sortKey === k ? 'on' : ''}" data-sort="${k}" aria-sort="${sortKey === k ? (sortDir < 0 ? 'descending' : 'ascending') : 'none'}">${l}</button></th>`;
  $('s-areas').innerHTML = `<table class="areas-t"><thead><tr>${th('label', 'Policy area')}${th('bills', 'Bills', 'r')}<th scope="col">${c.years.join('–')}</th>${th('enacted', 'Became law')}${th('bipartisan', 'Bipartisan')}<th scope="col">Strongest champion</th></tr></thead><tbody>
    ${rows.map(a => `<tr><th scope="row"><a href="#/champions/${a.code}">${esc(a.label)}</a></th><td class="r">${num(a.bills)}</td><td>${sparkline(a.perYear)}</td>
      <td class="bc">${bar(a.enacted || 0, 'e')}<span>${pct(a.enacted)}</span></td><td class="bc">${bar(a.bipartisan || 0, 'w')}<span>${pct(a.bipartisan)}</span></td>
      <td>${a.top ? `<button class="linkish" data-leg="${a.top.legislator_id}" data-topic="${a.code}">${partyChip(a.top.party)} ${esc(a.top.name)}</button>` : '—'}</td></tr>`).join('')}</tbody></table>`;
}

export function setupInsights() {
  on($('view-insights'), 'click', '[data-sort]', el => { const k = el.dataset.sort; sortDir = sortKey === k ? -sortDir : -1; sortKey = k; renderAreas(); });
  on($('view-insights'), 'click', '[data-leg]', el => openLegislator(el.dataset.leg, el.dataset.topic || null));
  on($('view-insights'), 'click', '[data-review]', () => { setTimeout(() => { $('b-review').checked = true; $('b-review').dispatchEvent(new Event('input')); }, 50); });
}
export function invalidateInsights() { computed = null; }
