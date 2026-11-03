'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../api/sales-sync-stage.js');
const {_test:{validate,sha256}}=handler;
const row={store_name:'Main Branch',bill_no:'111SN0589',sl_no:24,item_name:'silk color story duppata',bill_date:'2026-11-02',qty:1,rate:2500,discount:0,amount:2500,sm_name:'Not recorded',agent_name:'Not recorded',pay_mode:'Not recorded',sale_type:'Offline',bank_account:'Not recorded'};
function res(){return {statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(v){this.body=v;return this}}}
function req(rows){return {method:'POST',headers:{'x-kk-sync-token':'a'.repeat(40)},body:{rows}}}
test('valid row',()=>assert.equal(validate(row),null));
test('blank payment rejected',()=>assert.equal(validate({...row,pay_mode:''}),'Invalid pay_mode'));
test('negative amount rejected',()=>assert.equal(validate({...row,amount:-10}),'Invalid financial amount'));
test('floating point money accepted',()=>assert.equal(validate({...row,amount:0.29}),null));
test('stable sha',()=>assert.equal(sha256('abc'),sha256('abc')));
test('production never stages',async()=>{process.env.VERCEL_ENV='production';const r=res();await handler(req([row]),r);assert.equal(r.statusCode,503)});
test('preview without token rejects',async()=>{process.env.VERCEL_ENV='preview';delete process.env.KK_SALES_SYNC_TOKEN;const r=res();await handler(req([row]),r);assert.equal(r.statusCode,401)});
test('preview without staging environment rejects',async()=>{process.env.VERCEL_ENV='preview';process.env.KK_SALES_SYNC_TOKEN='a'.repeat(40);delete process.env.KK_SALES_STAGING_ENABLED;const r=res();await handler(req([row]),r);assert.equal(r.statusCode,503)});
test('duplicate identities rejected before fetch',async()=>{process.env.VERCEL_ENV='preview';process.env.KK_SALES_SYNC_TOKEN='a'.repeat(40);process.env.KK_SALES_STAGING_ENABLED='true';process.env.KK_DEV_SUPABASE_SERVICE_ROLE_KEY='eyJdummy';const r=res();await handler(req([row,row]),r);assert.equal(r.statusCode,422);assert.equal(r.body.errors[0].error,'Duplicate key in batch')});
test('mock staging inserts once and repeat is idempotent',async()=>{
 process.env.VERCEL_ENV='preview';process.env.KK_SALES_SYNC_TOKEN='a'.repeat(40);process.env.KK_SALES_STAGING_ENABLED='true';process.env.KK_DEV_SUPABASE_SERVICE_ROLE_KEY='eyJdummy';
 const db=new Map();const old=global.fetch;
 global.fetch=async(url,opts)=>{
  if(opts.method==='POST'){for(const x of JSON.parse(opts.body))if(!db.has(x.source_key))db.set(x.source_key,x.payload_sha256);return {ok:true,status:201,text:async()=>''}}
  return {ok:true,status:200,text:async()=>JSON.stringify(Array.from(db,([source_key,payload_sha256])=>({source_key,payload_sha256})))};
 };
 try{let r=res();await handler(req([row]),r);assert.equal(r.statusCode,200);assert.equal(r.body.staged_new,1);r=res();await handler(req([row]),r);assert.equal(r.statusCode,200);assert.equal(r.body.staged_new,0);assert.equal(r.body.already_staged,1)}finally{global.fetch=old}
});
