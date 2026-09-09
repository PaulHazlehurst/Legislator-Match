import AdmZip from 'adm-zip';

const BASE = 'https://api.legiscan.com/';
const KEY = process.env.LEGISCAN_API_KEY;

async function call(op, params = {}) {
  const qs = new URLSearchParams({ key: KEY, op, ...params });
  const url = `${BASE}?${qs}`;
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`LegiScan ${op} HTTP ${res.status}`);
      const json = await res.json();
      if (json.status !== 'OK') throw new Error(`LegiScan ${op} error: ${json.alert?.message || 'unknown'}`);
      return json;
    } catch (e) {
      lastErr = e;
      const wait = 2000 * Math.pow(2, attempt); // 2s,4s,8s,16s,32s
      console.log(`  LegiScan ${op} attempt ${attempt + 1} failed (${e.message}); retrying in ${wait / 1000}s…`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// List available session datasets for a state, optionally a single year.
export async function getDatasetList(state, year) {
  const json = await call('getDatasetList', year ? { state, year } : { state });
  return json.datasetlist || [];
}

// Download + unzip one session dataset. Returns parsed JSON grouped by type.
// The archive holds one JSON file per bill, per person, and per vote.
export async function getSessionData(dataset) {
  const json = await call('getDataset', {
    id: dataset.session_id,
    access_key: dataset.access_key,
  });
  const zipBuf = Buffer.from(json.dataset.zip, 'base64');
  const zip = new AdmZip(zipBuf);

  const out = { bills: [], people: [], votes: [] };
  const keyCounts = {};
  let jsonCount = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.endsWith('.json')) continue;
    let parsed;
    try { parsed = JSON.parse(entry.getData().toString('utf8')); }
    catch { continue; }
    jsonCount++;
    const k = Object.keys(parsed)[0] || '?';
    keyCounts[k] = (keyCounts[k] || 0) + 1;
    // Each file is wrapped, e.g. { "bill": {...} } / { "person": {...} } / { "vote"|"roll_call": {...} }
    if (parsed.bill) out.bills.push(parsed.bill);
    else if (parsed.person) out.people.push(parsed.person);
    else if (parsed.roll_call) out.votes.push(parsed.roll_call);
    else if (parsed.vote) out.votes.push(parsed.vote);
  }
  const hb = out.bills.filter(b => String(b.bill_number || '').startsWith('HB')).length;
  const sb = out.bills.filter(b => String(b.bill_number || '').startsWith('SB')).length;
  console.log(`  ZIP: ${zip.getEntries().length} entries, ${jsonCount} json, wrappers=${JSON.stringify(keyCounts)}`);
  console.log(`  parsed bills: ${out.bills.length} (HB=${hb}, SB=${sb}), people=${out.people.length}, votes=${out.votes.length}`);
  return out;
}

// ── field mappings (verified against LegiScan API v1.91) ────────────────────
export const PARTY = { 1: 'D', 2: 'R', 3: 'I' };
export const VOTE = { 1: 'yea', 2: 'nay', 3: 'nv', 4: 'absent' };

// bill.status: 1 introduced, 2 engrossed, 3 enrolled, 4 passed, 5 vetoed, 6 failed/dead
export function mapStatus(status) {
  switch (Number(status)) {
    case 4: return { outcome: 'passed',  stage: 'passed' };
    case 3: return { outcome: 'pending', stage: 'advancing' };   // passed both chambers, awaiting signature
    case 5: return { outcome: 'failed',  stage: 'vetoed' };
    case 6: return { outcome: 'failed',  stage: 'dead' };
    case 2: return { outcome: 'pending', stage: 'on_floor' };
    default: return { outcome: 'pending', stage: 'introduced' };
  }
}

// A sponsor is a co-sponsor when sponsor_type_id === 2; otherwise treat as primary.
export function sponsorRole(s) {
  return Number(s.sponsor_type_id) === 2 ? 'cosponsor' : 'primary';
}

export function chamberFromBody(bodyOrChamber) {
  const v = String(bodyOrChamber || '').toUpperCase();
  if (v.startsWith('S')) return 'senate';
  if (v.startsWith('H') || v.startsWith('A')) return 'house';
  return null;
}
