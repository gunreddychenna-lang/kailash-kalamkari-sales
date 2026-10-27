"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/owner-inventory.js');
async function invoke({role='owner', active=true, token='test-token', method='GET', duplicate=false, invalidCount=false, failed=false}={}) {
 const names=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','CATALOGUE_SUPABASE_URL','CATALOGUE_SUPABASE_ANON_KEY'];
 const before=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 Object.assign(process.env,{SUPABASE_URL:'https://dev.example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'dev-key', CATALOGUE_SUPABASE_URL:'https://ehovvhckvgwfkbgfvchi.supabase.co',CATALOGUE_SUPABASE_ANON_KEY:'public-catalog-key'});
 const oldFetch=global.fetch, calls=[];
 const products=Array.from({length:501},(_,i)=>({code:duplicate&&i===500?'A0001':`A${String(i+1).padStart(4,'0')}`,fabric:'Cotton',qty:1,department:'Sarees',store_code:'C',is_available:true}));
 global.fetch=async(raw,opts)=>{
   const u=new URL(raw);calls.push({u,opts});
   if(u.pathname==='/auth/v1/user')return {ok:true,json:async()=>({id:'verified-user'})};
   if(u.pathname==='/rest/v1/kk_staff_access')return {ok:true,json:async()=>[{role,active}]};
   assert.equal(u.hostname,'ehovvhckvgwfkbgfvchi.supabase.co');
   assert.equal(u.pathname,'/rest/v1/products');
   assert.equal(u.searchParams.get('is_available'),'eq.true');
   assert.equal(u.searchParams.get('qty'),'gt.0');
   if(failed)return {ok:false};
   const offset=Number(u.searchParams.get('offset'));
   const page=products.slice(offset,offset+500);
   return {ok:true,headers:{get:k=>k==='content-range'?(invalidCount?'*/*':`${offset}-${offset+page.length-1}/${products.length}`):null},json:async()=>page};
 };
 const res={setHeader(){},status(n){this.code=n;return this},json(body){this.body=body;return this}};
 try {await handler({method,headers:token?{authorization:`Bearer ${token}`}:{}} ,res);return {res,calls}} finally {
  global.fetch=oldFetch;
  for(const name of names) if(before[name]===undefined)delete process.env[name];else process.env[name]=before[name];
 }
}
test('real catalogue pages are complete, shaped for current UI and read only',async()=>{
 const {res,calls}=await invoke();assert.equal(res.code,200);assert.equal(res.body.counts.saree_inventory,501);assert.equal(res.body.source,'catalogue_products');assert.equal(res.body.saree_inventory[0].theme,'Not Defined');assert.equal(res.body.saree_inventory[0].store_code,'C');assert.ok(calls.every(c=>c.opts.method==='GET'));
 assert.ok(!JSON.stringify(res.body).includes('dev-key'));
});
test('admin can view the catalogue',async()=>{assert.equal((await invoke({role:'admin'})).res.code,200)});
for(const args of [{role:'employee'}, {active:false},{token:''},{method:'POST'}]) test(`deny unauthorized ${JSON.stringify(args)}`,async()=>{
 const {res,calls}=await invoke(args);assert.ok([401,403,405].includes(res.code));assert.ok(!calls.some(c=>c.u.pathname==='/rest/v1/products'));
});
for(const args of [{duplicate:true},{invalidCount:true},{failed:true}])test(`fail closed on catalogue errors ${JSON.stringify(args)}`,async()=>{
 const {res}=await invoke(args);assert.equal(res.code,503);assert.equal(res.body.saree_inventory,undefined);
});
