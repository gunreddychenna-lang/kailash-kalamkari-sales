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
  if(typeof opts.configureRows==='function')opts.configureRows(db);
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
  assert.deepEqual(r.data.counts,{all:4,settled:1,not_settled:3,pending:1,unverified:1,review:1});
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

test('verified partial payments display Settled for now regardless of outstanding balance', () => {
  const {summarize} = ledger._test;
  const bills = [
    {branch:'Main Branch',bill_no:'ONE',bill_amount:6746,bill_date:'2026-11-15'},
    {branch:'Main Branch',bill_no:'FIFTY',bill_amount:7650,bill_date:'2026-11-15'},
    {branch:'Main Branch',bill_no:'OVER',bill_amount:17300,bill_date:'2026-11-15'},
    {branch:'Main Branch',bill_no:'LARGE',bill_amount:50000,bill_date:'2026-11-15'},
    {branch:'Main Branch',bill_no:'UNPAID',bill_amount:50,bill_date:'2026-11-15'}
  ];
  const payment = (bill,paid) => ({
    invoice_key: JSON.stringify(['Main Branch',bill]),amount:paid,
    payments:[{amount:paid,account:'Bank',reference:'TEST',payment_date:'2026-11-15'}]
  });
  const rows=summarize(bills,[],[],[payment('ONE',6745),payment('FIFTY',7600),payment('LARGE',1000)]);
  const byBill=Object.fromEntries(rows.map(r=>[r.bill_no,r]));
  assert.equal(byBill.ONE.status,'pending');
  assert.equal(byBill.ONE.display_status,'settled');
  assert.equal(byBill.ONE.collection_settled_for_now,true);
  assert.equal(byBill.ONE.balance_due,1);
  assert.equal(byBill.ONE.verified_paid,6745);
  assert.equal(byBill.FIFTY.display_status,'settled');
  assert.equal(byBill.FIFTY.balance_due,50);
  assert.equal(byBill.LARGE.display_status,'settled');
  assert.equal(byBill.LARGE.balance_due,49000);
  assert.equal(byBill.LARGE.status,'pending');
  assert.equal(byBill.OVER.display_status,'unverified');
  assert.equal(byBill.UNPAID.display_status,'unverified');
});
test('one paise difference is not written off in accounting', () => {
  const {summarize} = ledger._test;
  const bills=[{branch:'Main Branch',bill_no:'ONEPAISE',bill_amount:33000.01,bill_date:'2026-11-15'}];
  const receipts=[{invoice_key:JSON.stringify(['Main Branch','ONEPAISE']),amount:33000,
    payments:[{amount:33000,account:'Bank',reference:'R'}]}];
  const [r]=summarize(bills,[],[],receipts);
  assert.equal(r.status,'pending');
  assert.equal(r.display_status,'settled');
  assert.equal(r.balance_due,0.01);
  assert.equal(r.verified_paid,33000);
});

test('simple Settled / Not Settled grouping keeps actual dues and excludes reviews from branch totals',async()=>{
 const {data,code}=await run({role:'owner',query:'/api/accountant-ledger?status=not_settled&branch=all'});
 assert.equal(code,200);
 assert.equal(data.total,data.counts.not_settled);
 assert.ok(data.rows.every(row=>row.display_status!=='settled'));
 const main=data.branch_totals.find(x=>x.branch==='Main Branch');
 assert.ok(main);
 assert.equal(main.invoices,4);
 assert.equal(main.excluded_review,1);
 assert.equal(main.billed,1000+1200+1500);
 assert.equal(main.recorded_paid,1000);
 assert.equal(main.due,1200+1500);
 const khps=data.branch_totals.find(x=>x.branch==='KHPS');
 assert.equal(khps.invoices,1);
 assert.equal(khps.due,2100);
});
test('branch amount summaries respect staff branch permissions',async()=>{
 const r=await run({role:'employee',stores:['Main Branch']});
 assert.equal(r.code,200);
 assert.deepEqual(r.data.branch_totals.map(x=>x.branch),['Main Branch']);
});

test('inclusive invoice date range filters rows, tabs and branch totals consistently',async()=>{
  const r=await run({role:'owner',query:'/api/accountant-ledger?branch=all&from=2026-11-11&to=2026-11-12'});
  assert.equal(r.code,200);
  assert.equal(r.data.from,'2026-11-11');
  assert.equal(r.data.to,'2026-11-12');
  assert.equal(r.data.counts.all,4);
  assert.ok(r.data.rows.every(x=>x.bill_date>='2026-11-11' && x.bill_date<='2026-11-12'));
  const main=r.data.branch_totals.find(x=>x.branch==='Main Branch');
  assert.equal(main.invoices,3);
  assert.equal(main.excluded_review,1);
  assert.equal(main.billed,1200+1500);
  assert.equal(main.recorded_paid,0);
  assert.equal(main.due,1200+1500);
  const khps=r.data.branch_totals.find(x=>x.branch==='KHPS');
  assert.equal(khps.invoices,1);
  assert.equal(khps.billed,2100);
});
test('invalid dates or reversed ranges rejected before database reads',async()=>{
  for(const query of [
    '/api/accountant-ledger?from=2026-02-30',
    '/api/accountant-ledger?from=2026-11-13&to=2026-11-12',
    '/api/accountant-ledger?to=tomorrow',
    '/api/accountant-ledger?from=2026-11-12x'
  ]) {
    const r=await run({role:'owner',query});
    assert.equal(r.code,400);
    assert.equal(r.calls.length,0);
  }
});
test('date filters never expose unpermitted branch totals',async()=>{
  const r=await run({role:'employee',stores:['Main Branch'],query:'/api/accountant-ledger?branch=all&from=2026-11-12&to=2026-11-12'});
  assert.equal(r.code,200);
  assert.deepEqual(r.data.branch_totals.map(x=>x.branch),['Main Branch']);
});

test('payment method and account filters use only matching posted receipt splits',async()=>{
 const configureRows=db=>{
   db.batches.push({
     invoice_key: JSON.stringify(['Main Branch','C300']),amount:1000,invoice_allocated:1000,excess_amount:0,
     payments:[
       {amount:400,account:'TBH',method:'cash',reference:'CASH-TEST',payment_date:'2026-11-12'},
       {amount:600,account:'42441-TJ',method:'upi',reference:'UPI-TEST',payment_date:'2026-11-12'}
     ]
   });
 };
 const cash=await run({role:'owner',configureRows,query:'/api/accountant-ledger?branch=all&method=cash&account=TBH'});
 assert.equal(cash.code,200);
 assert.equal(cash.data.total,1);
 assert.equal(cash.data.rows[0].bill_no,'C300');
 assert.equal(cash.data.receipt_ledger.find(x=>x.branch==='Main Branch').recorded_amount,400);
 assert.equal(cash.data.rows[0].verified_paid,1000);
 const upi=await run({role:'owner',configureRows,query:'/api/accountant-ledger?branch=all&method=upi&account=42441-TJ'});
 assert.equal(upi.code,200);
 assert.equal(upi.data.receipt_ledger.find(x=>x.branch==='Main Branch').recorded_amount,600);
 assert.equal(upi.data.total,1);
 const wrongAccount=await run({role:'owner',configureRows,query:'/api/accountant-ledger?branch=all&method=cash&account=42441-TJ'});
 assert.equal(wrongAccount.code,200);
 assert.equal(wrongAccount.data.total,0);
 assert.equal(wrongAccount.data.receipt_count,0);
});
test('payment ledger does not count pending requests, historical bank names, or invoice full amount',async()=>{
 const r=await run({role:'owner',query:'/api/accountant-ledger?method=upi&account=Kalamkari%20Bank'});
 assert.equal(r.code,200);
 assert.equal(r.data.total,0);
 assert.equal(r.data.receipt_ledger.find(x=>x.branch==='Main Branch').recorded_amount,0);
 const oldBank=await run({role:'owner',query:'/api/accountant-ledger?method=upi&account=Sales%20Registered%20Bank'});
 assert.equal(oldBank.data.total,0);
});
test('payment filters cannot reveal other branch ledger receipt amounts to accountant',async()=>{
 const configureRows=db=>db.batches.push({
   invoice_key:JSON.stringify(['KHPS','KHPS1']),amount:100,invoice_allocated:100,excess_amount:0,
   payments:[{amount:100,account:'TBH',method:'cash',reference:'KHPS-CASH'}]
 });
 const r=await run({role:'employee',stores:['Main Branch'],configureRows,query:'/api/accountant-ledger?branch=all&method=cash&account=TBH'});
 assert.equal(r.code,200);
 assert.deepEqual(r.data.receipt_ledger.map(x=>x.branch),['Main Branch']);
 assert.equal(r.data.total,0);
});
test('invalid payment methods and excessively long account names fail before db reads',async()=>{
 for(const query of ['/api/accountant-ledger?method=bitcoin','/api/accountant-ledger?method=CASH','/api/accountant-ledger?account='+('x'.repeat(121))]){
  const r=await run({role:'owner',query});
  assert.equal(r.code,400);
  assert.equal(r.calls.length,0);
 }
});

test('₹99 invoice accepts ₹100 actual recorded, allocates ₹99 and keeps ₹1 excess separately',async()=>{
 const configureRows=db=>{
   db.bills.push({branch:'Main Branch',bill_no:'EXCESS99',bill_date:'2026-11-13',bill_amount:99});
   db.batches.push({invoice_key:JSON.stringify(['Main Branch','EXCESS99']),amount:100,
     invoice_allocated:99,excess_amount:1,
     payments:[{amount:100,account:'Cash Counter',method:'cash',reference:'EXCESS-TEST',payment_date:'2026-11-13'}]});
 };
 const r=await run({role:'owner',configureRows,query:'/api/accountant-ledger?branch=Main%20Branch&q=EXCESS99'});
 assert.equal(r.code,200);assert.equal(r.data.total,1);
 const invoice=r.data.rows[0];
 assert.equal(invoice.status,'settled');
 assert.equal(invoice.display_status,'settled');
 assert.equal(invoice.verified_paid,99);
 assert.equal(invoice.actual_received,100);
 assert.equal(invoice.excess_received,1);
 assert.equal(invoice.balance_due,0);
 assert.equal(r.data.branch_totals[0].recorded_paid,99);
 assert.equal(r.data.branch_totals[0].actual_received,100);
 assert.equal(r.data.branch_totals[0].excess_received,1);
 assert.equal(r.data.receipt_ledger[0].recorded_amount,100);
});
test('₹7650 invoice with ₹7600 actual receipt keeps ₹50 due and no excess',async()=>{
 const configureRows=db=>{
   db.bills.push({branch:'KHPS',bill_no:'SHORT7650',bill_date:'2026-11-13',bill_amount:7650});
   db.batches.push({invoice_key:JSON.stringify(['KHPS','SHORT7650']),amount:7600,
     invoice_allocated:7600,excess_amount:0,
     payments:[{amount:7600,account:'TBH',method:'upi',reference:'SHORT-TEST',payment_date:'2026-11-13'}]});
 };
 const r=await run({role:'owner',configureRows,query:'/api/accountant-ledger?branch=KHPS&q=SHORT7650'});
 assert.equal(r.code,200);
 const invoice=r.data.rows[0];
 assert.equal(invoice.status,'pending');
 assert.equal(invoice.display_status,'settled');
 assert.equal(invoice.actual_received,7600);
 assert.equal(invoice.verified_paid,7600);
 assert.equal(invoice.excess_received,0);
 assert.equal(invoice.balance_due,50);
});
test('invalid receipt allocation is flagged for review instead of silently counting',async()=>{
 const configureRows=db=>{
   db.bills.push({branch:'Main Branch',bill_no:'BADALLOCATION',bill_date:'2026-11-13',bill_amount:99});
   db.batches.push({invoice_key:JSON.stringify(['Main Branch','BADALLOCATION']),amount:100,
     invoice_allocated:100,excess_amount:0,
     payments:[{amount:100,account:'TBH',method:'cash'}]});
 };
 const r=await run({role:'owner',configureRows,query:'/api/accountant-ledger?branch=Main%20Branch&q=BADALLOCATION'});
 assert.equal(r.code,200);
 assert.equal(r.data.rows[0].status,'review');
 assert.equal(r.data.branch_totals[0].excluded_review,1);
});
