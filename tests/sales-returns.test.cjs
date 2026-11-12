'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname, '..'); // tests/ folder destination
const imp=require('../api/sales-sync-live.js')._test;
const base={store_name:'Main Branch',bill_no:'SRV101N0999',sl_no:1,item_name:'Return sample',bill_date:'2026-11-12',qty:-1,rate:-9500,discount:0,amount:-8550,sm_name:'Keerthi',agent_name:'Keerthi',sale_type:'Offline'};
test('approved SRV-series signed return accepted',()=>assert.equal(imp.validate(base),null));
test('negative movements cannot be disguised as normal sale invoices',()=>{
  assert.match(imp.validate({...base,bill_no:'111BN1234'}),/financial/);
  assert.match(imp.validate({...base,qty:1}),/financial/);
  assert.match(imp.validate({...base,rate:9500}),/financial/);
  assert.match(imp.validate({...base,amount:8550}),/financial/);
});
test('return idempotency identity is stable and still line-scoped',()=>{
  assert.equal(imp.lineId(base),imp.lineId({...base,amount:-8500}));
  assert.notEqual(imp.lineId(base),imp.lineId({...base,sl_no:2}));
});
test('return with more than two decimal amount is invalid',()=>{
  assert.match(imp.validate({...base,amount:-8550.001}),/financial/);
});
test('signed returns preserve recorded negative value without master',()=>{
  const code=fs.readFileSync(path.join(__dirname,'../common.js'),'utf8');
  const context={window:{},console};vm.runInNewContext(code,context);
  const r1={...base,rate:-26500,amount:-19191.89};
  const r2={...base,sl_no:2,rate:-14000,amount:-10139.11};
  assert.deepEqual(Array.from(context.window.KK.amounts([r1,r2],null)),[-19191.89,-10139.11]);
  assert.deepEqual(Array.from(context.window.KK.amounts([r1,r2],-29331)),[-19191.89,-10139.11]);
  assert.throws(()=>context.window.KK.amounts([r1,r2],-29000),/Return amount/);
});
test('sales girl report contains separated gross, returns, net and negative ledger',()=>{
  const code=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  for(const text of ['grossRevenue','returnsAmount','returnedUnits','Gross Sales:','Returns:','Net Sales:'])
    assert.ok(code.includes(text),text);
  assert.match(code,/bAmt < 0 \? 'Return' : 'Invoice'/);
});
