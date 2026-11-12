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
test('overpayment prevents starting the split batch',()=>{
 matchError(()=>core.validate(row,[upi,{...cash,amount:'4500'}],accounts,today),'exceed');
});
test('existing verified and pending allocations reduce permitted amount',()=>{
 const r={...row,verified_paid:2000,pending_amount:1000,status:'pending'};
 assert.equal(core.availableCents(r),700000);
 matchError(()=>core.validate(r,[{...upi,amount:'7000.01'}],accounts,today),'exceed');
 assert.equal(core.validate(r,[{...upi,amount:'7000'}],accounts,today).totalCents,700000);
});
test('settled and reconciliation-required invoices cannot be edited',()=>{
 for(const status of ['settled','review'])matchError(()=>core.validate({...row,status},[cash],accounts,today),'cannot accept');
});
test('no silent bank inference and noncash UTR mandatory',()=>{
 matchError(()=>core.validate(row,[{...upi,account:''}],accounts,today),'valid active');
 matchError(()=>core.validate(row,[{...upi,reference:''}],accounts,today),'reference is required');
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
