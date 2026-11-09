import { STATE, loadAll, classificationUpgraded } from './store.js';
import { $, esc, num, on, closeDrawer, closeModal, openModal, memberMeta, store } from './ui.js';
import { route, startRouter, navigate } from './router.js';
import { loadRelationships } from './relationships.js';
import { setupChampions, renderLanding, openTopic, closeTopic, renderResults } from './views/champions.js';
import { openLegislator, setupLegislatorDrawer } from './views/legislator.js';
import { setupBills, renderBills, renderWatch, openBill } from './views/bills.js';
import { setupInsights, renderInsights } from './views/insights.js';
import { setupNetwork, renderNetwork } from './views/network.js';
import { setupProposer } from './views/proposer.js';
import { setupDirectory, renderDirectory } from './views/directory.js';
import { WEIGHTS } from '../shared/scoring.js';

const VIEWS = ['champions', 'bills', 'relationships', 'insights', 'proposer', 'directory', 'watchlist', 'playbook'];

function show(view) {
  VIEWS.forEach(v => { $('view-' + v).hidden = v !== view; });
  document.querySelectorAll('[data-nav]').forEach(a => a.setAttribute('aria-current', a.dataset.nav === view ? 'page' : 'false'));
  $('morebtn').classList.toggle('active', ['directory', 'watchlist', 'playbook'].includes(view));
  closeMore();
  document.title = `${({ champions: 'Champions', bills: 'Bills', relationships: 'Relationships', insights: 'Insights', proposer: 'Proposer', directory: 'Directory', watchlist: 'Watchlist', playbook: 'Playbook' })[view]} | Pinnacle Bill Intelligence`;
}

function routes() {
  route('champions', (topic, sub) => { show('champions'); topic ? openTopic(topic, sub) : closeTopic(); });
  route('bills', () => { show('bills'); renderBills(); });
  route('relationships', (action, id) => { show('relationships'); renderNetwork(action === 'add' ? id : null); });
  route('insights', () => { show('insights'); renderInsights(); });
  route('proposer', () => { show('proposer'); });
  route('directory', () => { show('directory'); renderDirectory(); });
  route('watchlist', () => { show('watchlist'); renderWatch(); });
  route('playbook', () => { show('playbook'); });
  route('legislator', (id) => { show('champions'); closeTopic(); openLegislator(id); });
  route('bill', (id) => { show('bills'); openBill(id); });
}

// ── chrome ───────────────────────────────────────────────────────────────────
function closeMore() { $('moremenu').hidden = true; $('morebtn').setAttribute('aria-expanded', 'false'); }
function setupChrome() {
  $('morebtn').addEventListener('click', e => { e.stopPropagation(); const open = $('moremenu').hidden; $('moremenu').hidden = !open; $('morebtn').setAttribute('aria-expanded', String(open)); });
  document.addEventListener('click', e => { if (!e.target.closest('.navmore')) closeMore(); });
  $('drawer-close').addEventListener('click', closeDrawer);
  $('modal-close').addEventListener('click', closeModal);
  $('scrim').addEventListener('click', () => { closeDrawer(); closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if ($('cmdk').open) return; closeModal(); closeDrawer(); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmd(); }
    if (e.key === '/' && !/input|textarea|select/i.test(e.target.tagName)) { e.preventDefault(); openCmd(); }
  });
  $('printbtn').addEventListener('click', () => window.print());
  $('themebtn').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('helpbtn').addEventListener('click', methodology);
  on(document.body, 'click', '[data-method]', methodology);
  $('cmdbtn').addEventListener('click', openCmd);
}
function setTheme(t) { document.documentElement.dataset.theme = t; store('pinnacle_theme', t); $('themebtn').setAttribute('aria-pressed', String(t === 'dark')); }

function methodology() {
  const w = WEIGHTS;
  openModal(`<article class="method">
    <h2>How the scores work</h2>
    <p>Every current member gets two scores per policy area, from three sessions of sponsorship and outcome data. Click any member to see the bills behind their numbers.</p>
    <h3><span class="k k-w"></span>Willingness: will they carry it?</h3>
    <p>Driven by the bills they <b>lead</b>. Co-sponsoring is cheap in Annapolis, so it adds a little and is capped relative to what they lead: someone who only co-signs tops out around 33. Recent sessions count more (${w.recency.join(', ')} by session), and substantive bills more than local (${w.significance.local}), procedural (${w.significance.procedural}) or ceremonial ones (${w.significance.ceremonial}). A bill whose secondary area is this one counts half. A member gets up to ${w.focusMax} extra points when this area is a big share of what they carry.</p>
    <h3><span class="k k-e"></span>Effectiveness: can they pass it?</h3>
    <p>Their real record of getting the bills they lead enacted, in completed sessions. A bill counts as a win if it became law <b>or its cross-filed companion did</b>, since in Maryland only one twin often gets the vote. Passing one chamber earns partial credit (${w.credit.passedChamber}). Small samples are pulled toward the chamber average, so one lucky bill doesn't make anyone 100%. Majority-party membership adds what the data says it's worth. The result is placed on a bell curve: 50 is a typical member, 84 is one standard deviation better.</p>
    <p>Checked against reality: a member's 2024–25 record predicts their 2026 results (correlation 0.61).</p>
    <h3><span class="k k-c"></span>Champion</h3>
    <p>The geometric mean of the two. You need both: a willing member with no record of passing bills, or a powerful one who never touches the issue, can't top the list.</p>
    <h3>Policy areas</h3>
    <p>Bills are classified by a rule engine built on the Department of Legislative Services' own subject assignments and Maryland's title conventions, with an AI second opinion on uncertain bills. On 150 hand-checked bills it picks the right area 88% of the time, and the right area or its listed secondary 97%. Any colleague with the team passcode can fix a bill from its page; fixes are never overwritten.</p>
    <h3>Absolute and relative</h3>
    <p>Absolute scores compare across all areas. Relative scores rank members against others active in the same area only.</p>
  </article>`);
}

// ── command palette ──────────────────────────────────────────────────────────
let cmdItems = [], cmdSel = 0, cmdHits = [];
function buildCmd() {
  cmdItems = [
    ...[['Champions', '#/champions'], ['Bills', '#/bills'], ['Relationships', '#/relationships'], ['Insights', '#/insights'], ['Proposer', '#/proposer'], ['Directory', '#/directory'], ['Watchlist', '#/watchlist'], ['Playbook', '#/playbook']].map(([l, h]) => ({ kind: 'Page', label: l, act: () => navigate(h) })),
    ...STATE.topics.filter(t => !t.legacy).map(t => ({ kind: 'Area', label: t.label, act: () => navigate('#/champions/' + t.code) })),
    ...STATE.legislators.map(l => ({ kind: 'Member', label: l.name, sub: `${l.party}, ${memberMeta(l)}`, act: () => openLegislator(l.id) })),
    ...STATE.bills.map(b => ({ kind: 'Bill', label: `${b.bill_number} ${b.title}`, sub: String(b.year), act: () => openBill(b.id) })),
  ];
}
function openCmd() { if (!cmdItems.length) return; $('cmdk').showModal(); $('cmdk-input').value = ''; cmdSel = 0; renderCmd(); }
function renderCmd() {
  const q = $('cmdk-input').value.trim().toLowerCase();
  cmdHits = !q ? cmdItems.filter(i => i.kind !== 'Bill' && i.kind !== 'Member').slice(0, 10)
    : cmdItems.filter(i => i.label.toLowerCase().includes(q)).sort((a, b) => (a.label.toLowerCase().startsWith(q) ? 0 : 1) - (b.label.toLowerCase().startsWith(q) ? 0 : 1)).slice(0, 12);
  cmdSel = Math.min(cmdSel, Math.max(0, cmdHits.length - 1));
  $('cmdk-results').innerHTML = cmdHits.length ? cmdHits.map((h, i) => `<li role="option" aria-selected="${i === cmdSel}" data-i="${i}"><span class="ck">${h.kind}</span><span class="cl">${esc(h.label)}</span>${h.sub ? `<span class="cs">${esc(h.sub)}</span>` : ''}</li>`).join('') : '<li class="empty">Nothing matches.</li>';
}
function runCmd(i) { const h = cmdHits[i]; if (h) { $('cmdk').close(); h.act(); } }
function setupCmd() {
  $('cmdk-input').addEventListener('input', () => { cmdSel = 0; renderCmd(); });
  $('cmdk-input').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); cmdSel = Math.min(cmdHits.length - 1, cmdSel + 1); renderCmd(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cmdSel = Math.max(0, cmdSel - 1); renderCmd(); }
    else if (e.key === 'Enter') { e.preventDefault(); runCmd(cmdSel); }
  });
  on($('cmdk-results'), 'click', '[data-i]', el => runCmd(+el.dataset.i));
  $('cmdk').addEventListener('click', e => { if (e.target === $('cmdk')) $('cmdk').close(); });
}

// ── boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  setTheme(store('pinnacle_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  setupChrome(); setupCmd();
  const prog = { bills: [0, 8000], sponsorships: [0, 37000] };
  try {
    await loadAll({ onProgress: (k, d, t) => { prog[k] = [d, t]; const done = prog.bills[0] + prog.sponsorships[0], tot = prog.bills[1] + prog.sponsorships[1]; $('loadbar').style.width = Math.round(100 * done / tot) + '%'; } });
  } catch (e) {
    $('loading').innerHTML = `<p><b>The legislative data didn't load.</b> ${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button>`;
    return;
  }
  $('loading').hidden = true; $('app').hidden = false;
  await loadRelationships();
  setupChampions(); setupBills(); setupInsights(); setupNetwork(); setupProposer(); setupDirectory(); setupLegislatorDrawer(openBill);
  renderLanding(); buildCmd(); routes();
  if (!classificationUpgraded()) {
    $('banner').hidden = false;
    $('banner').innerHTML = 'Bills in the database still use the old classifier. An admin should run <code>ingest/sql/v2_migration.sql</code>, then the <b>reclassify-all</b> step of the Data ingest workflow. Until then, some bills sit in the wrong policy area and the new areas look empty.';
  }
  const yrs = STATE.index.years.slice().sort();
  $('foot').innerHTML = `${num(STATE.bills.length)} bills from the ${yrs[0]}–${yrs.at(-1)} Maryland sessions and ${STATE.legislators.length} current members. Data loaded ${STATE.loadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. <button class="linkish" data-method>How the scores work</button>`;
  startRouter();
  window.addEventListener('relationships-changed', () => renderResults());
}

boot();
