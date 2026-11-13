'use strict';
(async()=>{
 const el=id=>document.getElementById(id);
 const say=s=>el('status').textContent=s;
 const money=v=>Number(v||0).toLocaleString('en-IN',{style:'currency',currency:'INR'});
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let client,profile,invoice,accounts=[],history=[],pending=null,busy=false,storageKey='';
 function lock(){el('lookup-fields').disabled=busy||!!pending;el('payment-fields').disabled=busy||!!pending;el('retry-button').hidden=!pending;el('retry-button').disabled=busy;}
 function canUse(p){return p&&p.active===true&&(p.role==='owner'||p.role==='admin'||(p.role==='employee'&&p.features.includes('payments')&&p.stores.length));}
 async function api(method,payload){
   const {data,error}=await client.auth.getSession();if(error||!data?.session?.access_token)throw new Error('Session expired. Sign in again.');
   const url='/api/accountant-payments'+(method==='GET'?'?'+new URLSearchParams(payload):'');
   const response=await fetch(url,{method,cache:'no-store',headers:{Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(payload)}:{})});
   const result=await response.json().catch(()=>({error:'Invalid payment response'}));
   if(!response.ok){const e=new Error(result.error||'Request failed');e.status=response.status;throw e;}return result;
 }
 function branchOptions(){
   const stores=['Main Branch','KHPS'].filter(s=>['owner','admin'].includes(profile.role)||profile.stores.includes(s));
   el('branch').replaceChildren();for(const s of stores){const opt=new Option(s,s);el('branch').append(opt);}return stores.length>0;
 }
 function accountOptions(){
   const method=el('method').value;
   const eligible=accounts.filter(a=>method==='cash'?a.account_type==='Cash':
     ['Bank','Bank Account','Payment Service'].includes(a.account_type));
   el('account').replaceChildren();for(const a of eligible)el('account').append(new Option(a.account_name,a.account_name));
   const ref=el('reference');ref.required=false;ref.placeholder=method==='cash'?'Optional cash receipt note':'UTR / transaction reference (optional)';
 }
 function show(data){
   invoice=data.invoice;history=data.requests||[];accounts=data.accounts||[];
   el('invoice-area').hidden=false;
   el('invoice-heading').textContent=invoice.bill_no+' · '+invoice.branch;
   el('invoice-amount').textContent=money(invoice.bill_amount);
   el('pending-total').textContent=money(history.filter(x=>x.status==='pending').reduce((n,x)=>n+Number(x.amount),0));
   el('history').replaceChildren();
   for(const r of history){const tr=document.createElement('tr');for(const cell of [r.payment_date,r.payment_method,r.account_name,money(r.amount),r.payment_reference||'—',r.status]){const td=document.createElement('td');td.textContent=String(cell);tr.append(td);}el('history').append(tr);}
   accountOptions();el('amount').max=Number(invoice.bill_amount).toFixed(2);
 }
 async function loadInvoice(){
   busy=true;lock();say('Checking invoice and pending entries…');
   try{const branch=el('branch').value,bill=el('bill').value.trim().toUpperCase();
     if(!/^[A-Za-z0-9_-]{1,64}$/.test(bill))throw new Error('Enter a valid bill number.');
     el('bill').value=bill;const data=await api('GET',{branch,bill});show(data);say('Verified invoice loaded. Entries remain pending until reconciled.');
   }catch(e){invoice=null;el('invoice-area').hidden=true;say(e.message);}finally{busy=false;lock();}
 }
 async function save(){
   if(!pending||busy)return;busy=true;lock();say('Saving payment request securely…');
   try{const result=await api('POST',pending);
     sessionStorage.removeItem(storageKey);pending=null;
     const message=result.replayed?'Existing request confirmed — no duplicate':'Payment request saved: PENDING for review';
     const branch=el('branch').value,bill=el('bill').value;
     const data=await api('GET',{branch,bill});show(data);window.dispatchEvent(new Event('kk-accountant-request-saved'));say(message+'. No invoice balance was changed.');
   }catch(e){
     if([400,403,409,422].includes(e.status)){sessionStorage.removeItem(storageKey);pending=null;}
     say(e.message+(pending?' Use Retry Same Submission (do not create a new one).':' Review invoice and try again.'));
   }finally{busy=false;lock();}
 }
 try{
   if(!window.supabase?.createClient||!window.KK_STAFF_CONFIG||!window.KKSecureAuth)throw new Error('Secure login unavailable');
   client=window.supabase.createClient(KK_STAFF_CONFIG.url,KK_STAFF_CONFIG.anonKey);
   profile=await KKSecureAuth.getStaff(client);
   if(!canUse(profile)){location.replace('accountant-login.html');return;}
   if(!branchOptions())throw new Error('No authorized store assigned');
   storageKey='kk-accountant-request:'+profile.authUserId;
   pending=JSON.parse(sessionStorage.getItem(storageKey)||'null');
   el('payment-date').value=today;el('payment-date').max=today;
   el('method').addEventListener('change',accountOptions);
   el('lookup-form').addEventListener('submit',e=>{e.preventDefault();if(!pending)loadInvoice();});
   el('payment-form').addEventListener('submit',async e=>{
     e.preventDefault();if(!invoice||busy||pending)return;
     const method=el('method').value;
     const reference=el('reference').value.trim();

     const amount=el('amount').value;
     if(!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(amount)||Number(amount)<=0||Number(amount)>Number(invoice.bill_amount)){say('Enter a valid received amount within the invoice total.');return;}
     const candidate={branch:invoice.branch,bill_no:invoice.bill_no,amount,payment_method:method,account_name:el('account').value,payment_reference:reference,payment_date:el('payment-date').value,idempotency_key:crypto.randomUUID()};
     if(!candidate.account_name){say('Select a valid payment account.');return;}
     if(!confirm('Submit '+money(amount)+' for '+invoice.bill_no+' as PENDING for Owner/Admin review? This will NOT mark the invoice paid.'))return;
     pending=candidate;sessionStorage.setItem(storageKey,JSON.stringify(pending));await save();
   });
   el('retry-button').addEventListener('click',save);
   el('logout').addEventListener('click',async()=>{await KKSecureAuth.signOut(client);location.replace('accountant-login.html');});
   lock();
   if(pending){el('invoice-area').hidden=false;say('Previous submission has an unknown result. Click Retry Same Submission. Do not start another payment.');}
   else say('Signed in as '+profile.displayName+'. Enter the original bill number.');
 }catch(e){say(e.message||'Unable to load payment page');}
})();
