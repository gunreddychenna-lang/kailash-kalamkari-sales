'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../api/sales-sync-live.js')._test;
const base = {store_name:'Main Branch',bill_no:'111BN1112',sl_no:1,item_name:'handmade saree',
  bill_date:'2026-11-11',qty:1,rate:1800,discount:600,amount:1200,sm_name:'swathi',agent_name:'swathi',sale_type:'Offline'};
const big = Array.from({length:156},(_,i)=>({...base,sl_no:i+1}));
function mock(prior=[]) {
  const sql=[];
  const client={query:async (query,args)=>{
    sql.push({query,args});
    if(query.startsWith('SELECT store_name,bill_no'))return {rows:prior};
    return {rows:[]};
  },release:()=>{}};
  return {sql,db:{connect:async()=>client}};
}
test('40 ordinary invoice lines stay allowed and mixed 41 are rejected',()=>{
  assert.equal(api.validBatchShape(Array.from({length:40},(_,i)=>({...base,bill_no:'B'+i}))),true);
  assert.equal(api.validBatchShape(Array.from({length:41},(_,i)=>({...base,bill_no:'B'+i}))),false);
  assert.equal(api.validBatchShape(big),true);
});
test('156-line invoice validates and dry-runs as one atomic SQL insertion',async()=>{
  for(const r of big)assert.equal(api.validate(r),null);
  const m=mock();const result=await api.reconcile(m.db,big,true);
  assert.equal(result.status,200);
  assert.equal(result.submitted_rows,156);
  assert.equal(result.would_insert,156);
  assert.equal(result.production_writes,false);
  const insert=m.sql.filter(s=>s.query.startsWith('INSERT INTO public.sales'));
  assert.equal(insert.length,1);
  assert.equal(insert[0].args.length,156*13);
  assert.ok(insert[0].query.includes('NULL,NULL,NULL'));
  assert.ok(m.sql.some(s=>s.query==='ROLLBACK'));
  assert.ok(!m.sql.some(s=>s.query==='COMMIT'));
});
test('large invoice refuses historic conflicting identity before writing',async()=>{
  const m=mock([{...base,line_id:null}]);
  const result=await api.reconcile(m.db,big,false);
  assert.equal(result.status,409);
  assert.equal(m.sql.filter(s=>s.query.startsWith('INSERT')).length,0);
  assert.ok(m.sql.some(s=>s.query==='ROLLBACK'));
});
test('ordinary sale invoice rejects negative return values',()=>{
  assert.match(api.validate({...base,amount:-1200}),/Invalid financial/);
  assert.match(api.validate({...base,qty:-1}),/Invalid financial amount/);
});
