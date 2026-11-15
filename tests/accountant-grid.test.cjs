'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../accountant-grid-core.js');
const today='2026-11-12';
const row={branch:'Main Branch',bill_no:'111BN1052',invoice_amount:10000,verified_paid:0,pending_amount:0,status:'unverified'};
const accounts=[{account_name:'Cash Counter',account_type:'Cash'},
  {account_name:'KK Bank',account_type:'Bank Account'},
  {account_name:'KK Payment Service',account_type:'Payment Service'}];
const upi={method:'upi',account:'KK Bank',reference:'UTR-1234',date:today,amount:'6500.00'};
const cash={method:'cash',account:'Cash Counter',reference:'',date:today,amount:'3500.00'};
function matchError(fn, fragment) {assert.throws(fn,err=>String(err.message).includes(fragment));}
test('exact money values and invalid amounts',()=>{
 assert.equal(core.cents('10000.75'),1000075);
 assert.equal(core.cents('0.01'),1);
 for(const x of ['-1','100.001','3,000','1e3','NaN',''])assert.equal(core.cents(x),null);
});
test('single UPI payment is a pending request, no auto amount',()=>{
 const x=core.validate(row,[upi],accounts,today);
 assert.equal(x.totalCents,650000);
 assert.equal(x.splits[0].amount,'6500.00');
 assert.equal(x.splits[0].payment_method,'upi');
 assert.equal(x.splits[0].payment_reference,'UTR-1234');
});
test('cash + bank split exactly matches invoice without inferring it was paid',()=>{
 const x=core.validate(row,[upi,cash],accounts,today);
 assert.equal(x.totalCents,1000000);
 assert.equal(x.splits[1].payment_reference,'');
});
test('overpayment retains actual collected sum and calculates separate excess',()=>{
 const v=core.validate(row,[upi,{...cash,amount:'4500'}],accounts,today);
 assert.equal(v.totalCents,1100000);
 assert.equal(v.availableCents,1000000);
 assert.equal(v.estimatedExcessCents,100000);
 assert.equal(v.splits[0].amount,'6500.00');
});
test('existing verified and pending allocations reduce permitted amount',()=>{
 const r={...row,verified_paid:2000,pending_amount:1000,status:'pending'};
 assert.equal(core.availableCents(r),700000);
 assert.equal(core.validate(r,[{...upi,amount:'7000.01'}],accounts,today).estimatedExcessCents,1);
 assert.equal(core.validate(r,[{...upi,amount:'7000'}],accounts,today).totalCents,700000);
});
test('settled and reconciliation-required invoices cannot be edited',()=>{
 for(const status of ['settled','review'])matchError(()=>core.validate({...row,status},[cash],accounts,today),'cannot accept');
});
test('account required while UTR is optional for UPI',()=>{
 matchError(()=>core.validate(row,[{...upi,account:''}],accounts,today),'valid active');
 assert.equal(core.validate(row,[{...upi,reference:''}],accounts,today).splits[0].payment_reference,'');
 matchError(()=>core.validate(row,[{...upi,account:'Cash Counter'}],accounts,today),'valid active');
});
test('exact same account and UTR in two split rows is rejected',()=>{
 matchError(()=>core.validate(row,[{...upi,amount:'500'}, {...upi,amount:'500'}],accounts,today),'same bank/reference');
});
test('invalid dates, future dates and too many splits rejected',()=>{
 for(const date of ['2026-11-31','2026-11-13','2026-08-31'])matchError(()=>core.validate(row,[{...cash,date}],accounts,today),'valid received date');
 matchError(()=>core.validate(row,Array(21).fill(cash),accounts,today),'between 1 and 20');
});
test('accountant view files include approved route and no direct financial table writes',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../accountant-grid.html'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'../accountant-grid.js'),'utf8');
 for(const header of ['Sales Girl','Sales Channel','Bill No.','Bill Amount','Bank Name','UTR / Reference','Add Split'])assert.ok(html.includes(header),header);
 assert.match(js,/view:'register'/);
 assert.match(js,/\/api\/accountant-payments/);
 assert.doesNotMatch(js,/\/rest\/v1\/sales\b|\/rest\/v1\/kk_payment_requests\b|service_role|SUPABASE_SERVICE_ROLE_KEY/);
 assert.match(js,/idempotency_key:crypto\.randomUUID\(\)/);
});

test('blank UTR allows multiple splits to same bank',()=>{
  const parts=[
    {...upi,reference:'',amount:'3000.00'},
    {...upi,reference:'',amount:'1000.00'}
  ];
  const result=core.validate(row,parts,accounts,today);
  assert.equal(result.splits.length,2);
  assert.equal(result.totalCents,400000);
});

test('IST payment date is ISO even at UTC midnight boundary, compatible with server validation', () => {
  assert.equal(core.todayIST(new Date('2026-11-14T20:00:00Z')), '2026-11-15');
  assert.equal(core.todayIST(new Date('2026-11-15T01:00:00Z')), '2026-11-15');
  assert.equal(core.todayIST(new Date('2026-11-15T18:29:00Z')), '2026-11-15');
  assert.equal(core.todayIST(new Date('2026-11-15T18:31:00Z')), '2026-11-16');
  assert.equal(core.isDate(core.todayIST(new Date('2026-11-15T08:00:00Z'))), true);
});
test('Owner Add Bank remains role-limited and reachable through approved server action', () => {
  const grid = fs.readFileSync(path.join(__dirname,'../accountant-grid.js'),'utf8');
  const html = fs.readFileSync(path.join(__dirname,'../accountant-grid.html'),'utf8');
  assert.match(html,/id="add-bank-button"/);
  assert.match(grid,/\['owner','admin'\]\.includes\(state\.profile\.role\)/);
  assert.match(grid,/addEventListener\('click',\(\)=>\{el\('bank-error'\)/);
  assert.match(grid,/\/api\/accountant-payments\?action=add-account/);
  assert.match(grid,/Core\.todayIST\(\)/);
});

test('₹99 invoice accepts ₹100 actually received with ₹1 excess',()=>{
 const low={...row,invoice_amount:99};
 const receipt={...cash,amount:'100.00'};
 const saved=core.validate(low,[receipt],accounts,today);
 assert.equal(saved.totalCents,10000);
 assert.equal(saved.estimatedExcessCents,100);
 assert.equal(saved.splits[0].amount,'100.00');
});
test('₹7650 invoice accepts ₹7600 actually received and preserves ₹50 balance',()=>{
 const bill={...row,invoice_amount:7650};
 const received={...cash,amount:'7600.00'};
 const saved=core.validate(bill,[received],accounts,today);
 assert.equal(saved.totalCents,760000);
 assert.equal(saved.availableCents-saved.totalCents,5000);
 assert.equal(saved.estimatedExcessCents,0);
});
