'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../lib/accountant-ledger');
const uuid = '11111111-1111-4111-8111-111111111111';
const openingKey = '["Main Branch", "A100"]';
function mockRows() {
  return {
    bills: [
      {branch:'Main Branch',bill_no:'A100',bill_date:'2026-11-10',bill_amount:1000},
      {branch:'Main Branch',bill_no:'B200',bill_date:'2026-11-11',bill_amount:1200},
      {branch:'Main Branch',bill_no:'C300',bill_date:'2026-11-12',bill_amount:1500},
      {branch:'Main Branch',bill_no:'D400',bill_date:'2026-11-12',bill_amount:250},
      {branch:'Main Branch',bill_no:'D400',bill_date:'2026-11-11',bill_amount:250},
      {branch:'KHPS',bill_no:'KHPS1',bill_date:'2026-11-12',bill_amount:2100}
    ],
    requests:[{store_name:'Main Branch',bill_no:'B200',amount:300,payment_method:'upi',account_name:'Kalamkari Bank',payment_reference:'UTR-987',payment_date:'2026-11-12',status:'pending',created_at:'2026-11-12T05:00:00Z'}],
    openings:[{invoice_key:openingKey,bill_amount:1000,opening_paid:1000,locked:true,evidence_reference:'VERIFIED-OPENING'}],
    batches:[],
    sales:[{store_name:'Main Branch',bill_no:'C300',bank_account:'Sales Registered Bank'}]
  };
}
async function run(opts={}) {
  const oldFetch=global.fetch; const oldEnv={VERCEL_ENV:process.env.VERCEL_ENV,SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY};
  process.env.VERCEL_ENV=opts.env||'production';process.env.SUPABASE_URL=opts.url||'https://dqvqqrbvklpiibzqivbp.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='MOCK_SECRET';
  const calls=[];const db=mockRows();
  global.fetch=async (url, init) => {
    assert.equal(init.method,'GET');
    const u = new URL(url); const path=u.pathname;calls.push({path,u,init});let data;
    if(path==='/auth/v1/user')data={id:uuid};
    else if(path==='/rest/v1/kk_staff_access')data=[{role:opts.role||'employee',active:opts.active??true,stores:opts.stores||['Main Branch'],features:opts.features||['payments']}];
    else if(path==='/rest/v1/bills_master')data=db.bills.filter(x=>u.searchParams.get('branch')==='eq.'+x.branch);
    else if(path==='/rest/v1/kk_payment_requests')data=db.requests.filter(x=>u.searchParams.get('store_name')==='eq.'+x.store_name);
    else if(path==='/rest/v1/kk_opening_balances')data=db.openings;
    else if(path==='/rest/v1/kk_receipt_batches')data=db.batches;
    else if(path==='/rest/v1/sales')data=db.sales.filter(x=>u.searchParams.get('store_name')==='eq.'+x.store_name);
    else throw new Error('Unexpected path '+path);
    return {ok:true,status:200,json:async()=>data};
  };
  const res={setHeader(){},status(s){this.code=s;return this;},json(data){this.data=data;return this;}};
  const req={method:opts.method||'GET',headers:opts.noToken?{}:{authorization:'Bearer TEST_JWT'},url:opts.query||'/api/accountant-ledger?branch=all'};
  try{await (opts.throughPayments ? require('../api/accountant-payments.js') : ledger)(req,res);return {code:res.code,data:res.data,calls};}
  finally{global.fetch=oldFetch;for(const [k,v] of Object.entries(oldEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
test('only approved opening/posted receipts count as settled; bank in sales is unverified',async()=>{
  const r=await run();assert.equal(r.code,200);
  assert.deepEqual(r.data.counts,{all:4,settled:1,pending:1,unverified:1,review:1});
  const rows=Object.fromEntries(r.data.rows.map(x=>[x.bill_no,x]));
  assert.equal(rows.A100.status,'settled');assert.equal(rows.A100.verified_paid,1000);assert.equal(rows.A100.reference,'VERIFIED-OPENING');
  assert.equal(rows.B200.status,'pending');assert.equal(rows.B200.pending_amount,300);assert.equal(rows.B200.reference,'UTR-987');
  assert.equal(rows.C300.status,'unverified');assert.equal(rows.C300.sale_bank,'Sales Registered Bank');assert.equal(rows.C300.verified_paid,0);
  assert.equal(rows.D400.status,'review');assert.equal(rows.D400.matches,2);
  assert.ok(!r.data.rows.find(x=>x.branch==='KHPS'));
});
test('accountant cannot read other branch',async()=>{const r=await run({query:'/api/accountant-ledger?branch=KHPS'});assert.equal(r.code,403);assert.equal(r.calls.some(x=>x.path==='/rest/v1/bills_master'),false);});
test('nonpayments employee, inactive users, and anonymous sessions are denied',async()=>{
 for(const opts of [{features:['dashboard']},{active:false},{noToken:true}]){
  const r=await run(opts);assert.ok([401,403].includes(r.code));assert.equal(r.calls.some(x=>x.path==='/rest/v1/bills_master'),false);
 }
});
test('owner can list both branches but all matching rows remain read only',async()=>{
 const r=await run({role:'owner'});assert.equal(r.code,200);assert.deepEqual(r.data.branches,['Main Branch','KHPS']);assert.equal(r.data.counts.all,5);
 assert.ok(r.calls.every(c=>c.init.method==='GET'));
});
test('status filter, search, page size and pagination obey selection',async()=>{
 const r=await run({query:'/api/accountant-ledger?status=pending&branch=Main%20Branch&q=B200&page_size=1'});
 assert.equal(r.code,200);assert.equal(r.data.total,1);assert.equal(r.data.rows[0].bill_no,'B200');
 const second=await run({query:'/api/accountant-ledger?branch=all&page_size=2&page=2'});
 assert.equal(second.code,200);assert.equal(second.data.rows.length,2);assert.equal(second.data.pages,2);
});
test('does not accept POST and never calls a write endpoint',async()=>{
 const r=await run({method:'POST'});assert.equal(r.code,405);assert.equal(r.calls.length,0);
});
test('project / environment pin denies misrouted calls',async()=>{
 for(const opts of [{env:'preview'},{url:'https://example.invalid'}]){const r=await run(opts);assert.equal(r.code,503);assert.equal(r.calls.length,0);}
});
test('exact invoice-key JSON normalization and decimals',()=>{
 const {parseKey,paise}=ledger._test;
 assert.equal(parseKey(' [ "Main Branch" , "A100" ] '),JSON.stringify(['Main Branch','A100']));
 assert.equal(parseKey('bad-json'),null);assert.equal(paise('100.25'),10025);assert.equal(paise(null),null);
});
test('invalid filter page and status denied before database reads',async()=>{
 for(const query of ['/api/accountant-ledger?status=paid','/api/accountant-ledger?page=0','/api/accountant-ledger?page_size=999']){
 const r=await run({query});assert.equal(r.code,400);assert.equal(r.calls.length,0);
 }
});

test('invoice register runs through existing payments API', async () => {
  const r = await run({
    throughPayments: true,
    query: '/api/accountant-payments?view=register&branch=Main%20Branch'
  });
  assert.equal(r.code, 200);
  assert.equal(r.data.counts.all, 4);
});
