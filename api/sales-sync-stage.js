'use strict';

// PREVIEW-ONLY, DEV-STAGING-ONLY. Never writes to public.sales.
const crypto = require('node:crypto');
const DEV_URL = 'https://yiaipfquxyrqxvkvjykp.supabase.co';
const FIELDS = new Set(['store_name','bill_no','sl_no','item_name','bill_date','qty','rate','discount','amount','sm_name','agent_name','pay_mode','sale_type','bank_account']);

function response(res,status,payload) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json');
  return res.status(status).json(payload);
}
function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function authorized(req) {
  const expected = process.env.KK_SALES_SYNC_TOKEN;
  const supplied = req.headers && req.headers['x-kk-sync-token'];
  if (typeof expected !== 'string' || expected.length < 32 || typeof supplied !== 'string') return false;
  return crypto.timingSafeEqual(Buffer.from(sha256(expected),'hex'),Buffer.from(sha256(supplied),'hex'));
}
function isoDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v+'T00:00:00Z')) && new Date(v+'T00:00:00Z').toISOString().slice(0,10) === v;
}
function money(v) {
  return typeof v === 'number' && Number.isFinite(v) && v>=0 && Math.abs(Math.round(v*100) - v*100) < 1e-7;
}
function validate(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'Invalid row';
  if (Object.keys(r).some(k=>!FIELDS.has(k))) return 'Unexpected field';
  if (!['Main Branch','KHPS'].includes(r.store_name)) return 'Invalid store';
  if (typeof r.bill_no !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(r.bill_no)) return 'Invalid bill_no';
  if (!Number.isInteger(r.sl_no) || r.sl_no<1) return 'Invalid sl_no';
  if (!isoDate(r.bill_date)) return 'Invalid bill_date';
  if (typeof r.qty !== 'number' || !Number.isFinite(r.qty) || r.qty<=0) return 'Invalid qty';
  if (!money(r.rate)||!money(r.discount)||!money(r.amount)||r.amount<=0) return 'Invalid financial amount';
  for(const f of ['item_name','sm_name','agent_name','pay_mode','sale_type','bank_account']){
    if(typeof r[f]!=='string'||!r[f].trim()||r[f].length>200) return 'Invalid '+f;
  }
  return null;
}
async function supa(path, opts={}) {
  const key=process.env.KK_DEV_SUPABASE_SERVICE_ROLE_KEY;
  const out=await fetch(DEV_URL+'/rest/v1/'+path,{
    ...opts,
    headers:{apikey:key,Authorization:'Bearer '+key,...opts.headers}
  });
  const body=await out.text();
  if(!out.ok) throw new Error('DEV staging HTTP '+out.status+': '+body.slice(0,120));
  return body ? JSON.parse(body) : null;
}
async function handler(req,res) {
  if(req.method!=='POST') {res.setHeader('Allow','POST');return response(res,405,{error:'Method not allowed'});}
  if(process.env.VERCEL_ENV!=='preview') return response(res,503,{error:'Preview only'});
  if(!authorized(req)) return response(res,401,{error:'Unauthorized sync request'});
  if(process.env.KK_SALES_STAGING_ENABLED!=='true' ||
      !process.env.KK_DEV_SUPABASE_SERVICE_ROLE_KEY ||
      !process.env.KK_DEV_SUPABASE_SERVICE_ROLE_KEY.startsWith('eyJ')) {
    return response(res,503,{error:'DEV staging not configured'});
  }
  const rows=req.body && req.body.rows;
  if(!Array.isArray(rows)||!rows.length||rows.length>40||JSON.stringify(req.body).length>100000)
    return response(res,400,{error:'Invalid batch size'});
  const errors=[], keys=new Set(), prepared=[];
  rows.forEach((r,i)=>{
    const err=validate(r);
    if(err){errors.push({row:i+1,error:err});return;}
    const key=sha256(JSON.stringify([r.store_name,r.bill_no,r.sl_no]));
    if(keys.has(key)){errors.push({row:i+1,error:'Duplicate key in batch'});return;}
    keys.add(key);
    prepared.push({source_key:key,source_date:r.bill_date,store_name:r.store_name,bill_no:r.bill_no,sl_no:r.sl_no,amount:r.amount,payload:r,payload_sha256:sha256(JSON.stringify(r))});
  });
  if(errors.length) return response(res,422,{mode:'DEV_STAGING',database_writes:false,errors});

  const unknown=rows.filter(r=>r.pay_mode==='Not recorded'||r.bank_account==='Not recorded').length;
  try {
    // Read existing identities and reject changed payloads. No overwrite ever.
    const ids=prepared.map(p=>'"'+p.source_key+'"').join(',');
    const find='kk_sales_sync_staging?select=source_key,payload_sha256&source_key=in.('+encodeURIComponent(ids)+')';
    const existing=await supa(find);
    const prior=new Map(existing.map(x=>[x.source_key,x.payload_sha256]));
    const conflicts=prepared.filter(p=>prior.has(p.source_key)&&prior.get(p.source_key)!==p.payload_sha256);
    if(conflicts.length) return response(res,409,{mode:'DEV_STAGING',database_writes:false,error:'Existing staged rows have different values',conflicts:conflicts.map(p=>({bill_no:p.bill_no,sl_no:p.sl_no}))});
    const fresh=prepared.filter(p=>!prior.has(p.source_key));
    if(fresh.length) {
      await supa('kk_sales_sync_staging?on_conflict=source_key',{
        method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(fresh)
      });
    }
    // Re-read after insert, including concurrent inserts; verify fingerprints.
    const verified=await supa(find);
    const actual=new Map(verified.map(x=>[x.source_key,x.payload_sha256]));
    if(prepared.some(p=>actual.get(p.source_key)!==p.payload_sha256))
      return response(res,409,{mode:'DEV_STAGING',error:'Staging verification mismatch; manual review required'});
    const totalPaise=rows.reduce((acc,r)=>acc+Math.round(r.amount*100),0);
    return response(res,200,{
      mode:'DEV_STAGING',production_writes:false,submitted_rows:rows.length,
      staged_new: fresh.length,already_staged:prepared.length-fresh.length,
      total_bill_amount:totalPaise/100,needs_payment_review:unknown,
      message:'Rows staged for review in DEV only; public.sales unchanged'
    });
  }catch(e){
    // Don't leak DEV credentials or raw DB details to clients.
    console.error('DEV staging failed',e.message);
    return response(res,502,{error:'DEV staging unavailable. No production writes.'});
  }
}
module.exports=handler;
module.exports._test={validate,sha256};
