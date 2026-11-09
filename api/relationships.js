// /api/relationships — the Pinnacle staff relationship web.
//   GET                          → { staff: [...], relationships: [...] }
//   POST { action, ... }         save_staff | delete_staff | save_relationship | delete_relationship
// Requires the x-team-passcode header (see api/_lib/team.js).
import { guard, sb, readBody, isUuid, clip } from './_lib/team.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  try {
    if (req.method === 'GET') {
      const [staff, relationships] = await Promise.all([
        sb('staff?select=id,name,title,color&order=name'),
        sb('staff_relationships?select=id,staff_id,legislator_id,strength,kind,notes,last_contact,updated_by,updated_at&order=updated_at.desc'),
      ]);
      return res.status(200).json({ staff, relationships });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only.' });

    const { action, staff, relationship, id } = readBody(req);
    if (action === 'save_staff') {
      const name = clip(staff?.name, 120)?.trim();
      if (!name) return res.status(400).json({ error: 'Enter a name.' });
      const row = { name, title: clip(staff.title, 120) || null, color: /^#[0-9a-f]{6}$/i.test(staff.color || '') ? staff.color : null };
      const out = isUuid(staff.id)
        ? await sb(`staff?id=eq.${staff.id}`, { method: 'PATCH', body: row, prefer: 'return=representation' })
        : await sb('staff', { method: 'POST', body: row, prefer: 'return=representation' });
      return res.status(200).json({ staff: out[0] });
    }
    if (action === 'delete_staff') {
      if (!isUuid(id)) return res.status(400).json({ error: 'Unknown colleague.' });
      await sb(`staff?id=eq.${id}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }
    if (action === 'save_relationship') {
      const r = relationship || {};
      if (!isUuid(r.staff_id) || !isUuid(r.legislator_id)) return res.status(400).json({ error: 'Pick a colleague and a legislator.' });
      const strength = Math.max(1, Math.min(3, Number(r.strength) || 2));
      const row = {
        staff_id: r.staff_id, legislator_id: r.legislator_id, strength,
        kind: clip(r.kind, 60) || null, notes: clip(r.notes, 2000) || null,
        last_contact: /^\d{4}-\d{2}-\d{2}$/.test(r.last_contact || '') ? r.last_contact : null,
        updated_by: clip(r.updated_by, 80) || null, updated_at: new Date().toISOString(),
      };
      const out = await sb('staff_relationships?on_conflict=staff_id,legislator_id', {
        method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=representation' });
      return res.status(200).json({ relationship: out[0] });
    }
    if (action === 'delete_relationship') {
      if (!isUuid(id)) return res.status(400).json({ error: 'Unknown relationship.' });
      await sb(`staff_relationships?id=eq.${id}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    const missing = /relation .* does not exist|Could not find the table/i.test(e.message);
    return res.status(missing ? 503 : 500).json({
      error: missing ? 'The relationship tables are missing: run ingest/sql/v2_migration.sql in Supabase.' : e.message,
      code: missing ? 'not_configured' : 'error' });
  }
}
