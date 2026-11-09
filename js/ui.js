// Small, dependency-free UI helpers shared by every view.
import { STATE } from './store.js';

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pct = (v, d = 0) => v == null || isNaN(v) ? '—' : (100 * v).toFixed(d) + '%';
export const num = (v) => (v ?? 0).toLocaleString('en-US');
export const chamberName = (c) => c === 'senate' ? 'Senate' : 'House';
export const partyName = (p) => p === 'D' ? 'Democrat' : p === 'R' ? 'Republican' : 'Independent';
export const lastName = (n) => String(n || '').trim().split(/\s+/).slice(-1)[0];
export const topicLabel = (code) => STATE.topicByCode[code]?.label || code || 'Unclassified';
export function subtopicLabel(topic, sub) {
  return STATE.topicByCode[topic]?.subtopics.find(s => s.code === sub)?.label || null;
}
export const districtLabel = (d) => d ? String(d).replace(/^(HD|SD)-0*/, 'District ') : '';

export function memberMeta(l) {
  return [chamberName(l.chamber), districtLabel(l.district)].filter(Boolean).join(', ');
}
export function partyChip(p) {
  return `<span class="party party-${esc(p || 'I')}" title="${partyName(p)}">${esc(p || 'I')}</span>`;
}

const RESULT = {
  'law': ['Became law', 'law'],
  'law-companion': ['Law via companion', 'law'],
  'passed-chamber': ['Passed one chamber', 'part'],
  'vetoed': ['Vetoed', 'dead'],
  'died': ['Did not pass', 'dead'],
  'in-flight': ['In progress', 'live'],
};
export function resultTag(b) {
  const [label, cls] = RESULT[b.result] || ['—', 'live'];
  const tip = b.result === 'law-companion' ? 'This bill stalled, but its cross-filed companion in the other chamber became law.' : '';
  return `<span class="tag tag-${cls}"${tip ? ` title="${esc(tip)}"` : ''}>${label}</span>`;
}

// The champion dial: outer arc = Willingness, inner arc = Effectiveness,
// centre = Champion score. Arcs start at 12 o'clock and run clockwise.
export function dial(w, e, c, { size = 64, label = true } = {}) {
  const R1 = 27, R2 = 20, C1 = 2 * Math.PI * R1, C2 = 2 * Math.PI * R2;
  const arc = (r, circ, v, cls) => `<circle class="dial-track" cx="32" cy="32" r="${r}"/><circle class="${cls}" cx="32" cy="32" r="${r}" stroke-dasharray="${(circ * v / 100).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 32 32)"/>`;
  return `<figure class="dial" style="--size:${size}px" aria-label="Champion ${c}: willingness ${w}, effectiveness ${e}">
    <svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
      ${arc(R1, C1, w, 'dial-w')}${arc(R2, C2, e, 'dial-e')}
      <text x="32" y="33" class="dial-n">${c}</text>
    </svg>
    ${label ? `<figcaption><span class="k-w">W ${w}</span><span class="k-e">E ${e}</span></figcaption>` : ''}
  </figure>`;
}

export function bar(v, cls = 'w', max = 100) {
  return `<span class="meter"><span class="meter-fill m-${cls}" style="width:${Math.max(0, Math.min(100, 100 * v / max)).toFixed(1)}%"></span></span>`;
}

export function sparkline(series, { w = 64, h = 18 } = {}) {
  if (!series.length) return '';
  const max = Math.max(1, ...series);
  const pts = series.map((v, i) => [(i / Math.max(1, series.length - 1)) * (w - 4) + 2, h - 2 - (v / max) * (h - 4)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const last = pts.at(-1);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.2"/></svg>`;
}

// ── toast / drawer / modal ───────────────────────────────────────────────────
let toastTimer;
export function toast(msg, kind = 'info') {
  const el = $('toast'); el.textContent = msg; el.dataset.kind = kind; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

let lastFocus = null;
export function openDrawer(html) {
  if (!$('drawer').classList.contains('open')) lastFocus = document.activeElement;
  $('dbody').innerHTML = html;
  $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false'); $('scrim').classList.add('open');
  $('dbody').scrollTop = 0;
  setTimeout(() => $('drawer-close').focus(), 30);
}
export function closeDrawer() {
  $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden', 'true');
  if (!$('modal').classList.contains('open')) $('scrim').classList.remove('open');
  if (lastFocus?.focus) { try { lastFocus.focus(); } catch (_) {} lastFocus = null; }
}
export function openModal(html) { $('modal-body').innerHTML = html; $('modal').classList.add('open'); $('scrim').classList.add('open'); }
export function closeModal() { $('modal').classList.remove('open'); if (!$('drawer').classList.contains('open')) $('scrim').classList.remove('open'); }

export function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename; document.body.appendChild(a); a.click(); a.remove();
}

// Event delegation helper: on(container, 'click', '[data-open]', (el, ev) => …)
export function on(root, type, selector, fn) {
  root.addEventListener(type, (ev) => {
    const el = ev.target.closest(selector);
    if (el && root.contains(el)) fn(el, ev);
  });
}

export function store(key, value) {
  try { if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null'); localStorage.setItem(key, JSON.stringify(value)); } catch (_) { return null; }
}
