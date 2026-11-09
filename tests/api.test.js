// Team API guards: no env → 503, wrong passcode → 401, bad input → 400,
// and nothing reaches Supabase unless the passcode matches.
import test from 'node:test';
import assert from 'node:assert/strict';

const mockRes = () => {
  const r = { code: 200, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
};
const req = (method, passcode, body) => ({ method, headers: passcode ? { 'x-team-passcode': passcode } : {}, body });

test('relationships: not configured → 503 not_configured', async () => {
  delete process.env.TEAM_PASSCODE; delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  const { default: handler } = await import('../api/relationships.js');
  const res = mockRes(); await handler(req('GET', 'x'), res);
  assert.equal(res.code, 503); assert.equal(res.body.code, 'not_configured');
});

test('relationships: wrong or missing passcode → 401, no database call', async () => {
  Object.assign(process.env, { TEAM_PASSCODE: 'open sesame', SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_KEY: 'k' });
  let fetched = false; const orig = globalThis.fetch; globalThis.fetch = async () => { fetched = true; throw new Error('should not fetch'); };
  const { default: handler } = await import('../api/relationships.js');
  for (const p of [null, 'open', 'open sesame!']) { const res = mockRes(); await handler(req('GET', p), res); assert.equal(res.code, 401); }
  assert.equal(fetched, false);
  globalThis.fetch = orig;
});

test('relationships: validates input before writing', async () => {
  const calls = []; const orig = globalThis.fetch;
  globalThis.fetch = async (url, opt) => { calls.push([url, opt?.method]); return new Response('[{"id":"x"}]', { status: 200 }); };
  const { default: handler } = await import('../api/relationships.js');
  let res = mockRes(); await handler(req('POST', 'open sesame', { action: 'save_relationship', relationship: { staff_id: 'nope', legislator_id: 'nope' } }), res);
  assert.equal(res.code, 400); assert.equal(calls.length, 0);
  res = mockRes(); await handler(req('POST', 'open sesame', { action: 'save_staff', staff: { name: '   ' } }), res);
  assert.equal(res.code, 400);
  res = mockRes(); await handler(req('POST', 'open sesame', { action: 'save_staff', staff: { name: 'Avery Collins', color: 'javascript:alert(1)' } }), res);
  assert.equal(res.code, 200);
  assert.match(calls[0][0], /\/rest\/v1\/staff$/);
  globalThis.fetch = orig;
});

test('bill-topic: rejects codes outside the taxonomy', async () => {
  const orig = globalThis.fetch; globalThis.fetch = async () => { throw new Error('should not fetch'); };
  const { default: handler } = await import('../api/bill-topic.js');
  const id = '00000000-0000-4000-8000-000000000000';
  for (const body of [{ billId: id, topic: 'made-up' }, { billId: id, topic: 'health', subtopic: 'income-tax' }, { billId: id, topic: 'health', secondary: 'health' }, { billId: 'x', topic: 'health' }]) {
    const res = mockRes(); await handler(req('POST', 'open sesame', body), res); assert.equal(res.code, 400, JSON.stringify(body));
  }
  globalThis.fetch = orig;
});
