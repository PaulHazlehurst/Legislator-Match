// The Proposer: any idea in, a game plan out.
//   area → odds → committees that decide it → who to ask → who has tried → AI read
import { STATE } from '../store.js';
import { buildSearchIndex, inferArea } from '../../shared/search.js';
import { topicStats, topicCommittees } from '../../shared/scoring.js';
import { $, esc, pct, partyChip, memberMeta, topicLabel, subtopicLabel, resultTag, scoreBlock, stoppedAt, on, toast } from '../ui.js';
import { relsFor, STRENGTH, staffColor } from '../relationships.js';
import { champions, seatText } from './champions.js';
import { openLegislator } from './legislator.js';
import { navigate } from '../router.js';

const P = { text: '', ai: null, aiState: 'idle', topic: null, sub: null, picked: false, subPicked: false, engine: null, seq: 0, cross: null };
const isLaw = b => b.result === 'law' || b.result === 'law-companion';
const engine = () => P.engine ||= buildSearchIndex(STATE.bills.map(b => ({ id: b.id, title: b.title })));

// ── analysis (pure: text + optional AI hints → everything the page shows) ────
export function analyse(text, { ai = null, topic = null, sub = null } = {}) {
  const inf = inferArea(engine(), text, id => STATE.billById[id], { extra: ai?.searchTerms || [], aiTopic: ai?.topicCode || null });
  const areas = inf.areas.filter(a => STATE.topicByCode[a.topic]).slice(0, 4);
  const chosen = topic || areas[0]?.topic || null;
  if (!chosen) return { areas, topic: null };
  const subtopic = sub !== null ? (sub || null) : (ai?.topicCode === chosen && ai.subtopicCode) || inf.subtopicFor(chosen);

  // similar bills: close matches, one row per policy (a bill and its companion count once)
  const top = inf.hits[0]?.score || 0, seen = new Set(), similar = [];
  for (const h of inf.hits) {
    const b = STATE.billById[h.id];
    if (!b || h.score < top * 0.45 || seen.has(b.id)) continue;
    seen.add(b.id); b.companions.forEach(c => seen.add(c));
    similar.push({ ...h, bill: b });
    if (similar.length >= 14) break;
  }
  const decided = similar.filter(s => s.bill.credit !== null);
  const laws = decided.filter(s => isLaw(s.bill));
  const area = topicStats(STATE.index, chosen);

  // repeat attempts: the same title filed in more than one session
  const byTitle = new Map();
  for (const s of similar) { const k = s.bill.title.toLowerCase(); (byTitle.get(k) || byTitle.set(k, []).get(k)).push(s.bill); }
  const repeats = [...byTitle.values()].filter(v => new Set(v.map(b => b.year)).size > 1)
    .map(v => ({ title: v[0].title, years: [...new Set(v.map(b => b.year))].sort(), passed: v.some(isLaw) }));

  // committees: where the similar bills actually went, else where the area's bills go
  const tally = { house: {}, senate: {} };
  for (const s of similar.filter(x => x.bill.topic === chosen || x.bill.secondary === chosen)) for (const [ch, code] of [[s.bill.chamber, s.bill.committee], [s.bill.chamber === 'house' ? 'senate' : 'house', s.bill.oppCommittee]])
    if (code && !code.startsWith('x-') && STATE.committeeByCode[code]) tally[ch][code] = (tally[ch][code] || 0) + s.score;
  const tc = topicCommittees(STATE.index, chosen, subtopic), tcAll = topicCommittees(STATE.index, chosen);
  const committees = ['house', 'senate'].map(ch => {
    const best = Object.entries(tally[ch]).sort((a, b) => b[1] - a[1])[0];
    const code = best?.[0] || tc[ch][0]?.code || tcAll[ch][0]?.code;
    const cm = code && STATE.committeeByCode[code]; if (!cm) return null;
    const sent = [...STATE.index.billById.values()].filter(b => b.topic === chosen && b.credit !== null && (b.chamber === ch ? b.committee : b.oppCommittee) === code && b.chamber === ch);
    return { chamber: ch, committee: cm, from: best ? 'similar' : 'area', sent: sent.length, out: sent.length ? sent.filter(b => b.stage >= 3).length / sent.length : null };
  }).filter(Boolean);

  // the team
  const rows = champions(chosen, subtopic);
  const carried = new Map();                                     // legislator → similar bills they led
  for (const s of similar) for (const sp of STATE.sponsorsByBill.get(s.bill.id) || []) if (sp.role !== 'cosponsor') (carried.get(sp.legislator_id) || carried.set(sp.legislator_id, []).get(sp.legislator_id)).push(s.bill);
  const cmCodes = new Set(committees.map(c => c.committee.code));
  const fit = r => r.best + (carried.has(r.legislator_id) ? 12 : 0) + (r.seat && cmCodes.has(r.seat.code) ? 6 : 0);
  const ranked = rows.filter(r => r.bills_led > 0 || carried.has(r.legislator_id)).sort((a, b) => fit(b) - fit(a));
  const used = new Set(), team = [];
  const take = (role, why, pred) => { const r = ranked.find(x => !used.has(x.legislator_id) && pred(x)); if (r) { used.add(r.legislator_id); team.push({ role, why: why(r), r }); } return r; };
  const reason = r => carried.has(r.legislator_id) ? `Led ${carried.get(r.legislator_id)[0].bill_number} (${carried.get(r.legislator_id)[0].year}), a similar bill` : `Led ${r.bills_led} bill${r.bills_led === 1 ? '' : 's'} in this area, ${r.laws} became law`;
  const lead = take('Lead sponsor', reason, r => r.in_majority);
  if (lead) take(`Cross-file in the ${lead.chamber === 'senate' ? 'House' : 'Senate'}`, reason, r => r.chamber !== lead.chamber && r.in_majority);
  take('Across the aisle', r => `${reason(r)}. A minority-party co-sponsor gives bipartisan cover`, r => !r.in_majority);
  for (const c of committees) {
    const id = c.committee.chair; if (!id || used.has(id)) continue;
    const r = rows.find(x => x.legislator_id === id);
    used.add(id); team.push({ role: `Gatekeeper: chairs ${c.committee.name}`, why: 'Decides whether the bill gets a vote. Brief before the hearing', r: r || null, id });
  }
  const insiders = rows.filter(r => !used.has(r.legislator_id) && r.seat && cmCodes.has(r.seat.code) && r.bills_led > 0).slice(0, 4);
  const tried = [...carried].filter(([id]) => !used.has(id) && STATE.legById[id]).slice(0, 4).map(([id, bills]) => ({ id, bills }));

  return { areas, topic: chosen, subtopic, similar, decided: decided.length, laws: laws.length, area, repeats, committees, team, insiders, tried, classifier: inf.classifier };
}

function crossRates() {
  if (P.cross) return P.cross;
  const d = [...STATE.index.billById.values()].filter(b => b.credit !== null && b.significance === 'substantive');
  const rate = xs => xs.length ? xs.filter(isLaw).length / xs.length : null;
  return P.cross = { yes: rate(d.filter(b => b.companions.length)), no: rate(d.filter(b => !b.companions.length)) };
}

// ── rendering ────────────────────────────────────────────────────────────────
const warmHTML = (id) => relsFor(id).slice(0, 3).map(x => `<span class="warm" style="--c:${staffColor(x.staff)}" title="${esc(STRENGTH[x.strength])}">${esc(x.staff.name)}</span>`).join('');

function teamCard(t) {
  const id = t.r?.legislator_id || t.id, l = STATE.legById[id]; if (!l) return '';
  const warm = warmHTML(id), contact = STATE.people[id];
  const st = t.r && seatText(t.r);
  return `<li class="tcard">
    <span class="tc-role">${esc(t.role)}</span>
    <button class="who" data-open="${id}"><span class="nm">${esc(l.name)}</span><span class="meta">${partyChip(l.party)} ${esc(memberMeta(l))}</span></button>
    <p class="tc-why">${esc(t.why)}.${st && !/Gatekeeper/.test(t.role) ? ` ${esc(st.label)}.` : ''}</p>
    ${t.r ? scoreBlock(t.r.best, t.r.willingness, t.r.effectiveness) : ''}
    <p class="tc-warm">${warm ? `<span class="warm-lead">Ask through</span>${warm}` : `<span class="muted">No one on our team knows them yet.</span> <a href="#/relationships/add/${id}">Record a relationship</a>`}</p>
    ${contact?.email ? `<p class="tc-contact"><a href="mailto:${esc(contact.email)}">Email</a>${contact.phone ? `<a href="tel:${esc(contact.phone)}">${esc(contact.phone)}</a>` : ''}</p>` : ''}
  </li>`;
}

function render() {
  const a = analyse(P.text, { ai: P.ai, topic: P.picked ? P.topic : null, sub: P.subPicked ? (P.sub || '') : null });
  const cr = crossRates();
  if (!a.topic) {
    $('p-out').innerHTML = `<p class="empty"><b>Nothing in three sessions looks like this yet.</b><br>Add a few specifics: what would change, and for whom. ${P.aiState === 'loading' ? 'The AI analyst is still reading it…' : ''}</p>`;
    return;
  }
  P.topic = a.topic; P.sub = a.subtopic;
  const t = STATE.topicByCode[a.topic];
  const odds = a.decided >= 4 ? a.laws / a.decided : null;
  const stops = {};
  a.similar.forEach(s => { const w = stoppedAt(s.bill); if (w) stops[w] = (stops[w] || 0) + 1; });
  const topStop = Object.entries(stops).sort((x, y) => y[1] - x[1])[0];
  const lead = a.team[0], cross = a.team.find(x => /^Cross-file/.test(x.role)), chair = a.team.find(x => /^Gatekeeper/.test(x.role)), aisle = a.team.find(x => x.role === 'Across the aisle');
  const nm = x => esc(STATE.legById[x.r?.legislator_id || x.id]?.name || '');
  const ai = P.ai;

  $('p-out').innerHTML = `
  <article class="plan">
    <section class="plan-sec">
      <h2>What this is</h2>
      ${ai?.summary ? `<p class="summary">${esc(ai.summary)}</p>` : ''}
      <p class="areas-pick"><span class="muted">Policy area:</span> ${a.areas.map(x => `<button class="chip ${x.topic === a.topic ? 'on' : ''}" data-area="${x.topic}" aria-pressed="${x.topic === a.topic}">${esc(topicLabel(x.topic))}</button>`).join('')}
        <a class="mini-link" href="#/champions">Other…</a></p>
      ${t.subtopics.length ? `<p class="areas-pick"><span class="muted">More precisely:</span> <button class="chip ${!a.subtopic ? 'on' : ''}" data-sub="">Any</button>${t.subtopics.map(s => `<button class="chip ${s.code === a.subtopic ? 'on' : ''}" data-sub="${s.code}">${esc(s.label)}</button>`).join('')}</p>` : ''}
    </section>

    <section class="plan-sec">
      <h2>The odds</h2>
      <div class="odds">
        <div class="odd"><b>${odds != null ? pct(odds) : pct(a.area.rate)}</b><span>${odds != null ? `of similar bills became law (${a.laws} of ${a.decided})` : `of ${esc(topicLabel(a.topic).toLowerCase())} bills become law. Too few similar bills to say more`}</span></div>
        ${odds != null ? `<div class="odd"><b>${pct(a.area.rate)}</b><span>is the average for ${esc(topicLabel(a.topic).toLowerCase())}</span></div>` : ''}
        <div class="odd"><b>${pct(cr.yes)}</b><span>of cross-filed bills become law, against ${pct(cr.no)} filed in one chamber. Cross-file this</span></div>
      </div>
      ${topStop ? `<p>Where similar bills stopped most often: <b>${esc(topStop[0].toLowerCase())}</b> (${topStop[1]} of ${a.similar.length}).</p>` : ''}
      ${a.repeats.length ? `<p>Expect more than one session: ${a.repeats.slice(0, 2).map(r => `“${esc(r.title.slice(0, 80))}” was filed in ${r.years.join(', ')}${r.passed ? ' before it passed' : ' and has not passed yet'}`).join('; ')}.</p>` : ''}
    </section>

    <section class="plan-sec">
      <h2>Who decides</h2>
      <div class="gates">${a.committees.map(c => { const cm = c.committee, ch = cm.chair && STATE.legById[cm.chair], v = cm.vice && STATE.legById[cm.vice];
        return `<div class="gate"><span class="gate-ch">${c.chamber === 'senate' ? 'Senate' : 'House'}</span><b>${esc(cm.name)}</b>
          <span class="muted">${c.from === 'similar' ? 'heard the similar bills' : 'hears most bills in this area'}${c.out != null && c.sent >= 8 ? `. Votes out ${pct(c.out)} of them` : ''}</span>
          ${ch ? `<span>Chair: <button class="linkish" data-open="${ch.id}">${esc(ch.name)}</button> ${warmHTML(ch.id)}</span>` : ''}
          ${v ? `<span>Vice chair: <button class="linkish" data-open="${v.id}">${esc(v.name)}</button> ${warmHTML(v.id)}</span>` : ''}</div>`; }).join('') || '<p class="muted">No committee pattern for this yet.</p>'}</div>
      ${a.insiders.length ? `<p>Friendly seats on those committees: ${a.insiders.map(r => `<button class="linkish" data-open="${r.legislator_id}">${esc(r.name)}</button> (${r.best})`).join(', ')}.</p>` : ''}
    </section>

    <section class="plan-sec">
      <h2>Who to ask</h2>
      ${a.team.length ? `<ol class="team">${a.team.map(teamCard).join('')}</ol>` : '<p class="muted">No one has led a bill in this area yet. Try a broader area above.</p>'}
      ${a.tried.length ? `<p>Also carried something like this: ${a.tried.map(x => `<button class="linkish" data-open="${x.id}">${esc(STATE.legById[x.id].name)}</button> (${esc(x.bills[0].bill_number)}, ${x.bills[0].year})`).join(', ')}.</p>` : ''}
    </section>

    <section class="plan-sec">
      <h2>The sequence</h2>
      <ol class="steps">
        ${lead ? `<li>Ask <b>${nm(lead)}</b> to lead it.</li>` : ''}
        ${cross ? `<li>Line up <b>${nm(cross)}</b> to file the companion in the other chamber on the same day.</li>` : '<li>Find a sponsor in the other chamber and cross-file on the same day.</li>'}
        ${chair ? `<li>Brief <b>${nm(chair)}</b> before the hearing is scheduled. Nothing moves without the chair.</li>` : ''}
        ${aisle ? `<li>Bring <b>${nm(aisle)}</b> on as a co-sponsor before the bill becomes contested.</li>` : '<li>Add a minority-party co-sponsor before the bill becomes contested.</li>'}
        <li>${ai?.fiscal ? esc(ai.fiscal) : 'Get ahead of the fiscal note: cost is the quiet killer in committee.'}</li>
      </ol>
    </section>

    ${ai ? `<section class="plan-sec">
      <h2>The politics</h2>
      ${ai.framing ? `<p>${esc(ai.framing)}</p>` : ''}
      <div class="sides">
        ${ai.supporters.length ? `<div><h3>Likely allies</h3><ul>${ai.supporters.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${ai.opponents.length ? `<div><h3>Likely opposition</h3><ul>${ai.opponents.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${ai.risks.length ? `<div><h3>Watch for</h3><ul>${ai.risks.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      </div>
      <p class="fine">Written by an AI analyst from the description alone. Check it against what you know.</p>
    </section>` : `<p class="fine plan-ai">${P.aiState === 'loading' ? 'The AI analyst is reading this for allies, opposition and framing…' : P.aiState === 'off' ? 'For allies, opposition and framing, an admin can add an AI key in Vercel (see README). Everything above comes from the legislative record.' : P.aiState === 'error' ? 'The AI analyst was unavailable just now. Everything above comes from the legislative record.' : ''}</p>`}

    <section class="plan-sec">
      <h2>Who has tried this</h2>
      ${a.similar.length ? `<ul class="bill-list">${a.similar.slice(0, 10).map(s => { const b = s.bill, sp = (STATE.sponsorsByBill.get(b.id) || []).find(x => x.role !== 'cosponsor'), l = sp && STATE.legById[sp.legislator_id];
        return `<li class="bill-row"><button class="bill-line" data-bill="${b.id}"><span class="bn">${esc(b.bill_number)}</span><span class="bt">${esc(b.title)}</span><span class="by">${b.year}${l ? `, ${esc(l.name)}` : ''}${stoppedAt(b) ? `. ${esc(stoppedAt(b))}` : ''}</span>${resultTag(b)}</button></li>`; }).join('')}</ul>` : '<p class="muted">No similar bills in the last three sessions. That can be an opening, or a sign the idea needs a different vehicle.</p>'}
    </section>

    <p class="plan-actions"><button class="btn" data-act="print">Print or save as PDF</button> <button class="btn btn-quiet" data-act="link">Copy link to this plan</button></p>
  </article>`;
}

async function askAI(text, seq) {
  P.aiState = 'loading';
  try {
    const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const j = await res.json().catch(() => ({}));
    if (seq !== P.seq) return;
    if (!res.ok) { P.aiState = j.code === 'not_configured' || res.status === 404 || res.status === 501 ? 'off' : 'error'; }
    else { P.ai = j; P.aiState = 'done'; }
  } catch (_) { if (seq !== P.seq) return; P.aiState = 'off'; }
  render();
}

export function runIdea(text) {
  text = String(text || '').trim();
  $('p-text').value = text;
  if (text.length < 4) { $('p-out').innerHTML = ''; return; }
  if (text === P.text && $('p-out').innerHTML) return;
  Object.assign(P, { text, ai: null, topic: null, sub: null, picked: false, subPicked: false, seq: P.seq + 1 });
  P.aiState = 'loading';
  render();
  askAI(text, P.seq);
}

export function setupProposer() {
  $('p-form').addEventListener('submit', e => { e.preventDefault(); const v = $('p-text').value.trim(); if (v.length < 4) { $('p-text').focus(); return; } navigate('#/proposer/' + encodeURIComponent(v)); });
  $('p-text').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('p-form').requestSubmit(); } });
  on($('p-examples'), 'click', '[data-example]', el => navigate('#/proposer/' + encodeURIComponent(el.dataset.example)));
  on($('p-out'), 'click', '[data-open]', el => openLegislator(el.dataset.open, P.topic));
  on($('p-out'), 'click', '[data-area]', el => { P.topic = el.dataset.area; P.picked = true; P.subPicked = false; render(); });
  on($('p-out'), 'click', '[data-sub]', el => { P.sub = el.dataset.sub; P.picked = true; P.subPicked = true; render(); });
  on($('p-out'), 'click', '[data-act]', async el => {
    if (el.dataset.act === 'print') { document.body.classList.add('print-plan'); window.print(); document.body.classList.remove('print-plan'); }
    else { try { await navigator.clipboard.writeText(location.href); toast('Link copied.'); } catch (_) { toast('Copy the address from the address bar.'); } }
  });
}
