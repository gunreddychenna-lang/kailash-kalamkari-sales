"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { previewReconciliation } = require('../lib/sales-preview-reconciliation.cjs');
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/sales-invoice-preview' };
function fixture() {
  const bills_master = [
    ['111BN0592','2026-08-31','Offline',1500,1], ['111BN0592','2026-08-31','Online',4500,3],
    ['111SN0285','2026-08-17','Offline',14000,1], ['111SN0285','2026-08-17','Wholesale',168490,24],
    ['111SN0475','2026-09-05','Wholesale',26000,4], ['111SN0475','2026-09-30','Wholesale',84500,13]
  ].map(([bill_no,bill_date,channel,bill_amount,total_qty]) => ({bill_no,bill_date,channel,bill_amount,total_qty,branch:'Main Branch'}));
  const sales = bills_master.map((m,id) => ({id, bill_no:m.bill_no,bill_date:m.bill_date,
    sale_type:m.channel,store_name:m.branch,amount:m.bill_amount,qty:m.total_qty}));
  return {sales,bills_master,receivables:[]};
}
test('revised matching is available only on the named Preview branch', () => {
  for (const e of [{}, {...env,VERCEL_ENV:'production'}, {...env,VERCEL_ENV:'development'},
    {...env,VERCEL_GIT_COMMIT_REF:'engineering/kk-ceo-006-checkpoint'}]) {
    assert.equal(previewReconciliation(fixture(),e),null);
  }
  assert.equal(previewReconciliation(fixture(),env).groups.length,6);
});
test('changed amounts, missing lines and duplicate masters reject the full review set', () => {
  for (const mutate of [d=>d.sales.pop(), d=>d.sales[0].amount++, d=>d.bills_master.push({...d.bills_master[0]})]) {
    const d=fixture(); mutate(d); assert.equal(previewReconciliation(d,env),null);
  }
});
test('pg date objects work and returned master identity remains available', () => {
  const d=fixture();
  for (const row of [...d.sales,...d.bills_master]) {
    const [y,m,day]=row.bill_date.split('-').map(Number); row.bill_date=new Date(y,m-1,day);
  }
  const result=previewReconciliation(d,env);
  assert.equal(result.groups.length,6); assert.ok(result.groups.every(g=>g.master));
});
test('receipts remain unresolved for repeated invoice identities', () => {
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../common.js'),'utf8'),context);
  const d=fixture(), KK=context.window.KK, index=KK.invoiceIndex(d.bills_master);
  for (const master of d.bills_master) {
    const receipt={bill_no:master.bill_no,bill_date:master.bill_date,store_name:master.branch,amount:1};
    assert.equal(KK.matchInvoice(receipt,index).ambiguous,true);
  }
});
