"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const source = require('../api/owner-dashboard.js');
function response(){return {code:200,setHeader(){},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};}
async function run({sales=[],bills=[]}={}){
 const oldFetch=global.fetch, oldUrl=process.env.SUPABASE_URL, oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://mock.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='mock-dev';
 global.fetch=async u=>({ok:true,json:async()=>u.includes('/auth/v1/user')?{id:'owner'}:[{role:'owner',active:true}]});
 const handler=source.createHandler(undefined,async()=>({sales,receivables:[],bills_master:bills}));const res=response();
 try{await handler({method:'GET',headers:{authorization:'Bearer test-jwt'}},res);return res;}finally{global.fetch=oldFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;}
}
test('empty datasets succeed',async()=>{const r=await run();assert.equal(r.code,200);assert.equal(r.body.counts.sales,0);});
test('501 rows are represented without truncation',async()=>{const sales=Array.from({length:501},(_,i)=>({id:i+1,amount:100}));const r=await run({sales});assert.equal(r.code,200);assert.equal(r.body.sales.length,501);});
test('repeated invoices retain reconciliation warning',async()=>{const bills=[{bill_no:'A1',branch:'Main Branch'},{bill_no:'A1',branch:'Main Branch'}];const r=await run({bills});assert.equal(r.code,200);assert.equal(r.body.bills_master.length,2);assert.equal(r.body.reconciliation.duplicate_invoice_references,1);});
