"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/owner-inventory.js');
async function invoke({role='owner', active=true, token='jwt', method='GET', duplicate=false, cap=300, badRange=false}={}) {
 const old = {fetch:global.fetch, url:process.env.SUPABASE_URL, key:process.env.SUPABASE_SERVICE_ROLE_KEY};
 process.env.SUPABASE_URL='https://mock.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-secret';
 const rows=Array.from({length:501},(_,i)=>({id:duplicate?1:i+1,qty:i===0?2.5:i===1?0:1}));
 const calls=[];
 global.fetch=async(raw, options)=>{
  calls.push({raw, options}); const url=new URL(raw);
  if(url.pathname==='/auth/v1/user') return {ok:true,json:async()=>({id:'verified'})};
  if(url.pathname.endsWith('kk_staff_access')) return {ok:true,json:async()=>[{role,active}]};
  assert.equal(url.pathname,'/rest/v1/saree_inventory');
  const offset=Number(url.searchParams.get('offset')); const page=rows.slice(offset,offset+cap);
  return {ok:true,headers:{get:()=>badRange?'*/*':`${offset}-${offset+page.length-1}/${rows.length}`},json:async()=>page};
 };
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
 try {await handler({method,headers:token?{authorization:`Bearer ${token}`} : {}},res);return {res,calls};}
 finally {global.fetch=old.fetch; for(const [key,value] of [['SUPABASE_URL',old.url],['SUPABASE_SERVICE_ROLE_KEY',old.key]]) {if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
for(const role of ['owner','admin']) test(`${role}: complete paginated inventory preserves zero and decimal quantities`,async()=>{
 const {res,calls}=await invoke({role}); assert.equal(res.code,200); assert.equal(res.body.counts.saree_inventory,501);
 assert.equal(res.body.saree_inventory[0].qty,2.5); assert.equal(res.body.saree_inventory[1].qty,0);
 assert.equal(res.body.read_only,true); assert.equal(res.headers['Cache-Control'],'no-store');
 assert.ok(calls.every(c=>c.options.method==='GET')); assert.ok(!JSON.stringify(res.body).includes('fixture-secret'));
});
for(const settings of [{role:'employee'},{active:false},{role:'unknown'},{token:''},{method:'POST'},{method:'DELETE'}])
 test(`inventory denies ${JSON.stringify(settings)} before inventory reads`,async()=>{
  const {res,calls}=await invoke(settings); assert.ok([401,403,405].includes(res.code));
  assert.ok(!calls.some(c=>c.raw.includes('/saree_inventory')));
 });
for(const settings of [{duplicate:true},{badRange:true}]) test(`inventory fails closed: ${JSON.stringify(settings)}`,async()=>{
 const {res}=await invoke(settings);assert.equal(res.code,503);assert.equal(res.body.saree_inventory,undefined);
});
