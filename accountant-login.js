'use strict';
(async()=>{
 const el=id=>document.getElementById(id), say=x=>el('status').textContent=x;
 try{
   if(!window.supabase?.createClient||!window.KK_STAFF_CONFIG||!window.KKSecureAuth)throw new Error('Login configuration unavailable');
   const client=window.supabase.createClient(KK_STAFF_CONFIG.url,KK_STAFF_CONFIG.anonKey);
   const allowed=p=>p&&p.active===true&&(p.role==='owner'||p.role==='admin'||(p.role==='employee'&&p.features.includes('payments')&&p.stores.length>0));
   const open=async()=>{const p=await KKSecureAuth.getStaff(client);if(allowed(p))location.replace('accountant-grid.html');};
   client.auth.onAuthStateChange(event=>{
     if(event==='PASSWORD_RECOVERY'){
       el('login').hidden=true;el('recovery').hidden=false;el('forgot').hidden=true;say('Set your new password to finish recovery.');
     }
   });
   el('login').addEventListener('submit',async e=>{
     e.preventDefault();el('sign-in').disabled=true;say('Verifying staff access…');
     try{const p=await KKSecureAuth.login(client,el('email').value,el('password').value);
       if(!allowed(p)){await KKSecureAuth.signOut(client);throw new Error('Account does not have payment entry permission');}
       location.replace('accountant-grid.html');
     }catch(err){say(err.message||'Sign in failed');}finally{el('sign-in').disabled=false;}
   });
   el('forgot').addEventListener('click',async()=>{
     const email=el('email').value.trim();if(!/^\S+@\S+\.\S+$/.test(email)){say('Enter your account email first.');return;}
     el('forgot').disabled=true;
     try{const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin+'/accountant-login.html'});
       if(error)throw error;
       say('If the account exists, a password recovery link has been sent. Check your email.');
     }catch{say('Password recovery unavailable. Contact Owner/Admin.');}finally{el('forgot').disabled=false;}
   });
   el('recovery').addEventListener('submit',async e=>{
     e.preventDefault();const password=el('new-password').value;
     if(password.length<12){say('Password must contain at least 12 characters.');return;}
     const {error}=await client.auth.updateUser({password});
     if(error){say('Password change failed. Please use a new recovery link.');return;}
     await client.auth.signOut();
     history.replaceState(null,'',location.pathname);
     el('recovery').hidden=true;el('login').hidden=false;el('forgot').hidden=false;say('Password saved. Sign in with the new password.');
   });
   if(!location.hash.includes('type=recovery'))await open();
   if(!el('recovery').hidden)return;
   say('Use your approved account email and password.');
 }catch(err){say(err.message||'Unable to load login');}
})();
