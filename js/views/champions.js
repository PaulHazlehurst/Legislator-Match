import { STATE, topicCounts } from '../store.js';
import { scoreTopic, topicStats } from '../../shared/scoring.js';
import { $, esc, pct, num, dial, partyChip, memberMeta, topicLabel, subtopicLabel, sparkline, on, openModal, toast, downloadCSV, lastName, bar } from '../ui.js';
import { relsFor, STRENGTH, staffColor } from '../relationships.js';
import { openLegislator } from './legislator.js';
import { navigate } from '../router.js';

const S = { topic: null, sub: null, view: 'list', rows: [], picks: new Map() };

// ── landing: the index of policy areas ───────────────────────────────────────
export function renderLanding() {
  const counts = topicCounts();
  const years = STATE.index.years.slice().sort();
  const items = STATE.topics.filter(t => counts[t.code]).map(t => {
    const st = topicStats(STATE.index, t.code);
    const perYear = years.map(y => STATE.bills.filter(b => b.topic === t.code && b.year === y).length);
    const leaders = new Set(STATE.sponsorships.filter(s => s.role !== 'cosponsor' && STATE.billById[s.bill_id]?.topic === t.code).map(s => s.legislator_id)).size;
    return { t, n: counts[t.code], st, perYear, leaders };
  });
  const q = ($('topic-filter')?.value || '').trim().toLowerCase();
  const shown = items.filter(i => !q || i.t.label.toLowerCase().includes(q) || i.t.subtopics.some(s => s.label.toLowerCase().includes(q)));
  $('topic-index').innerHTML = shown.length ? shown.map(i => `
    <a class="ti" href="#/champions/${esc(i.t.code)}">
      <span class="ti-name">${esc(i.t.label)}</span>
      <span class="ti-subs">${i.t.subtopics.slice(0, 4).map(s => esc(s.label)).join(', ')}${i.t.subtopics.length > 4 ? ', …' : ''}</span>
      <span class="ti-stat"><b>${num(i.n)}</b> bills</span>
      <span class="ti-stat"><b>${i.leaders}</b> sponsors</span>
      <span class="ti-stat" title="Substantive bills in completed sessions that became law, counting cross-filed companions"><b>${pct(i.st.rate)}</b> enacted</span>
      <span class="ti-trend" title="Bills filed ${years.join(', ')}: ${i.perYear.join(', ')}">${sparkline(i.perYear)}</span>
    </a>`).join('') : `<p class="empty">No policy area matches “${esc(q)}”. Try a broader word, or open the Proposer to describe your bill.</p>`;
}

// ── results for one topic ────────────────────────────────────────────────────
export function openTopic(code, sub = null) {
  if (!STATE.topicByCode[code]) { navigate('#/champions'); return; }
  S.topic = code; S.sub = sub || null;
  $('finder-landing').hidden = true; $('finder-results').hidden = false;
  $('rtitle').textContent = topicLabel(code);
  renderSubChips();
  renderResults();
}
export function closeTopic() { S.topic = null; $('finder-landing').hidden = false; $('finder-results').hidden = true; renderLanding(); }
export const currentTopic = () => S.topic;

function renderSubChips() {
  const t = STATE.topicByCode[S.topic];
  const all = STATE.bills.filter(b => b.topic === S.topic);
  const chips = [['', 'All', all.length], ...t.subtopics.map(s => [s.code, s.label, all.filter(b => b.subtopic === s.code).length])]
    .filter(([c, , n]) => !c || n > 0);
  $('subchips').innerHTML = chips.length > 1 ? chips.map(([c, l, n]) =>
    `<a class="chip ${((S.sub || '') === c) ? 'on' : ''}" href="#/champions/${esc(S.topic)}${c ? '/' + esc(c) : ''}" aria-current="${(S.sub || '') === c}">${esc(l)} <span>${n}</span></a>`).join('') : '';
}

function filteredRows() {
  const party = $('f-party').value, chamber = $('f-chamber').value, led = $('f-led').checked, warm = $('f-warm').checked;
  const sort = $('f-sort').value, rel = $('f-scale').value === 'rel';
  let rows = scoreTopic(STATE.index, S.topic, { subtopic: S.sub });
  S.all = rows.length;
  rows = rows.filter(r => (!party || r.party === party) && (!chamber || r.chamber === chamber) && (!led || r.bills_led > 0));
  rows.forEach(r => { r.rels = relsFor(r.legislator_id); r.W = rel ? r.rel_willingness : r.willingness; r.E = rel ? r.rel_effectiveness : r.effectiveness; r.C = rel ? r.rel_champion : r.champion; });
  if (warm) rows = rows.filter(r => r.rels.length);
  const key = { champion: r => r.C, willingness: r => r.W, effectiveness: r => r.E, led: r => r.bills_led, laws: r => r.laws, warm: r => (r.rels[0]?.strength || 0) * 1000 + r.C }[sort] || (r => r.C);
  rows.sort((a, b) => key(b) - key(a) || b.C - a.C);
  return rows;
}

export function renderResults() {
  if (!S.topic) return;
  const rows = S.rows = filteredRows();
  const label = S.sub ? subtopicLabel(S.topic, S.sub) : topicLabel(S.topic);
  const st = topicStats(STATE.index, S.topic);
  const leaders = rows.filter(r => r.bills_led > 0).length;
  $('rsummary').innerHTML = rows.length
    ? `${leaders} of ${rows.length} member${rows.length === 1 ? '' : 's'} shown have led a bill on ${esc(label.toLowerCase())}. In completed sessions, ${pct(st.rate)} of substantive bills here became law.`
    : '';
  $('v-list').classList.toggle('on', S.view === 'list'); $('v-map').classList.toggle('on', S.view === 'map');
  if (!rows.length && !STATE.bills.some(b => b.topic === S.topic)) {
    $('results').innerHTML = `<div class="empty"><b>No bills are filed under ${esc(topicLabel(S.topic))} yet.</b><br>This is a new policy area. It fills in once the database is reclassified (see the notice at the top).</div>`;
    return;
  }
  if (!rows.length) {
    $('results').innerHTML = `<div class="empty"><b>No one matches these filters.</b><br>Clear “Led a bill here” or “Our relationships only”, or pick a broader subtopic.</div>`;
    return;
  }
  $('results').innerHTML = S.view === 'map' ? mapView(rows) : `<ol class="champs">${rows.slice(0, 120).map(row).join('')}</ol>${rows.length > 120 ? `<p class="note">Showing the top 120 of ${rows.length}. Export CSV for the full list.</p>` : ''}`;
}

function row(r, i) {
  const picked = S.picks.has(r.legislator_id);
  const badges = [];
  if (r.power.chair) badges.push(`<span class="badge badge-power" title="${esc((r.power.chairOf || []).filter(Boolean).join(', '))}">Committee chair</span>`);
  else if (r.power.vice) badges.push('<span class="badge badge-power">Vice chair</span>');
  if (r.power.leadership) badges.push('<span class="badge badge-power">Leadership</span>');
  if (!r.in_majority) badges.push('<span class="badge badge-minor" title="Minority-party members usually need a majority co-sponsor to move a bill">Minority party</span>');
  if (r.quality !== 'solid') badges.push(`<span class="badge badge-thin" title="Few bills behind these numbers; treat them as directional">${r.quality === 'thin' ? 'Thin record' : 'Co-sponsor only'}</span>`);
  const warm = r.rels.slice(0, 3).map(x => `<span class="warm" style="--c:${staffColor(x.staff)}" title="${esc(STRENGTH[x.strength])}${x.kind ? ', ' + esc(x.kind) : ''}">${esc(x.staff.name)}</span>`).join('');
  const ev = [
    r.bills_led ? `Led <b>${r.bills_led}</b> bill${r.bills_led === 1 ? '' : 's'}` : '<b>Never led</b> a bill here',
    r.decided ? `<b>${r.laws}</b> of ${r.decided} became law${r.laws_via_companion ? ` (${r.laws_via_companion} via companion)` : ''}` : null,
    r.bills_cosponsored ? `co-sponsored ${r.bills_cosponsored}` : null,
    r.in_flight ? `${r.in_flight} in progress` : null,
  ].filter(Boolean).join('<span class="sep">, </span>');
  return `<li class="champ" data-id="${r.legislator_id}" style="--i:${Math.min(i, 12)}">
    <span class="rank">${i + 1}</span>
    <button class="who" data-open="${r.legislator_id}">
      <span class="nm">${esc(r.name)}</span>
      <span class="meta">${partyChip(r.party)} ${esc(memberMeta(r))}</span>
      <span class="ev">${ev}</span>
      ${badges.length || warm ? `<span class="badges">${warm ? `<span class="warm-lead">Knows them:</span>${warm}` : ''}${badges.join('')}</span>` : ''}
    </button>
    ${dial(r.W, r.E, r.C)}
    <label class="pick" title="Add to compare"><input type="checkbox" data-pick="${r.legislator_id}" ${picked ? 'checked' : ''}><span class="sr">Compare ${esc(r.name)}</span></label>
  </li>`;
}

function mapView(rows) {
  const W = 640, H = 420, P = 44;
  const X = v => P + v / 100 * (W - P * 1.4), Y = v => H - P - v / 100 * (H - P * 1.6);
  const top = new Set(rows.slice(0, 5).map(r => r.legislator_id));
  const grid = [0, 25, 50, 75, 100].map(v => `<line class="grid" x1="${X(v)}" y1="${Y(0)}" x2="${X(v)}" y2="${Y(100)}"/><line class="grid" x1="${X(0)}" y1="${Y(v)}" x2="${X(100)}" y2="${Y(v)}"/><text class="ax" x="${X(v)}" y="${Y(0) + 16}" text-anchor="middle">${v}</text><text class="ax" x="${X(0) - 8}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const dots = rows.map(r => `<circle class="pt pt-${esc(r.party || 'I')}${r.rels.length ? ' pt-warm' : ''}" cx="${X(r.W).toFixed(1)}" cy="${Y(r.E).toFixed(1)}" r="${top.has(r.legislator_id) ? 6.5 : 4.5}" data-open="${r.legislator_id}" tabindex="0"><title>${esc(r.name)} (${r.party}) Willingness ${r.W}, Effectiveness ${r.E}${r.rels.length ? ', known to ' + r.rels.map(x => x.staff.name).join(', ') : ''}</title></circle>`).join('');
  const labels = rows.slice(0, 5).map(r => `<text class="pt-label" x="${(X(r.W) + 9).toFixed(1)}" y="${(Y(r.E) + 4).toFixed(1)}">${esc(lastName(r.name))}</text>`).join('');
  return `<figure class="mapfig"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Willingness versus effectiveness for ${rows.length} members">
    <rect class="sweet" x="${X(60)}" y="${Y(100)}" width="${X(100) - X(60)}" height="${Y(60) - Y(100)}"/>
    <text class="sweet-l" x="${X(100) - 6}" y="${Y(100) + 16}" text-anchor="end">Willing and able</text>
    ${grid}${dots}${labels}
    <text class="axt" x="${(X(0) + X(100)) / 2}" y="${H - 6}" text-anchor="middle">Willingness</text>
    <text class="axt" transform="rotate(-90 14 ${(Y(0) + Y(100)) / 2})" x="14" y="${(Y(0) + Y(100)) / 2}" text-anchor="middle">Effectiveness</text>
  </svg><figcaption><span class="lg"><i class="pt-D"></i>Democrat</span><span class="lg"><i class="pt-R"></i>Republican</span><span class="lg"><i class="ring"></i>Someone on our team knows them</span> The five strongest champions are labelled; click any dot for details.</figcaption></figure>`;
}

// ── compare + strategy brief ─────────────────────────────────────────────────
function togglePick(id, on) {
  if (on) { if (S.picks.size >= 4) { toast('Compare up to four members at a time.'); return false; } S.picks.set(id, S.topic); }
  else S.picks.delete(id);
  renderTray(); return true;
}
function renderTray() {
  const t = $('tray');
  t.classList.toggle('up', S.picks.size > 0);
  $('tray-chips').innerHTML = [...S.picks.keys()].map(id => `<span class="tchip">${esc(STATE.legById[id]?.name)}<button data-unpick="${id}" aria-label="Remove ${esc(STATE.legById[id]?.name)}">×</button></span>`).join('');
}
function pickedRows() {
  const all = scoreTopic(STATE.index, S.topic, { subtopic: S.sub });
  return [...S.picks.keys()].map(id => all.find(r => r.legislator_id === id) || { legislator_id: id, ...STATE.legById[id], willingness: 0, effectiveness: 0, champion: 0, bills_led: 0, laws: 0, decided: 0, power: {}, in_majority: false, quality: 'minimal' });
}
function openCompare() {
  if (S.picks.size < 2) { toast('Pick at least two members to compare.'); return; }
  const rows = pickedRows();
  const line = (label, f) => `<tr><th scope="row">${label}</th>${rows.map(r => `<td>${f(r)}</td>`).join('')}</tr>`;
  openModal(`<h2>Compare on ${esc(topicLabel(S.topic))}</h2>
    <table class="cmp"><thead><tr><th></th>${rows.map(r => `<th scope="col"><button class="linkish" data-open="${r.legislator_id}">${esc(r.name)}</button><span class="meta">${partyChip(r.party)} ${esc(memberMeta(r))}</span></th>`).join('')}</tr></thead><tbody>
    ${line('Champion', r => dial(r.willingness, r.effectiveness, r.champion, { size: 56 }))}
    ${line('Willingness', r => `${bar(r.willingness, 'w')} ${r.willingness}`)}
    ${line('Effectiveness', r => `${bar(r.effectiveness, 'e')} ${r.effectiveness}`)}
    ${line('Bills led here', r => r.bills_led)}
    ${line('Became law', r => r.decided ? `${r.laws} of ${r.decided}` : '—')}
    ${line('Overall record', r => r.overall ? `${r.overall.laws} laws from ${r.overall.led} bills led` : '—')}
    ${line('Majority party', r => r.in_majority ? 'Yes' : 'No')}
    ${line('Our relationships', r => relsFor(r.legislator_id).map(x => `${esc(x.staff.name)} (${esc(STRENGTH[x.strength].toLowerCase())})`).join('<br>') || '—')}
    </tbody></table>`);
}
function openStrategy() {
  if (!S.picks.size) { toast('Pick members first.'); return; }
  const rows = pickedRows().sort((a, b) => b.champion - a.champion);
  const lead = rows[0], chair = rows.find(r => r.power.chair && r !== lead), minority = rows.filter(r => !r.in_majority);
  const crossChamber = rows.find(r => r.chamber !== lead.chamber);
  const warm = rows.flatMap(r => relsFor(r.legislator_id).map(x => ({ r, x }))).sort((a, b) => b.x.strength - a.x.strength);
  const st = topicStats(STATE.index, S.topic);
  const steps = [
    `Lock in <b>${esc(lead.name)}</b> as lead sponsor: willingness ${lead.willingness}, effectiveness ${lead.effectiveness}${lead.decided ? `, ${lead.laws} of ${lead.decided} of their bills here became law` : ''}.`,
    crossChamber ? `Ask <b>${esc(crossChamber.name)}</b> to cross-file in the ${crossChamber.chamber === 'senate' ? 'Senate' : 'House'}. Cross-filed bills pass far more often (see Insights).` : `Find a ${lead.chamber === 'senate' ? 'House' : 'Senate'} sponsor to cross-file: a companion bill in the other chamber is the strongest single predictor of passage in this data.`,
    chair ? `Brief <b>${esc(chair.name)}</b> early: as a committee chair they decide whether the bill gets a vote.` : 'Identify the chair of the committee of referral and brief them before the hearing; they decide whether the bill gets a vote.',
    minority.length ? `Keep ${minority.map(r => `<b>${esc(r.name)}</b>`).join(' and ')} on as minority-party co-sponsors for bipartisan cover.` : 'Add a minority-party co-sponsor before the bill becomes contested.',
  ];
  openModal(`<article class="brief">
    <h2>Strategy brief: ${esc(topicLabel(S.topic))}${S.sub ? `, ${esc(subtopicLabel(S.topic, S.sub))}` : ''}</h2>
    <p class="brief-sub">${STATE.index.years.length} sessions of Maryland sponsorship and outcome data. ${st.rate != null ? `${pct(st.rate)} of substantive bills in this area became law.` : ''}</p>
    <h3>Recommended sequence</h3><ol class="steps">${steps.map(s => `<li>${s}</li>`).join('')}</ol>
    <h3>Who on our team opens the door</h3>
    ${warm.length ? `<ul class="plain">${warm.map(({ r, x }) => `<li><b>${esc(x.staff.name)}</b> knows ${esc(r.name)} (${esc(STRENGTH[x.strength].toLowerCase())}${x.kind ? ', ' + esc(x.kind) : ''})</li>`).join('')}</ul>` : '<p>No one on the team has a recorded relationship with these members yet. Add them in Relationships.</p>'}
    <h3>The picks</h3>
    <ul class="plain">${rows.map(r => `<li><b>${esc(r.name)}</b>, ${esc(r.party)}, ${esc(memberMeta(r))}: champion ${r.champion} (willingness ${r.willingness}, effectiveness ${r.effectiveness})</li>`).join('')}</ul>
    <p class="brief-foot">Pinnacle Bill Intelligence, ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
  </article><div class="modal-actions"><button class="btn" onclick="window.print()">Print or save as PDF</button></div>`);
}

function exportCSV() {
  const rows = S.rows; if (!rows.length) return;
  downloadCSV(`champions-${S.topic}${S.sub ? '-' + S.sub : ''}-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Rank', 'Name', 'Party', 'Chamber', 'District', 'Champion', 'Willingness', 'Effectiveness', 'Bills led', 'Co-sponsored', 'Became law', 'Decided', 'Majority', 'Data quality', 'Our relationships'],
    ...rows.map((r, i) => [i + 1, r.name, r.party, r.chamber, r.district, r.C, r.W, r.E, r.bills_led, r.bills_cosponsored, r.laws, r.decided, r.in_majority ? 'yes' : 'no', r.quality, r.rels.map(x => `${x.staff.name} (${STRENGTH[x.strength]})`).join('; ')]),
  ]);
}

export function setupChampions() {
  $('topic-filter').addEventListener('input', renderLanding);
  ['f-sort', 'f-party', 'f-chamber', 'f-led', 'f-scale', 'f-warm'].forEach(id => $(id).addEventListener('change', renderResults));
  $('v-list').addEventListener('click', () => { S.view = 'list'; renderResults(); });
  $('v-map').addEventListener('click', () => { S.view = 'map'; renderResults(); });
  $('exportbtn').addEventListener('click', exportCSV);
  on($('results'), 'click', '[data-open]', el => openLegislator(el.dataset.open, S.topic));
  on($('results'), 'keydown', 'circle[data-open]', (el, ev) => { if (ev.key === 'Enter') openLegislator(el.dataset.open, S.topic); });
  on($('results'), 'change', '[data-pick]', (el) => { if (!togglePick(el.dataset.pick, el.checked)) el.checked = false; });
  on($('tray'), 'click', '[data-unpick]', el => { S.picks.delete(el.dataset.unpick); renderTray(); document.querySelectorAll(`[data-pick="${el.dataset.unpick}"]`).forEach(c => c.checked = false); });
  $('tray-cmp').addEventListener('click', openCompare);
  $('tray-strat').addEventListener('click', openStrategy);
  $('tray-clear').addEventListener('click', () => { S.picks.clear(); renderTray(); document.querySelectorAll('[data-pick]').forEach(c => c.checked = false); });
  on($('modal'), 'click', '[data-open]', el => openLegislator(el.dataset.open, S.topic));
}
