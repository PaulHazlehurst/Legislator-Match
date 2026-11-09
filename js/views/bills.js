import { STATE } from '../store.js';
import { select } from '../api.js';
import { teamApi, getPasscode, setPasscode } from '../api.js';
import { classifyBill } from '../../shared/classifier.js';
import { invalidateInsights } from './insights.js';
import { $, esc, num, partyChip, topicLabel, subtopicLabel, resultTag, openDrawer, on, toast, store } from '../ui.js';

const WATCH_KEY = 'pinnacle_watch';
export const WATCH = new Set(store(WATCH_KEY) || []);
const saveWatch = () => { store(WATCH_KEY, [...WATCH]); const b = $('nav-watch-count'); if (b) b.textContent = WATCH.size ? ` (${WATCH.size})` : ''; };

const CONF = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };
const BY = { rules_v2: 'Rules v2', ai_review: 'AI-reviewed', manual: 'Fixed by a colleague', legiscan_subject: 'v1 subject tag', subject_keyword: 'v1 keyword', gemini: 'v1 AI', gemini_no_match: 'v1 AI (no match)', unclassified: 'Unclassified' };

export function billRow(b) {
  return `<li class="bill-row"><button class="bill-line" data-bill="${b.id}">
    <span class="bn">${esc(b.bill_number)}</span><span class="bt">${esc(b.title)}</span>
    <span class="by">${b.year}, ${esc(topicLabel(b.topic))}${b.confidence && b.confidence !== 'high' ? `, <i class="conf conf-${b.confidence}">${b.confidence} confidence</i>` : ''}</span>
    ${resultTag(b)}</button>
    <button class="star ${WATCH.has(b.id) ? 'on' : ''}" data-star="${b.id}" aria-pressed="${WATCH.has(b.id)}" title="Watch this bill"><span class="sr">Watch ${esc(b.bill_number)}</span>★</button></li>`;
}

export function renderBills() {
  const q = $('b-input').value.trim().toLowerCase(), tp = $('b-topic').value, oc = $('b-outcome').value, yr = $('b-year').value, rq = $('b-review').checked;
  if (q.length < 2 && !tp && !oc && !yr && !rq) { $('b-rows').innerHTML = '<p class="empty">Search by number or words in the title, or pick a policy area.</p>'; $('b-count').textContent = ''; return; }
  const words = q.split(/\s+/).filter(Boolean);
  const hits = [...STATE.index.billById.values()].filter(b =>
    (!tp || b.topic === tp || b.secondary === tp) && (!yr || String(b.year) === yr) &&
    (!oc || (oc === 'law' ? /^law/.test(b.result) : b.result === oc)) &&
    (!rq || b.confidence === 'low' || b.confidence === 'medium' || !b.topic) &&
    (!words.length || words.every(w => (b.bill_number + ' ' + b.title).toLowerCase().includes(w))))
    .sort((a, b) => b.year - a.year || a.bill_number.localeCompare(b.bill_number, 'en', { numeric: true }));
  $('b-count').textContent = `${num(hits.length)} bill${hits.length === 1 ? '' : 's'}`;
  $('b-rows').innerHTML = hits.length ? `<ul class="bill-list">${hits.slice(0, 150).map(billRow).join('')}</ul>${hits.length > 150 ? `<p class="note">Showing the first 150. Narrow the search to see the rest.</p>` : ''}` : '<p class="empty">No bills match. Try fewer words or clear a filter.</p>';
}

export function renderWatch() {
  const bills = [...WATCH].map(id => STATE.billById[id]).filter(Boolean);
  $('w-rows').innerHTML = bills.length ? `<ul class="bill-list">${bills.map(billRow).join('')}</ul>`
    : '<p class="empty">Nothing on your watchlist yet. Star (★) any bill in Bills to keep it here. The list is saved in this browser.</p>';
}

export async function openBill(id) {
  const b = STATE.billById[id]; if (!b) return;
  const tLabel = topicLabel(b.topic), sLabel = b.subtopic && subtopicLabel(b.topic, b.subtopic);
  openDrawer(`<header class="d-head">
      <p class="meta"><b>${esc(b.bill_number)}</b>, ${b.year} session <button class="star ${WATCH.has(b.id) ? 'on' : ''}" data-star="${b.id}" title="Watch this bill">★</button></p>
      <h2 id="drawer-title" class="bill-title">${esc(b.title)}</h2>
      <p>${resultTag(b)}</p>
    </header>
    <section class="d-sec" id="d-desc"><p class="muted">Loading summary…</p></section>
    <section class="d-sec">
      <h3>Classification</h3>
      <p class="cls"><span class="tpill">${esc(tLabel)}</span>${sLabel ? `<span class="tpill tpill-sub">${esc(sLabel)}</span>` : ''}${b.secondary ? `<span class="tpill tpill-sec" title="Secondary area: counts at half weight in scores">also ${esc(topicLabel(b.secondary))}</span>` : ''}</p>
      <p class="fine">${esc(CONF[b.confidence] || 'Confidence not recorded')}, ${esc(BY[b.classified_by] || b.classified_by || '')}. Significance: ${esc(b.significance)}.</p>
      <div id="d-why"></div>
      <details class="fix"><summary>Fix this classification</summary>${fixForm(b)}</details>
    </section>
    ${b.companions.length ? `<section class="d-sec"><h3>Cross-filed companion</h3><ul class="bills">${b.companions.map(cid => { const c = STATE.billById[cid]; return c ? `<li><button class="bill-line" data-bill="${c.id}"><span class="bn">${esc(c.bill_number)}</span><span class="bt">${esc(c.title)}</span>${resultTag(c)}</button></li>` : ''; }).join('')}</ul></section>` : ''}
    <section class="d-sec"><h3>Sponsors</h3><div id="d-spons">${sponsorsHTML(b)}</div></section>
    <section class="d-sec"><h3>Recorded votes</h3><div id="d-rolls" class="muted">Loading votes…</div></section>`);

  try {
    const [d] = await select('bills', `select=description,legiscan_subjects&id=eq.${id}`);
    const el = $('d-desc'); if (!el) return;
    el.innerHTML = d?.description ? `<p class="summary">${esc(d.description)}</p>` : '<p class="muted">No summary on file.</p>';
    const r = classifyBill({ title: b.title, description: d?.description, subjects: d?.legiscan_subjects || [] });
    $('d-why').innerHTML = `<details><summary>Why this area</summary><ul class="why">${r.evidence.map(([t, w, why]) => `<li><span class="tpill tpill-mini">${esc(topicLabel(t))}</span> ${esc(why)}${w ? ` <span class="muted">+${w}</span>` : ''}</li>`).join('')}</ul>
      <p class="fine">Subjects assigned by the Department of Legislative Services: ${esc((d?.legiscan_subjects || []).slice(0, 6).map(s => s.subject_name || s).join(', ') || 'none')}.</p>
      ${r.topic !== b.topic ? `<p class="fine">The current rules would file this under ${esc(topicLabel(r.topic))}; the stored value comes from ${esc(BY[b.classified_by] || 'an earlier pass')}.</p>` : ''}</details>`;
  } catch (_) { const el = $('d-desc'); if (el) el.innerHTML = '<p class="muted">Summary unavailable right now.</p>'; }

  try {
    const rolls = await select('roll_calls', `select=id,chamber,vote_date,description,yea,nay,nv,absent,passed&bill_id=eq.${id}&order=vote_date`);
    const el = $('d-rolls'); if (!el) return;
    el.classList.remove('muted');
    el.innerHTML = rolls.length ? `<ul class="rolls">${rolls.map(rc => { const tot = (rc.yea || 0) + (rc.nay || 0); return `<li><span class="rc-d">${esc(rc.description || 'Vote')}<span class="muted"> ${rc.chamber === 'senate' ? 'Senate' : 'House'}${rc.vote_date ? ', ' + esc(rc.vote_date) : ''}</span></span><span class="tally"><span class="y" style="width:${tot ? 100 * rc.yea / tot : 0}%"></span></span><span class="rc-n">${rc.yea}–${rc.nay}</span></li>`; }).join('')}</ul>` : '<p class="muted">No recorded roll-call votes.</p>';
  } catch (_) { const el = $('d-rolls'); if (el) el.textContent = 'Votes unavailable right now.'; }
}

function sponsorsHTML(b) {
  const sp = (STATE.sponsorsByBill.get(b.id) || []).map(s => ({ ...s, l: STATE.legById[s.legislator_id] })).filter(s => s.l);
  if (!sp.length) return '<p class="muted">Introduced by a committee or by request; no individual sponsor.</p>';
  const lead = sp.filter(s => s.role !== 'cosponsor'), co = sp.filter(s => s.role === 'cosponsor');
  const parties = sp.map(s => s.l.party), d = parties.filter(p => p === 'D').length, r = parties.filter(p => p === 'R').length;
  const btn = s => `<button class="linkish" data-leg="${s.l.id}">${partyChip(s.l.party)} ${esc(s.l.name)}</button>`;
  return `<p>${lead.map(btn).join(', ') || '<span class="muted">No individual lead sponsor</span>'}</p>
    ${co.length ? `<details><summary>${co.length} co-sponsor${co.length === 1 ? '' : 's'}: ${d} Democrat${d === 1 ? '' : 's'}, ${r} Republican${r === 1 ? '' : 's'}${d && r ? ', bipartisan' : ''}</summary><p class="cos">${co.map(btn).join(', ')}</p></details>` : ''}`;
}

function fixForm(b) {
  const opts = (sel) => STATE.topics.filter(t => !t.legacy).map(t => `<option value="${t.code}" ${t.code === sel ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
  return `<form class="fixform" data-bill="${b.id}">
    <label>Policy area<select name="topic" required>${opts(b.topic)}</select></label>
    <label>Subtopic<select name="subtopic">${subOpts(b.topic, b.subtopic)}</select></label>
    <label>Secondary area<select name="secondary"><option value="">None</option>${opts(b.secondary)}</select></label>
    ${getPasscode() ? '' : '<label>Team passcode<input name="passcode" type="password" autocomplete="current-password" required></label>'}
    <button class="btn" type="submit">Save classification</button>
    <p class="fine">Saved fixes are kept by every future automated pass.</p></form>`;
}
const subOpts = (topic, sel) => '<option value="">None</option>' + (STATE.topicByCode[topic]?.subtopics || []).map(s => `<option value="${s.code}" ${s.code === sel ? 'selected' : ''}>${esc(s.label)}</option>`).join('');

export function setupBills() {
  $('b-topic').innerHTML = '<option value="">All policy areas</option>' + STATE.topics.filter(t => !t.legacy).map(t => `<option value="${t.code}">${esc(t.label)}</option>`).join('');
  $('b-year').innerHTML = '<option value="">All sessions</option>' + STATE.index.years.map(y => `<option>${y}</option>`).join('');
  ['b-input', 'b-topic', 'b-outcome', 'b-year', 'b-review'].forEach(id => $(id).addEventListener('input', renderBills));
  // #dbody's [data-bill]/[data-leg] clicks are handled once, in setupLegislatorDrawer.
  for (const root of [$('b-rows'), $('w-rows'), $('p-out')]) on(root, 'click', '[data-bill]', el => openBill(el.dataset.bill));
  for (const root of [$('b-rows'), $('w-rows'), $('dbody'), $('p-out')]) {
    on(root, 'click', '[data-star]', (el, ev) => {
      ev.stopPropagation(); const id = el.dataset.star;
      WATCH.has(id) ? WATCH.delete(id) : WATCH.add(id); saveWatch();
      document.querySelectorAll(`[data-star="${id}"]`).forEach(s => { s.classList.toggle('on', WATCH.has(id)); s.setAttribute('aria-pressed', WATCH.has(id)); });
    });
  }
  on($('dbody'), 'change', '.fixform select[name=topic]', el => { el.form.subtopic.innerHTML = subOpts(el.value, null); });
  $('dbody').addEventListener('submit', async (ev) => {
    const f = ev.target.closest('.fixform'); if (!f) return;
    ev.preventDefault();
    if (f.passcode) setPasscode(f.passcode.value);
    const body = { billId: f.dataset.bill, topic: f.topic.value, subtopic: f.subtopic.value || null, secondary: f.secondary.value || null, user: store('pinnacle_user') || '' };
    try {
      await teamApi('bill-topic', { method: 'POST', body });
      const b = STATE.billById[body.billId];
      const patch = { topic: body.topic, subtopic: body.subtopic, secondary: body.secondary, classified_by: 'manual', confidence: 'high' };
      Object.assign(b, patch);
      Object.assign(STATE.bills.find(x => x.id === body.billId) || {}, patch);
      invalidateInsights();
      try { sessionStorage.removeItem('pinnacle_cache_v2'); } catch (_) {}
      toast('Classification saved.');
      openBill(body.billId);
    } catch (e) {
      if (e.status === 401) setPasscode('');
      toast(e.code === 'not_deployed' || e.code === 'not_configured' ? 'Fixes need team sync, which is not set up on this server yet.' : e.message, 'error');
    }
  });
  saveWatch();
}
