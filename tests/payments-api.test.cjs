'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/payments');
const actor = '11111111-1111-4111-8111-111111111111';
async function run(options = {}) {
  const original = { ...process.env }; const oldFetch = global.fetch; const calls = [];
  Object.assign(process.env, { SUPABASE_URL: options.base || 'https://yiaipfquxyrqxvkvjykp.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only', VERCEL_ENV: options.env || 'preview' });
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    const auth = url.endsWith('/auth/v1/user');
    return { ok: auth ? !options.badToken : !options.code, status: 200,
      json: async () => auth ? { id: actor } : options.code ? { code: options.code, message: options.message } : { bill_amount: 10000, paid_amount: 2000, balance: 8000, history: [], test_only: true } };
  };
  const result = {};
  const req = { method: options.method || 'POST', url: '/api/payments?bill_no=TEST-PAY-10000&branch=Main%20Branch',
    headers: options.noToken ? {} : { authorization: 'Bearer test-token' },
    body: { bill_no: 'TEST-PAY-10000', branch: 'Main Branch', idempotency_key: actor, expected_bill_amount: 10000,
      payments: [{ account: 'Cash', amount: '2000', payment_date: '2026-09-01', reference: '' }], ...options.body } };
  const res = { setHeader() {}, status(code) { result.status = code; return this; }, json(data) { result.data = data; return this; } };
  try { await handler(req,res); return { ...result,calls }; }
  finally { global.fetch = oldFetch; for (const k of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VERCEL_ENV']) { if (original[k]===undefined) delete process.env[k]; else process.env[k]=original[k]; } }
}
test('production environment and production database cannot receive trial payments', async () => {
  for (const options of [{ env: 'production' }, { base: 'https://dqvqqrbvklpiibzqivbp.supabase.co' }]) {
    const r = await run(options); assert.equal(r.status,503); assert.equal(r.calls.length,0);
  }
});
test('anonymous and invalid sessions are rejected', async () => {
  assert.equal((await run({noToken:true})).status,401);
  assert.equal((await run({badToken:true})).status,401);
});
test('browser cannot forge actor, change bill value, or omit submission key', async () => {
  for (const body of [{ p_actor: actor }, { bill_amount: 1 }, { idempotency_key: '' }]) {
    const r = await run({body}); assert.equal(r.status,400); assert.equal(r.calls.length,0);
  }
});
test('verified identity and unchanged retry key reach one atomic RPC', async () => {
  const r = await run(); assert.equal(r.status,200); assert.equal(r.calls.length,2);
  const payload = JSON.parse(r.calls[1].init.body);
  assert.equal(payload.p_actor,actor); assert.equal(payload.p_id,actor);
  assert.equal(payload.p_payments[0].account,'Cash'); assert.equal(payload.p_payments[0].payment_date,'2026-09-01');
});
test('refresh reads receipt history without posting payment details', async () => {
  const r = await run({method:'GET'}); assert.equal(r.status,200);
  assert.equal(Object.hasOwn(JSON.parse(r.calls[1].init.body),'p_payments'),false);
});
test('authorization, conflict and cumulative overpayment return actionable errors', async () => {
  assert.equal((await run({code:'42501'})).status,403);
  assert.equal((await run({code:'23505',message:'Identical payment already saved; check receipt history'})).status,409);
  assert.equal((await run({code:'22023',message:'Payments exceed remaining bill balance'})).status,422);
  const r = await run({code:'XX000',message:'secret connection details'});
  assert.equal(r.status,503); assert.ok(!JSON.stringify(r.data).includes('secret'));
});
