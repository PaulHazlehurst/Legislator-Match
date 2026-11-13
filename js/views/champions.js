import { STATE, topicCounts, committeeName } from '../store.js';
import { scoreTopic, topicStats, topicCommittees, withAccess } from '../../shared/scoring.js';
import { $, esc, pct, num, scoreBlock, partyChip, memberMeta, topicLabel, subtopicLabel, sparkline, on, openModal, toast, downloadCSV, lastName, bar, nextSession } from '../ui.js';
import { relsFor, STRENGTH, staffColor } from '../relationships.js';
import { openLegislator } from './legislator.js';
import { navigate } from '../router.js';

const S = { topic: null, sub: null, view: 'list', rows: [], picks: new Map() };

// Rows for a topic with everything the UI needs: our relationships, the
// "best for us" score, and a plain description of any committee seat.
export function champions(topic, sub = null, { access = true } = {}) {
  const rows = scoreTopic(STATE.index, topic, { subtopic: sub });
  for (const r of rows) {
    r.rels = relsFor(r.legislator_id);
    r.strength = r.rels[0]?.strength || 0;
    r.best = access ? withAccess(r.champion, r.strength) : r.champion;
    r.posts = r.power.posts || [];
  }
  return rows;
}
export function seatText(r) {
  if (!r.seat) return null;
  const name = committeeName(r.seat.code) || 'the committee';
  const role = { chair: 'Chairs', vice: 'Vice chair of', member: 'Sits on' }[r.seat.role];
  return { label: `${role} ${name}`, tip: `${name} hears ${pct(r.seat.share)} of ${r.chamber === 'senate' ? 'Senate' : 'House'} bills in this area`, strong: r.seat.role !== 'member' };
}

// ── landing ──────────────────────────────────────────────────────────────────
export function renderLanding() {
  const ns = nextSession();
  $('countdown').textContent = ns.inSession ? 'The General Assembly is in session.'
    : `${ns.days} days until the ${ns.start.getFullYear()} session opens on ${ns.start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}. Sponsors are lining up bills now.`;
  const counts = topicCounts();
  const years = STATE.index.years.slice().sort();
  const items = STATE.topics.filter(t => counts[t.code]).map(t => {
    const st = topicStats(STATE.index, t.code);
    const perYear = years.map(y => STATE.bills.filter(b => b.topic === t.code && b.year === y).length);
    return { t, n: counts[t.code], st, perYear };
  });
  const q = ($('topic-filter')?.value || '').trim().toLowerCase();
  const shown = items.filter(i => !q || i.t.label.toLowerCase().includes(q) || i.t.subtopics.some(s => s.label.toLowerCase().includes(q)));
  $('topic-index').innerHTML = shown.length ? shown.map(i => `
    <a class="ti" href="#/champions/${esc(i.t.code)}">
      <span class="ti-name">${esc(i.t.label)}</span>
      <span class="ti-subs">${i.t.subtopics.slice(0, 4).map(s => esc(s.label)).join(', ')}${i.t.subtopics.length > 4 ? ', …' : ''}</span>
      <span class="ti-stat"><b>${num(i.n)}</b> bills</span>
      <span class="ti-stat" title="Substantive bills in completed sessions that became law, counting cross-filed companions"><b>${pct(i.st.rate)}</b> became law</span>
      <span class="ti-trend" title="Bills filed ${years.join(', ')}: ${i.perYear.join(', ')}">${sparkline(i.perYear)}</span>
    </a>`).join('') : `<p class="empty">No policy area matches “${esc(q)}”. Describe the bill in the box above instead.</p>`;
}

// ── results for one topic ────────────────────────────────────────────────────
export function openTopic(code, sub = null) {
  if (!STATE.topicByCode[code]) { navigate('#/champions'); return; }
  S.topic = code; S.sub = sub || null;
  $('finder-landing').hidden = true; $('finder-results').hidden = false;
  $('rtitle').textContent = topicLabel(code);
  renderSubChips(); renderGatekeepers(); renderResults();
}
export function closeTopic() { S.topic = null; $('finder-landing').hidden = false; $('finder-results').hidden = true; renderLanding(); }

function renderSubChips() {
  const t = STATE.topicByCode[S.topic];
  const all = STATE.bills.filter(b => b.topic === S.topic);
  const chips = [['', 'All', all.length], ...t.subtopics.map(s => [s.code, s.label, all.filter(b => b.subtopic === s.code).length])].filter(([c, , n]) => !c || n > 0);
  $('subchips').innerHTML = chips.length > 1 ? chips.map(([c, l, n]) =>
    `<a class="chip ${((S.sub || '') === c) ? 'on' : ''}" href="#/champions/${esc(S.topic)}${c ? '/' + esc(c) : ''}" aria-current="${(S.sub || '') === c}">${esc(l)} <span>${n}</span></a>`).join('') : '';
}

// The committees that decide this area's bills, and who chairs them.
export function gatekeepersHTML(topic, sub = null) {
  let tc = topicCommittees(STATE.index, topic, sub);
  if (sub && !tc.house.length && !tc.senate.length) tc = topicCommittees(STATE.index, topic);
  const cell = (ch) => {
    const top = tc[ch].filter(c => c.share >= 0.15).slice(0, 2);
    if (!top.length) return '';
    return top.map(c => {
      const cm = STATE.committeeByCode[c.code]; if (!cm) return '';
      const chair = cm.chair && STATE.legById[cm.chair], rel = chair && relsFor(chair.id)[0];
      return `<div class="gate"><span class="gate-ch">${ch === 'senate' ? 'Senate' : 'House'}</span>
        <b>${esc(cm.name)}</b><span class="muted">hears ${pct(c.share)} of these bills</span>
        ${chair ? `<span>Chair: <button class="linkish" data-open="${chair.id}">${esc(chair.name)}</button>${rel ? ` <span class="warm" style="--c:${staffColor(rel.staff)}">${esc(rel.staff.name)} knows them</span>` : ''}</span>` : ''}</div>`;
    }).join('');
  };
  const html = cell('house') + cell('senate');
  return html ? `<div class="gates">${html}</div>` : '';
}
function renderGatekeepers() { $('gatekeepers').innerHTML = gatekeepersHTML(S.topic, S.sub); }

function filteredRows() {
  const party = $('f-party').value, chamber = $('f-chamber').value, led = $('f-led').checked, warm = $('f-warm').checked, seat = $('f-seat').checked;
  const sort = $('f-sort').value;
  let rows = champions(S.topic, S.sub, { access: $('f-access').checked });
  rows = rows.filter(r => (!party || r.party === party) && (!chamber || r.chamber === chamber) && (!led || r.bills_led > 0) && (!warm || r.rels.length) && (!seat || r.seat));
  const key = { champion: r => r.best, willingness: r => r.willingness, effectiveness: r => r.effectiveness, laws: r => r.laws }[sort] || (r => r.best);
  rows.sort((a, b) => key(b) - key(a) || b.champion - a.champion);
  const active = [party, chamber, !led, warm, seat, !$('f-access').checked].filter(Boolean).length;
  $('filter-count').textContent = active ? ` (${active})` : '';
  return rows;
}

export function renderResults() {
  if (!S.topic) return;
  const rows = S.rows = filteredRows();
  const label = S.sub ? subtopicLabel(S.topic, S.sub) : topicLabel(S.topic);
  const st = topicStats(STATE.index, S.topic);
  const known = rows.filter(r => r.rels.length).length;
  $('rsummary').innerHTML = rows.length
    ? `${rows.length} member${rows.length === 1 ? '' : 's'} on ${esc(label.toLowerCase())}${known ? `, ${known} of whom we know` : ''}. ${pct(st.rate)} of substantive bills here became law. <button class="linkish" data-method>How the scores work</button>`
    : '';
  $('v-list').classList.toggle('on', S.view === 'list'); $('v-map').classList.toggle('on', S.view === 'map');
  if (!rows.length && !STATE.bills.some(b => b.topic === S.topic)) {
    $('results').innerHTML = `<div class="empty"><b>No bills are filed under ${esc(topicLabel(S.topic))} yet.</b></div>`;
    return;
  }
  if (!rows.length) {
    $('results').innerHTML = `<div class="empty"><b>No one matches these filters.</b><br>Open Filters and clear one, or pick a broader subtopic.</div>`;
    return;
  }
  $('results').innerHTML = S.view === 'map' ? mapView(rows) : `<ol class="champs">${rows.slice(0, 100).map(row).join('')}</ol>${rows.length > 100 ? `<p class="note">Showing the top 100 of ${rows.length}. Export CSV for the full list.</p>` : ''}`;
}

export function championRow(r, i, { pick = false, topic = S.topic } = {}) {
  const badges = [];
  const st = seatText(r);
  if (st) badges.push(`<span class="badge ${st.strong ? 'badge-power' : ''}" title="${esc(st.tip)}">${esc(st.label)}</span>`);
  if (r.posts.length) badges.push(`<span class="badge badge-power">${esc(r.posts[0])}</span>`);
  if (!r.in_majority) badges.push('<span class="badge" title="Minority-party members usually need a majority co-sponsor to move a bill">Minority party</span>');
  if (r.quality === 'minimal') badges.push('<span class="badge badge-thin" title="Has only co-sponsored here, never led">Co-sponsor only</span>');
  const warm = r.rels.slice(0, 3).map(x => `<span class="warm" style="--c:${staffColor(x.staff)}" title="${esc(STRENGTH[x.strength])}${x.kind ? ', ' + esc(x.kind) : ''}">${esc(x.staff.name)}</span>`).join('');
  const ev = [
    r.bills_led ? `Led <b>${r.bills_led}</b> bill${r.bills_led === 1 ? '' : 's'} here` : 'Never led a bill here',
    r.decided ? `<b>${r.laws}</b> became law` : null,
    r.in_flight ? `${r.in_flight} in progress` : null,
  ].filter(Boolean).join(', ');
  const lift = r.best - r.champion;
  return `<li class="champ" data-id="${r.legislator_id}">
    <span class="rank">${i + 1}</span>
    <button class="who" data-open="${r.legislator_id}" data-topic="${esc(topic)}">
      <span class="nm">${esc(r.name)}</span>
      <span class="meta">${partyChip(r.party)} ${esc(memberMeta(r))}</span>
      <span class="ev">${ev}</span>
      ${badges.length || warm ? `<span class="badges">${warm ? `<span class="warm-lead">We know them:</span>${warm}` : ''}${badges.join('')}</span>` : ''}
    </button>
    ${scoreBlock(r.best, r.willingness, r.effectiveness, { note: lift > 0 ? `Includes +${lift} because we know them.` : '' })}
    ${pick ? `<label class="pick" title="Add to compare"><input type="checkbox" data-pick="${r.legislator_id}" ${S.picks.has(r.legislator_id) ? 'checked' : ''}><span class="sr">Compare ${esc(r.name)}</span></label>` : ''}
  </li>`;
}
const row = (r, i) => championRow(r, i, { pick: true });

function mapView(rows) {
  const W = 640, H = 420, P = 44;
  const X = v => P + v / 100 * (W - P * 1.4), Y = v => H - P - v / 100 * (H - P * 1.6);
  const top = new Set(rows.slice(0, 5).map(r => r.legislator_id));
  const grid = [0, 25, 50, 75, 100].map(v => `<line class="grid" x1="${X(v)}" y1="${Y(0)}" x2="${X(v)}" y2="${Y(100)}"/><line class="grid" x1="${X(0)}" y1="${Y(v)}" x2="${X(100)}" y2="${Y(v)}"/><text class="ax" x="${X(v)}" y="${Y(0) + 16}" text-anchor="middle">${v}</text><text class="ax" x="${X(0) - 8}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const dots = rows.map(r => `<circle class="pt pt-${esc(r.party || 'I')}${r.rels.length ? ' pt-warm' : ''}" cx="${X(r.willingness).toFixed(1)}" cy="${Y(r.effectiveness).toFixed(1)}" r="${top.has(r.legislator_id) ? 6.5 : 4.5}" data-open="${r.legislator_id}" tabindex="0"><title>${esc(r.name)} (${r.party}): carries it ${r.willingness}, passes it ${r.effectiveness}${r.rels.length ? ', known to ' + r.rels.map(x => x.staff.name).join(', ') : ''}</title></circle>`).join('');
  const labels = rows.slice(0, 5).map(r => `<text class="pt-label" x="${(X(r.willingness) + 9).toFixed(1)}" y="${(Y(r.effectiveness) + 4).toFixed(1)}">${esc(lastName(r.name))}</text>`).join('');
  return `<figure class="mapfig"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Likelihood to carry versus ability to pass for ${rows.length} members">
    <rect class="sweet" x="${X(60)}" y="${Y(100)}" width="${X(100) - X(60)}" height="${Y(60) - Y(100)}"/>
    <text class="sweet-l" x="${X(100) - 6}" y="${Y(100) + 16}" text-anchor="end">Willing and able</text>
    ${grid}${dots}${labels}
    <text class="axt" x="${(X(0) + X(100)) / 2}" y="${H - 6}" text-anchor="middle">More likely to carry it</text>
    <text class="axt" transform="rotate(-90 14 ${(Y(0) + Y(100)) / 2})" x="14" y="${(Y(0) + Y(100)) / 2}" text-anchor="middle">Better at passing bills</text>
  </svg><figcaption><span class="lg"><i class="pt-D"></i>Democrat</span><span class="lg"><i class="pt-R"></i>Republican</span><span class="lg"><i class="ring"></i>We know them</span> The top five are labelled. Click any dot for details.</figcaption></figure>`;
}

// ── compare + strategy brief ─────────────────────────────────────────────────
function togglePick(id, on_) {
  if (on_) { if (S.picks.size >= 4) { toast('Compare up to four members at a time.'); return false; } S.picks.set(id, S.topic); }
  else S.picks.delete(id);
  renderTray(); return true;
}
function renderTray() {
  $('tray').classList.toggle('up', S.picks.size > 0);
  $('tray-chips').innerHTML = [...S.picks.keys()].map(id => `<span class="tchip">${esc(STATE.legById[id]?.name)}<button data-unpick="${id}" aria-label="Remove ${esc(STATE.legById[id]?.name)}">×</button></span>`).join('');
}
function pickedRows() {
  const all = champions(S.topic, S.sub);
  return [...S.picks.keys()].map(id => all.find(r => r.legislator_id === id)).filter(Boolean);
}
function openCompare() {
  if (S.picks.size < 2) { toast('Pick at least two members to compare.'); return; }
  const rows = pickedRows();
  const line = (label, f) => `<tr><th scope="row">${label}</th>${rows.map(r => `<td>${f(r)}</td>`).join('')}</tr>`;
  openModal(`<h2>Compare on ${esc(topicLabel(S.topic))}</h2>
    <div class="tablewrap"><table class="cmp"><thead><tr><th></th>${rows.map(r => `<th scope="col"><button class="linkish" data-open="${r.legislator_id}">${esc(r.name)}</button><span class="meta">${partyChip(r.party)} ${esc(memberMeta(r))}</span></th>`).join('')}</tr></thead><tbody>
    ${line('Overall', r => `<b class="score-n">${r.best}</b>`)}
    ${line('Carries it', r => `${bar(r.willingness, 'w')} ${r.willingness}`)}
    ${line('Passes it', r => `${bar(r.effectiveness, 'e')} ${r.effectiveness}`)}
    ${line('Bills led here', r => r.bills_led)}
    ${line('Became law', r => r.decided ? `${r.laws} of ${r.decided}` : '—')}
    ${line('Committee', r => esc(seatText(r)?.label || '—'))}
    ${line('Majority party', r => r.in_majority ? 'Yes' : 'No')}
    ${line('We know them', r => r.rels.map(x => `${esc(x.staff.name)} (${esc(STRENGTH[x.strength].toLowerCase())})`).join('<br>') || '—')}
    </tbody></table></div>`);
}

function exportCSV() {
  const rows = S.rows; if (!rows.length) return;
  downloadCSV(`champions-${S.topic}${S.sub ? '-' + S.sub : ''}-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Rank', 'Name', 'Party', 'Chamber', 'District', 'Best for us', 'Champion', 'Carries it', 'Passes it', 'Bills led', 'Co-sponsored', 'Became law', 'Decided', 'Committee seat', 'Leadership', 'Email', 'Phone', 'We know them'],
    ...rows.map((r, i) => [i + 1, r.name, r.party, r.chamber, r.district, r.best, r.champion, r.willingness, r.effectiveness, r.bills_led, r.bills_cosponsored, r.laws, r.decided, seatText(r)?.label || '', r.posts.join('; '), STATE.people[r.legislator_id]?.email || '', STATE.people[r.legislator_id]?.phone || '', r.rels.map(x => `${x.staff.name} (${STRENGTH[x.strength]})`).join('; ')]),
  ]);
}

export function setupChampions() {
  $('topic-filter').addEventListener('input', renderLanding);
  $('idea-form').addEventListener('submit', e => { e.preventDefault(); const v = $('idea-input').value.trim(); if (v.length < 4) { $('idea-input').focus(); return; } navigate('#/proposer/' + encodeURIComponent(v)); });
  $('idea-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('idea-form').requestSubmit(); } });
  ['f-sort', 'f-party', 'f-chamber', 'f-led', 'f-warm', 'f-seat', 'f-access'].forEach(id => $(id).addEventListener('change', renderResults));
  $('v-list').addEventListener('click', () => { S.view = 'list'; renderResults(); });
  $('v-map').addEventListener('click', () => { S.view = 'map'; renderResults(); });
  $('exportbtn').addEventListener('click', exportCSV);
  for (const root of [$('results'), $('gatekeepers')]) on(root, 'click', '[data-open]', el => openLegislator(el.dataset.open, S.topic));
  on($('results'), 'keydown', 'circle[data-open]', (el, ev) => { if (ev.key === 'Enter') openLegislator(el.dataset.open, S.topic); });
  on($('results'), 'change', '[data-pick]', (el) => { if (!togglePick(el.dataset.pick, el.checked)) el.checked = false; });
  on($('tray'), 'click', '[data-unpick]', el => { S.picks.delete(el.dataset.unpick); renderTray(); document.querySelectorAll(`[data-pick="${el.dataset.unpick}"]`).forEach(c => c.checked = false); });
  $('tray-cmp').addEventListener('click', openCompare);
  $('tray-clear').addEventListener('click', () => { S.picks.clear(); renderTray(); document.querySelectorAll('[data-pick]').forEach(c => c.checked = false); });
  on($('modal'), 'click', '[data-open]', el => openLegislator(el.dataset.open, S.topic));
}
