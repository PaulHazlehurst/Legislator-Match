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

  ['state', 'issue', 'subissue', 'party', 'chamber'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      if (id === 'issue') populateSubtopicDropdown('issue', 'subissue');
      render();
    });
  });

  document.getElementById('f-topic').addEventListener('change', () => {
    populateSubtopicDropdown('f-topic', 'f-subtopic');
  });
  document.getElementById('f-state').addEventListener('change', populateExistingLegislatorDropdown);

  setupAddPanel();
  setupDeletePanel();

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
  ['issue', 'f-topic'].forEach(selId => {
    const sel = document.getElementById(selId);
    sel.innerHTML = '';
    Object.entries(DATA.topics).forEach(([code, t]) => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = t.label;
      sel.appendChild(opt);
    });
  });
}

function populateSubtopicDropdown(topicSelId, subSelId) {
  const topicCode = document.getElementById(topicSelId).value;
  const sel = document.getElementById(subSelId);
  const isFilter = subSelId === 'subissue';
  sel.innerHTML = '';

  if (isFilter) {
    const anyOpt = document.createElement('option');
    anyOpt.value = 'any';
    anyOpt.textContent = 'All subtopics';
    sel.appendChild(anyOpt);
  }

  const topic = DATA.topics[topicCode];
  if (!topic) return;
  Object.entries(topic.subtopics).forEach(([code, label]) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = label;
    sel.appendChild(opt);
  });
}

function populateExistingLegislatorDropdown() {
  const stateCode = document.getElementById('f-state').value;
  const sel = document.getElementById('f-existing-leg');
  sel.innerHTML = '';
  const stateData = DATA.states[stateCode];
  if (!stateData) return;
  stateData.legislators
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = `${l.name} (${l.party}, ${l.chamber === 'senate' ? 'Senate' : 'House'} D${l.district || '—'})`;
      sel.appendChild(opt);
    });
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
  let raw = 0;

  relevant.forEach(b => {
    const roleWeight = b.role === 'sponsor' ? 1 : 0.5;
    const age = Math.max(0, currentYear - b.year);
    const recencyWeight = Math.max(0.3, 1 - age * 0.15);
    raw += roleWeight * recencyWeight;
  });

  const score = Math.min(100, Math.round((raw / 4) * 100));
  const decided = relevant.filter(b => b.outcome === 'passed' || b.outcome === 'failed');
  const passed = relevant.filter(b => b.outcome === 'passed').length;
  const rate = decided.length > 0 ? Math.round((passed / decided.length) * 100) : 0;

  return { score, relevant, passed, rate };
}

function render() {
  const state = document.getElementById('state').value;
  const issue = document.getElementById('issue').value;
  const subissue = document.getElementById('subissue').value;
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

    const billsHtml = [...relevant]
      .sort((a, b) => b.year - a.year)
      .map(b => {
        const roleLabel = b.role === 'sponsor' ? 'Sponsor' : 'Co-sponsor';
        const subLabelInner = DATA.topics[b.topic] && DATA.topics[b.topic].subtopics[b.subtopic]
          ? DATA.topics[b.topic].subtopics[b.subtopic] : null;
        let tagClass = 'tag-failed', tagLabel = 'Pending';
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
        <div>
          <p class="name">${escapeHtml(l.name)}</p>
          <p class="meta">${partyLabel} &middot; ${chamberLabel}${districtLabel ? ' &middot; ' + districtLabel : ''}</p>
        </div>
        <div class="score-box">
          <p class="label">Interest score</p>
          <p class="value">${score}</p>
        </div>
      </div>
      <div class="meter"><div class="meter-fill" style="width:${score}%;"></div></div>
      <div class="stats-row">
        <span>${relevant.length} bill${relevant.length === 1 ? '' : 's'} on this issue</span>
        <span>${decidedCount > 0 ? `${passed} of ${decidedCount} decided bills passed (${rate}%)` : 'No decided bills yet'}</span>
      </div>
      <details>
        <summary>Show bill history</summary>
        <ul class="bill-list">${billsHtml}</ul>
      </details>
    </div>`;
  }).join('');
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
    populateExistingLegislatorDropdown();
    document.getElementById('ai-status').textContent = '';
    document.getElementById('save-status').textContent = '';
    overlay.classList.add('open');
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
    if (result.topic && DATA.topics[result.topic]) {
      document.getElementById('f-topic').value = result.topic;
      populateSubtopicDropdown('f-topic', 'f-subtopic');
      if (result.subtopic) document.getElementById('f-subtopic').value = result.subtopic;
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

    setStatus('ai-status', 'Fields filled — review before saving.', 'success');
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
  const topic = document.getElementById('f-topic').value;
  const subtopic = document.getElementById('f-subtopic').value;
  const year = parseInt(document.getElementById('f-year').value, 10);
  const role = document.getElementById('f-role').value;
  const outcome = document.getElementById('f-outcome').value;

  if (!title) { setStatus('save-status', 'Bill title is required.', 'error'); return; }

  const bill = { title, topic, subtopic, year, role, outcome };

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
    setStatus('save-status', 'Saved! GitHub Pages will update in ~1 minute.', 'success');
    document.getElementById('add-form').reset();
    setTimeout(() => {
      document.getElementById('add-overlay').classList.remove('open');
      init(); // reload data
    }, 1200);
  } catch (err) {
    setStatus('save-status', `Save failed: ${err.message}`, 'error');
  }
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
    setStatus('delete-status', 'Deleted. Refreshing…', 'success');
    setTimeout(() => init(), 1000);
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
