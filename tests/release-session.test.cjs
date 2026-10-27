const test=require('node:test');const assert=require('node:assert/strict');
const vm=require('node:vm');const fs=require('node:fs');
function wrapper(role){
 let signedOut=false;const profile={role,valid:true,active:true};
 const adapter={getStaff:async()=>profile,login:async()=>profile,signOut:async()=>{signedOut=true;}};
 const window={KKSecureAuth:adapter};const c=vm.createContext({window,KKSecureAuth:adapter,localStorage:{removeItem(){}},location:{replace(){}}});
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../common.js'),'utf8'),c);
 return {api:window.KK,client:{auth:{}},signedOut:()=>signedOut};
}
test('employee restored session is denied by first-release wrapper',async()=>{const w=wrapper('employee');assert.equal(await w.api.session(w.client),null);});
test('employee email login is rejected and signs out',async()=>{const w=wrapper('employee');await assert.rejects(w.api.login(w.client,'x','y'),/Owner or Admin/);assert.equal(w.signedOut(),true);});
for(const role of ['owner','admin'])test(`${role} remains authorized in first-release wrapper`,async()=>{const w=wrapper(role);assert.equal((await w.api.session(w.client)).secureRole,role);});
