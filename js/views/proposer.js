import { STATE } from '../store.js';
import { classifyBill } from '../../shared/classifier.js';
import { scoreTopic } from '../../shared/scoring.js';
import { $, esc, dial, partyChip, memberMeta, topicLabel, subtopicLabel, resultTag, on } from '../ui.js';
import { relsFor, staffColor } from '../relationships.js';
import { openLegislator } from './legislator.js';

const STOP = new Set('a an and the of for to in on by with from that this or as at be is are its into under establishing requiring altering providing prohibiting authorizing certain bill act state maryland'.split(' '));

function similarBills(text, topic) {
  const words = [...new Set(text.toLowerCase().match(/[a-z][a-z-]{3,}/g) || [])].filter(w => !STOP.has(w));
  if (!words.length) return [];
  return [...STATE.index.billById.values()].map(b => {
    const t = b.title.toLowerCase(); let s = words.filter(w => t.includes(w)).length;
    if (b.topic === topic) s += 0.5; return [s, b];
  }).filter(([s]) => s >= 2).sort((a, b) => b[0] - a[0] || b[1].year - a[1].year).slice(0, 6).map(x => x[1]);
}

function champList(topic, sub) {
  const rows = scoreTopic(STATE.index, topic, { subtopic: sub }).filter(r => r.bills_led > 0).slice(0, 6);
  if (!rows.length) return '<p class="muted">No one has led a bill on this yet.</p>';
  return `<ol class="champs champs-compact">${rows.map((r, i) => {
    const warm = relsFor(r.legislator_id).slice(0, 2).map(x => `<span class="warm" style="--c:${staffColor(x.staff)}">${esc(x.staff.name)}</span>`).join('');
    return `<li class="champ"><span class="rank">${i + 1}</span><button class="who" data-open="${r.legislator_id}" data-topic="${topic}"><span class="nm">${esc(r.name)}</span><span class="meta">${partyChip(r.party)} ${esc(memberMeta(r))}</span><span class="ev">Led ${r.bills_led}, ${r.laws} became law</span>${warm ? `<span class="badges"><span class="warm-lead">Knows them:</span>${warm}</span>` : ''}</button>${dial(r.willingness, r.effectiveness, r.champion)}</li>`;
  }).join('')}</ol>`;
}

async function run() {
  const text = $('p-text').value.trim();
  if (text.length < 8) { $('p-out').innerHTML = '<p class="empty">Describe the bill in a sentence or paste its title or summary.</p>'; return; }
  const r = classifyBill({ title: text, description: text });
  if (!r.topic) { $('p-out').innerHTML = '<p class="empty">No policy area stood out. Add a few specifics (what the bill changes, who it affects), or pick an area in Champions.</p>'; return; }
  const alt = Object.keys(r.scores).filter(t => t !== r.topic).slice(0, 2);
  const render = (topic, sub, ai) => {
    $('p-out').innerHTML = `
      <section class="p-detect">
        <p>This reads as <b>${esc(topicLabel(topic))}</b>${sub ? `, ${esc(subtopicLabel(topic, sub))}` : ''}${ai?.topicCode && ai.topicCode !== r.topic ? ' (AI analysis)' : ''}.
        ${alt.length ? `Also consider ${alt.map(t => `<button class="linkish" data-alt="${t}">${esc(topicLabel(t))}</button>`).join(' or ')}.` : ''}</p>
        ${ai?.summary ? `<p class="summary">${esc(ai.summary)}</p>` : ''}
        ${ai?.strategy ? `<p class="strategy"><b>Strategy.</b> ${esc(ai.strategy)}</p>` : ''}
        <p id="p-ai" class="fine">${ai ? '' : 'Asking the AI analyst for a summary and strategy…'}</p>
      </section>
      <section><h3>Best positioned to carry it</h3>${champList(topic, sub)}</section>
      ${(() => { const sim = similarBills(text, topic); return sim.length ? `<section><h3>Similar bills already filed</h3><ul class="bill-list">${sim.map(b => `<li class="bill-row"><button class="bill-line" data-bill="${b.id}"><span class="bn">${esc(b.bill_number)}</span><span class="bt">${esc(b.title)}</span><span class="by">${b.year}</span>${resultTag(b)}</button></li>`).join('')}</ul></section>` : ''; })()}`;
  };
  render(r.topic, r.subtopic, null);
  $('p-go').disabled = true;
  try {
    const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const ai = await res.json();
    if (!res.ok) throw new Error(ai.error || 'HTTP ' + res.status);
    const topic = STATE.topicByCode[ai.topicCode] ? ai.topicCode : r.topic;
    render(topic, topic === r.topic ? r.subtopic : null, ai);
  } catch (e) {
    const el = $('p-ai'); if (el) el.textContent = 'AI analysis is unavailable right now, so this uses the built-in classifier only.';
  } finally { $('p-go').disabled = false; }
}

export function setupProposer() {
  $('p-go').addEventListener('click', run);
  $('p-text').addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(); });
  on($('p-out'), 'click', '[data-open]', el => openLegislator(el.dataset.open, el.dataset.topic));
  on($('p-out'), 'click', '[data-alt]', el => { location.hash = '#/champions/' + el.dataset.alt; });
}
