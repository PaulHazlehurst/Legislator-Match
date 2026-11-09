// Pinnacle staff ↔ legislator relationships.
//
// Team mode: stored in Supabase (staff, staff_relationships) behind
// /api/relationships, which checks the team passcode. Nothing here is readable
// with the public key.
// Local mode: if that endpoint isn't deployed/configured yet, the same data is
// kept in this browser (and can be exported/imported) so nobody loses work.
import { teamApi, getPasscode, ApiError } from './api.js';
import { store } from './ui.js';

const LOCAL_KEY = 'pinnacle_relationships_v1';
export const REL = { mode: 'loading', staff: [], rels: [], error: null };
export const STRENGTH = { 1: 'Acquaintance', 2: 'Working relationship', 3: 'Close' };
export const STAFF_COLORS = ['#A87B12', '#7A4FA0', '#2A7F9E', '#B0573A', '#4F7A2A', '#8A3F6E', '#3D5A99', '#9C6B1F'];

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2));
const saveLocal = () => store(LOCAL_KEY, { staff: REL.staff, rels: REL.rels });
const changed = () => window.dispatchEvent(new Event('relationships-changed'));

export async function loadRelationships() {
  try {
    const j = await teamApi('relationships');
    REL.mode = 'team'; REL.staff = j.staff || []; REL.rels = j.relationships || []; REL.error = null;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { REL.mode = 'locked'; REL.error = getPasscode() ? 'That passcode was not accepted.' : null; }
    else {
      REL.mode = 'local'; REL.error = e.code === 'not_configured' ? 'not_configured' : 'not_deployed';
      const d = store(LOCAL_KEY) || {}; REL.staff = d.staff || []; REL.rels = d.rels || [];
    }
  }
  return REL;
}

export async function saveStaff({ id, name, title, color }) {
  name = String(name || '').trim(); if (!name) throw new Error('Enter a name.');
  if (REL.mode === 'team') {
    const j = await teamApi('relationships', { method: 'POST', body: { action: 'save_staff', staff: { id, name, title, color } } });
    upsert(REL.staff, j.staff);
    return j.staff;
  }
  const s = { id: id || uid(), name, title: title || '', color: color || STAFF_COLORS[REL.staff.length % STAFF_COLORS.length] };
  upsert(REL.staff, s); saveLocal(); return s;
}
export async function deleteStaff(id) {
  if (REL.mode === 'team') await teamApi('relationships', { method: 'POST', body: { action: 'delete_staff', id } });
  REL.staff = REL.staff.filter(s => s.id !== id); REL.rels = REL.rels.filter(r => r.staff_id !== id);
  if (REL.mode !== 'team') saveLocal();
  changed();
}
export async function saveRel(r) {
  const row = { id: r.id, staff_id: r.staff_id, legislator_id: r.legislator_id, strength: Number(r.strength) || 2,
    kind: r.kind || '', notes: r.notes || '', last_contact: r.last_contact || null, updated_by: r.updated_by || '' };
  if (!row.staff_id || !row.legislator_id) throw new Error('Pick a colleague and a legislator.');
  if (REL.mode === 'team') {
    const j = await teamApi('relationships', { method: 'POST', body: { action: 'save_relationship', relationship: row } });
    REL.rels = REL.rels.filter(x => !(x.staff_id === row.staff_id && x.legislator_id === row.legislator_id));
    REL.rels.push(j.relationship); changed(); return j.relationship;
  }
  const existing = REL.rels.find(x => x.staff_id === row.staff_id && x.legislator_id === row.legislator_id);
  const saved = { ...existing, ...row, id: existing?.id || row.id || uid(), updated_at: new Date().toISOString() };
  REL.rels = REL.rels.filter(x => x !== existing); REL.rels.push(saved); saveLocal(); changed(); return saved;
}
export async function deleteRel(id) {
  if (REL.mode === 'team') await teamApi('relationships', { method: 'POST', body: { action: 'delete_relationship', id } });
  REL.rels = REL.rels.filter(r => r.id !== id);
  if (REL.mode !== 'team') saveLocal();
  changed();
}

export function relsFor(legislatorId) {
  return REL.rels.filter(r => r.legislator_id === legislatorId)
    .map(r => ({ ...r, staff: REL.staff.find(s => s.id === r.staff_id) }))
    .filter(r => r.staff).sort((a, b) => b.strength - a.strength);
}
export const staffColor = (s) => s?.color || STAFF_COLORS[Math.max(0, REL.staff.indexOf(s)) % STAFF_COLORS.length];

export function exportLocal() { return JSON.stringify({ staff: REL.staff, rels: REL.rels, exported_at: new Date().toISOString() }, null, 2); }
export function importLocal(text) {
  const d = JSON.parse(text);
  if (!Array.isArray(d.staff) || !Array.isArray(d.rels)) throw new Error('That file is not a relationship export.');
  REL.staff = d.staff; REL.rels = d.rels; saveLocal();
}

function upsert(list, item) { const i = list.findIndex(x => x.id === item.id); if (i >= 0) list[i] = item; else list.push(item); }
