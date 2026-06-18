// ===========================================================================
// CONFIG — set this to your deployed serverless function base URL.
// See README.md "Deploying the serverless function" section.
// Example: "https://legislator-matcher-api.vercel.app"
// ===========================================================================
const API_BASE = "PASTE_YOUR_VERCEL_FUNCTION_URL_HERE";

// Track current filter state for the custom searchable dropdowns
let currentIssue = null;
let currentSubissue = 'any';

async function init() {
  try {
    const res = await fetch('data.json?_=' + Date.now());
    DATA = await res.json();
  } catch (err) {
    document.getElementById('results').innerHTML =
      '<p class="empty">Could not load data.json. Make sure it is in the same folder as this page.</p>';
    return;
  }

  // Normalize all "pending" outcomes to "failed" — we only log past bills
  normalizePendingToFailed();

  populateStateDropdowns();
  buildSearchSelectDropdowns();
  populateSubtopicFormSelect('f-topic', 'f-subtopic');
  populateTopicFormDropdown();
  populateExistingLegislatorDropdown();

  ['state', 'party', 'chamber'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      render(); renderStats(); renderSidebar();
      // Refresh audit filters if audit tab is active
      if (document.getElementById('tab-audit')?.classList.contains('active')) setupAudit();
    });
  });

  document.getElementById('f-topic').addEventListener('change', () => {
    populateSubtopicFormSelect('f-topic', 'f-subtopic');
    toggleNewTopicInput();
  });
  document.getElementById('f-subtopic').addEventListener('change', toggleNewSubtopicInput);
  document.getElementById('f-state').addEventListener('change', () => {
    document.getElementById('f-existing-leg-search').value = '';
    populateExistingLegislatorDropdown();
  });

  setupTabs();
  setupSidebar();
  setupAddPanel();
  setupDeletePanel();
  setupImportPanel();
  setupSponsorPanel();
  setupKeyboardShortcuts();
  populateImportStateDropdown();

  // Restore user name from localStorage
  const savedName = localStorage.getItem('pinnacle_user_name');
  if (savedName) document.getElementById('user-name').value = savedName;
  document.getElementById('user-name').addEventListener('change', e => {
    localStorage.setItem('pinnacle_user_name', e.target.value.trim());
  });

  document.getElementById('print-btn').addEventListener('click', () => {
    // Populate print header before printing
    document.getElementById('print-date').textContent = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    const stateCode = document.getElementById('state').value;
    const stateName = DATA.states[stateCode]?.name || stateCode;
    const issueTopic = currentIssue ? DATA.topics[currentIssue]?.label : 'All topics';
    document.getElementById('print-filters').textContent = `${stateName} · ${issueTopic}`;
    setTimeout(() => window.print(), 50);
  });
  document.getElementById('export-btn').addEventListener('click', handleExport);
  document.getElementById('copy-btn').addEventListener('click', handleCopyResults);

  render();
  renderSidebar();
  renderStats();
}

function normalizePendingToFailed() {
  if (!DATA.sponsors) DATA.sponsors = {};
  Object.values(DATA.states).forEach(st => {
    st.legislators.forEach(l => {
      l.bills.forEach(b => { if (b.outcome === 'pending') b.outcome = 'failed'; });
    });
  });
}


function populateStateDropdowns() {
  ['state', 'f-state'].forEach(selId => {
    const sel = document.getElementById(selId);
    sel.innerHTML = '';
    Object.entries(DATA.states).forEach(([code, st]) => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = st.name;
      sel.appendChild(opt);
    });
  });
}

// ── CUSTOM SEARCHABLE DROPDOWN SYSTEM ──────────────────────────────────────
// Builds two searchable dropdowns for the main filter (issue area + subtopic).
// Each is a button that opens a panel with a search box at the top.

function buildSearchSelectDropdowns() {
  buildSearchSelect({
    triggerId: 'ss-issue-trigger',
    dropdownId: 'ss-issue-dropdown',
    optionsId: 'ss-issue-options',
    getOptions: () => Object.entries(DATA.topics).map(([code, t]) => ({ value: code, label: t.label })),
    anyOption: null,
    onSelect: (code, label) => {
      currentIssue = code;
      currentSubissue = 'any';
      document.getElementById('ss-issue-trigger').textContent = label;
      // Rebuild subtopic dropdown for this topic
      buildSubissueOptions();
      document.getElementById('ss-subissue-trigger').textContent = 'All subtopics';
      render();
      renderStats();
    }
  });

  buildSubissueOptions();

  // Default to first topic
  const firstEntry = Object.entries(DATA.topics)[0];
  if (firstEntry) {
    currentIssue = firstEntry[0];
    document.getElementById('ss-issue-trigger').textContent = firstEntry[1].label;
  }
}

function buildSubissueOptions() {
  buildSearchSelect({
    triggerId: 'ss-subissue-trigger',
    dropdownId: 'ss-subissue-dropdown',
    optionsId: 'ss-subissue-options',
    getOptions: () => {
      if (!currentIssue || !DATA.topics[currentIssue]) return [];
      return Object.entries(DATA.topics[currentIssue].subtopics).map(([code, label]) => ({ value: code, label }));
    },
    anyOption: 'All subtopics',
    onSelect: (code, label) => {
      currentSubissue = code || 'any';
      document.getElementById('ss-subissue-trigger').textContent = label;
      render();
    }
  });
}

function buildSearchSelect({ triggerId, dropdownId, optionsId, getOptions, anyOption, onSelect }) {
  const trigger = document.getElementById(triggerId);
  const dropdown = document.getElementById(dropdownId);
  const optionsContainer = document.getElementById(optionsId);
  const searchInput = dropdown.querySelector('.search-select-search input');
  let isOpen = false;

  function openDropdown() {
    // Close all other open dropdowns first
    document.querySelectorAll('.search-select-dropdown.open').forEach(d => {
      if (d !== dropdown) d.classList.remove('open');
    });
    document.querySelectorAll('.search-select-trigger.open').forEach(t => {
      if (t !== trigger) t.classList.remove('open');
    });
    isOpen = true;
    dropdown.classList.add('open');
    trigger.classList.add('open');
    searchInput.value = '';
    renderOptions('');
    searchInput.focus();
  }

  function closeDropdown() {
    isOpen = false;
    dropdown.classList.remove('open');
    trigger.classList.remove('open');
  }

  function renderOptions(filter) {
    const opts = getOptions();
    const needle = filter.toLowerCase();
    const filtered = opts.filter(o => !needle || o.label.toLowerCase().includes(needle));
    optionsContainer.innerHTML = '';

    if (anyOption) {
      const el = document.createElement('div');
      el.className = 'search-select-option any-opt' + (currentSubissue === 'any' ? ' selected' : '');
      el.textContent = anyOption;
      el.addEventListener('click', () => { onSelect(null, anyOption); closeDropdown(); });
      optionsContainer.appendChild(el);
    }

    if (filtered.length === 0) {
      optionsContainer.innerHTML += '<div class="search-select-empty">No matches</div>';
      return;
    }

    filtered.forEach(opt => {
      const el = document.createElement('div');
      el.className = 'search-select-option';
      el.textContent = opt.label;
      el.addEventListener('click', () => { onSelect(opt.value, opt.label); closeDropdown(); });
      optionsContainer.appendChild(el);
    });
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    isOpen ? closeDropdown() : openDropdown();
  });
  searchInput.addEventListener('input', e => renderOptions(e.target.value));
  searchInput.addEventListener('click', e => e.stopPropagation());

  // Close on outside click
  document.addEventListener('click', () => { if (isOpen) closeDropdown(); });
  dropdown.addEventListener('click', e => e.stopPropagation());
}

// ── FORM DROPDOWN POPULATION ─────────────────────────────────────────────────

function populateTopicFormDropdown() {
  const formSel = document.getElementById('f-topic');
  formSel.innerHTML = '';
  Object.entries(DATA.topics).forEach(([code, t]) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = t.label;
    formSel.appendChild(opt);
  });
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ Add new topic…';
  formSel.appendChild(newOpt);
}

function populateSubtopicFormSelect(topicSelId, subSelId) {
  const topicCode = document.getElementById(topicSelId).value;
  const sel = document.getElementById(subSelId);
  sel.innerHTML = '';

  if (topicCode === '__new__') {
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '+ Add new subtopic…';
    newOpt.selected = true;
    sel.appendChild(newOpt);
    return;
  }

  const topic = DATA.topics[topicCode];
  if (!topic) return;
  Object.entries(topic.subtopics).forEach(([code, label]) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = label;
    sel.appendChild(opt);
  });

  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ Add new subtopic…';
  sel.appendChild(newOpt);
}

// Also call this after init so the form topic list stays in sync when new
// topics are created via save
function refreshTopicFormDropdown() {
  const prev = document.getElementById('f-topic').value;
  populateTopicFormDropdown();
  if (prev) document.getElementById('f-topic').value = prev;
  populateSubtopicFormSelect('f-topic', 'f-subtopic');
}

function toggleNewTopicInput() {
  const isNew = document.getElementById('f-topic').value === '__new__';
  document.getElementById('f-topic-new').style.display = isNew ? 'block' : 'none';
  if (isNew) toggleNewSubtopicInput(); // topic being new forces subtopic new too
}

function toggleNewSubtopicInput() {
  const isNew = document.getElementById('f-subtopic').value === '__new__';
  document.getElementById('f-subtopic-new').style.display = isNew ? 'block' : 'none';
}

function populateImportStateDropdown() {
  const sel = document.getElementById('import-state');
  sel.innerHTML = '';
  Object.entries(DATA.states).forEach(([code, st]) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = st.name;
    sel.appendChild(opt);
  });
}

function populateExistingLegislatorDropdown(filterText) {
  const stateCode = document.getElementById('f-state').value;
  const sel = document.getElementById('f-existing-leg');
  const previousValue = sel.value;
  sel.innerHTML = '';
  const stateData = DATA.states[stateCode];
  if (!stateData) return;

  const needle = (filterText || '').trim().toLowerCase();

  stateData.legislators
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(l => !needle || l.name.toLowerCase().includes(needle))
    .forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = `${l.name} (${l.party}, ${l.chamber === 'senate' ? 'Senate' : 'House'} D${l.district || '—'})`;
      sel.appendChild(opt);
    });

  // Keep the previous selection if it's still in the filtered list
  if (previousValue && Array.from(sel.options).some(o => o.value === previousValue)) {
    sel.value = previousValue;
  }

  if (sel.options.length === 0) {
    const opt = document.createElement('option');
    opt.disabled = true;
    opt.textContent = 'No matches';
    sel.appendChild(opt);
  }
}

// ---------------------------------------------------------------------------
// Scoring + rendering
// ---------------------------------------------------------------------------
function computeScore(bills, issue, subtopic, legId) {
  let relevant = bills.filter(b => b.topic === issue);
  if (subtopic && subtopic !== 'any') {
    relevant = relevant.filter(b => b.subtopic === subtopic);
  }
  if (relevant.length === 0) return { score: 0, relevant, passed: 0, rate: 0 };

  const currentYear = new Date().getFullYear();

  const activityWeights = relevant.map(b => {
    const age = Math.max(0, currentYear - b.year);
    return Math.max(0.4, 1 - age * 0.1);
  });
  const totalActivity = activityWeights.reduce((a, b) => a + b, 0);
  const volumeScore = Math.min(100, Math.sqrt(totalActivity / 5) * 100);

  const decided = relevant.filter(b => b.outcome === 'passed' || b.outcome === 'failed');
  const passed = relevant.filter(b => b.outcome === 'passed').length;
  let passageMultiplier = 1.0;
  if (decided.length > 0) {
    const passRate = passed / decided.length;
    const confidence = Math.min(1, decided.length / 4);
    const rawMultiplier = 0.85 + passRate * 0.30;
    passageMultiplier = 1 + (rawMultiplier - 1) * confidence;
  }

  let baseScore = Math.round(Math.min(100, volumeScore * passageMultiplier));

  // Sponsor bonus: +8 points for legislators we have a relationship with,
  // capped at 100. This nudges them up in rankings to reflect the real-world
  // advantage of having an existing relationship.
  if (legId && isSponsor(legId)) {
    baseScore = Math.min(100, baseScore + 8);
  }

  const rate = decided.length > 0 ? Math.round((passed / decided.length) * 100) : 0;
  return { score: baseScore, relevant, passed, rate };
}

function render() {
  const state = document.getElementById('state').value;
  const issue = currentIssue;
  const subissue = currentSubissue;
  const party = document.getElementById('party').value;
  const chamber = document.getElementById('chamber').value;

  const stateData = DATA.states[state];
  let legislators = stateData ? stateData.legislators : [];

  if (party !== 'any') legislators = legislators.filter(l => l.party === party);
  if (chamber !== 'any') legislators = legislators.filter(l => l.chamber === chamber);

  const scored = legislators
    .map(l => ({ l, ...computeScore(l.bills, issue, subissue, l.id) }))
    .filter(item => item.relevant.length > 0)
    .sort((a, b) => b.score - a.score);

  const meta = document.getElementById('results-meta');
  const results = document.getElementById('results');

  if (!issue) {
    meta.textContent = '';
    results.innerHTML = '<p class="empty">Select a topic to get started.</p>';
    return;
  }

  const topicLabel = DATA.topics[issue] ? DATA.topics[issue].label.toLowerCase() : '';
  const subLabel = (subissue !== 'any' && DATA.topics[issue]) ? DATA.topics[issue].subtopics[subissue] : null;

  if (scored.length === 0) {
    meta.textContent = '';
    results.innerHTML = `<div style="text-align:center;padding:2.5rem 1rem;">
      <div style="font-size:32px;margin-bottom:12px;">🔍</div>
      <p style="font-size:15px;font-weight:600;color:var(--blue-900);margin:0 0 6px;">No legislators found for this combination</p>
      <p style="font-size:13px;color:var(--text-secondary);margin:0 0 16px;">Try broadening your filters, or import bills for legislators in this topic area.</p>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
        <button class="btn-outline" onclick="document.getElementById('open-import').click()">⬇ Import from LegiScan</button>
        <button class="btn-outline" onclick="document.getElementById('open-add').click()">+ Add a bill manually</button>
      </div>
    </div>`;
    return;
  }

  meta.textContent = `${scored.length} legislator${scored.length === 1 ? '' : 's'} with a track record on ${subLabel ? subLabel.toLowerCase() + ' (' + topicLabel + ')' : topicLabel}`;

  results.innerHTML = scored.map(item => {
    const { l, score, relevant, passed, rate } = item;
    const partyLabel = l.party === 'D' ? 'Democrat' : 'Republican';
    const chamberLabel = l.chamber === 'senate' ? 'Senate' : 'House';
    const districtLabel = l.district ? `District ${l.district}` : '';
    const decidedCount = relevant.filter(b => b.outcome === 'passed' || b.outcome === 'failed').length;
    const scoreClass = scoreColorClass(score);
    const notes = (l.notes || '').trim();
    const sponsorData = DATA.sponsors && DATA.sponsors[l.id];
    const cardSponsorClass = sponsorData ? ' is-sponsor' : '';

    // Data quality indicator — tells the team how much to trust the score
    const billCount = relevant.length;
    const dataQuality = billCount >= 4
      ? { cls: 'dq-strong', label: 'Strong data' }
      : billCount >= 2
        ? { cls: 'dq-thin', label: 'Thin data' }
        : { cls: 'dq-minimal', label: 'Minimal data' };

    const billsHtml = [...relevant]
      .sort((a, b) => b.year - a.year)
      .map(b => {
        const roleLabel = b.role === 'sponsor' ? 'Sponsor' : 'Co-sponsor';
        const subLabelInner = DATA.topics[b.topic] && DATA.topics[b.topic].subtopics[b.subtopic]
          ? DATA.topics[b.topic].subtopics[b.subtopic] : null;
        let tagClass = 'tag-pending', tagLabel = 'Prior session';
        if (b.outcome === 'passed') { tagClass = 'tag-passed'; tagLabel = 'Passed'; }
        else if (b.outcome === 'failed') { tagClass = 'tag-failed'; tagLabel = 'Did not pass'; }
        return `<li>
          <span>${escapeHtml(b.title)} <span style="color:var(--text-tertiary);">&middot; ${roleLabel}, ${b.year}</span></span>
          <span class="bill-tags">
            ${subLabelInner ? `<span class="tag tag-sub">${escapeHtml(subLabelInner)}</span>` : ''}
            <span class="tag ${tagClass}">${tagLabel}</span>
          </span>
        </li>`;
      }).join('');

    return `
    <div class="card${cardSponsorClass}" data-legid="${l.id}">
      <div class="card-top">
        <div class="card-identity">
          <p class="card-name">${escapeHtml(l.name)}
            <span class="party-badge ${l.party || ''}">${l.party || ''}</span>
            ${sponsorData ? '<span class="star-badge">⭐ Sponsor</span>' : ''}
          </p>
          <p class="card-meta">${chamberLabel}${districtLabel ? ' &middot; ' + districtLabel : ''} &middot; ${partyLabel}</p>
        </div>
        <div class="score-col">
          <div class="score-ring ${scoreClass}">${score}</div>
          <span class="score-label">Interest</span>
        </div>
      </div>
      <div class="meter"><div class="meter-fill ${scoreClass}" style="width:${score}%;"></div></div>
      <div class="stats-row">
        <span class="stat">📋 ${relevant.length} bill${relevant.length === 1 ? '' : 's'} on this issue</span>
        <span class="stat">${decidedCount > 0 ? `✅ ${passed}/${decidedCount} passed (${rate}%)` : '⏳ No decided bills yet'}</span>
        <span class="data-quality ${dataQuality.cls}" title="Score confidence based on number of bills tracked">${dataQuality.label}</span>
      </div>
      <div class="notes-row">
        ${notes
          ? `<p class="notes-text">📝 ${escapeHtml(notes)} <button class="notes-edit-btn" data-legid="${l.id}">Edit</button></p>`
          : `<button class="notes-edit-btn" data-legid="${l.id}">+ Add note</button>`
        }
        <div class="notes-input-row" id="notes-input-${l.id}" style="display:none;">
          <input type="text" placeholder="e.g. Spoke with aide Oct 2025, interested in workforce angle" value="${escapeHtml(notes)}" />
          <button class="notes-save-btn" data-legid="${l.id}" data-statecode="${state}">Save</button>
        </div>
      </div>
      <details>
        <summary>Bill history (${relevant.length})</summary>
        <ul class="bill-list">${billsHtml}</ul>
      </details>
    </div>`;
  }).join('');

  // Wire up notes toggle/save on each newly rendered card
  document.querySelectorAll('.notes-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = document.getElementById('notes-input-' + btn.dataset.legid);
      row.style.display = row.style.display === 'none' ? 'flex' : 'none';
      if (row.style.display === 'flex') row.querySelector('input').focus();
    });
  });
  document.querySelectorAll('.notes-save-btn').forEach(btn => {
    btn.addEventListener('click', () => saveNote(btn.dataset.statecode, btn.dataset.legid, btn));
  });
}

function scoreColorClass(score) {
  if (score <= 50) return 'score-low';
  if (score <= 80) return 'score-mid';
  return 'score-high';
}

// Export current results as a CSV the team can open in Excel
function handleExport() {
  const state = document.getElementById('state').value;
  const issue = currentIssue;
  const subissue = currentSubissue;
  const party = document.getElementById('party').value;
  const chamber = document.getElementById('chamber').value;

  const stateData = DATA.states[state];
  if (!stateData || !issue) { alert('Select a state and topic first.'); return; }

  let legislators = stateData.legislators;
  if (party !== 'any') legislators = legislators.filter(l => l.party === party);
  if (chamber !== 'any') legislators = legislators.filter(l => l.chamber === chamber);

  const scored = legislators
    .map(l => ({ l, ...computeScore(l.bills, issue, subissue, l.id) }))
    .filter(item => item.relevant.length > 0)
    .sort((a, b) => b.score - a.score);

  const topicLabel = DATA.topics[issue]?.label || issue;
  const rows = [
    ['Name', 'Party', 'Chamber', 'District', 'Interest Score', 'Bills on Topic', 'Passed', 'Passage Rate (%)', 'Notes']
  ];
  scored.forEach(({ l, score, relevant, passed, rate }) => {
    rows.push([
      l.name, l.party, l.chamber, l.district || '',
      score, relevant.length, passed, rate, l.notes || ''
    ]);
  });

  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `legislator-match-${topicLabel.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Save a note for a legislator directly to GitHub via the backend
async function saveNote(stateCode, legislatorId, btn) {
  if (!apiConfigured()) return;
  const row = document.getElementById('notes-input-' + legislatorId);
  const note = row.querySelector('input').value.trim();
  btn.textContent = 'Saving…';
  btn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/save-note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stateCode, legislatorId, note })
    });
    if (!res.ok) throw new Error('save failed');
    // Optimistically update local DATA so re-render shows the note
    const legObj = DATA.states[stateCode]?.legislators.find(l => l.id === legislatorId);
    if (legObj) legObj.notes = note;
    render();
  } catch {
    btn.textContent = 'Save';
    btn.disabled = false;
    alert('Could not save note. Check Vercel logs.');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// ADD PANEL
// ---------------------------------------------------------------------------
// ── TABS ──────────────────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.main-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'stats') renderStats();
      if (tab.dataset.tab === 'sponsors') renderSponsorsTab();
      if (tab.dataset.tab === 'audit') { setupAudit(); }
      if (tab.dataset.tab === 'feed') { renderFeed(); }
    });
  });
}

// ── SIDEBAR ────────────────────────────────────────────────────────────────────
function setupSidebar() {
  document.getElementById('sidebar-search').addEventListener('input', e => {
    renderSidebar(e.target.value);
  });
}

function renderSidebar(filter = '') {
  const list = document.getElementById('sidebar-list');
  const countEl = document.getElementById('sidebar-count');
  const stateCode = document.getElementById('state').value;
  const stateData = DATA.states[stateCode];
  if (!stateData) { list.innerHTML = ''; return; }

  const needle = filter.toLowerCase();
  const legs = stateData.legislators
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(l => !needle || l.name.toLowerCase().includes(needle));

  list.innerHTML = legs.map(l => {
    const chamberAbbr = l.chamber === 'senate' ? 'Sen.' : 'Del.';
    return `<div class="sidebar-leg" data-legid="${l.id}">
      <span class="leg-party ${l.party || ''}">${l.party || '?'}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(l.name.replace(/^(sen\.|del\.|rep\.)\s*/i, ''))}</span>
      ${isSponsor(l.id) ? '<span title="Our sponsor" style="font-size:11px;flex-shrink:0;">⭐</span>' : ''}
    </div>`;
  }).join('');

  countEl.textContent = `${legs.length} of ${stateData.legislators.length} legislators`;

  list.querySelectorAll('.sidebar-leg').forEach(el => {
    el.addEventListener('click', () => {
      const legId = el.dataset.legid;
      // Highlight in sidebar
      list.querySelectorAll('.sidebar-leg').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      // Scroll to the matching card in the results, or highlight legislator
      const card = document.querySelector(`.card[data-legid="${legId}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.outline = '2px solid var(--blue-500)';
        setTimeout(() => card.style.outline = '', 1800);
      }
    });
  });
}

// ── STATISTICS TAB ─────────────────────────────────────────────────────────────
function renderStats() {
  const container = document.getElementById('stats-content');
  const stateCode = document.getElementById('state').value;
  const stateData = DATA.states[stateCode];
  if (!stateData || stateData.legislators.length === 0) {
    container.innerHTML = '<p class="empty">No data yet for this state.</p>';
    return;
  }

  const allBills = [];
  let totalLegs = 0, legsWithBills = 0;
  stateData.legislators.forEach(l => {
    totalLegs++;
    if (l.bills.length > 0) legsWithBills++;
    l.bills.forEach(b => allBills.push({ ...b, legId: l.id, legName: l.name, party: l.party, chamber: l.chamber }));
  });

  const decided = allBills.filter(b => b.outcome === 'passed' || b.outcome === 'failed');
  const passed = allBills.filter(b => b.outcome === 'passed');
  const overallRate = decided.length > 0 ? Math.round((passed.length / decided.length) * 100) : 0;

  // ── AGGREGATE BY DIMENSION ──────────────────────────────────────────────
  function agg(bills, keyFn) {
    const m = {};
    bills.forEach(b => {
      const k = keyFn(b);
      if (!k) return;
      if (!m[k]) m[k] = { total: 0, passed: 0, decided: 0 };
      m[k].total++;
      if (b.outcome === 'passed') m[k].passed++;
      if (b.outcome === 'passed' || b.outcome === 'failed') m[k].decided++;
    });
    return m;
  }

  const byParty = agg(allBills, b => b.party === 'D' ? 'Democrat' : b.party === 'R' ? 'Republican' : null);
  const byChamber = agg(allBills, b => b.chamber === 'senate' ? 'Senate' : 'House / Delegates');
  const byTopic = agg(allBills, b => (DATA.topics[b.topic] && DATA.topics[b.topic].label) || b.topic || 'Unknown');

  // ── CROSSTAB: party × chamber ──────────────────────────────────────────
  const crosstab = {};
  allBills.forEach(b => {
    const party = b.party === 'D' ? 'Democrat' : b.party === 'R' ? 'Republican' : 'Other';
    const ch = b.chamber === 'senate' ? 'Senate' : 'House';
    const key = `${party}|${ch}`;
    if (!crosstab[key]) crosstab[key] = { total: 0, passed: 0, decided: 0 };
    crosstab[key].total++;
    if (b.outcome === 'passed') crosstab[key].passed++;
    if (b.outcome === 'passed' || b.outcome === 'failed') crosstab[key].decided++;
  });

  // ── LEADERBOARD: top sponsors by pass rate (min 2 decided bills) ───────
  const legStats = stateData.legislators.map(l => {
    const lb = l.bills.filter(b => b.outcome === 'passed' || b.outcome === 'failed');
    const lp = l.bills.filter(b => b.outcome === 'passed');
    return {
      id: l.id, name: l.name, party: l.party, chamber: l.chamber,
      total: l.bills.length, passed: lp.length, decided: lb.length,
      rate: lb.length >= 2 ? Math.round((lp.length / lb.length) * 100) : null
    };
  });

  const topByPassRate = legStats
    .filter(l => l.rate !== null && l.decided >= 2)
    .sort((a, b) => b.rate - a.rate || b.total - a.total)
    .slice(0, 8);

  const topByVolume = legStats
    .filter(l => l.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  // ── SPONSOR INSIGHTS ────────────────────────────────────────────────────
  const sponsors = DATA.sponsors || {};
  const sponsorIds = Object.keys(sponsors);
  const sponsorBills = allBills.filter(b => sponsorIds.includes(b.legId));
  const sponsorDecided = sponsorBills.filter(b => b.outcome === 'passed' || b.outcome === 'failed');
  const sponsorPassed = sponsorBills.filter(b => b.outcome === 'passed');
  const sponsorRate = sponsorDecided.length > 0 ? Math.round((sponsorPassed.length / sponsorDecided.length) * 100) : null;

  // ── HELPER: render bar rows ─────────────────────────────────────────────
  function barRows(obj, fillClass = '') {
    const entries = Object.entries(obj).sort((a, b) => b[1].total - a[1].total);
    const maxTotal = Math.max(...entries.map(e => e[1].total), 1);
    return entries.map(([label, d]) => {
      const rate = d.decided > 0 ? Math.round((d.passed / d.decided) * 100) : null;
      const barPct = Math.round((d.total / maxTotal) * 100);
      return `<div class="bar-row">
        <span class="bar-row-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
        <div class="bar-track"><div class="bar-fill ${fillClass}" style="width:${barPct}%"></div></div>
        <span class="bar-val">${d.total} bill${d.total === 1 ? '' : 's'}</span>
        <span class="bar-rate">${rate !== null ? rate + '% pass' : '—'}</span>
      </div>`;
    }).join('');
  }

  function leaderboardRow(l, rank) {
    const rankLabel = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `<span class="lb-rank">${rank}</span>`;
    const partyClass = l.party === 'D' ? 'D' : 'R';
    const chamberAbbr = l.chamber === 'senate' ? 'Sen.' : 'Del.';
    const isSponsor = sponsorIds.includes(l.id);
    return `<div class="leaderboard-row">
      <span style="font-size:${rank <= 3 ? '18' : '13'}px;width:24px;flex-shrink:0;text-align:center;">${rankLabel}</span>
      <span class="lb-name">${isSponsor ? '⭐ ' : ''}${escapeHtml(l.name)}${isSponsor ? '' : ''}</span>
      <span class="lb-badge party-badge ${partyClass}">${l.party}</span>
      <span class="lb-badge" style="background:var(--blue-50);color:var(--blue-700);font-size:9.5px;">${chamberAbbr}</span>
      <span class="lb-val">${l.total} bills</span>
    </div>`;
  }

  function passRateRow(l, rank) {
    const rankLabel = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `<span class="lb-rank">${rank}</span>`;
    const partyClass = l.party === 'D' ? 'D' : 'R';
    const isSponsor = sponsorIds.includes(l.id);
    const chipClass = l.rate >= 60 ? 'high' : l.rate >= 35 ? 'mid' : 'low';
    return `<div class="leaderboard-row">
      <span style="font-size:${rank <= 3 ? '18' : '13'}px;width:24px;flex-shrink:0;text-align:center;">${rankLabel}</span>
      <span class="lb-name">${isSponsor ? '⭐ ' : ''}${escapeHtml(l.name)}</span>
      <span class="lb-badge party-badge ${partyClass}">${l.party}</span>
      <span class="lb-val">${l.decided} decided</span>
      <span class="lb-score ${chipClass}">${l.rate}%</span>
    </div>`;
  }

  function crosstabRow(party, cells) {
    return `<tr>
      <td style="font-weight:600;color:${party === 'Democrat' ? '#1448A0' : party === 'Republican' ? '#A01414' : 'inherit'}">${party}</td>
      ${cells.map(k => {
        const d = crosstab[k] || { total: 0, passed: 0, decided: 0 };
        const rate = d.decided > 0 ? Math.round((d.passed / d.decided) * 100) : null;
        const chipClass = rate === null ? 'na' : rate >= 60 ? 'high' : rate >= 35 ? 'mid' : 'low';
        return `<td><span class="rate-chip ${chipClass}">${rate !== null ? rate + '%' : '—'}</span> <span style="font-size:11px;color:var(--text-secondary)">(${d.total})</span></td>`;
      }).join('')}
    </tr>`;
  }

  // ── TOPIC HEAT: which topics are getting the most action ────────────────
  const topicHeat = Object.entries(byTopic).sort((a, b) => b[1].total - a[1].total);
  const hotTopic = topicHeat[0];
  const topPartyByBills = Object.entries(byParty).sort((a, b) => b[1].total - a[1].total)[0];
  const topPartyByRate = Object.entries(byParty)
    .filter(([, d]) => d.decided >= 3)
    .sort((a, b) => (b[1].passed / b[1].decided) - (a[1].passed / a[1].decided))[0];

  // ── RENDER ──────────────────────────────────────────────────────────────
  container.innerHTML = `

    <!-- Key numbers -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card-label">Total bills tracked</div>
        <div class="stat-card-value">${allBills.length}</div>
        <div class="stat-card-sub">${decided.length} with decided outcomes</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Overall passage rate</div>
        <div class="stat-card-value">${overallRate}%</div>
        <div class="stat-card-sub">${passed.length} of ${decided.length} decided bills</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Legislators tracked</div>
        <div class="stat-card-value">${legsWithBills}</div>
        <div class="stat-card-sub">${totalLegs} total in system</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">Our sponsors</div>
        <div class="stat-card-value">${sponsorIds.length}</div>
        <div class="stat-card-sub">${sponsorRate !== null ? sponsorRate + '% pass rate' : 'No decided bills yet'}</div>
      </div>
    </div>

    <!-- Insight banner -->
    ${(hotTopic || topPartyByRate) ? `
    <div class="insight-card">
      <h3>Key insights</h3>
      ${hotTopic ? `<div class="insight-item">
        <span class="i-label">Most active topic</span>
        <span class="i-value">${escapeHtml(hotTopic[0])} <span class="insight-tag">${hotTopic[1].total} bills</span></span>
      </div>` : ''}
      ${topPartyByRate ? `<div class="insight-item">
        <span class="i-label">Best passage rate by party (3+ bills)</span>
        <span class="i-value">${escapeHtml(topPartyByRate[0])} <span class="insight-tag">${Math.round((topPartyByRate[1].passed / topPartyByRate[1].decided) * 100)}%</span></span>
      </div>` : ''}
      ${topPartyByBills ? `<div class="insight-item">
        <span class="i-label">Most bills sponsored by party</span>
        <span class="i-value">${escapeHtml(topPartyByBills[0])} <span class="insight-tag">${topPartyByBills[1].total} bills</span></span>
      </div>` : ''}
      ${sponsorIds.length > 0 && sponsorRate !== null ? `<div class="insight-item">
        <span class="i-label">Sponsor network passage rate</span>
        <span class="i-value">${sponsorRate}% <span class="insight-tag">${sponsorPassed.length} of ${sponsorDecided.length} bills</span></span>
      </div>` : ''}
    </div>` : ''}

    <!-- Party × Chamber crosstab -->
    <div class="stats-section">
      <h3>Passage rate by party &amp; chamber</h3>
      <p class="section-sub">What percentage of decided bills pass, broken down by who's sponsoring and where.</p>
      ${decided.length < 3 ? '<p class="empty" style="padding:.5rem 0;font-size:13px;">Not enough decided bills yet to show a meaningful crosstab.</p>' : `
      <table class="crosstab">
        <thead><tr>
          <th>Party</th>
          <th>Senate</th>
          <th>House / Del.</th>
        </tr></thead>
        <tbody>
          ${crosstabRow('Democrat', ['Democrat|Senate', 'Democrat|House'])}
          ${crosstabRow('Republican', ['Republican|Senate', 'Republican|House'])}
        </tbody>
      </table>`}
    </div>

    <!-- Leaderboards side by side -->
    <div class="stats-2col">
      <div class="stats-section">
        <h3>Most bills sponsored</h3>
        <p class="section-sub">By volume of primary-sponsored bills tracked.</p>
        ${topByVolume.length === 0
          ? '<p class="empty" style="padding:.5rem 0;font-size:13px;">No data yet.</p>'
          : topByVolume.map((l, i) => leaderboardRow(l, i + 1)).join('')}
      </div>
      <div class="stats-section">
        <h3>Best passage rate</h3>
        <p class="section-sub">Minimum 2 decided bills required.</p>
        ${topByPassRate.length === 0
          ? '<p class="empty" style="padding:.5rem 0;font-size:13px;">Not enough decided bills yet.</p>'
          : topByPassRate.map((l, i) => passRateRow(l, i + 1)).join('')}
      </div>
    </div>

    <!-- Bills by topic -->
    <div class="stats-section">
      <h3>Activity by topic</h3>
      <p class="section-sub">Bill volume and passage rate per issue area.</p>
      ${Object.keys(byTopic).length === 0
        ? '<p class="empty" style="padding:.5rem 0;">No bills added yet.</p>'
        : barRows(byTopic)}
    </div>

    <!-- Party + Chamber side by side -->
    <div class="stats-2col">
      <div class="stats-section">
        <h3>By party</h3>
        ${Object.keys(byParty).length === 0 ? '<p class="empty" style="padding:.5rem 0;">No data.</p>' : barRows(byParty, 'amber')}
      </div>
      <div class="stats-section">
        <h3>By chamber</h3>
        ${Object.keys(byChamber).length === 0 ? '<p class="empty" style="padding:.5rem 0;">No data.</p>' : barRows(byChamber, 'green')}
      </div>
    </div>
  `;
}

function setupAddPanel() {
  const overlay = document.getElementById('add-overlay');
  document.getElementById('open-add').addEventListener('click', () => {
    document.getElementById('f-existing-leg-search').value = '';
    populateExistingLegislatorDropdown();
    document.getElementById('ai-status').textContent = '';
    document.getElementById('save-status').textContent = '';
    document.getElementById('f-topic-new').style.display = 'none';
    document.getElementById('f-topic-new').value = '';
    document.getElementById('f-subtopic-new').style.display = 'none';
    document.getElementById('f-subtopic-new').value = '';
    overlay.classList.add('open');
  });
  document.getElementById('f-existing-leg-search').addEventListener('input', e => {
    populateExistingLegislatorDropdown(e.target.value);
  });
  document.getElementById('close-add').addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });

  document.querySelectorAll('input[name="leg-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isNew = document.querySelector('input[name="leg-mode"]:checked').value === 'new';
      document.getElementById('existing-leg-group').style.display = isNew ? 'none' : 'block';
      document.getElementById('new-leg-group').style.display = isNew ? 'block' : 'none';
    });
  });

  // AI fill from typed title
  document.getElementById('ai-fill-btn').addEventListener('click', async () => {
    const text = document.getElementById('ai-title-input').value.trim();
    if (!text) return;
    await runAiFill({ text });
  });

  // AI fill from PDF
  const dropZone = document.getElementById('file-drop');
  const fileInput = document.getElementById('file-input');
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handlePdfFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handlePdfFile(fileInput.files[0]);
  });

  document.getElementById('add-form').addEventListener('submit', handleSaveBill);
}

async function handlePdfFile(file) {
  if (file.type !== 'application/pdf') {
    setStatus('ai-status', 'Please drop a PDF file.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    const base64 = reader.result.split(',')[1];
    await runAiFill({ pdfBase64: base64 });
  };
  reader.readAsDataURL(file);
}

async function runAiFill(payload) {
  if (!apiConfigured()) return;
  setStatus('ai-status', 'Reading bill and filling fields…', 'loading');
  try {
    const res = await fetch(`${API_BASE}/api/parse-bill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, knownTopics: DATA.topics })
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const result = await res.json();

    if (result.title) document.getElementById('f-bill-title').value = result.title;
    if (result.year) document.getElementById('f-year').value = result.year;

    if (result.topicMatch && DATA.topics[result.topicMatch]) {
      // Matched an existing topic
      document.getElementById('f-topic').value = result.topicMatch;
      populateSubtopicDropdown('f-topic', 'f-subtopic');
      toggleNewTopicInput();
      if (result.subtopicMatch && DATA.topics[result.topicMatch].subtopics[result.subtopicMatch]) {
        document.getElementById('f-subtopic').value = result.subtopicMatch;
        toggleNewSubtopicInput();
      } else if (result.suggestedSubtopicLabel) {
        document.getElementById('f-subtopic').value = '__new__';
        document.getElementById('f-subtopic-new').value = result.suggestedSubtopicLabel;
        toggleNewSubtopicInput();
      }
    } else if (result.suggestedTopicLabel) {
      // No existing topic fit — select "+ Add new topic…" and pre-fill the name
      document.getElementById('f-topic').value = '__new__';
      document.getElementById('f-topic-new').value = result.suggestedTopicLabel;
      toggleNewTopicInput();
      if (result.suggestedSubtopicLabel) {
        document.getElementById('f-subtopic-new').value = result.suggestedSubtopicLabel;
      }
    }

    if (result.sponsorName) {
      document.getElementById('ai-status').dataset.sponsor = result.sponsorName;
      // try to match an existing legislator by name
      const stateCode = document.getElementById('f-state').value;
      const stateData = DATA.states[stateCode];
      const match = stateData && stateData.legislators.find(l =>
        l.name.toLowerCase().includes(result.sponsorName.toLowerCase()) ||
        result.sponsorName.toLowerCase().includes(l.name.replace(/^(sen\.|del\.)\s*/i, '').toLowerCase())
      );
      if (match) {
        document.querySelector('input[name="leg-mode"][value="existing"]').checked = true;
        document.getElementById('existing-leg-group').style.display = 'block';
        document.getElementById('new-leg-group').style.display = 'none';
        document.getElementById('f-existing-leg').value = match.id;
      } else {
        document.querySelector('input[name="leg-mode"][value="new"]').checked = true;
        document.getElementById('existing-leg-group').style.display = 'none';
        document.getElementById('new-leg-group').style.display = 'block';
        document.getElementById('f-leg-name').value = result.sponsorName;
      }
    }

    let fillMsg = 'Fields filled — review before saving.';
    if (result.suggestedTopicLabel) {
      fillMsg = `Fields filled — suggested a new topic "${result.suggestedTopicLabel}" since none of the existing ones fit. Review before saving.`;
    } else if (result.suggestedSubtopicLabel) {
      fillMsg = `Fields filled — suggested a new subtopic "${result.suggestedSubtopicLabel}". Review before saving.`;
    }
    setStatus('ai-status', fillMsg, 'success');
  } catch (err) {
    setStatus('ai-status', `AI fill failed: ${err.message}. You can still fill the form manually.`, 'error');
  }
}

async function handleSaveBill(e) {
  e.preventDefault();
  if (!apiConfigured()) return;

  const isNewLeg = document.querySelector('input[name="leg-mode"]:checked').value === 'new';
  const stateCode = document.getElementById('f-state').value;
  const title = document.getElementById('f-bill-title').value.trim();
  const year = parseInt(document.getElementById('f-year').value, 10);
  const role = document.getElementById('f-role').value;
  const outcome = document.getElementById('f-outcome').value;

  if (!title) { setStatus('save-status', 'Bill title is required.', 'error'); return; }

  // Resolve topic — either an existing code, or a brand-new one typed by the user
  let topicSel = document.getElementById('f-topic').value;
  let topic, topicLabel;
  if (topicSel === '__new__') {
    topicLabel = document.getElementById('f-topic-new').value.trim();
    if (!topicLabel) { setStatus('save-status', 'New topic name is required.', 'error'); return; }
    topic = slugify(topicLabel);
  } else {
    topic = topicSel;
    topicLabel = DATA.topics[topic] ? DATA.topics[topic].label : topic;
  }

  // Resolve subtopic the same way
  let subtopicSel = document.getElementById('f-subtopic').value;
  let subtopic = null, subtopicLabel = null;
  if (subtopicSel === '__new__') {
    subtopicLabel = document.getElementById('f-subtopic-new').value.trim();
    if (!subtopicLabel) { setStatus('save-status', 'New subtopic name is required.', 'error'); return; }
    subtopic = slugify(subtopicLabel);
  } else if (subtopicSel) {
    subtopic = subtopicSel;
    subtopicLabel = (DATA.topics[topic] && DATA.topics[topic].subtopics[subtopic])
      ? DATA.topics[topic].subtopics[subtopic] : subtopic;
  }

  const bill = { title, topic, topicLabel, subtopic, subtopicLabel, year, role, outcome };

  let legislatorPayload;
  if (isNewLeg) {
    const name = document.getElementById('f-leg-name').value.trim();
    if (!name) { setStatus('save-status', 'Legislator name is required.', 'error'); return; }
    legislatorPayload = {
      mode: 'new',
      name,
      party: document.getElementById('f-leg-party').value,
      chamber: document.getElementById('f-leg-chamber').value,
      district: document.getElementById('f-leg-district').value.trim()
    };
  } else {
    legislatorPayload = { mode: 'existing', legislatorId: document.getElementById('f-existing-leg').value };
  }

  setStatus('save-status', 'Saving to GitHub…', 'loading');
  try {
    const res = await fetch(`${API_BASE}/api/save-bill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stateCode, legislator: legislatorPayload, bill })
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server returned ${res.status}`);
    }
    const result = await res.json();
    let savedMsg = 'Saved! Waiting for GitHub Pages to publish…';
    if (result.topicWasNew) savedMsg = `Saved, and created a new topic "${topicLabel}". ` + savedMsg;
    else if (result.subtopicWasNew) savedMsg = `Saved, and created a new subtopic "${subtopicLabel}". ` + savedMsg;
    setStatus('save-status', savedMsg, 'loading');
    document.getElementById('add-form').reset();

    // Log the activity (fire-and-forget)
    const legName = (legislatorPayload.mode === 'existing')
      ? (document.getElementById('f-existing-leg').options[document.getElementById('f-existing-leg').selectedIndex]?.text || 'a legislator')
      : legislatorPayload.name;
    logActivity('add_bill', `Added "${bill.title}" for ${legName} (${topicLabel || 'unclassified'})`);

    const appeared = await waitForBillToAppear(result.billId);
    if (appeared) {
      setStatus('save-status', 'Saved and live — refreshing the page now.', 'success');
    } else {
      setStatus('save-status', 'Saved to GitHub, but the live site is taking longer than usual to update. It will show up soon — refresh in a minute if it doesn\'t.', 'success');
    }
    setTimeout(() => {
      document.getElementById('add-overlay').classList.remove('open');
      init(); // reload data
    }, 900);
  } catch (err) {
    setStatus('save-status', `Save failed: ${err.message}`, 'error');
  }
}

function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// Polls data.json (cache-busted) every couple seconds until the given
// bill ID actually shows up, since GitHub Pages typically takes
// 30-90 seconds to republish after a commit. Gives up after ~2 minutes.
async function waitForBillToAppear(billId, maxWaitMs = 120000, intervalMs = 3000) {
  if (!billId) return false;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch('data.json?_=' + Date.now());
      const fresh = await res.json();
      const found = Object.values(fresh.states).some(st =>
        st.legislators.some(l => l.bills.some(b => b.id === billId))
      );
      if (found) {
        DATA = fresh; // adopt the freshly fetched data right away
        return true;
      }
    } catch {
      // ignore transient fetch errors and keep polling
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

async function waitForBillToDisappear(billId, maxWaitMs = 120000, intervalMs = 3000) {
  if (!billId) return false;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch('data.json?_=' + Date.now());
      const fresh = await res.json();
      const stillThere = Object.values(fresh.states).some(st =>
        st.legislators.some(l => l.bills.some(b => b.id === billId))
      );
      if (!stillThere) {
        DATA = fresh;
        return true;
      }
    } catch {
      // ignore transient fetch errors and keep polling
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

// ---------------------------------------------------------------------------
// DELETE PANEL
// ---------------------------------------------------------------------------
function setupDeletePanel() {
  const overlay = document.getElementById('delete-overlay');
  document.getElementById('open-delete').addEventListener('click', () => {
    renderDeleteList();
    document.getElementById('delete-status').textContent = '';
    overlay.classList.add('open');
  });
  document.getElementById('close-delete').addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
}

// ---------------------------------------------------------------------------
// LEGISCAN IMPORT PANEL
// ---------------------------------------------------------------------------
let importState = { peopleId: null, matchedName: null, stateCode: null, party: '', chamber: '', district: '', bills: [] };

function setupImportPanel() {
  const overlay = document.getElementById('import-overlay');

  document.getElementById('open-import').addEventListener('click', () => {
    document.getElementById('import-search-step').style.display = 'block';
    document.getElementById('import-review-step').style.display = 'none';
    document.getElementById('import-search-status').textContent = '';
    document.getElementById('import-matches').innerHTML = '';
    document.getElementById('import-name').value = '';
    overlay.classList.add('open');
  });
  document.getElementById('close-import').addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });

  document.getElementById('import-search-btn').addEventListener('click', handleImportSearch);
  document.getElementById('import-back-btn').addEventListener('click', () => {
    document.getElementById('import-search-step').style.display = 'block';
    document.getElementById('import-review-step').style.display = 'none';
  });
  document.getElementById('import-save-all-btn').addEventListener('click', handleImportSaveAll);
}

async function handleImportSearch() {
  if (!apiConfigured()) return;
  const stateCode = document.getElementById('import-state').value;
  const name = document.getElementById('import-name').value.trim();
  if (!name) { setStatus('import-search-status', 'Enter a legislator name first.', 'error'); return; }

  setStatus('import-search-status', 'Searching LegiScan…', 'loading');
  document.getElementById('import-matches').innerHTML = '';

  try {
    const res = await fetch(`${API_BASE}/api/import-legiscan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'findPerson', stateCode, name })
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server returned ${res.status}`);
    }
    const result = await res.json();

    if (!result.matches || result.matches.length === 0) {
      setStatus('import-search-status', 'No matching legislator found in the current LegiScan session for that state. Check spelling, or they may not have a current-session entry yet.', 'error');
      return;
    }

    setStatus('import-search-status', `Found ${result.matches.length} match${result.matches.length === 1 ? '' : 'es'} — pick one.`, 'success');
    renderImportMatches(result.matches, stateCode);
  } catch (err) {
    setStatus('import-search-status', `Search failed: ${err.message}`, 'error');
  }
}

function renderImportMatches(matches, stateCode) {
  const container = document.getElementById('import-matches');
  container.innerHTML = matches.map((m, i) => `
    <div class="delete-item" style="margin-bottom:8px;">
      <div class="info">
        <div>${escapeHtml(m.name)}</div>
        <div class="who">${escapeHtml(m.party || '')} &middot; ${escapeHtml(m.role || '')}${m.district ? ' &middot; District ' + escapeHtml(String(m.district)) : ''}</div>
      </div>
      <button data-idx="${i}" style="border-color:var(--blue-600); color:var(--blue-700);">Select</button>
    </div>
  `).join('');

  container.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const match = matches[btn.dataset.idx];
      handleImportFetchBills(match, stateCode);
    });
  });
}

async function handleImportFetchBills(match, stateCode) {
  setStatus('import-search-status', `Fetching bills sponsored by ${match.name}…`, 'loading');

  try {
    const res = await fetch(`${API_BASE}/api/import-legiscan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fetchBills', peopleId: match.peopleId, knownTopics: DATA.topics })
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server returned ${res.status}`);
    }
    const result = await res.json();

    if (!result.bills || result.bills.length === 0) {
      setStatus('import-search-status', `${match.name} has no primary-sponsored bills in the current session.`, 'error');
      return;
    }

    importState = {
      peopleId: match.peopleId,
      matchedName: match.name,
      party: match.party || '',
      chamber: match.chamber || '',
      district: match.district || '',
      stateCode,
      bills: result.bills
    };
    document.getElementById('import-matched-name').textContent = match.name;
    document.getElementById('import-bill-count').textContent = result.bills.length;
    renderImportReview();

    document.getElementById('import-search-step').style.display = 'none';
    document.getElementById('import-review-step').style.display = 'block';
    document.getElementById('import-save-status').textContent = '';
  } catch (err) {
    setStatus('import-search-status', `Fetch failed: ${err.message}`, 'error');
  }
}

function renderImportReview() {
  const container = document.getElementById('import-bill-list');

  const needsReviewCount = importState.bills.filter(b => b.needsReview).length;
  const highConfCount = importState.bills.filter(b => b.topicMatch && b.confidence === 'high').length;

  // Summary bar above the list
  const summaryHtml = `<div style="background:var(--surface-raised);border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 14px;margin-bottom:12px;font-size:12.5px;">
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">
      <span style="color:var(--green);font-weight:600;">✓ ${highConfCount} classified with high confidence</span>
      ${needsReviewCount > 0 ? `<span style="color:var(--amber);font-weight:600;">⚠ ${needsReviewCount} need your review</span>` : ''}
      <label style="margin-left:auto;display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text-secondary);text-transform:none;cursor:pointer;">
        <input type="checkbox" id="filter-needs-review" /> Show only needs-review
      </label>
    </div>
    ${needsReviewCount > 0 ? `<p style="margin:6px 0 0;color:var(--text-secondary);font-size:12px;">Bills marked ⚠ are unchecked by default. Assign them a topic before saving, or leave them unchecked to skip.</p>` : ''}
  </div>`;

  const topicOptionsHtml = (selectedCode) => {
    let html = `<option value="">— Unclassified (skip this bill) —</option>`;
    html += Object.entries(DATA.topics).map(([code, t]) =>
      `<option value="${code}" ${code === selectedCode ? 'selected' : ''}>${escapeHtml(t.label)}</option>`
    ).join('');
    html += `<option value="__new__" ${selectedCode === '__new__' ? 'selected' : ''}>+ Add new topic…</option>`;
    return html;
  };

  const subtopicOptionsHtml = (topicCode, selectedCode) => {
    if (!topicCode) return `<option value="">—</option>`;
    const topic = DATA.topics[topicCode];
    let html = `<option value="">— None —</option>`;
    if (topic) {
      html += Object.entries(topic.subtopics).map(([code, label]) =>
        `<option value="${code}" ${code === selectedCode ? 'selected' : ''}>${escapeHtml(label)}</option>`
      ).join('');
    }
    html += `<option value="__new__" ${selectedCode === '__new__' ? 'selected' : ''}>+ Add new subtopic…</option>`;
    return html;
  };

  const billsHtml = importState.bills.map((b, i) => {
    const isHighConf = b.topicMatch && b.confidence === 'high';
    const isLowConf = b.topicMatch && b.confidence === 'low';
    const needsReview = b.needsReview;
    const topicCode = b.topicMatch || '';
    const subtopicCode = b.subtopicMatch || '';

    let defaultOutcome = 'failed';
    if (b.statusCode === 4) defaultOutcome = 'passed';
    else if (b.statusCode === 5 || b.statusCode === 6) defaultOutcome = 'failed';

    const borderColor = isHighConf ? 'var(--green)' : needsReview ? 'var(--amber)' : 'var(--border)';
    const confidenceBadge = isHighConf
      ? `<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:100px;background:var(--green-bg);color:var(--green);flex-shrink:0;">✓ High confidence</span>`
      : isLowConf
        ? `<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:100px;background:var(--amber-bg);color:var(--amber);flex-shrink:0;">⚠ Low confidence — review</span>`
        : `<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:100px;background:var(--red-bg);color:var(--red);flex-shrink:0;">✕ Unclassified — assign topic</span>`;

    // Only pre-check high-confidence bills; user must actively check low/unclassified ones
    const checked = isHighConf ? 'checked' : '';

    return `
    <div class="card" data-bill-idx="${i}" data-needs-review="${needsReview ? '1' : '0'}" style="border-left:3px solid ${borderColor};padding:.75rem 1rem;">
      <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;">
        <input type="checkbox" class="import-bill-checkbox" ${checked} style="margin-top:3px;flex-shrink:0;" />
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:12.5px;color:var(--blue-900);line-height:1.35;margin-bottom:3px;">${escapeHtml(b.title)}</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            ${confidenceBadge}
            <span style="font-size:11px;color:var(--text-tertiary);">${b.billNumber || ''} &middot; ${b.year || ''}</span>
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr auto auto;gap:8px;align-items:end;">
        <div>
          <label style="font-size:9.5px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:3px;">Topic</label>
          <select class="import-topic-select" style="height:30px;font-size:12px;">${topicOptionsHtml(topicCode)}</select>
          <input type="text" class="import-topic-new" placeholder="New topic name" value="${escapeHtml(b.suggestedTopicLabel || '')}" style="display:${topicCode === '__new__' ? 'block' : 'none'};margin-top:4px;height:30px;font-size:12px;" />
        </div>
        <div>
          <label style="font-size:9.5px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:3px;">Subtopic</label>
          <select class="import-subtopic-select" style="height:30px;font-size:12px;">${subtopicOptionsHtml(topicCode, subtopicCode)}</select>
          <input type="text" class="import-subtopic-new" placeholder="New subtopic" value="${escapeHtml(b.suggestedSubtopicLabel || '')}" style="display:${subtopicCode === '__new__' ? 'block' : 'none'};margin-top:4px;height:30px;font-size:12px;" />
        </div>
        <div>
          <label style="font-size:9.5px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:3px;">Year</label>
          <input type="number" class="import-year" value="${b.year || new Date().getFullYear()}" style="height:30px;font-size:12px;width:74px;" />
        </div>
        <div>
          <label style="font-size:9.5px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:3px;">Outcome</label>
          <select class="import-outcome" style="height:30px;font-size:12px;">
            <option value="passed" ${defaultOutcome === 'passed' ? 'selected' : ''}>Passed</option>
            <option value="failed" ${defaultOutcome === 'failed' ? 'selected' : ''}>Did not pass</option>
          </select>
        </div>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = summaryHtml + billsHtml;

  // Filter toggle
  document.getElementById('filter-needs-review').addEventListener('change', function() {
    container.querySelectorAll('[data-bill-idx]').forEach(card => {
      if (this.checked && card.dataset.needsReview !== '1') {
        card.style.display = 'none';
      } else {
        card.style.display = 'block';
      }
    });
  });

  // Wire up each card's topic/subtopic select interactions
  container.querySelectorAll('[data-bill-idx]').forEach(card => {
    const topicSel = card.querySelector('.import-topic-select');
    const topicNew = card.querySelector('.import-topic-new');
    const subSel = card.querySelector('.import-subtopic-select');
    const subNew = card.querySelector('.import-subtopic-new');
    const checkbox = card.querySelector('.import-bill-checkbox');

    topicSel.addEventListener('change', () => {
      topicNew.style.display = topicSel.value === '__new__' ? 'block' : 'none';
      subSel.innerHTML = subtopicOptionsHtml(topicSel.value, null);
      subNew.style.display = 'none';
      // Auto-check when user assigns a topic
      if (topicSel.value && topicSel.value !== '__new__') checkbox.checked = true;
    });
    subSel.addEventListener('change', () => {
      subNew.style.display = subSel.value === '__new__' ? 'block' : 'none';
    });
  });
}

let importSaveInProgress = false;

async function handleImportSaveAll() {
  if (!apiConfigured()) return;
  if (importSaveInProgress) return; // guard against double-clicks triggering duplicate saves

  const cards = document.querySelectorAll('#import-bill-list [data-bill-idx]');
  const checkedCards = Array.from(cards).filter(c => c.querySelector('.import-bill-checkbox').checked);

  if (checkedCards.length === 0) {
    setStatus('import-save-status', 'No bills selected.', 'error');
    return;
  }

  importSaveInProgress = true;
  const saveBtn = document.getElementById('import-save-all-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  // First, resolve the legislator: try to find an existing one by name in
  // this state; if none, create one (party/chamber/district unknown from
  // LegiScan in this simplified flow, so they're left blank for manual fill).
  const stateData = DATA.states[importState.stateCode];
  const existing = stateData.legislators.find(l =>
    l.name.toLowerCase().includes(importState.matchedName.toLowerCase()) ||
    importState.matchedName.toLowerCase().includes(l.name.replace(/^(sen\.|del\.|rep\.)\s*/i, '').toLowerCase())
  );


  const legislatorPayload = existing
    ? { mode: 'existing', legislatorId: existing.id }
    : {
        mode: 'new',
        name: importState.matchedName,
        party: importState.party,
        chamber: importState.chamber,
        district: String(importState.district || '')
      };

  let savedCount = 0, failedCount = 0;
  let lastBillId = null;

  setStatus('import-save-status', `Saving ${checkedCards.length} bill${checkedCards.length === 1 ? '' : 's'} to GitHub…`, 'loading');

  for (const card of checkedCards) {
    const idx = parseInt(card.dataset.billIdx, 10);
    const original = importState.bills[idx];

    const topicSel = card.querySelector('.import-topic-select').value;
    const topicNewVal = card.querySelector('.import-topic-new').value.trim();
    const subSel = card.querySelector('.import-subtopic-select').value;
    const subNewVal = card.querySelector('.import-subtopic-new').value.trim();

    // Skip bills with no topic — user left them unclassified intentionally
    if (!topicSel || topicSel === '') {
      failedCount++;
      continue;
    }

    const topic = topicSel === '__new__' ? slugify(topicNewVal) : topicSel;
    const topicLabel = topicSel === '__new__' ? topicNewVal : DATA.topics[topicSel]?.label;
    const subtopic = subSel === '__new__' ? slugify(subNewVal) : (subSel || null);
    const subtopicLabel = subSel === '__new__' ? subNewVal : (DATA.topics[topicSel]?.subtopics?.[subSel] || subSel || null);

    const bill = {
      title: original.title,
      topic, topicLabel, subtopic, subtopicLabel,
      year: parseInt(card.querySelector('.import-year').value, 10),
      role: 'sponsor', // import flow only pulls primary-sponsored bills
      outcome: card.querySelector('.import-outcome').value
    };

    try {
      const res = await fetch(`${API_BASE}/api/save-bill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stateCode: importState.stateCode, legislator: legislatorPayload, bill })
      });
      if (!res.ok) throw new Error('save failed');
      const result = await res.json();
      lastBillId = result.billId;
      // After the first new legislator is created, subsequent bills in this
      // loop should attach to that same legislator rather than create more.
      if (legislatorPayload.mode === 'new') {
        legislatorPayload.mode = 'existing';
        legislatorPayload.legislatorId = result.legislatorId;
      }
      savedCount++;
    } catch {
      failedCount++;
    }
  }

  if (savedCount > 0) {
    setStatus('import-save-status', `Saved ${savedCount} bill${savedCount === 1 ? '' : 's'}${failedCount > 0 ? `, ${failedCount} failed` : ''}. Waiting for the live site to update…`, 'loading');
    await waitForBillToAppear(lastBillId);
    setStatus('import-save-status', `Done — ${savedCount} bill${savedCount === 1 ? '' : 's'} saved and live.`, 'success');
    logActivity('import', `Imported ${savedCount} bill${savedCount === 1 ? '' : 's'} for ${importState.matchedName}`);
    setTimeout(() => {
      document.getElementById('import-overlay').classList.remove('open');
      init();
    }, 1200);
  } else {
    setStatus('import-save-status', 'All saves failed. Check the Vercel logs for details.', 'error');
  }

  importSaveInProgress = false;
  saveBtn.disabled = false;
  saveBtn.textContent = 'Save selected to GitHub';
}


function renderDeleteList() {
  const allBills = [];
  Object.entries(DATA.states).forEach(([stateCode, st]) => {
    st.legislators.forEach(l => {
      l.bills.forEach(b => {
        allBills.push({ stateCode, legislatorId: l.id, legislatorName: l.name, ...b });
      });
    });
  });

  allBills.sort((a, b) => {
    const aNum = parseInt((a.id || '').replace(/\D/g, ''), 10) || 0;
    const bNum = parseInt((b.id || '').replace(/\D/g, ''), 10) || 0;
    return bNum - aNum;
  });

  const recent = allBills.slice(0, 15);
  const list = document.getElementById('delete-list');

  if (recent.length === 0) {
    list.innerHTML = '<p class="empty">No bills to show.</p>';
    return;
  }

  list.innerHTML = recent.map(b => `
    <div class="delete-item">
      <div class="info">
        <div>${escapeHtml(b.title)}</div>
        <div class="who">${escapeHtml(b.legislatorName)} &middot; ${b.year}</div>
      </div>
      <button data-state="${b.stateCode}" data-leg="${b.legislatorId}" data-bill="${b.id}">Delete</button>
    </div>
  `).join('');

  list.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => handleDeleteBill(btn.dataset.state, btn.dataset.leg, btn.dataset.bill));
  });
}

async function handleDeleteBill(stateCode, legislatorId, billId) {
  if (!apiConfigured()) return;
  if (!confirm('Delete this bill entry? This cannot be undone from here (though it stays in GitHub history).')) return;

  setStatus('delete-status', 'Deleting…', 'loading');
  try {
    const res = await fetch(`${API_BASE}/api/delete-bill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stateCode, legislatorId, billId })
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Server returned ${res.status}`);
    }
    setStatus('delete-status', 'Deleted from GitHub. Waiting for the live site to update…', 'loading');
    const gone = await waitForBillToDisappear(billId);
    setStatus('delete-status', gone
      ? 'Removed and live — refreshing now.'
      : 'Deleted from GitHub, but the live site is taking longer than usual. It will update soon.', 'success');
    setTimeout(() => init(), 900);
  } catch (err) {
    setStatus('delete-status', `Delete failed: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function setStatus(elId, msg, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}

function apiConfigured(silent = false) {
  if (!API_BASE || API_BASE === "PASTE_YOUR_VERCEL_FUNCTION_URL_HERE") {
    if (!silent) alert('The serverless function URL is not set yet. See README.md to deploy it, then paste the URL into app.js (API_BASE).');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// AUDIT TAB
// ---------------------------------------------------------------------------
function setupAudit() {
  const stateCode = document.getElementById('state').value;
  const stateData = DATA.states[stateCode];

  // Populate legislator filter
  const legSel = document.getElementById('audit-filter-leg');
  legSel.innerHTML = '<option value="">All legislators</option>';
  if (stateData) {
    stateData.legislators
      .slice().sort((a, b) => a.name.localeCompare(b.name))
      .forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.id;
        opt.textContent = l.name;
        legSel.appendChild(opt);
      });
  }

  // Populate topic filter
  const topicSel = document.getElementById('audit-filter-topic');
  topicSel.innerHTML = '<option value="">All topics</option>';
  Object.entries(DATA.topics).forEach(([code, t]) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = t.label;
    topicSel.appendChild(opt);
  });

  legSel.addEventListener('change', renderAudit);
  topicSel.addEventListener('change', renderAudit);
  document.getElementById('audit-filter-unclassified').addEventListener('change', renderAudit);

  renderAudit();
}

function renderAudit() {
  const container = document.getElementById('audit-content');
  const stateCode = document.getElementById('state').value;
  const stateData = DATA.states[stateCode];
  if (!stateData) { container.innerHTML = '<p class="empty">No data for this state.</p>'; return; }

  const filterLeg = document.getElementById('audit-filter-leg').value;
  const filterTopic = document.getElementById('audit-filter-topic').value;
  const filterUnclassified = document.getElementById('audit-filter-unclassified').checked;

  let legs = stateData.legislators.filter(l => !filterLeg || l.id === filterLeg);

  const rows = [];
  let totalBills = 0, unclassifiedCount = 0;

  legs.forEach(l => {
    let bills = l.bills.filter(b => {
      if (filterTopic && b.topic !== filterTopic) return false;
      if (filterUnclassified && b.topic) return false;
      return true;
    });
    if (bills.length === 0) return;
    totalBills += bills.length;
    unclassifiedCount += bills.filter(b => !b.topic).length;

    rows.push(`<div class="audit-leg-header">${escapeHtml(l.name)} <span style="font-weight:400;color:var(--text-tertiary)">&middot; ${bills.length} bill${bills.length === 1 ? '' : 's'}</span></div>`);

    bills.slice().sort((a, b) => b.year - a.year).forEach(b => {
      const topicLabel = b.topic && DATA.topics[b.topic] ? DATA.topics[b.topic].label : null;
      const subtopicLabel = b.topic && b.subtopic && DATA.topics[b.topic]?.subtopics[b.subtopic]
        ? DATA.topics[b.topic].subtopics[b.subtopic] : null;
      const isUnclassified = !b.topic;
      const outcomeLabel = b.outcome === 'passed' ? 'Passed' : b.outcome === 'failed' ? 'Did not pass' : 'Prior session';
      const outcomeColor = b.outcome === 'passed' ? 'var(--green)' : 'var(--text-tertiary)';

      rows.push(`<div class="audit-row${isUnclassified ? ' unclassified' : ''}" data-leg-id="${l.id}" data-bill-id="${b.id}" data-state="${stateCode}">
        <div>
          <p class="audit-title">${escapeHtml(b.title)}</p>
          <div class="audit-meta">
            <span>${b.year || '—'}</span>
            ${isUnclassified
              ? `<span style="color:var(--amber);font-weight:700;">⚠ No topic assigned</span>`
              : `<span style="font-weight:600;color:var(--blue-700);">${escapeHtml(topicLabel || b.topic)}</span>${subtopicLabel ? `<span>${escapeHtml(subtopicLabel)}</span>` : ''}`
            }
            <span style="color:${outcomeColor}">${outcomeLabel}</span>
          </div>
        </div>
        <button class="audit-edit-btn">Edit</button>
      </div>`);
    });
  });

  if (rows.length === 0) {
    container.innerHTML = '<p class="empty">No bills match these filters.</p>';
    return;
  }

  container.innerHTML = `<p style="font-size:12px;color:var(--text-secondary);margin:0 0 10px;">${totalBills} bill${totalBills === 1 ? '' : 's'}${unclassifiedCount > 0 ? ` &middot; <span style="color:var(--amber);font-weight:600;">${unclassifiedCount} unclassified</span>` : ''}</p>` + rows.join('');

  container.querySelectorAll('.audit-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.audit-row');
      if (row.querySelector('.audit-inline-form')) {
        row.querySelector('.audit-inline-form').remove();
        return;
      }
      openAuditInlineForm(row);
    });
  });
}

function openAuditInlineForm(row) {
  const stateCode = row.dataset.state;
  const legId = row.dataset.legId;
  const billId = row.dataset.billId;
  const stateData = DATA.states[stateCode];
  if (!stateData) return;
  const leg = stateData.legislators.find(l => l.id === legId);
  if (!leg) return;
  const bill = leg.bills.find(b => b.id === billId);
  if (!bill) return;

  const topicOptionsHtml = () => {
    let html = `<option value="">— Unclassified —</option>`;
    html += Object.entries(DATA.topics).map(([code, t]) =>
      `<option value="${code}" ${code === bill.topic ? 'selected' : ''}>${escapeHtml(t.label)}</option>`
    ).join('');
    return html;
  };

  const subtopicOptionsHtml = (topicCode) => {
    let html = `<option value="">— None —</option>`;
    const topic = topicCode && DATA.topics[topicCode];
    if (topic) {
      html += Object.entries(topic.subtopics).map(([code, label]) =>
        `<option value="${code}" ${code === bill.subtopic ? 'selected' : ''}>${escapeHtml(label)}</option>`
      ).join('');
    }
    return html;
  };

  const form = document.createElement('div');
  form.className = 'audit-inline-form';
  form.innerHTML = `
    <div class="fg" style="grid-column:1/-1;">
      <label>Title</label>
      <input type="text" class="af-title" value="${escapeHtml(bill.title)}" />
    </div>
    <div class="fg">
      <label>Topic</label>
      <select class="af-topic">${topicOptionsHtml()}</select>
    </div>
    <div class="fg">
      <label>Subtopic</label>
      <select class="af-subtopic">${subtopicOptionsHtml(bill.topic)}</select>
    </div>
    <div class="fg">
      <label>Year</label>
      <input type="number" class="af-year" value="${bill.year || ''}" />
    </div>
    <div class="fg">
      <label>Outcome</label>
      <select class="af-outcome">
        <option value="passed" ${bill.outcome === 'passed' ? 'selected' : ''}>Passed</option>
        <option value="failed" ${bill.outcome === 'failed' ? 'selected' : ''}>Did not pass</option>
      </select>
    </div>
    <div class="audit-form-actions">
      <button class="audit-save-btn">Save</button>
      <button class="audit-cancel-btn">Cancel</button>
      <button class="audit-delete-btn">Delete bill</button>
    </div>
    <div class="status-msg" id="audit-status-${billId}" style="grid-column:1/-1;"></div>
  `;

  // Wire up topic change to refresh subtopic
  form.querySelector('.af-topic').addEventListener('change', function() {
    form.querySelector('.af-subtopic').innerHTML = subtopicOptionsHtml(this.value);
  });

  form.querySelector('.audit-cancel-btn').addEventListener('click', () => form.remove());

  form.querySelector('.audit-save-btn').addEventListener('click', async () => {
    if (!apiConfigured()) return;
    const topicCode = form.querySelector('.af-topic').value;
    const subtopicCode = form.querySelector('.af-subtopic').value;
    const updates = {
      title: form.querySelector('.af-title').value.trim(),
      topic: topicCode || null,
      topicLabel: topicCode ? (DATA.topics[topicCode]?.label || topicCode) : null,
      subtopic: subtopicCode || null,
      subtopicLabel: subtopicCode ? (DATA.topics[topicCode]?.subtopics?.[subtopicCode] || subtopicCode) : null,
      year: parseInt(form.querySelector('.af-year').value, 10) || bill.year,
      outcome: form.querySelector('.af-outcome').value
    };

    const statusEl = document.getElementById(`audit-status-${billId}`);
    statusEl.textContent = 'Saving…';
    statusEl.className = 'status-msg loading';

    try {
      const res = await fetch(`${API_BASE}/api/edit-bill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stateCode, legislatorId: legId, billId, updates })
      });
      if (!res.ok) throw new Error('save failed');
      // Update local DATA so re-render reflects the change
      Object.assign(bill, updates);
      logActivity('edit_bill', `Edited "${bill.title}" for ${leg.name}`);
      statusEl.textContent = 'Saved!';
      statusEl.className = 'status-msg success';
      setTimeout(() => { form.remove(); renderAudit(); render(); }, 700);
    } catch (err) {
      statusEl.textContent = `Failed: ${err.message}`;
      statusEl.className = 'status-msg error';
    }
  });

  form.querySelector('.audit-delete-btn').addEventListener('click', async () => {
    if (!confirm('Delete this bill permanently?')) return;
    if (!apiConfigured()) return;
    const statusEl = document.getElementById(`audit-status-${billId}`);
    statusEl.textContent = 'Deleting…';
    statusEl.className = 'status-msg loading';
    try {
      const res = await fetch(`${API_BASE}/api/delete-bill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stateCode, legislatorId: legId, billId })
      });
      if (!res.ok) throw new Error('delete failed');
      leg.bills = leg.bills.filter(b => b.id !== billId);
      renderAudit();
      render();
    } catch (err) {
      statusEl.textContent = `Failed: ${err.message}`;
      statusEl.className = 'status-msg error';
    }
  });

  row.appendChild(form);
}

// ---------------------------------------------------------------------------
// SPONSORS SYSTEM
// ---------------------------------------------------------------------------
function isSponsor(legId) {
  return !!(DATA.sponsors && DATA.sponsors[legId]);
}

function renderSponsorsTab() {
  const container = document.getElementById('sponsors-list');
  const sponsors = DATA.sponsors || {};
  const stateCode = document.getElementById('state').value;
  const stateData = DATA.states[stateCode];

  if (Object.keys(sponsors).length === 0) {
    container.innerHTML = '<p class="empty">No sponsors added yet. Add legislators you\'ve worked with to highlight them across the app.</p>';
    return;
  }

  // Find the legislator objects for all sponsor IDs
  const allLegs = {};
  Object.values(DATA.states).forEach(st => {
    st.legislators.forEach(l => { allLegs[l.id] = l; });
  });

  container.innerHTML = Object.entries(sponsors).map(([legId, sponsorData]) => {
    const l = allLegs[legId];
    if (!l) return '';
    const partyLabel = l.party === 'D' ? 'Democrat' : l.party === 'R' ? 'Republican' : l.party;
    const chamberLabel = l.chamber === 'senate' ? 'Senator' : 'Delegate';
    return `<div class="sponsor-card">
      <div class="sponsor-star">⭐</div>
      <div class="sponsor-body">
        <p class="sponsor-name">${escapeHtml(l.name)}</p>
        <p class="sponsor-meta">${partyLabel} &middot; ${chamberLabel}${l.district ? ' &middot; District ' + escapeHtml(l.district) : ''}</p>
        ${sponsorData.note ? `<div class="sponsor-note">${escapeHtml(sponsorData.note)}</div>` : ''}
        <div class="sponsor-actions">
          <button class="sponsor-remove-btn" data-legid="${legId}">Remove</button>
        </div>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.sponsor-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => handleRemoveSponsor(btn.dataset.legid));
  });
}

async function handleRemoveSponsor(legId) {
  if (!apiConfigured()) return;
  if (!confirm('Remove this legislator from sponsors?')) return;
  if (!DATA.sponsors) return;
  delete DATA.sponsors[legId];
  renderSponsorsTab();
  renderSidebar();
  render();
  renderStats();
  try {
    await fetch(`${API_BASE}/api/save-sponsors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sponsors: DATA.sponsors })
    });
  } catch { /* optimistic — will sync on next save */ }
}

function setupSponsorPanel() {
  const overlay = document.getElementById('sponsor-overlay');

  document.getElementById('open-add-sponsor').addEventListener('click', () => {
    document.getElementById('sponsor-status').textContent = '';
    document.getElementById('sponsor-relationship').value = '';
    document.getElementById('sponsor-search').value = '';
    populateSponsorDropdown();
    overlay.classList.add('open');
  });
  document.getElementById('close-sponsor').addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });

  document.getElementById('sponsor-state').innerHTML = '';
  Object.entries(DATA.states).forEach(([code, st]) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = st.name;
    document.getElementById('sponsor-state').appendChild(opt);
  });
  document.getElementById('sponsor-state').addEventListener('change', () => {
    document.getElementById('sponsor-search').value = '';
    populateSponsorDropdown();
  });
  document.getElementById('sponsor-search').addEventListener('input', e => populateSponsorDropdown(e.target.value));
  document.getElementById('save-sponsor-btn').addEventListener('click', handleSaveSponsor);
  populateSponsorDropdown();
}

function populateSponsorDropdown(filter = '') {
  const stateCode = document.getElementById('sponsor-state').value;
  const sel = document.getElementById('sponsor-leg');
  sel.innerHTML = '';
  const stateData = DATA.states[stateCode];
  if (!stateData) return;
  const needle = filter.toLowerCase();
  stateData.legislators
    .slice().sort((a, b) => a.name.localeCompare(b.name))
    .filter(l => !needle || l.name.toLowerCase().includes(needle))
    .forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.id;
      const alreadySponsor = isSponsor(l.id);
      opt.textContent = `${alreadySponsor ? '⭐ ' : ''}${l.name} (${l.party}, ${l.chamber === 'senate' ? 'Sen.' : 'Del.'})`;
      sel.appendChild(opt);
    });
  if (sel.options.length === 0) {
    const opt = document.createElement('option');
    opt.disabled = true;
    opt.textContent = 'No matches';
    sel.appendChild(opt);
  }
}

async function handleSaveSponsor() {
  if (!apiConfigured()) return;
  const legId = document.getElementById('sponsor-leg').value;
  const note = document.getElementById('sponsor-relationship').value.trim();
  if (!legId) { setStatus('sponsor-status', 'Select a legislator.', 'error'); return; }

  if (!DATA.sponsors) DATA.sponsors = {};
  DATA.sponsors[legId] = { addedAt: new Date().toISOString(), note };

  setStatus('sponsor-status', 'Saving…', 'loading');
  try {
    const res = await fetch(`${API_BASE}/api/save-sponsors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sponsors: DATA.sponsors })
    });
    if (!res.ok) throw new Error('save failed');
    setStatus('sponsor-status', 'Added!', 'success');
    setTimeout(() => {
      document.getElementById('sponsor-overlay').classList.remove('open');
      renderSponsorsTab();
      renderSidebar();
      render();
      renderStats();
    }, 700);
  } catch (err) {
    setStatus('sponsor-status', `Save failed: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// TEAM ACTIVITY FEED
// ---------------------------------------------------------------------------
function renderFeed() {
  const container = document.getElementById('feed-content');
  const log = DATA.activityLog;

  if (!log || log.length === 0) {
    container.innerHTML = `<div class="feed-card"><p style="font-size:13px;color:var(--text-secondary);text-align:center;padding:1rem 0;">No activity yet. When you add bills, import legislators, or edit data, it will appear here for the whole team to see.</p></div>`;
    return;
  }

  const icons = {
    add_bill: '📋',
    edit_bill: '✏️',
    delete_bill: '🗑',
    import: '⬇',
    add_sponsor: '⭐',
    add_note: '📝',
    default: '•'
  };

  function timeAgo(ts) {
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60000);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    if (d < 7) return `${d}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  function initials(name) {
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  }

  container.innerHTML = `<div class="feed-card">${log.slice(0, 50).map(entry => `
    <div class="feed-entry">
      <div class="feed-avatar" title="${escapeHtml(entry.user)}">${initials(entry.user || 'TM')}</div>
      <div class="feed-body">
        <div class="feed-who">${escapeHtml(entry.user || 'Team member')}</div>
        <div class="feed-what"><span class="feed-icon">${icons[entry.action] || icons.default}</span>${escapeHtml(entry.detail)}</div>
        <div class="feed-when">${timeAgo(entry.ts)}</div>
      </div>
    </div>`).join('')}</div>`;

  document.getElementById('refresh-feed-btn').onclick = async () => {
    try {
      const res = await fetch('data.json?_=' + Date.now());
      DATA = await res.json();
      normalizePendingToFailed();
      renderFeed();
    } catch { /* silent */ }
  };
}

// Fire-and-forget activity log — never blocks the user action
function logActivity(action, detail) {
  if (!apiConfigured(true)) return; // silent check
  const user = document.getElementById('user-name')?.value.trim() || 'Team member';
  fetch(`${API_BASE}/api/log-activity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, detail, user })
  }).catch(() => {}); // completely fire-and-forget
}

// ---------------------------------------------------------------------------
// KEYBOARD SHORTCUTS
// ---------------------------------------------------------------------------
function setupKeyboardShortcuts() {
  const toast = document.getElementById('shortcut-toast');
  let toastTimer;

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  document.addEventListener('keydown', e => {
    // Don't fire shortcuts when typing in an input/textarea/select
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Don't fire if a panel is open
    if (document.querySelector('.overlay.open')) return;

    switch(e.key) {
      case '/':
        e.preventDefault();
        // Focus the issue search trigger
        document.getElementById('ss-issue-trigger')?.click();
        showToast('/ — Search topics');
        break;
      case 'a':
        e.preventDefault();
        document.getElementById('open-add')?.click();
        showToast('A — Add bill');
        break;
      case 'i':
        e.preventDefault();
        document.getElementById('open-import')?.click();
        showToast('I — Import from LegiScan');
        break;
      case 's':
        e.preventDefault();
        document.querySelector('.main-tab[data-tab="stats"]')?.click();
        showToast('S — Statistics');
        break;
      case 'e':
        e.preventDefault();
        document.querySelector('.main-tab[data-tab="audit"]')?.click();
        showToast('E — Edit / Audit');
        break;
      case 'm':
        e.preventDefault();
        document.querySelector('.main-tab[data-tab="matcher"]')?.click();
        showToast('M — Matcher');
        break;
      case 'f':
        e.preventDefault();
        document.querySelector('.main-tab[data-tab="feed"]')?.click();
        showToast('F — Team Feed');
        break;
      case 'p':
        if (e.ctrlKey || e.metaKey) return; // let browser Ctrl+P handle itself
        e.preventDefault();
        document.getElementById('print-btn')?.click();
        showToast('P — Print report');
        break;
      case 'Escape':
        document.querySelectorAll('.overlay.open').forEach(o => o.classList.remove('open'));
        break;
    }
  });
}
// ---------------------------------------------------------------------------
function handleCopyResults() {
  const cards = document.querySelectorAll('.card');
  if (!cards.length) { alert('No results to copy.'); return; }

  const stateCode = document.getElementById('state').value;
  const stateName = DATA.states[stateCode]?.name || stateCode;
  const lines = [`Legislator Match Results — ${stateName}`, `Generated ${new Date().toLocaleDateString()}`, ''];

  cards.forEach((card, i) => {
    const name = card.querySelector('.card-name')?.textContent?.trim() || '';
    const meta = card.querySelector('.card-meta')?.textContent?.trim() || '';
    const score = card.querySelector('.score-ring')?.textContent?.trim() || '';
    const stats = card.querySelector('.stats-row')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const notes = card.querySelector('.notes-text')?.textContent?.replace('Edit', '').trim();
    lines.push(`${i + 1}. ${name}`);
    lines.push(`   ${meta}`);
    lines.push(`   Interest Score: ${score}/100`);
    lines.push(`   ${stats}`);
    if (notes && !notes.includes('Add note')) lines.push(`   Note: ${notes}`);
    lines.push('');
  });

  navigator.clipboard.writeText(lines.join('\n'))
    .then(() => {
      const btn = document.getElementById('copy-btn');
      const orig = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    })
    .catch(() => alert('Could not copy to clipboard.'));
}

init();
