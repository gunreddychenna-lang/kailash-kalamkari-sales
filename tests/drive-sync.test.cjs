const assert=require('node:assert/strict');
const test=require('node:test');
const {nameParts,mapRow}=require('../lib/drive-normalize');
test('duplicate suffix means same design and colour',()=>{
 assert.deepEqual(nameParts('Peacock & Red (2).jpg'),{design:'Peacock',colour:'Red',needs_review:false});
 assert.deepEqual(nameParts('Peacock & Red.jpg'),nameParts('Peacock & Red (2).jpg'));
});
test('unknown design and no ampersand are explicit',()=>{
 assert.deepEqual(nameParts('& Green.jpeg'),{design:'Unknown Design',colour:'Green',needs_review:true});
 assert.deepEqual(nameParts('IMG_2026.jpg'),{design:'Unknown Design',colour:'Unknown Colour',needs_review:true});
});
test('same colour and design across distinct ids remains distinct',()=>{
 const a=mapRow({drive_file_id:'A',store:'C',fabric:'Silk',filename:'Peacock & Red.jpg'});
 const b=mapRow({drive_file_id:'B',store:'C',fabric:'Silk',filename:'Peacock & Red (1).jpg'});
 assert.equal(a.theme,b.theme);assert.notEqual(a.id,b.id);
});
const handler=require('../api/drive-sync');
function res(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;return this;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};}
test('sync rejects unauthenticated calls',async()=>{
 const old={...process.env};
 process.env.KK_DRIVE_SYNC_SECRET='a'.repeat(40);process.env.KK_DRIVE_SYNC_SUPABASE_URL='https://example.supabase.co';process.env.KK_DRIVE_SYNC_SERVICE_ROLE_KEY='dummy';
 try{const r=res();await handler({method:'POST',headers:{},body:{complete:true,items:[]}},r);assert.equal(r.statusCode,401);}finally{process.env=old;}
});
test('sync refuses partial scans',async()=>{
 const old={...process.env};
 process.env.KK_DRIVE_SYNC_SECRET='a'.repeat(40);process.env.KK_DRIVE_SYNC_SUPABASE_URL='https://example.supabase.co';process.env.KK_DRIVE_SYNC_SERVICE_ROLE_KEY='dummy';
 try{const r=res();await handler({method:'POST',headers:{'x-kk-drive-sync-secret':'a'.repeat(40)},body:{complete:false,items:[{id:'1'}]}},r);assert.equal(r.statusCode,400);}finally{process.env=old;}
});
