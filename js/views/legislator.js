import { STATE } from '../store.js';
import { scoreTopic, legislatorProfile } from '../../shared/scoring.js';
import { rpc } from '../api.js';
import { $, esc, pct, dial, partyChip, partyName, memberMeta, topicLabel, resultTag, openDrawer, on, chamberName } from '../ui.js';
import { relsFor, STRENGTH, staffColor, REL } from '../relationships.js';

let current = null;

export function openLegislator(id, topic = null) {
  const l = STATE.legById[id]; if (!l) return;
  current = { id, topic };
  const topics = STATE.topics.map(t => t.code);
  const profile = legislatorProfile(STATE.index, id, topics);
  topic = topic || profile[0]?.topic || null;
  const r = topic ? scoreTopic(STATE.index, topic).find(x => x.legislator_id === id) : null;
  const L = STATE.index.legById.get(id);
  const rels = relsFor(id);
  const power = L.power || {};

  const badges = [power.chair && `Chair${power.chairOf?.length ? ', ' + power.chairOf.filter(Boolean).join(', ') : ''}`, power.vice && 'Vice chair', power.leadership && 'Leadership', L.inMajority ? 'Majority party' : 'Minority party'].filter(Boolean);

  openDrawer(`
    <header class="d-head">
      <h2 id="drawer-title">${esc(l.name)}</h2>
      <p class="meta">${partyChip(l.party)} ${esc(partyName(l.party))}, ${esc(memberMeta(l))}</p>
      <p class="badges">${badges.map(b => `<span class="badge badge-power">${esc(b)}</span>`).join('')}</p>
      <p class="d-record">Across all areas: led <b>${L.record.n}</b> bills in completed sessions, <b>${L.record.laws}</b> became law. Expected passage rate ${pct(L.expect)} (chamber average ${pct(STATE.index.chamberBase[l.chamber])}).</p>
    </header>

    <section class="d-sec">
      <h3>Our relationships</h3>
      ${rels.length ? `<ul class="rels">${rels.map(x => `<li><span class="sw" style="background:${staffColor(x.staff)}"></span><b>${esc(x.staff.name)}</b> <span class="muted">${esc(STRENGTH[x.strength])}${x.kind ? ', ' + esc(x.kind) : ''}${x.last_contact ? ', last contact ' + esc(x.last_contact) : ''}</span>${x.notes ? `<p class="note">${esc(x.notes)}</p>` : ''}</li>`).join('')}</ul>` : `<p class="muted">No one on the team has recorded a relationship with ${esc(l.name.split(' ')[0])} yet.</p>`}
      <a class="btn btn-quiet" href="#/relationships/add/${id}">${rels.length ? 'Add or edit a relationship' : 'Record a relationship'}</a>
      ${REL.mode === 'local' ? '<p class="fine">Relationships are saved in this browser only until team sync is set up.</p>' : ''}
    </section>

    ${r ? scoreSection(r, l, topic) : ''}

    <section class="d-sec">
      <h3>Strongest policy areas</h3>
      <ol class="areas">${profile.slice(0, 8).map(p => `<li><button class="linkish" data-topic="${p.topic}">${esc(topicLabel(p.topic))}</button><span class="muted">led ${p.bills_led}, ${p.laws} law${p.laws === 1 ? '' : 's'}</span>${dial(p.willingness, p.effectiveness, p.champion, { size: 40, label: false })}</li>`).join('') || '<li class="muted">No classified activity yet.</li>'}</ol>
    </section>

    <section class="d-sec"><h3>Works most often with</h3>${allies(id)}</section>
    <section class="d-sec"><h3>Votes most alike</h3><div id="d-votes" class="muted">Comparing roll-call votes…</div></section>
  `);
  loadVotes(id);
}

function scoreSection(r, l, topic) {
  const b = r.breakdown;
  const led = r.bills.led.slice().sort((x, y) => y.year - x.year), co = r.bills.co.slice().sort((x, y) => y.year - x.year);
  const billLi = (x, role) => `<li><button class="bill-line" data-bill="${x.id}"><span class="bn">${esc(x.bill_number)}</span><span class="bt">${esc(x.title)}</span><span class="by">${x.year}${x.topic !== topic ? ', secondary area' : ''}</span>${resultTag(x)}</button></li>`;
  return `<section class="d-sec">
    <h3>${esc(topicLabel(topic))}</h3>
    <div class="explain">
      ${dial(r.willingness, r.effectiveness, r.champion, { size: 84 })}
      <dl>
        <dt class="k-w">Willingness ${r.willingness}</dt>
        <dd>Led ${r.bills_led} bill${r.bills_led === 1 ? '' : 's'} here (weighted ${b.ledWeight}) and co-sponsored ${r.bills_cosponsored} (adds ${b.coContribution}, capped so co-signing can't stand in for leading)${b.focus ? `, plus ${b.focus} for focus: this area is a large share of what they carry` : ''}. Recent sessions and substantive bills count most.</dd>
        <dt class="k-e">Effectiveness ${r.effectiveness}</dt>
        <dd>${r.decided ? `Of ${r.decided} bill${r.decided === 1 ? '' : 's'} they led here in completed sessions, ${r.laws} became law${r.laws_via_companion ? ` (${r.laws_via_companion} through a cross-filed companion)` : ''}${r.passed_chamber ? ` and ${r.passed_chamber} passed one chamber` : ''}.` : 'No completed record in this area yet, so this leans on their overall record.'}
          Blended with their overall record (${pct(b.overallRate)}) and ${r.in_majority ? 'majority' : 'minority'} status, that is an expected passage rate of ${pct(r.expected_rate)}, against ${pct(STATE.index.expectDist.mean)} for a typical member${b.power ? `, plus ${b.power} for committee or leadership posts` : ''}.</dd>
      </dl>
    </div>
    ${led.length ? `<h4>Led (${led.length})</h4><ul class="bills">${led.map(x => billLi(x)).join('')}</ul>` : ''}
    ${co.length ? `<details><summary>Co-sponsored (${co.length})</summary><ul class="bills">${co.map(x => billLi(x)).join('')}</ul></details>` : ''}
  </section>`;
}

function allies(id) {
  const L = STATE.index.legById.get(id);
  const mine = new Set([...L.led, ...L.co].map(b => b.id));
  const counts = new Map();
  for (const billId of mine) for (const s of STATE.sponsorsByBill.get(billId) || []) if (s.legislator_id !== id) counts.set(s.legislator_id, (counts.get(s.legislator_id) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).filter(([, n]) => n >= 3);
  if (!top.length) return '<p class="muted">No frequent co-sponsors yet.</p>';
  const cross = top.filter(([o]) => STATE.legById[o]?.party !== STATE.legById[id].party).length;
  return `<ul class="peers">${top.map(([o, n]) => { const p = STATE.legById[o]; return `<li><button class="linkish" data-leg="${o}">${partyChip(p.party)} ${esc(p.name)}</button><span class="muted">${n} bills together, ${esc(chamberName(p.chamber))}</span></li>`; }).join('')}</ul>${cross ? `<p class="fine">${cross} of these work across the aisle.</p>` : ''}`;
}

async function loadVotes(id) {
  let rows = [];
  try { rows = await rpc('voting_alignment', { leg: id }); } catch (e) {
    const el = $('d-votes'); if (el && current?.id === id) el.textContent = 'Vote comparison is unavailable right now (the database did not answer in time).';
    return;
  }
  const el = $('d-votes'); if (!el || current?.id !== id) return;
  if (!rows?.length) { el.textContent = 'Not enough shared roll calls to compare.'; return; }
  const row = x => `<li><button class="linkish" data-leg="${x.legislator_id || x.id || ''}">${partyChip(x.party)} ${esc(x.name)}</button><span class="vbar"><i style="width:${x.pct}%"></i></span><span class="muted">${x.pct}%</span></li>`;
  el.classList.remove('muted');
  el.innerHTML = `<ul class="peers">${rows.slice(0, 6).map(row).join('')}</ul>`;
}

export function setupLegislatorDrawer(openBill) {
  on($('dbody'), 'click', '[data-topic]', el => current && openLegislator(current.id, el.dataset.topic));
  on($('dbody'), 'click', '[data-leg]', el => el.dataset.leg && openLegislator(el.dataset.leg, current?.topic));
  on($('dbody'), 'click', '[data-bill]', el => { if (el.tagName !== 'FORM') openBill(el.dataset.bill); });
}
