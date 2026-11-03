'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const api=require('../api/sales-sync-live.js')._test;
const sample={store_name:'Main Branch',bill_no:'111SN0589',sl_no:24,item_name:'silk color story duppata',bill_date:'2026-11-02',qty:1,rate:2500,discount:0,amount:2500,sm_name:'Mouni',agent_name:'Mouni',pay_mode:'Not recorded',sale_type:'Offline',bank_account:'Not recorded'};
function dbMock(prior=[]){const statements=[];let inserted=0;let closed=0;const db={connect:async()=>({query:async(s,args)=>{statements.push(s);if(s.startsWith('SELECT store_name'))return {rows:prior};if(s.startsWith('INSERT'))inserted++;return {rows:[]}},release(){closed++}})};return {db,statements,get inserted(){return inserted},get closed(){return closed}};}
test('valid source row',()=>assert.equal(api.validate(sample),null));
test('blank payment source permitted',()=>assert.equal(api.validate({...sample,pay_mode:'',bank_account:''}),null));
test('invalid money rejected',()=>assert.match(api.validate({...sample,amount:-1}),/financial/));
test('stable deterministic identity',()=>assert.equal(api.lineId(sample),api.lineId({...sample,amount:2400})));
test('core compares financial changes',()=>{const prior={...sample,bill_date:sample.bill_date,rate:'2500',discount:'0',amount:'2500'};assert.equal(api.coreMatches(prior,sample),true);assert.equal(api.coreMatches(prior,{...sample,amount:2400}),false)});
test('dry-run always rolls back',async()=>{const m=dbMock();const out=await api.reconcile(m.db,[sample],true);assert.equal(out.mode,'PRODUCTION_DRY_RUN');assert.equal(out.inserted,0);assert.equal(out.would_insert,1);assert.equal(m.inserted,1);assert.ok(m.statements.includes('ROLLBACK'));assert.ok(!m.statements.includes('COMMIT'));});
test('commit inserts and never touches payment tables',async()=>{const m=dbMock();const out=await api.reconcile(m.db,[sample],false);assert.equal(out.inserted,1);assert.ok(m.statements.includes('COMMIT'));assert.ok(m.statements.every(x=>!/INSERT INTO public\.(payment_splits|receivables)|^UPDATE\s|^DELETE\s/i.test(x)));const insert=m.statements.find(x=>x.startsWith('INSERT'));assert.match(insert,/NULL,NULL,NULL/);});
test('already imported identical line skipped',async()=>{const old={...sample,line_id:api.lineId(sample),rate:'2500',discount:'0',amount:'2500',bill_date:'2026-11-02'};const m=dbMock([old]);const out=await api.reconcile(m.db,[sample],false);assert.equal(out.inserted,0);assert.equal(out.already_present,1);});
test('existing different financial amount blocks all writes',async()=>{const old={...sample,line_id:api.lineId(sample),rate:'2500',discount:'0',amount:'2000',bill_date:'2026-11-02'};const m=dbMock([old]);const out=await api.reconcile(m.db,[sample],false);assert.equal(out.status,409);assert.equal(m.inserted,0);assert.ok(m.statements.includes('ROLLBACK'));});
test('existing historical invoice blocks all writes',async()=>{const old={...sample,line_id:null};const m=dbMock([old]);const out=await api.reconcile(m.db,[sample],false);assert.equal(out.status,409);assert.equal(m.inserted,0);});
