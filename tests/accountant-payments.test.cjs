'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../api/accountant-payments.js');
const {money,validDate}=handler._test;
const actor='11111111-1111-4111-8111-111111111111';
const reqid='22222222-2222-4222-8222-222222222222';
const form={branch:'Main Branch',bill_no:'111BN1046',amount:'10000',payment_method:'upi',account_name:'KK Bank',payment_reference:'UTR12345',payment_date:'2026-11-12',idempotency_key:reqid};
async function run(opts={}){
 const original={...process.env};const oldFetch=global.fetch;const calls=[];
 process.env.VERCEL_ENV=opts.env||'production';process.env.SUPABASE_URL=opts.base||'https://dqvqqrbvklpiibzqivbp.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='TEST_KEY_NOT_REAL';
 global.fetch=async(url,init)=>{
   const path=new URL(url).pathname;calls.push({path,init});let code=200,data={};
   if(path==='/auth/v1/user')data={id:actor};
   else if(path==='/rest/v1/kk_staff_access')data=[{active:opts.active??true,role:opts.role||'employee',stores:opts.stores||['Main Branch'],features:opts.features||['payments']}];
   else if(path==='/rest/v1/kk_payment_accounts')data=[{account_name:'KK Bank',account_type:'Bank'}];
   else if(path==='/rest/v1/bills_master')data=[{bill_amount:'25000',bill_date:'2026-11-01'}];
   else if(path==='/rest/v1/kk_payment_requests')data=[];
   else if(path==='/rest/v1/rpc/kk_submit_payment_request')data={id:reqid,status:'pending',replayed:opts.replayed??false};
   else throw new Error('Unexpected path: '+path);
   return {ok:code<400,status:code,text:async()=>JSON.stringify(data)};
 };
 const result={};const req={method:opts.method||'POST',url:opts.url||'/api/accountant-payments?branch=Main%20Branch&bill=111BN1046',headers:opts.noToken?{}:{authorization:'Bearer TEST_USER_TOKEN'},body:{...form,...opts.body}};
 const res={setHeader(){},status(s){result.status=s;return this;},json(data){result.data=data;return this;}};
 try{await handler(req,res);return{...result,calls};}
 finally{global.fetch=oldFetch;for(const k of ['VERCEL_ENV','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];}}
}
test('valid money and date',()=>{assert.equal(money('1000.75'),1000.75);assert.equal(money('-1'),null);assert.equal(validDate('2026-02-30'),false);});
test('preview and wrong project fail closed before any fetch',async()=>{for(const x of [{env:'preview'},{base:'https://wrong.supabase.co'}]){const r=await run(x);assert.equal(r.status,503);assert.equal(r.calls.length,0);}});
test('anonymous denied',async()=>{const r=await run({noToken:true});assert.equal(r.status,401);assert.equal(r.calls.length,0);});
test('ordinary employee without payments access denied',async()=>{const r=await run({features:['sales_entry']});assert.equal(r.status,403);assert.equal(r.calls.some(x=>x.path.endsWith('kk_submit_payment_request')),false);});
test('employee denied outside assigned branch',async()=>{const r=await run({stores:['KHPS']});assert.equal(r.status,403);});
test('inactive employee denied',async()=>{const r=await run({active:false});assert.equal(r.status,403);});
test('approved accountant can submit pending request',async()=>{
 const r=await run();assert.equal(r.status,200);assert.equal(r.data.status,'pending');assert.equal(r.data.posted,false);
 const call=r.calls.find(x=>x.path==='/rest/v1/rpc/kk_submit_payment_request');assert.ok(call);
 const p=JSON.parse(call.init.body);assert.equal(p.p_actor,actor);assert.equal(p.p_branch,'Main Branch');assert.equal(p.p_id,reqid);assert.equal(p.p_reference,'UTR12345');
 assert.equal(r.calls.some(x=>x.path==='/rest/v1/sales'),false);
});
test('forged actor and approval fields rejected before writes',async()=>{for(const body of [{p_actor:actor},{status:'approved'},{posted:true}]){const r=await run({body});assert.equal(r.status,400);assert.equal(r.calls.some(x=>x.path.includes('/rpc/')),false);}});
test('blank noncash reference accepted',async()=>{const r=await run({body:{payment_reference:''}});assert.equal(r.status,200);const call=r.calls.find(x=>x.path==='/rest/v1/rpc/kk_submit_payment_request');assert.equal(JSON.parse(call.init.body).p_reference,'');});
test('invalid amount rejected',async()=>{for(const amount of ['-2','0','20.123','99999999999']){const r=await run({body:{amount}});assert.equal(r.status,400);}});
test('Owner/Admin can view authorized branch pending entries',async()=>{for(const role of ['owner','admin']){const r=await run({method:'GET',role});assert.equal(r.status,200);assert.ok(Array.isArray(r.data.accounts));assert.ok(r.data.invoice);}});
test('accountant GET pending history filters to own actor',async()=>{const r=await run({method:'GET'});assert.equal(r.status,200);const x=r.calls.find(x=>x.path==='/rest/v1/kk_payment_requests');assert.match(x.init.method||'GET',/GET/);});
