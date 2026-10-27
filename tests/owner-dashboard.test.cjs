"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const moduleUnderTest = require('../api/owner-dashboard.js');

async function invoke({ token='jwt',role='owner',active=true,method='GET',fail=false }={}){
 const oldFetch=global.fetch, oldUrl=process.env.SUPABASE_URL, oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL='https://mock.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='mock-dev-key';
 const calls=[];
 global.fetch=async (u,o)=>{calls.push({u,o});return {ok:true,json:async()=>u.includes('/auth/v1/user')?{id:'verified-user'}:[{role,active}]};};
 const readData=async ()=>{calls.push({db:true});if(fail)throw Error('Database unavailable');return {sales:[{id:1,store_name:'Main Branch'}],receivables:[{id:'rec-1',amount:500}],bills_master:[{bill_no:'TEST-001',branch:'Main Branch'}]};};
 const handler=moduleUnderTest.createHandler(undefined,readData);
 const res={code:200,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 try{await handler({method,headers:token?{authorization:`Bearer ${token}`}:{}} ,res);return {res,calls};}
 finally{global.fetch=oldFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;}
}
test('anonymous caller denied before upstream reads',async()=>{const {res,calls}=await invoke({token:''});assert.equal(res.code,401);assert.equal(calls.length,0);});
test('write methods rejected',async()=>{const {res,calls}=await invoke({method:'POST'});assert.equal(res.code,405);assert.equal(calls.length,0);});
test('employee denied before financial read',async()=>{const {res,calls}=await invoke({role:'employee'});assert.equal(res.code,403);assert.equal(calls.some(x=>x.db),false);});
test('inactive owner denied',async()=>{const {res}=await invoke({active:false});assert.equal(res.code,403);});
test('owner receives read-only datasets',async()=>{const {res,calls}=await invoke();assert.equal(res.code,200);assert.deepEqual(res.body.counts,{sales:1,receivables:1,bills_master:1});assert.equal(res.body.read_only,true);assert.equal(calls.filter(x=>x.db).length,1);});
test('admin receives dashboard',async()=>{const {res}=await invoke({role:'admin'});assert.equal(res.code,200);});
test('database outage fails closed',async()=>{const {res}=await invoke({fail:true});assert.equal(res.code,503);assert.equal(res.body.sales,undefined);});
