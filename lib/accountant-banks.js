'use strict';
// Owner/Admin-only addition of payment account labels. Does not post receipts, change invoices,
// update the legacy bank_accounts table, or alter existing bank account records.
const PROJECT_URL = 'https://dqvqqrbvklpiibzqivbp.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(['Bank Account', 'Payment Service', 'Cash']);
function respond(res, status, result) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json');
  return res.status(status).json(result);
}
function check(body) {
  if(!body || typeof body !== 'object' || Array.isArray(body) ||
    Object.keys(body).length !== 2 ||
    Object.keys(body).some(k => !['account_name','account_type'].includes(k)))
    return {error:'Invalid payment account details'};
  const name = typeof body.account_name === 'string' ? body.account_name.trim() : '';
  if (name.length < 1 || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name) ||
      !TYPES.has(body.account_type))
    return {error:'Invalid payment account details'};
  return {account_name:name, account_type:body.account_type};
}
async function handler(req,res) {
  if(req.method !== 'POST') {
    res.setHeader('Allow','POST');
    return respond(res,405,{error:'Method not allowed'});
  }
  const base = process.env.SUPABASE_URL?.replace(/\/$/,'');
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(process.env.VERCEL_ENV !== 'production' || base !== PROJECT_URL || !secret)
    return respond(res,503,{error:'Payment account service unavailable'});
  const bearer = (req.headers?.authorization || '').match(/^Bearer ([^\s]+)$/i)?.[1];
  if(!bearer) return respond(res,401,{error:'Sign in required'});
  const candidate = check(req.body);
  if(candidate.error) return respond(res,400,candidate);

  async function upstream(path,{method='GET',jwt=secret,body,prefer}={}) {
    const response=await fetch(base+path,{
      method,
      headers:{apikey:secret,Authorization:'Bearer '+jwt,'Content-Type':'application/json',
        ...(prefer ? {Prefer:prefer} : {})},
      ...(body !== undefined ? {body:JSON.stringify(body)} : {}),
      signal:AbortSignal.timeout(12000)
    });
    const raw=await response.text();
    let result=null;
    try{result=raw ? JSON.parse(raw) : null;}catch {throw new Error('Invalid bank backend response');}
    return {ok:response.ok,status:response.status,body:result};
  }
  try {
    const auth=await upstream('/auth/v1/user',{jwt:bearer});
    if(!auth.ok || !UUID.test(auth.body?.id || ''))
      return respond(res,401,{error:'Invalid session'});
    const profile=await upstream('/rest/v1/kk_staff_access?auth_user_id=eq.'+
      encodeURIComponent(auth.body.id)+'&select=role,active');
    if(!profile.ok || !Array.isArray(profile.body) || profile.body.length !== 1)
      return respond(res,503,{error:'Staff authorization unavailable'});
    if(profile.body[0].active !== true || !['owner','admin'].includes(profile.body[0].role))
      return respond(res,403,{error:'Only Owner/Admin can add payment accounts'});
    const existing=await upstream('/rest/v1/kk_payment_accounts?select=account_name&limit=1000');
    if(!existing.ok || !Array.isArray(existing.body))
      return respond(res,503,{error:'Account list unavailable'});
    if(existing.body.some(x => typeof x.account_name==='string' &&
        x.account_name.trim().toLowerCase()===candidate.account_name.toLowerCase()))
      return respond(res,409,{error:'Payment account already exists'});
    const insert=await upstream('/rest/v1/kk_payment_accounts?select=account_name,account_type,is_active',{
      method:'POST',prefer:'return=representation',body:[{...candidate,is_active:true}]
    });
    if(!insert.ok) return respond(res,insert.body?.code==='23505'?409:503,{
      error:insert.body?.code==='23505'?'Payment account already exists':'Account creation failed'});
    if(!Array.isArray(insert.body)||insert.body.length!==1 ||
      insert.body[0].account_name!==candidate.account_name ||
      insert.body[0].account_type!==candidate.account_type)
      return respond(res,503,{error:'Unexpected create result; verify account list before retrying'});
    return respond(res,201,{account:insert.body[0],message:'Payment account added'});
  } catch(error) {
    console.error('Payment account creation failed',error?.name || 'Error');
    return respond(res,503,{error:'Account creation failed; verify the list before retrying'});
  }
}
module.exports=handler;
module.exports._test={check};
