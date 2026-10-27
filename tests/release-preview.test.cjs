"use strict";
const test=require('node:test'); const assert=require('node:assert/strict');
const {createServer}=require('../release-server.cjs');
test('preview refuses legacy production Supabase configuration',()=>{
 assert.throws(()=>createServer({base:'https://dqvqqrbvklpiibzqivbp.supabase.co',anon:'public'}),/Production is blocked/);
});
test('DEV and preview HTTP surfaces expose only sales, inventory and login',async()=>{
 for(const label of ['DEV','preview']) {
  const server=createServer({base:'http://127.0.0.1:9999',anon:'fixture-public'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
   for(const route of ['/','/stock.html','/app.js','/common.js','/staff-config.js']) {
    const response=await fetch(base+route);assert.equal(response.status,200,label+route);
    const text=await response.text();
    assert.ok(!text.includes('dqvqqrbvklpiibzqivbp'));
    if (route === '/staff-config.js') {
      assert.ok(text.includes('http://127.0.0.1:9999'));
      assert.ok(text.includes('fixture-public'));
    }
   }
   for(const route of ['/entry.html','/staff.html','/attendance.html','/crm.html','/api/staff','/api/payment-requests','/api/owner-sales','/security/008_consolidated_rls_REVIEW_ONLY.sql','/.git','/app.js.pre-repair-20261026-184742.bak'])
    assert.equal((await fetch(base+route)).status,404,label+route);
   assert.equal((await fetch(base+'/api/owner-inventory',{method:'POST'})).status,405);
   assert.equal((await fetch(base+'/api/owner-dashboard',{method:'DELETE'})).status,405);
   assert.equal((await fetch(base+'/stock.html',{method:'POST'})).status,405);
  } finally {await new Promise(resolve=>server.close(resolve));}
 }
});
