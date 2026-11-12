'use strict';
// Production-only, authenticated, pending payment requests.
// Does NOT post receipts, change sales, or change paid balances.
const PROJECT_URL='https://dqvqqrbvklpiibzqivbp.supabase.co';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BILL=/^[A-Za-z0-9_-]{1,64}$/;
const BRANCHES=new Set(['Main Branch','KHPS']);
const METHODS=new Set(['cash','upi','bank_transfer','card']);
function respond(res,code,body){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');return res.status(code).json(body);}
function money(s){if(!['number','string'].includes(typeof s)||!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(String(s)))return null;const n=Number(s);return Number.isFinite(n)&&n>0?n:null;}
function validDate(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const t=new Date(s+'T00:00:00Z');return !isNaN(t.getTime())&&t.toISOString().slice(0,10)===s;}
function cleanError(msg){
  const allowed=new Set(['Not authorized','Invalid payment details','Choose an active matching account','Invoice missing or ambiguous','Invalid amount for verified invoice','Pending payments exceed original bill','Submission key conflict']);
  return allowed.has(msg)?msg:'Payment request unavailable. Verify history before retrying.';
}
async function handler(req,res){
  if(!['GET','POST'].includes(req.method))return respond(res,405,{error:'Method not allowed'});
  const base=process.env.SUPABASE_URL?.replace(/\/$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(process.env.VERCEL_ENV!=='production'||base!==PROJECT_URL||!key)return respond(res,503,{error:'Accountant payment entry not configured'});
  const bearer=(req.headers?.authorization||'').match(/^Bearer ([^\s]+)$/i)?.[1];
  if(!bearer)return respond(res,401,{error:'Sign in required'});
  async function upstream(path,{method='GET',jwt=key,body,prefer}={}){
    const response=await fetch(base+path,{method,headers:{apikey:key,Authorization:'Bearer '+jwt,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});
    const raw=await response.text();let result=null;try{result=raw?JSON.parse(raw):null;}catch{throw new Error('Invalid response from payments backend');}
    return{ok:response.ok,status:response.status,body:result};
  }
  try{
    const auth=await upstream('/auth/v1/user',{jwt:bearer});
    if(!auth.ok||!UUID.test(auth.body?.id||''))return respond(res,401,{error:'Invalid session'});
    const actor=auth.body.id;
    const profiles=await upstream('/rest/v1/kk_staff_access?auth_user_id=eq.'+encodeURIComponent(actor)+'&select=role,active,stores,features');
    const staff=profiles.body?.[0];
    if(!profiles.ok||!Array.isArray(profiles.body)||profiles.body.length!==1)return respond(res,503,{error:'Staff authorization unavailable'});
    if(staff.active!==true)return respond(res,403,{error:'Access denied'});
    const full=['owner','admin'].includes(staff.role);
    const allowed=branch=>full||(staff.role==='employee'&&Array.isArray(staff.features)&&staff.features.includes('payments')&&Array.isArray(staff.stores)&&staff.stores.includes(branch));
    const body=req.method==='POST'?req.body:new URL(req.url,'http://localhost').searchParams;
    if(!body||(req.method==='POST'&&(typeof body!=='object'||Array.isArray(body))))return respond(res,400,{error:'Invalid request'});
    const branch=req.method==='POST'?body.branch:body.get('branch');
    if(!BRANCHES.has(branch))return respond(res,400,{error:'Choose a valid branch'});
    if(!allowed(branch))return respond(res,403,{error:'Access denied'});
    if(req.method==='GET'){
      const accounts=await upstream('/rest/v1/kk_payment_accounts?is_active=eq.true&select=account_name,account_type&order=account_name.asc');
      if(!accounts.ok||!Array.isArray(accounts.body))return respond(res,503,{error:'Accounts unavailable'});
      const bill=body.get('bill');
      if(bill!==null&&!BILL.test(bill))return respond(res,400,{error:'Invalid bill'});
      let invoice=null, requests=[];
      if(bill){
        const lookup=await upstream('/rest/v1/bills_master?branch=eq.'+encodeURIComponent(branch)+'&bill_no=eq.'+encodeURIComponent(bill)+'&select=bill_amount,bill_date&limit=2');
        if(!lookup.ok||!Array.isArray(lookup.body))return respond(res,503,{error:'Invoice lookup unavailable'});
        if(lookup.body.length!==1)return respond(res,422,{error:'Invoice missing or ambiguous'});
        invoice={bill_no:bill,branch,bill_amount:lookup.body[0].bill_amount,bill_date:lookup.body[0].bill_date};
        const path='/rest/v1/kk_payment_requests?store_name=eq.'+encodeURIComponent(branch)+'&bill_no=eq.'+encodeURIComponent(bill)+'&select=id,amount,payment_method,account_name,payment_reference,payment_date,status,created_at&order=created_at.desc&limit=100';
        const history=await upstream(path+(full?'':'&entered_by_auth_user_id=eq.'+encodeURIComponent(actor)));
        if(!history.ok||!Array.isArray(history.body))return respond(res,503,{error:'Pending history unavailable'});
        requests=history.body;
      }
      return respond(res,200,{branch,invoice,accounts:accounts.body,requests,notice:'Pending entries do not count as paid receipts.'});
    }
    const fields=new Set(['branch','bill_no','amount','payment_method','account_name','payment_reference','payment_date','idempotency_key']);
    if(Object.keys(body).some(k=>!fields.has(k))||!BILL.test(body.bill_no||'')||!METHODS.has(body.payment_method)||
      !UUID.test(body.idempotency_key||'')||money(body.amount)===null||!validDate(body.payment_date)||
      typeof body.account_name!=='string'||!body.account_name.trim()||body.account_name.length>120||
      typeof body.payment_reference!=='string'||body.payment_reference.length>120||
      (body.payment_method!=='cash'&&!body.payment_reference.trim()))return respond(res,400,{error:'Invalid payment details'});
    const result=await upstream('/rest/v1/rpc/kk_submit_payment_request',{method:'POST',prefer:'return=representation',body:{
      p_actor:actor,p_id:body.idempotency_key,p_branch:branch,p_bill:body.bill_no,p_amount:String(body.amount),
      p_method:body.payment_method,p_account:body.account_name.trim(),p_reference:body.payment_reference.trim(),p_date:body.payment_date
    }});
    if(!result.ok){const error=cleanError(result.body?.message);return respond(res,result.status===409||result.body?.code==='23505'?409:result.body?.code==='42501'?403:result.body?.code==='22023'?422:503,{error});}
    if(!result.body?.id||!['pending','approved','rejected'].includes(result.body.status))return respond(res,503,{error:'Unexpected save response. Check history before retrying.'});
    return respond(res,200,{id:result.body.id,status:result.body.status,replayed:result.body.replayed===true,posted:false});
  }catch(error){console.error('Accountant payment API error',error?.name||'Failure');return respond(res,503,{error:'Payment backend unavailable. Check history before retrying.'});}
}
module.exports=handler;
module.exports._test={money,validDate,cleanError};
