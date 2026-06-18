// ===========================================================================
// CONFIG — set this to your deployed serverless function base URL.
// See README.md "Deploying the serverless function" section.
// Example: "https://legislator-matcher-api.vercel.app"
// ===========================================================================
const API_BASE = "https://legislator-match.vercel.app";

let DATA = null;

async function init() {
  try {
    const res = await fetch('data.json?_=' + Date.now()); // cache-bust
    DATA = await res.json();
  } catch (err) {
    document.getElementById('results').innerHTML =
      '<p class="empty">Could not load data.json. Make sure it is in the same folder as this page.</p>';
    return;
  }

  populateStateDropdowns();
  populateTopicDropdowns();
  populateSubtopicDropdown('issue', 'subissue');
  populateSubtopicDropdown('f-topic', 'f-subtopic');
  populateExistingLegislatorDropdown();

  // Filter controls — issue/subissue are now datalist inputs, so 'input' event
  ['state', 'party', 'chamber'].forEach(id => {
    document.getElementById(id).addEventListener('change', render);
  });
  document.getElementById('issue').addEventListener('input', () => {
    populateSubtopicDropdown('issue', 'subissue');
    render();
  });
  document.getElementById('subissue').addEventListener('input', render);

  document.getElementById('f-topic').addEventListener('change', () => {
    populateSubtopicDropdown('f-topic', 'f-subtopic');
    toggleNewTopicInput();
  });
  document.getElementById('f-subtopic').addEventListener('change', toggleNewSubtopicInput);
  document.getElementById('f-state').addEventListener('change', () => {
    document.getElementById('f-existing-leg-search').value = '';
    populateExistingLegislatorDropdown();
  });

  setupAddPanel();
  setupDeletePanel();
  setupImportPanel();
  populateImportStateDropdown();

  document.getElementById('print-btn').addEventListener('click', () => window.print());
  document.getElementById('export-btn').addEventListener('click', handleExport);

  render();
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

function populateTopicDropdowns() {
  // Filter input — backed by a <datalist> so it's type-to-search, not a
  // plain dropdown. The input's value is the human-readable label typed
  // by the user; resolveTopicFilterValue() maps that back to a topic code.
  const filterDatalist = document.getElementById('issue-options');
  filterDatalist.innerHTML = '';
  Object.entries(DATA.topics).forEach(([code, t]) => {
    const opt = document.createElement('option');
    opt.value = t.label;
    filterDatalist.appendChild(opt);
  });

  // Default the filter input to the first topic's label if it's currently empty
  const issueInput = document.getElementById('issue');
  if (!issueInput.value) {
    const firstLabel = Object.values(DATA.topics)[0]?.label;
    if (firstLabel) issueInput.value = firstLabel;
  }

  // Form dropdown — topics plus a "create new" option (unchanged: this one
  // stays a real <select> since the add-bill form's "+ Add new topic…"
  // logic relies on <select> semantics)
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

// Resolves the currently-typed text in the #issue filter input back to its
// topic code, since the input holds a human label, not a code.
function resolveTopicFilterValue() {
  const typed = document.getElementById('issue').value.trim().toLowerCase();
  const match = Object.entries(DATA.topics).find(([code, t]) => t.label.toLowerCase() === typed);
  return match ? match[0] : null;
}

// Same idea for the #subissue filter input.
function resolveSubtopicFilterValue(topicCode) {
  const typed = document.getElementById('subissue').value.trim().toLowerCase();
  if (!typed || typed === 'all subtopics') return 'any';
  const topic = DATA.topics[topicCode];
  if (!topic) return 'any';
  const match = Object.entries(topic.subtopics).find(([code, label]) => label.toLowerCase() === typed);
  return match ? match[0] : 'any';
}

function populateSubtopicDropdown(topicSelId, subSelId) {
  // The filter path (#issue → #subissue) uses datalist inputs.
  // The form path (#f-topic → #f-subtopic) uses real <select> elements.
  if (subSelId === 'subissue') {
    populateSubtopicFilterDatalist(topicSelId);
  } else {
    populateSubtopicFormSelect(topicSelId, subSelId);
  }
}

function populateSubtopicFilterDatalist(topicSelId) {
  // Resolve the topic code from the filter input's current typed value
  const topicCode = resolveTopicFilterValue();
  const datalist = document.getElementById('subissue-options');
  datalist.innerHTML = '';
  const subInput = document.getElementById('subissue');
  subInput.value = ''; // clear subtopic when topic changes

  const topic = topicCode && DATA.topics[topicCode];
  if (!topic) return;
  Object.entries(topic.subtopics).forEach(([code, label]) => {
    const opt = document.createElement('option');
    opt.value = label;
    datalist.appendChild(opt);
  });
}

function populateSubtopicFormSelect(topicSelId, subSelId) {
  const topicCode = document.getElementById(topicSelId).value;
  const sel = document.getElementById(subSelId);
  sel.innerHTML = '';

  // Form's topic select is on "+ Add new topic…" — subtopic must also be new
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
function computeScore(bills, issue, subtopic) {
  let relevant = bills.filter(b => b.topic === issue);
  if (subtopic && subtopic !== 'any') {
    relevant = relevant.filter(b => b.subtopic === subtopic);
  }
  if (relevant.length === 0) return { score: 0, relevant, passed: 0, rate: 0 };

  const currentYear = new Date().getFullYear();

  // Recency-weighted "activity" — each bill contributes up to 1.0, decayed
  // gently by age with a floor so older bills still count for something.
  const activityWeights = relevant.map(b => {
    const age = Math.max(0, currentYear - b.year);
    return Math.max(0.4, 1 - age * 0.1);
  });
  const totalActivity = activityWeights.reduce((a, b) => a + b, 0);

  // Volume score uses a square-root curve rather than linear scaling, so a
  // single recent bill already registers as a real signal (~45) instead of
  // looking indistinguishable from "no activity," while a genuine track
  // record of 4-5+ recent bills is what's needed to approach 100. This is
  // the main lever that fixed everyone clustering at the same score
  // regardless of how many bills they actually had.
  const volumeScore = Math.min(100, Math.sqrt(totalActivity / 5) * 100);

  // Passage rate then nudges the score up or down by up to ~15%, but only
  // once there are enough decided bills (passed/failed, excluding pending)
  // for the rate to mean something — a single decided bill barely moves
  // the needle, while 4+ decided bills apply the full effect.
  const decided = relevant.filter(b => b.outcome === 'passed' || b.outcome === 'failed');
  const passed = relevant.filter(b => b.outcome === 'passed').length;
  let passageMultiplier = 1.0;
  if (decided.length > 0) {
    const passRate = passed / decided.length;
    const confidence = Math.min(1, decided.length / 4);
    const rawMultiplier = 0.85 + passRate * 0.30; // ranges 0.85x (never passes) to 1.15x (always passes)
    passageMultiplier = 1 + (rawMultiplier - 1) * confidence;
  }

  const score = Math.round(Math.min(100, volumeScore * passageMultiplier));
  const rate = decided.length > 0 ? Math.round((passed / decided.length) * 100) : 0;

  return { score, relevant, passed, rate };
}

function render() {
  const state = document.getElementById('state').value;
  const issue = resolveTopicFilterValue();
  const subissue = issue ? resolveSubtopicFilterValue(issue) : 'any';
  const party = document.getElementById('party').value;
  const chamber = document.getElementById('chamber').value;

  const stateData = DATA.states[state];
  let legislators = stateData ? stateData.legislators : [];

  if (party !== 'any') legislators = legislators.filter(l => l.party === party);
  if (chamber !== 'any') legislators = legislators.filter(l => l.chamber === chamber);

  const scored = legislators
    .map(l => ({ l, ...computeScore(l.bills, issue, subissue) }))
    .filter(item => item.relevant.length > 0)
    .sort((a, b) => b.score - a.score);

  const meta = document.getElementById('results-meta');
  const results = document.getElementById('results');

  if (!issue) {
    meta.textContent = '';
    results.innerHTML = '<p class="empty">Type a topic in the Issue area field to get started.</p>';
    return;
  }

  const topicLabel = DATA.topics[issue] ? DATA.topics[issue].label.toLowerCase() : '';
  const subLabel = (subissue !== 'any' && DATA.topics[issue]) ? DATA.topics[issue].subtopics[subissue] : null;

  if (scored.length === 0) {
    meta.textContent = '';
    results.innerHTML = '<p class="empty">No legislators with a record on this issue match these filters.</p>';
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

    const billsHtml = [...relevant]
      .sort((a, b) => b.year - a.year)
      .map(b => {
        const roleLabel = b.role === 'sponsor' ? 'Sponsor' : 'Co-sponsor';
        const subLabelInner = DATA.topics[b.topic] && DATA.topics[b.topic].subtopics[b.subtopic]
          ? DATA.topics[b.topic].subtopics[b.subtopic] : null;
        let tagClass = 'tag-pending', tagLabel = 'Pending';
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
    <div class="card">
      <div class="card-top">
        <div class="card-identity">
          <p class="name">${escapeHtml(l.name)}<span class="party-badge party-${l.party || ''}">${l.party || ''}</span></p>
          <p class="meta">${chamberLabel}${districtLabel ? ' &middot; ' + districtLabel : ''} &middot; ${partyLabel}</p>
        </div>
        <div class="score-col">
          <div class="score-ring ${scoreClass}">${score}</div>
          <span class="label">Interest</span>
        </div>
      </div>
      <div class="meter"><div class="meter-fill ${scoreClass}" style="width:${score}%;"></div></div>
      <div class="stats-row">
        <span class="stat">📋 ${relevant.length} bill${relevant.length === 1 ? '' : 's'} on this issue</span>
        <span class="stat">${decidedCount > 0 ? `✅ ${passed}/${decidedCount} passed (${rate}%)` : '⏳ No decided bills yet'}</span>
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
  const issue = resolveTopicFilterValue();
  const subissue = issue ? resolveSubtopicFilterValue(issue) : 'any';
  const party = document.getElementById('party').value;
  const chamber = document.getElementById('chamber').value;

  const stateData = DATA.states[state];
  if (!stateData || !issue) { alert('Select a state and topic first.'); return; }

  let legislators = stateData.legislators;
  if (party !== 'any') legislators = legislators.filter(l => l.party === party);
  if (chamber !== 'any') legislators = legislators.filter(l => l.chamber === chamber);

  const scored = legislators
    .map(l => ({ l, ...computeScore(l.bills, issue, subissue) }))
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
let importState = { peopleId: null, matchedName: null, stateCode: null, bills: [] };

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

    importState = { peopleId: match.peopleId, matchedName: match.name, stateCode, bills: result.bills };
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
  const topicOptionsHtml = (selectedCode) => {
    let html = Object.entries(DATA.topics).map(([code, t]) =>
      `<option value="${code}" ${code === selectedCode ? 'selected' : ''}>${escapeHtml(t.label)}</option>`
    ).join('');
    html += `<option value="__new__" ${selectedCode === '__new__' ? 'selected' : ''}>+ Add new topic…</option>`;
    return html;
  };
  const subtopicOptionsHtml = (topicCode, selectedCode) => {
    const topic = DATA.topics[topicCode];
    let html = '';
    if (topic) {
      html += Object.entries(topic.subtopics).map(([code, label]) =>
        `<option value="${code}" ${code === selectedCode ? 'selected' : ''}>${escapeHtml(label)}</option>`
      ).join('');
    }
    html += `<option value="__new__" ${selectedCode === '__new__' ? 'selected' : ''}>+ Add new subtopic…</option>`;
    return html;
  };

  container.innerHTML = importState.bills.map((b, i) => {
    const topicCode = b.topicMatch || (b.suggestedTopicLabel ? '__new__' : Object.keys(DATA.topics)[0]);
    const subtopicCode = b.subtopicMatch || (b.suggestedSubtopicLabel ? '__new__' : '');
    // LegiScan status codes: 4 = Passed, 5 = Vetoed, 6 = Failed. Anything
    // else (introduced/engrossed/enrolled-not-yet-passed) maps to pending.
    let defaultOutcome = 'pending';
    if (b.statusCode === 4) defaultOutcome = 'passed';
    else if (b.statusCode === 5 || b.statusCode === 6) defaultOutcome = 'failed';
    return `
    <div class="card" data-bill-idx="${i}">
      <label style="display:flex; align-items:flex-start; gap:8px; margin-bottom:10px; text-transform:none; font-size:13px; color:var(--text);">
        <input type="checkbox" class="import-bill-checkbox" checked style="margin-top:3px;" />
        <span style="font-weight:600; color:var(--blue-900);">${escapeHtml(b.title)}</span>
      </label>
      <div class="form-row">
        <div>
          <label>Topic</label>
          <select class="import-topic-select">${topicOptionsHtml(topicCode)}</select>
          <input type="text" class="import-topic-new" placeholder="New topic name" value="${escapeHtml(b.suggestedTopicLabel || '')}" style="display:${topicCode === '__new__' ? 'block' : 'none'}; margin-top:6px;" />
        </div>
        <div>
          <label>Subtopic</label>
          <select class="import-subtopic-select">${subtopicOptionsHtml(topicCode, subtopicCode)}</select>
          <input type="text" class="import-subtopic-new" placeholder="New subtopic name" value="${escapeHtml(b.suggestedSubtopicLabel || '')}" style="display:${subtopicCode === '__new__' ? 'block' : 'none'}; margin-top:6px;" />
        </div>
      </div>
      <div class="form-row" style="margin-top:10px;">
        <div>
          <label>Year</label>
          <input type="number" class="import-year" value="${b.year || new Date().getFullYear()}" />
        </div>
        <div>
          <label>Outcome</label>
          <select class="import-outcome">
            <option value="pending" ${defaultOutcome === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="passed" ${defaultOutcome === 'passed' ? 'selected' : ''}>Passed</option>
            <option value="failed" ${defaultOutcome === 'failed' ? 'selected' : ''}>Did not pass</option>
          </select>
        </div>
      </div>
    </div>`;
  }).join('');

  // Wire up each card's topic/subtopic select to toggle its own new-name input
  container.querySelectorAll('[data-bill-idx]').forEach(card => {
    const topicSel = card.querySelector('.import-topic-select');
    const topicNew = card.querySelector('.import-topic-new');
    const subSel = card.querySelector('.import-subtopic-select');
    const subNew = card.querySelector('.import-subtopic-new');

    topicSel.addEventListener('change', () => {
      topicNew.style.display = topicSel.value === '__new__' ? 'block' : 'none';
      subSel.innerHTML = subtopicOptionsHtml(topicSel.value, null);
      subNew.style.display = subSel.value === '__new__' ? 'block' : 'none';
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
    importState.matchedName.toLowerCase().includes(l.name.replace(/^(sen\.|del\.)\s*/i, '').toLowerCase())
  );
  const legislatorPayload = existing
    ? { mode: 'existing', legislatorId: existing.id }
    : { mode: 'new', name: importState.matchedName, party: '', chamber: '', district: '' };

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

    const topic = topicSel === '__new__' ? slugify(topicNewVal) : topicSel;
    const topicLabel = topicSel === '__new__' ? topicNewVal : DATA.topics[topicSel]?.label;
    const subtopic = subSel === '__new__' ? slugify(subNewVal) : subSel;
    const subtopicLabel = subSel === '__new__' ? subNewVal : (DATA.topics[topicSel]?.subtopics?.[subSel] || subSel);

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
  el.textContent = msg;
  el.className = 'status-msg' + (type ? ' ' + type : '');
}

function apiConfigured() {
  if (!API_BASE || API_BASE === "PASTE_YOUR_VERCEL_FUNCTION_URL_HERE") {
    alert('The serverless function URL is not set yet. See README.md to deploy it, then paste the URL into app.js (API_BASE).');
    return false;
  }
  return true;
}

init();
