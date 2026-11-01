'use strict';
// The only write is to the two NEW kk_drive_* tables through an atomic RPC.
const crypto=require('crypto');
function equal(a,b){const x=Buffer.from(a||'');const y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y);}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
 const token=process.env.KK_DRIVE_SYNC_SECRET;
 const db=process.env.KK_DRIVE_SYNC_SUPABASE_URL;
 const key=process.env.KK_DRIVE_SYNC_SERVICE_ROLE_KEY;
 if(!token||token.length<32||!db||!/^https:\/\/[^/]+\.supabase\.co$/.test(db)||!key)return res.status(503).json({error:'Sync not configured'});
 if(!equal(req.headers['x-kk-drive-sync-secret'],token))return res.status(401).json({error:'Unauthorized'});
 const body=req.body;
 if(!body||body.complete!==true||!Array.isArray(body.items)||body.items.length<1||body.items.length>25000)
  return res.status(400).json({error:'Full scan required'});
 const ids=new Set();
 for(const r of body.items){
  if(!r||typeof r.id!=='string'||!r.id.trim()||r.id.length>256||ids.has(r.id)||
   typeof r.store!=='string'||!r.store.trim()||r.store.length>128||
   typeof r.fabric!=='string'||!r.fabric.trim()||r.fabric.length>512||
   typeof r.filename!=='string'||!r.filename.trim()||r.filename.length>1024)
    return res.status(400).json({error:'Invalid or duplicate file record'});
  ids.add(r.id);
 }
 // Prevent accidental deletion on unexpectedly small otherwise-complete scans.
 const min=Number(process.env.KK_DRIVE_SYNC_MIN_FILES||'0');
 if(!Number.isInteger(min)||min<1||body.items.length<min)return res.status(409).json({error:'Scan below safety minimum'});
 try{
  const upstream=await fetch(db+'/rest/v1/rpc/kk_apply_drive_full_scan',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_items:body.items})});
  if(!upstream.ok)return res.status(503).json({error:'Database scan update failed'});
  return res.status(200).json(await upstream.json());
 }catch(_){return res.status(503).json({error:'Sync service unavailable'});}
};
