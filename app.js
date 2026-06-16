// ===========================================================================
// CONFIG — set this to your deployed serverless function base URL.
// See README.md "Deploying the serverless function" section.
// Example: "https://legislator-matcher-api.vercel.app"
// ===========================================================================
const API_BASE = "PASTE_YOUR_VERCEL_FUNCTION_URL_HERE";

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
    toggleNewTopicInput();
  });
  document.getElementById('f-subtopic').addEventListener('change', toggleNewSubtopicInput);
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
  // Filter dropdown — topics only, no "create new" option
  const filterSel = document.getElementById('issue');
  filterSel.innerHTML = '';
  Object.entries(DATA.topics).forEach(([code, t]) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = t.label;
    filterSel.appendChild(opt);
  });

  // Form dropdown — topics plus a "create new" option
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

function populateSubtopicDropdown(topicSelId, subSelId) {
  const topicCode = document.getElementById(topicSelId).value;
  const sel = document.getElementById(subSelId);
  const isFilter = subSelId === 'subissue';
  const isFormTopic = topicSelId === 'f-topic';
  sel.innerHTML = '';

  if (isFilter) {
    const anyOpt = document.createElement('option');
    anyOpt.value = 'any';
    anyOpt.textContent = 'All subtopics';
    sel.appendChild(anyOpt);
  }

  // Form's topic select is on "+ Add new topic…" — subtopic must also be new
  if (isFormTopic && topicCode === '__new__') {
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

  if (isFormTopic) {
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '+ Add new subtopic…';
    sel.appendChild(newOpt);
  }
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

  // Per-bill weighted strength: sponsor counts more than co-sponsor,
  // recent bills count more than old ones. Each bill's strength maxes
  // out at 1.0 (a sponsor, this year).
  const strengths = relevant.map(b => {
    const roleWeight = b.role === 'sponsor' ? 1 : 0.55;
    const age = Math.max(0, currentYear - b.year);
    const recencyWeight = Math.max(0.35, 1 - age * 0.12);
    return roleWeight * recencyWeight;
  });

  const avgStrength = strengths.reduce((a, b) => a + b, 0) / strengths.length;

  // A small volume bonus rewards a deeper track record without punishing
  // someone who only has one or two bills on this topic so far — it adds
  // up to +20 points at 5+ bills, scaling down to 0 for a single bill.
  const volumeBonus = Math.min(20, (relevant.length - 1) * 5);

  const score = Math.min(100, Math.round(avgStrength * 80 + volumeBonus));

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
    document.getElementById('f-topic-new').style.display = 'none';
    document.getElementById('f-topic-new').value = '';
    document.getElementById('f-subtopic-new').style.display = 'none';
    document.getElementById('f-subtopic-new').value = '';
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
