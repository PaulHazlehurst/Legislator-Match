import { STATE, committeeName } from '../store.js';
import { scoreTopic, legislatorProfile } from '../../shared/scoring.js';
import { $, esc, pct, scoreBlock, partyChip, partyName, memberMeta, topicLabel, resultTag, openDrawer, on, chamberName } from '../ui.js';
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
  const power = L.power || {}, person = STATE.people[id];
  const seats = Object.entries(power.seats || {}).map(([code, role]) => `${{ chair: 'Chair', vice: 'Vice chair', member: 'Member' }[role]}, ${committeeName(code) || code}`);
  const badges = [...(power.posts || []), ...seats.filter(s => !s.startsWith('Member')), L.inMajority ? 'Majority party' : 'Minority party'];
  const memberOf = seats.filter(s => s.startsWith('Member')).map(s => s.replace('Member, ', ''));

  openDrawer(`
    <header class="d-head">
      <h2 id="drawer-title">${esc(l.name)}</h2>
      <p class="meta">${partyChip(l.party)} ${esc(partyName(l.party))}, ${esc(memberMeta(l))}</p>
      <p class="badges">${badges.map(b => `<span class="badge badge-power">${esc(b)}</span>`).join('')}</p>
      ${memberOf.length ? `<p class="d-record">Sits on ${memberOf.map(esc).join(' and ')}.</p>` : ''}
      ${person ? `<p class="contact">${person.email ? `<a class="btn btn-quiet" href="mailto:${esc(person.email)}">Email</a>` : ''}${person.phone ? `<a class="btn btn-quiet" href="tel:${esc(person.phone)}">${esc(person.phone)}</a>` : ''}<a class="btn btn-quiet" href="https://mgaleg.maryland.gov/mgawebsite/Members/Details/${esc(person.slug)}" target="_blank" rel="noopener">Official page</a></p>` : ''}
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
      <ol class="areas">${profile.slice(0, 8).map(p => `<li><button class="linkish" data-topic="${p.topic}">${esc(topicLabel(p.topic))}</button><span class="muted">led ${p.bills_led}, ${p.laws} law${p.laws === 1 ? '' : 's'}</span><b class="score-n sm">${p.champion}</b></li>`).join('') || '<li class="muted">No classified activity yet.</li>'}</ol>
    </section>

    <section class="d-sec"><h3>Works most often with</h3>${allies(id)}</section>
    ${votesSection(id)}
  `);
}

function scoreSection(r, l, topic) {
  const b = r.breakdown;
  const led = r.bills.led.slice().sort((x, y) => y.year - x.year), co = r.bills.co.slice().sort((x, y) => y.year - x.year);
  const billLi = (x, role) => `<li><button class="bill-line" data-bill="${x.id}"><span class="bn">${esc(x.bill_number)}</span><span class="bt">${esc(x.title)}</span><span class="by">${x.year}${x.topic !== topic ? ', secondary area' : ''}</span>${resultTag(x)}</button></li>`;
  return `<section class="d-sec">
    <h3>${esc(topicLabel(topic))}</h3>
    <div class="explain">
      ${scoreBlock(r.champion, r.willingness, r.effectiveness)}
      <dl>
        <dt class="k-w">Carries it: ${r.willingness}</dt>
        <dd>Led ${r.bills_led} bill${r.bills_led === 1 ? '' : 's'} here and co-sponsored ${r.bills_cosponsored}. Leading a bill is what counts; co-signing adds only a little${b.focus >= 3 ? '. This area is a large share of what they carry' : ''}.</dd>
        <dt class="k-e">Passes it: ${r.effectiveness}</dt>
        <dd>${r.decided ? `Of ${r.decided} bill${r.decided === 1 ? '' : 's'} they led here in completed sessions, ${r.laws} became law${r.laws_via_companion ? ` (${r.laws_via_companion} through a cross-filed companion)` : ''}${r.passed_chamber ? ` and ${r.passed_chamber} passed one chamber` : ''}.` : 'No completed record in this area yet, so this leans on their overall record.'}
          Blended with their overall record (${pct(b.overallRate)}) and ${r.in_majority ? 'majority' : 'minority'} status, that is an expected passage rate of ${pct(r.expected_rate)}, against ${pct(STATE.index.expectDist.mean)} for a typical member${b.power > 0 ? `. Their committee or leadership seat adds ${b.power} points` : ''}.</dd>
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

// Voting patterns on contested roll calls (data/votes.json).
function votesSection(id) {
  const v = STATE.votes?.[id], me = STATE.legById[id];
  if (!v) return '';
  const row = ([o, p]) => { const l = STATE.legById[o]; return l ? `<li><button class="linkish" data-leg="${o}">${partyChip(l.party)} ${esc(l.name)}</button><span class="vbar"><i style="width:${p}%"></i></span><span class="muted">${p}%</span></li>` : ''; };
  const other = me.party === 'D' ? 'Republicans' : 'Democrats';
  const read = v.loyal == null ? '' : v.loyal >= 97 ? 'Almost never breaks with their party.' : v.loyal >= 90 ? 'Occasionally breaks with their party.' : 'Breaks with their party more than most: a possible swing vote.';
  return `<section class="d-sec"><h3>How they vote</h3>
    ${v.loyal != null ? `<p>Votes with their party on <b>${v.loyal}%</b> of ${v.n.toLocaleString()} contested votes. ${read}</p>` : ''}
    ${v.cross?.length ? `<h4>${other} they agree with most</h4><ul class="peers">${v.cross.slice(0, 3).map(row).join('')}</ul>` : ''}
    ${v.unlikeOwn?.length && v.unlikeOwn[0][1] < 95 ? `<h4>In their own party, least alike</h4><ul class="peers">${v.unlikeOwn.map(row).join('')}</ul>` : ''}
    <p class="fine">Contested votes are roll calls where at least one in ten voted on the losing side. Unanimous votes are left out.</p></section>`;
}

export function setupLegislatorDrawer(openBill) {
  on($('dbody'), 'click', '[data-topic]', el => current && openLegislator(current.id, el.dataset.topic));
  on($('dbody'), 'click', '[data-leg]', el => el.dataset.leg && openLegislator(el.dataset.leg, current?.topic));
  on($('dbody'), 'click', '[data-bill]', el => { if (el.tagName !== 'FORM') openBill(el.dataset.bill); });
}
