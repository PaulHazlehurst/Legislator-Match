// Shared by the team-only API routes. Files under api/_lib are not deployed as
// endpoints (Vercel skips underscore-prefixed paths).
//
// Vercel → Project → Settings → Environment Variables:
//   SUPABASE_URL          https://<project>.supabase.co
//   SUPABASE_SERVICE_KEY  service-role key (Supabase → Settings → API). Server only.
//   TEAM_PASSCODE         a passphrase you share with colleagues
import { timingSafeEqual } from 'node:crypto';

export function configured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && process.env.TEAM_PASSCODE);
}

export function checkPasscode(req) {
  const given = Buffer.from(String(req.headers['x-team-passcode'] || ''));
  const want = Buffer.from(String(process.env.TEAM_PASSCODE || ''));
  return want.length > 0 && given.length === want.length && timingSafeEqual(given, want);
}

// Returns false (and has already responded) when the request may not proceed.
export function guard(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!configured()) { res.status(503).json({ error: 'Team sync is not set up yet: add SUPABASE_URL, SUPABASE_SERVICE_KEY and TEAM_PASSCODE in Vercel.', code: 'not_configured' }); return false; }
  if (!checkPasscode(req)) { res.status(401).json({ error: 'Enter the team passcode to see and edit relationships.', code: 'passcode' }); return false; }
  return true;
}

export async function sb(path, { method = 'GET', body, prefer } = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body && JSON.stringify(body),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) { const e = new Error(data?.message || `Supabase HTTP ${r.status}`); e.status = r.status; throw e; }
  return data;
}

export function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b || {};
}

export const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
export const clip = (s, n) => (s == null ? null : String(s).slice(0, n));
