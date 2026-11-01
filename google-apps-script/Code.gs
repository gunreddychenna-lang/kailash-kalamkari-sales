/** Google Apps Script — configure Script Properties; no credentials in source.
 * ROOTS_JSON = [{"id":"DRIVE_FOLDER_ID","store":"Main Catalogue"},{"id":"SECOND_ID","store":"KHPS"}]
 * SYNC_URL = https://YOUR-PREVIEW.vercel.app/api/drive-sync
 * SYNC_SECRET = same 32+ character secret as KK_DRIVE_SYNC_SECRET in Preview
 * Sends only COMPLETE full scans. Failed folders abort the upload entirely.
 */
function kkScanAndSync() {
  const p = PropertiesService.getScriptProperties();
  const roots=JSON.parse(p.getProperty('ROOTS_JSON') || '[]');
  const url=p.getProperty('SYNC_URL');const secret=p.getProperty('SYNC_SECRET');
  if(roots.length<1||!url||!secret||secret.length<32)throw Error('Missing configuration');
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
  try{
    const seen=new Set(), items=[];
    roots.forEach(root=>{
      if(!root.id||!root.store)throw Error('Invalid root config');
      walk_(DriveApp.getFolderById(root.id),root.store,[],items,seen);
    });
    if(items.length<1)throw Error('Empty scan blocked');
    const body=JSON.stringify({complete:true,items:items});
    const resp=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',headers:{'x-kk-drive-sync-secret':secret},payload:body,muteHttpExceptions:true});
    if(resp.getResponseCode()!==200)throw Error('Sync rejected: HTTP '+resp.getResponseCode()+' '+resp.getContentText().slice(0,200));
    console.log('Sync OK '+resp.getContentText());
  }finally{lock.releaseLock();}
}
function walk_(folder,store,path,items,seen){
  const current=path.concat([folder.getName()]);
  const files=folder.getFiles();
  while(files.hasNext()){
    const f=files.next();
    if(!/^image\//.test(f.getMimeType()))continue;
    const id=f.getId();if(seen.has(id))throw Error('Duplicate across roots '+id);seen.add(id);
    // Folder directly containing image acts as fabric; adjust after real catalogue inspection.
    items.push({id:id,store:store,department:'Saree',fabric:current[current.length-1],filename:f.getName()});
  }
  const sub=folder.getFolders();while(sub.hasNext())walk_(sub.next(),store,current,items,seen);
}
function kkInstallQuarterHourlyTrigger(){
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='kkScanAndSync').forEach(ScriptApp.deleteTrigger);
  ScriptApp.newTrigger('kkScanAndSync').timeBased().everyMinutes(15).create();
}
