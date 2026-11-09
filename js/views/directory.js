import { STATE } from '../store.js';
import { allProfiles } from '../../shared/scoring.js';
import { $, esc, partyChip, memberMeta, topicLabel, on } from '../ui.js';
import { relsFor, staffColor } from '../relationships.js';
import { openLegislator } from './legislator.js';

let profiles = null;
export function renderDirectory() {
  profiles ||= allProfiles(STATE.index, STATE.topics.map(t => t.code));
  const q = $('r-q').value.trim().toLowerCase(), party = $('r-party').value, ch = $('r-chamber').value, sort = $('r-sort').value;
  let list = STATE.legislators.filter(l => (!party || l.party === party) && (!ch || l.chamber === ch) && (!q || l.name.toLowerCase().includes(q) || String(l.district).toLowerCase().includes(q)));
  const L = id => STATE.index.legById.get(id);
  const key = { name: null, laws: l => L(l.id).record.laws, record: l => L(l.id).expect, warm: l => relsFor(l.id).length }[sort];
  list.sort((a, b) => key ? key(b) - key(a) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
  $('r-count').textContent = `${list.length} member${list.length === 1 ? '' : 's'}`;
  $('r-grid').innerHTML = list.map(l => {
    const top = (profiles.get(l.id) || []).slice(0, 3), rec = L(l.id).record, rels = relsFor(l.id);
    return `<li><button class="mcard" data-open="${l.id}">
      <span class="nm">${esc(l.name)}</span><span class="meta">${partyChip(l.party)} ${esc(memberMeta(l))}</span>
      <span class="ev">${rec.laws} laws from ${rec.n} bills led</span>
      <span class="areas-mini">${top.map(p => `<span>${esc(topicLabel(p.topic))} <b>${p.champion}</b></span>`).join('') || '<span class="muted">No classified activity</span>'}</span>
      ${rels.length ? `<span class="badges">${rels.slice(0, 3).map(x => `<span class="warm" style="--c:${staffColor(x.staff)}">${esc(x.staff.name)}</span>`).join('')}</span>` : ''}
    </button></li>`;
  }).join('') || '<li class="empty">No members match.</li>';
}
export function setupDirectory() {
  ['r-q', 'r-party', 'r-chamber', 'r-sort'].forEach(id => $(id).addEventListener('input', renderDirectory));
  on($('r-grid'), 'click', '[data-open]', el => openLegislator(el.dataset.open));
}
