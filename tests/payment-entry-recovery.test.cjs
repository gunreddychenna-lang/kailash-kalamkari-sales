'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {check}=require('../api/accountant-banks.js')._test;
const handler=require('../api/accountant-banks.js');
const uuid='127fe7de-6814-46e9-a804-afc14e419825';
function response(){return{code:0,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};}
async function request(body,{role='owner',active=true,existing=[],withJwt=true,env='production'}={}){
  const old={url:process.env.SUPABASE_URL,service:process.env.SUPABASE_SERVICE_ROLE_KEY,vercel:process.env.VERCEL_ENV,fetch:global.fetch};
  process.env.SUPABASE_URL='https://dqvqqrbvklpiibzqivbp.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY='secret-for-tests';
  process.env.VERCEL_ENV=env;
  let writes=0,urls=[];
  global.fetch=async (url,opts)=>{
    urls.push({url,method:opts.method});
    let data;
    if(url.includes('/auth/v1/user'))data={id:uuid};
    else if(url.includes('/kk_staff_access?'))data=[{role,active}];
    else if(url.includes('/kk_payment_accounts?select=account_name&limit'))data=existing.map(account_name=>({account_name}));
    else if(url.includes('/kk_payment_accounts?select=account_name,account_type,is_active')){
      assert.equal(opts.method,'POST');writes++;
      data=JSON.parse(opts.body);
    } else throw new Error('Unexpected endpoint: '+url);
    return {ok:true,status:200,text:async()=>JSON.stringify(data)};
  };
  const res=response();
  try{await handler({method:'POST',headers:{authorization:withJwt?'Bearer jwt-for-test':''},body},res);}
  finally {global.fetch=old.fetch;for(const [name,val] of Object.entries({SUPABASE_URL:old.url,SUPABASE_SERVICE_ROLE_KEY:old.service,VERCEL_ENV:old.vercel})){
    if(val===undefined)delete process.env[name];else process.env[name]=val;
  }}
  return{res,writes,urls};
}
test('account input has strict keys/type/name rules',()=>{
  assert.deepEqual(check({account_name:' KK Bank ',account_type:'Bank Account'}),{account_name:'KK Bank',account_type:'Bank Account'});
  for(const payload of [null,{},[],{account_name:'',account_type:'Bank Account'},
    {account_name:'K'.repeat(121),account_type:'Bank Account'},
    {account_name:'Take By Hand',account_type:'Reseller'},
    {account_name:'K',account_type:'Bank Account',role:'owner'},
    {account_name:'K\nB',account_type:'Cash'}])assert.ok(check(payload).error);
});
test('Owner can create account through scoped table only, no financial writes',async()=>{
  const r=await request({account_name:' KK New Bank ',account_type:'Bank Account'});
  assert.equal(r.res.code,201);assert.equal(r.writes,1);
  assert.equal(r.res.body.account.account_name,'KK New Bank');
  assert.ok(r.urls.every(x=>!/(receivables|sales\?|kk_payment_requests|bills_master)/.test(x.url)));
});
test('Admin can create payment service',async()=>{
  const r=await request({account_name:'New PSP',account_type:'Payment Service'},{role:'admin'});
  assert.equal(r.res.code,201);assert.equal(r.writes,1);
});
test('employee, inactive staff, preview, anonymous all blocked',async()=>{
  for(const settings of [{role:'employee'}, {active:false}, {env:'preview'}, {withJwt:false}]){
    const r=await request({account_name:'New Bank',account_type:'Bank Account'},settings);
    assert.equal(r.writes,0);assert.ok([401,403,503].includes(r.res.code));
  }
});
test('duplicate label blocked without INSERT',async()=>{
  const r=await request({account_name:'  KC  ',account_type:'Bank Account'},{existing:['kc']});
  assert.equal(r.res.code,409);assert.equal(r.writes,0);
});
test('new grid preserves existing row Save Pending and uses resumable bulk queue only',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../accountant-grid.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../accountant-grid.html'),'utf8');
  assert.ok(html.includes('Saved Payment Accounts'));
  assert.ok(html.includes('Save All Entered Invoices (Current Page) as Pending'));
  assert.ok(js.includes('saveAllEditedPage'));
  assert.ok(js.includes('idempotency_key:crypto.randomUUID()'));
  assert.ok(js.includes('keepQueue();await finishQueue()'));
  assert.ok(js.includes('request(\'POST\',\'/api/accountant-banks\''));
  assert.ok(js.includes("actions.append(button('Save Pending'"));
  assert.doesNotMatch(js,/\.from\(['"](?:sales|receivables|bank_accounts|kk_payment_accounts)['"]\)/);
  assert.doesNotMatch(js,/\/rest\/v1\/(?:sales|receivables|kk_payment_requests)/);
});
