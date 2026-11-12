'use strict';
// Kailash Kalamkari: Production sales-only, transactionally idempotent importer.
// No update/delete statements; no payment/receivable writes.
const crypto = require('node:crypto');
const poolByUrl = new Map();
// Normal batches: 40. Exception: up to 500 lines from ONE invoice, atomically.
const MAX_STANDARD_ROWS = 40;
const MAX_SINGLE_INVOICE_ROWS = 500;
const MAX_REQUEST_BYTES = 600000;
function validBatchShape(rows) {
  return rows.length <= MAX_STANDARD_ROWS ||
    new Set(rows.map(r => r && r.bill_no)).size === 1;
}
const FIELDS = new Set(['store_name','bill_no','sl_no','item_name','bill_date','qty','rate','discount','amount','sm_name','agent_name','pay_mode','sale_type','bank_account']);
function hash(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function lineId(r) { return 'KKGS-' + hash(JSON.stringify([r.store_name,r.bill_no,r.sl_no])); }
function resp(res,status,data) {res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');return res.status(status).json(data);}
function auth(req) {
  const expected = process.env.KK_SALES_LIVE_TOKEN;
  const supplied = req.headers && req.headers['x-kk-live-token'];
  if (typeof expected!=='string'||expected.length<32||typeof supplied!=='string'||supplied.length<32) return false;
  return crypto.timingSafeEqual(Buffer.from(hash(expected),'hex'),Buffer.from(hash(supplied),'hex'));
}
function validDate(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;}
function money(n){return typeof n==='number'&&Number.isFinite(n)&&n>=0&&Math.abs(n*100-Math.round(n*100))<1e-7;}
function validate(r) {
  if(!r||typeof r!=='object'||Array.isArray(r)) return 'Invalid row';
  if(Object.keys(r).some(x=>!FIELDS.has(x))) return 'Unexpected field';
  if(!['Main Branch','KHPS'].includes(r.store_name))return 'Invalid store';
  if(typeof r.bill_no!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(r.bill_no))return 'Invalid bill_no';
  if(!Number.isInteger(r.sl_no)||r.sl_no<1)return 'Invalid sl_no';
  if(!validDate(r.bill_date))return 'Invalid bill_date';
  // SRV-series returns are signed movements; ordinary sales remain positive.
  if(typeof r.qty!=='number'||!Number.isFinite(r.qty)||r.qty===0)return 'Invalid qty';
  const signedMoney = n => typeof n==='number' && Number.isFinite(n) &&
    Math.abs(n*100-Math.round(n*100))<1e-7;
  if(!signedMoney(r.rate)||!money(r.discount)||!signedMoney(r.amount))return 'Invalid financial amount';
  const isReturn=/^SRV[0-9A-Z]+$/i.test(r.bill_no);
  if(isReturn ? !(r.qty<0&&r.rate<0&&r.amount<0) :
      !(r.qty>0&&r.rate>=0&&r.amount>0)) return 'Invalid financial amount';
  for(const k of ['item_name','sm_name','agent_name','sale_type'])if(typeof r[k]!=='string'||!r[k].trim()||r[k].length>200)return 'Invalid '+k;
  for(const k of ['pay_mode','bank_account'])if(r[k]!==undefined&&r[k]!==null&&(typeof r[k]!=='string'||r[k].length>200))return 'Invalid '+k;
  return null;
}
function coreMatches(db,r) {
  const eq=(a,b)=>String(a)===String(b);
  const amt=(a,b)=>Math.round(Number(a)*100)===Math.round(b*100);
  return eq(db.store_name,r.store_name)&&eq(db.bill_no,r.bill_no)&&Number(db.sl_no)===r.sl_no&&
    eq(db.item_name,r.item_name)&&eq(db.bill_date,r.bill_date)&&Number(db.qty)===r.qty&&
    amt(db.rate,r.rate)&&amt(db.discount,r.discount)&&amt(db.amount,r.amount);
}
function getPool() {
  const raw = process.env.KK_SALES_IMPORT_DATABASE_URL;

  if (!raw || !/^postgres(ql)?:\/\//.test(raw)) {
    throw new Error('Sales DB unavailable');
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw new Error('Invalid Sales DB URL');
  }

  // node-postgres SSL URL parameters override the ssl object.
  // Remove them so our verified CA configuration is retained.
  for (const key of [
    'sslmode', 'sslrootcert', 'sslcert',
    'sslkey', 'ssl', 'uselibpqcompat'
  ]) {
    parsed.searchParams.delete(key);
  }

  const fs = require('node:fs');
  const path = require('node:path');

  const ca = fs.readFileSync(
    path.join(__dirname, '..', 'certs', 'prod-ca-2021.crt'),
    'utf8'
  );

  if (!poolByUrl.has(raw)) {
    poolByUrl.set(raw, new (require('pg').Pool)({
      connectionString: parsed.toString(),
      ssl: {
        ca: ca,
        rejectUnauthorized: true
      },
      max: 2,
      connectionTimeoutMillis: 7000,
      idleTimeoutMillis: 10000
    }));
  }

  return poolByUrl.get(raw);
}
async function reconcile(db, rows, dryRun) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '8s'");
    await client.query("SET LOCAL statement_timeout = '20s'");
    await client.query('SELECT pg_advisory_xact_lock($1,$2)',[20461103,1102]);
    const uniqInvoice=[...new Set(rows.map(r=>r.bill_no))];
    const store=rows[0].store_name;
    const prior=(await client.query('SELECT store_name,bill_no,sl_no,item_name,bill_date::text,qty,rate,discount,amount,line_id FROM public.sales WHERE store_name=$1 AND bill_no = ANY($2::text[])',[store,uniqInvoice])).rows;
    // Existing historical invoice records may not have line IDs. Never add to them.
    const unacceptable=prior.find(x=>!x.line_id||!x.line_id.startsWith('KKGS-'));
    if(unacceptable) {await client.query('ROLLBACK');return {status:409,error:'Invoice already exists outside this importer',bill_no:unacceptable.bill_no};}
    const existing=new Map(prior.map(x=>[x.line_id,x]));
    const ids=new Set(rows.map(lineId));
    if(prior.some(x=>!/^KKGS-[0-9a-f]{64}$/.test(x.line_id))){await client.query('ROLLBACK');return {status:409,error:'Unexpected existing line identity'};}
    let newRows=0,skipped=0,total=0;
    const fresh=[];
    for (const r of rows) {
      const key=lineId(r), old=existing.get(key);total+=Math.round(r.amount*100);
      if(old){if(!coreMatches(old,r)){await client.query('ROLLBACK');return {status:409,error:'Previously imported line changed',bill_no:r.bill_no,sl_no:r.sl_no};}skipped++;continue;}
      fresh.push(r);
      newRows++;
    }
    // Insert every new line in ONE SQL statement and ONE transaction.
    // Avoid 500 individual database round trips. Payment fields remain NULL.
    if (fresh.length) {
      const values=[];
      const tuples=fresh.map(r=>{
        const start=values.length;
        values.push(lineId(r),r.store_name,r.bill_no,r.sl_no,r.item_name,r.bill_date,
          r.qty,r.rate,r.discount,r.amount,r.sm_name,r.agent_name,r.sale_type);
        return '('+Array.from({length:13},(_,i)=>'$'+(start+i+1)).join(',')+',NULL,NULL,NULL)';
      });
      await client.query(`INSERT INTO public.sales
        (line_id,store_name,bill_no,sl_no,item_name,bill_date,qty,rate,discount,amount,sm_name,agent_name,sale_type,pay_mode,bank_account,acc_name)
        VALUES ${tuples.join(',')}`, values);
    }
    if(dryRun) await client.query('ROLLBACK');else await client.query('COMMIT');
    return {status:200,mode:dryRun?'PRODUCTION_DRY_RUN':'PRODUCTION_IMPORT',submitted_rows:rows.length,inserted:dryRun?0:newRows,would_insert:dryRun?newRows:undefined,already_present:skipped,total_bill_amount:total/100,production_writes:!dryRun&&newRows>0,payments_written:0};
  } catch(error){try{await client.query('ROLLBACK');}catch(_){}throw error;}
  finally {client.release();}
}
async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return resp(res,405,{error:'Method not allowed'});}
  if(process.env.VERCEL_ENV!=='production'||process.env.KK_SALES_LIVE_ENABLED!=='true')return resp(res,503,{error:'Live sync disabled'});
  if(!auth(req))return resp(res,401,{error:'Unauthorized'});
  const body=req.body||{};const rows=body.rows;
  if(!Array.isArray(rows)||!rows.length||rows.length>MAX_SINGLE_INVOICE_ROWS||
    Buffer.byteLength(JSON.stringify(body),'utf8')>MAX_REQUEST_BYTES||
    typeof body.dry_run!=='boolean')return resp(res,400,{error:'Invalid batch'});
  if(!validBatchShape(rows))return resp(res,400,{error:'Large batches must contain one invoice'});
  const bad=[],identities=new Set();
  rows.forEach((r,i)=>{const err=validate(r);if(err)bad.push({row:i+1,error:err});else{const key=lineId(r);if(identities.has(key))bad.push({row:i+1,error:'Duplicate source line'});identities.add(key);}});
  if(bad.length)return resp(res,422,{errors:bad});
  if(rows.some(x=>x.store_name!==rows[0].store_name||x.bill_date!==rows[0].bill_date))return resp(res,422,{error:'Mixed branch/date batch forbidden'});
  try {const result=await reconcile(getPool(),rows,body.dry_run);const {status,...data}=result;return resp(res,status,data);}
  catch(error){console.error('Sales sync live failed',error.code||error.name);return resp(res,502,{error:'Sales import failed safely; verify database before retry'});}
}
module.exports=handler;
module.exports._test={validate,lineId,coreMatches,reconcile,validBatchShape};
