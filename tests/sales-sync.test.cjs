"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/sales-sync.js");
const TOKEN = "kk-sales-preview-only-token-at-least-32-chars";
const baseRow = Object.freeze({
  store_name: "Main Branch", bill_no: "KK-TEST-001", sl_no: 1,
  item_name: "Test saree", bill_date: "2026-11-03", qty: 1,
  rate: 1000, discount: 100, amount: 900,
  sm_name: "Test Staff", agent_name: "Test Staff",
  pay_mode: "Cash", sale_type: "Offline", bank_account: "Cash"
});
async function invoke({ method="POST", env="preview", provided=TOKEN,
  configured=TOKEN, body={ rows: [{...baseRow}] } }={}) {
  const oldEnv = process.env.VERCEL_ENV;
  const oldToken = process.env.KK_SALES_SYNC_TOKEN;
  const oldFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls++; throw new Error("Network/database request prohibited by dry-run test"); };
  if (env === null) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = env;
  if (configured === null) delete process.env.KK_SALES_SYNC_TOKEN;
  else process.env.KK_SALES_SYNC_TOKEN = configured;
  const res = {
    code: null, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(data) { this.body = data; return this; }
  };
  try {
    await handler({ method, headers: provided === null ? {} : {"x-kk-sync-token": provided}, body }, res);
    assert.equal(fetchCalls, 0, "dry-run must not contact Supabase or other remote services");
    return res;
  } finally {
    global.fetch = oldFetch;
    if (oldEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = oldEnv;
    if (oldToken === undefined) delete process.env.KK_SALES_SYNC_TOKEN; else process.env.KK_SALES_SYNC_TOKEN = oldToken;
  }
}
test("rejects requests without authentication", async () => {
  assert.equal((await invoke({ provided:null })).code, 401);
  assert.equal((await invoke({ configured:null })).code, 401);
  assert.equal((await invoke({ provided:"incorrect" })).code, 401);
  assert.equal((await invoke({ configured:"short" })).code, 401);
});
test("rejects unsupported HTTP methods", async () => {
  const r = await invoke({ method:"GET" });
  assert.equal(r.code, 405);
  assert.equal(r.headers.Allow, "POST");
});
test("production and unspecified environments fail closed", async () => {
  for (const env of ["production", "development", null]) {
    const r = await invoke({env});
    assert.equal(r.code, 503);
    assert.equal(r.body.error, "Sales import not enabled");
  }
});
test("valid batch returns only DRY_RUN results, with no database writes", async () => {
  const r = await invoke({ body:{rows:[{...baseRow},{...baseRow, bill_no:"KK-TEST-002", amount:300.25}]} });
  assert.equal(r.code, 200);
  assert.equal(r.body.mode, "DRY_RUN_ONLY");
  assert.equal(r.body.database_writes, false);
  assert.equal(r.body.submitted_rows, 2);
  assert.equal(r.body.valid_rows, 2);
  assert.equal(r.body.total_valid_amount, 1200.25);
  assert.deepEqual(r.body.errors, []);
});
test("invalid dates and amounts reject the rows", async () => {
  const r = await invoke({body:{rows:[
    {...baseRow, bill_date:"2026-02-30"},
    {...baseRow, bill_no:"KK-TEST-003", amount:-1},
    {...baseRow, bill_no:"KK-TEST-004", amount:12.345}
  ]}});
  assert.equal(r.code, 422);
  assert.equal(r.body.valid_rows, 0);
  assert.equal(r.body.errors.length, 3);
});
test("duplicate invoice lines in same batch are rejected", async () => {
  const r = await invoke({body:{rows:[{...baseRow},{...baseRow, amount:700}]}});
  assert.equal(r.code,422);
  assert.equal(r.body.valid_rows,1);
  assert.match(r.body.errors[0].error,/Duplicate/);
});
test("same invoice line in different branches is distinct", async () => {
  const r = await invoke({body:{rows:[{...baseRow},{...baseRow, store_name:"KHPS"}]}});
  assert.equal(r.code,200);
  assert.equal(r.body.valid_rows,2);
});
test("unrecognized columns and store names reject rows", async () => {
  const r = await invoke({body:{rows:[
    {...baseRow, unexpected:"secret"},
    {...baseRow, store_name:"Another Branch"}
  ]}});
  assert.equal(r.code,422);
  assert.equal(r.body.errors.length,2);
});
test("empty, oversized or malformed batches reject before processing", async () => {
  for (const body of [{rows:[]}, {rows:null}, {rows:Array.from({length:101},()=>({...baseRow}))}, {}]) {
    assert.equal((await invoke({body})).code,400);
  }
});
