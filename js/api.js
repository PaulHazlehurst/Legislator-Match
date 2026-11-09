// Thin clients for the two backends the page talks to:
//   • Supabase PostgREST (public, read-only anon key — RLS blocks writes)
//   • this app's own /api/* functions on Vercel (team passcode required)

export const SB_URL = 'https://pnqbhsckbcrfbksymyxh.supabase.co';
export const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBucWJoc2NrYmNyZmJrc3lteXhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyOTM4NDQsImV4cCI6MjEwMzg2OTg0NH0.FDSVZDCwjuRc29Z3Rkcr0M_4gX9KMVK0hzHzC11ckH0';

const H = { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` };

export class ApiError extends Error {
  constructor(msg, status, code) { super(msg); this.status = status; this.code = code; }
}

async function sbFetch(path, { range, count, timeoutMs = 30000, method = 'GET', body } = {}) {
  const headers = { ...H };
  if (range) headers.Range = `${range[0]}-${range[1]}`;
  if (count) headers.Prefer = 'count=exact';
  if (body) headers['Content-Type'] = 'application/json';
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers, body: body && JSON.stringify(body), signal: ctl.signal });
    if (!res.ok) {
      let j = {}; try { j = await res.json(); } catch (_) {}
      throw new ApiError(j.message || `HTTP ${res.status}`, res.status, j.code);
    }
    const total = count ? Number((res.headers.get('content-range') || '').split('/')[1]) || null : null;
    return { data: await res.json(), total };
  } catch (e) {
    if (e.name === 'AbortError') throw new ApiError('The database took too long to answer.', 504, 'timeout');
    throw e;
  } finally { clearTimeout(t); }
}

export const select = (table, query) => sbFetch(`${table}?${query}`).then(r => r.data);
export const rpc = (fn, args, timeoutMs = 12000) => sbFetch(`rpc/${fn}`, { method: 'POST', body: args, timeoutMs }).then(r => r.data);

// Fetch every row of a query, pages in parallel (PostgREST caps at 1000/page).
export async function selectAll(table, query, { pageSize = 1000, parallel = 6, onProgress } = {}) {
  const first = await sbFetch(`${table}?${query}`, { range: [0, pageSize - 1], count: true });
  const rows = [...first.data];
  const total = first.total ?? rows.length;
  const starts = [];
  for (let s = pageSize; s < total; s += pageSize) starts.push(s);
  let done = rows.length; onProgress?.(done, total);
  for (let i = 0; i < starts.length; i += parallel) {
    const pages = await Promise.all(starts.slice(i, i + parallel).map(s =>
      sbFetch(`${table}?${query}`, { range: [s, s + pageSize - 1] }).then(r => r.data)));
    for (const p of pages) { rows.push(...p); done += p.length; }
    onProgress?.(done, total);
  }
  return rows;
}

// ── team API (Vercel functions) ──────────────────────────────────────────────
const PASS_KEY = 'pinnacle_team_passcode';
export function getPasscode() { try { return localStorage.getItem(PASS_KEY) || ''; } catch (_) { return ''; } }
export function setPasscode(v) { try { v ? localStorage.setItem(PASS_KEY, v) : localStorage.removeItem(PASS_KEY); } catch (_) {} }

export async function teamApi(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-team-passcode': getPasscode() },
      body: body && JSON.stringify(body),
    });
  } catch (e) { throw new ApiError('Could not reach the team server.', 0, 'offline'); }
  let j = {}; try { j = await res.json(); } catch (_) {}
  if (!res.ok) throw new ApiError(j.error || `HTTP ${res.status}`, res.status, j.code || (res.status === 404 ? 'not_deployed' : undefined));
  return j;
}
