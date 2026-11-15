'use strict';
/* Editable invoice grid; saves to the EXISTING pending-request API only. */
(async () => {
  const el = id => document.getElementById(id);
  const Core = window.KKAccountantGridCore;
  const branchesList = ['Main Branch', 'KHPS'];
  const today = Core.todayIST();
  const fmt = value => value === null || value === undefined ? '—' :
    Number(value).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
  const statusLabel = {settled: 'Settled · recorded in portal', pending: 'Outstanding / partially paid',
    unverified: 'Unverified', review: 'Needs reconciliation'};
  const state = {client: null, profile: null, accounts: [], rows: [], edits: new Map(),
    branch: 'all', status: 'all', page: 1, totalPages: 1, busy: false, saving: false,
    storageKey: '', queue: null};
  const key = row => JSON.stringify([row.branch, row.bill_no]);
  const say = message => { el('notice').textContent = message; };
  function element(tag, text, className) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = String(text);
    if (className) n.className = className;
    return n;
  }
  function td(row, value, className) {
    const c = element('td', value, className); row.append(c); return c;
  }
  function button(label, fn, css = '', disabled = false) {
    const b = element('button', label, css); b.type = 'button'; b.disabled = disabled;
    b.addEventListener('click', fn); return b;
  }
  function input(kind, value, onChange, className = '') {
    const n = document.createElement('input'); n.type = kind;
    n.value = value || ''; n.className = className;
    n.addEventListener('input', () => { onChange(n.value); updateSaveAllButton(); }); return n;
  }
  function select(options, value, onChange, className = '') {
    const n = document.createElement('select'); n.className = className;
    for (const item of options) n.add(new Option(item.label, item.value));
    n.value = value;
    n.addEventListener('change', () => { onChange(n.value); updateSaveAllButton(); }); return n;
  }
  function part() { return {method:'upi', account:'', reference:'', amount:'', date:today}; }
  function editor(row) {
    const k = key(row);
    if (!state.edits.has(k)) state.edits.set(k, {parts:[part()], show:false});
    return state.edits.get(k);
  }
  function renderAccountList() {
    const list=el('accounts-list');list.replaceChildren();
    for (const a of state.accounts) {
      const tag=element('span',a.account_name+' · '+a.account_type,'accounts-pill');
      list.append(tag);
    }
    if(!state.accounts.length)list.append(element('span','No active payment accounts available.','muted'));
  }
  function hasDraft(edit) {
    return !!edit && edit.parts.some(p =>
      String(p.account||'').trim() || String(p.amount||'').trim() || String(p.reference||'').trim());
  }
  function updateSaveAllButton() {
    const saveAll = el('save-all-button');
    if (!saveAll) return;
    saveAll.disabled = state.busy || state.saving || !!state.queue ||
      !state.rows.some(row => hasDraft(state.edits.get(key(row))));
  }
  async function addBank(event) {
    event.preventDefault();
    if(!['owner','admin'].includes(state.profile?.role)) {el('bank-error').textContent='Owner/Admin only.';return;}
    const name=el('new-bank-name').value.trim();
    const type=el('new-bank-type').value;
    el('bank-submit').disabled=true;
    el('bank-error').textContent='';
    try {
      await request('POST','/api/accountant-payments?action=add-account',{account_name:name,account_type:type});
      el('bank-dialog').close();
      el('new-bank-name').value='';
      await fetchAccounts();renderAccountList();render();
      say('Payment account saved. Existing financial records are unchanged.');
    }catch(e){el('bank-error').textContent=e.message||'Unable to save account. Verify list before retrying.';}
    finally {el('bank-submit').disabled=false;}
  }
  function accountOptions(method) {
    return [{label:'Select account',value:''}, ...state.accounts.filter(a =>
      method === 'cash' ? a.account_type === 'Cash' :
        ['Bank', 'Bank Account', 'Payment Service'].includes(a.account_type)
    ).map(a => ({label:a.account_name,value:a.account_name}))];
  }
  function modeControl(p) {
    return select([
      {label:'UPI',value:'upi'}, {label:'Bank Transfer',value:'bank_transfer'},
      {label:'Card',value:'card'}, {label:'Cash',value:'cash'}
    ], p.method, value => {p.method = value; p.account = ''; render();}, 'method');
  }
  function accountControl(p) {
    return select(accountOptions(p.method), p.account, value => {p.account = value;});
  }
  function amountControl(p) {
    const n = input('number', p.amount, value => {p.amount = value;}, 'amount');
    n.min = '0.01'; n.step = '0.01'; n.placeholder = 'Received ₹'; return n;
  }
  function dateControl(p) {
    const n = input('date', p.date, value => {p.date = value;});
    n.min = '2026-09-01'; n.max = today; return n;
  }
  function referenceControl(p) {
    const n = input('text', p.reference, value => {p.reference = value;}, 'ref');
    n.maxLength = 120; n.placeholder = p.method === 'cash' ? 'Cash note (optional)' : 'UTR / transaction ID (optional)';
    return n;
  }
  function isLocked(row) {
    return state.saving || !!state.queue || ['review','settled'].includes(row.status) ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(row.bill_no);
  }
  function renderHistory(box, row) {
    const h = element('h3', 'Recorded payment / reference history'); box.append(h);
    if (!row.history?.length) {
      box.append(element('p', 'No verified receipt or submitted UTR is recorded for this invoice.', 'muted'));
    } else {
      const scroller = element('div', undefined, 'history'); const table = element('table');
      const head = element('thead'), header = element('tr');
      for (const title of ['Payment date','Record','Bank / Account','Amount','UTR / Reference','Status']) header.append(element('th',title));
      head.append(header); table.append(head);
      const body = element('tbody');
      for (const p of row.history) {
        const tr = element('tr');
        for (const value of [p.date||'—',p.type||'—',p.account||'—',fmt(p.amount),p.reference||'—',p.status||'—']) td(tr,value);
        body.append(tr);
      }
      table.append(body);scroller.append(table);box.append(scroller);
    }
    if (row.sale_bank) box.append(element('p',
      'Bank in original Sales data (NOT proof of settlement): ' + row.sale_bank,'muted'));
  }
  function renderSplit(box, row, p, index, editing) {
    const grid = element('div', undefined, 'split-grid');
    const labelled = (name, control) => {const label = element('label', name); label.append(control);grid.append(label);};
    labelled('Mode', modeControl(p));
    labelled('Bank / Account', accountControl(p));
    labelled('UTR / Reference', referenceControl(p));
    labelled('Amount Received ₹', amountControl(p));
    labelled('Received Date', dateControl(p));
    const action = element('div');
    action.append(button('Remove split', () => {
      editing.parts.splice(index,1); render();
    }, 'secondary', state.saving || !!state.queue));
    grid.append(action);box.append(grid);
  }
  function rowDetails(row, edit) {
    const detail = element('tr', undefined, 'detail-row');
    const cell = element('td');cell.colSpan = 10;
    const wrapper = element('div',undefined,'detail');
    const head = element('div',undefined,'split-head');
    head.append(element('h3','Split payments · ' + row.bill_no));
    let available = '—';
    try {available=fmt(Core.availableCents(row)/100);} catch {}
    head.append(element('strong','Remaining for NEW requests: ' + available));wrapper.append(head);
    if (edit.parts.length > 1) {
      for (let i=1;i<edit.parts.length;i++) renderSplit(wrapper,row,edit.parts[i],i,edit);
    } else wrapper.append(element('p','Use Add Split to divide one invoice across multiple banks. Each split is submitted as a separate pending request.','muted'));
    renderHistory(wrapper,row);
    cell.append(wrapper);detail.append(cell);return detail;
  }
  function drawRow(row) {
    const tr = element('tr');
    const edit = editor(row), p = edit.parts[0], locked = isLocked(row);
    td(tr,row.bill_date || '—','no-wrap');
    td(tr,row.sales_girl || '—');
    td(tr,row.sales_channel || '—');
    td(tr,row.bill_no,'bill');
    const amount = td(tr,fmt(row.invoice_amount),'money no-wrap');
    amount.append(element('div','Recorded paid: '+fmt(row.verified_paid),'tiny'));
    if (row.excess_received>0) amount.append(element('div','Excess collected: '+fmt(row.excess_received),'tiny'));
    amount.append(element('div','Existing pending: '+fmt(row.pending_amount),'tiny'));
    const bank = td(tr);
    const mode = modeControl(p), account = accountControl(p);
    mode.disabled = locked; account.disabled=locked;
    bank.append(mode,account);
    if (row.account && row.history?.length) bank.append(element('div','Recorded: '+row.account,'tiny'));
    if (row.sale_bank) bank.append(element('div','Sales bank (unverified): '+row.sale_bank,'tiny'));
    const ref = td(tr);const refInput = referenceControl(p);refInput.disabled=locked;ref.append(refInput);
    if (row.reference) ref.append(element('div','Recorded: '+row.reference,'tiny'));
    const received = td(tr);const moneyInput=amountControl(p),dateInput=dateControl(p);
    moneyInput.disabled=locked;dateInput.disabled=locked;
    received.append(moneyInput,element('div','Received date','tiny'),dateInput);
    const actions = td(tr);
    actions.append(button('+ Add Split',() => {
      edit.parts.push(part());edit.show=true;render();
    },'secondary', locked || edit.parts.length>=20));
    actions.append(button('Save Receipt',() => saveRow(row), '',locked));
    actions.append(button(edit.show ? 'Hide details' : 'Details / History', () => {
      edit.show=!edit.show;render();
    },'secondary'));
    const settled = (row.display_status || row.status) === 'settled';
    const displayLabel = settled ? (row.collection_settled_for_now
      ? 'Settled for now · '+fmt(row.balance_due)+' due' : 'Settled') : 'Not Settled';
    const status = td(tr);status.append(element('span',displayLabel,'tag '+(settled?'settled':'pending')));
    if (row.status === 'review') status.append(element('div','Requires reconciliation before payment entry','tiny'));
    const detail = edit.show ? rowDetails(row,edit) : null;
    return detail ? [tr,detail] : [tr];
  }
  function renderBranchTotals(totals) {
    const container = el('branch-totals');
    if (!container) return;
    container.replaceChildren();
    if (!Array.isArray(totals)) { container.append(element('span','Branch amounts unavailable','muted')); return; }
    for (const t of totals) {
      const card = element('article',undefined,'branch-amount');
      card.append(element('strong',t.branch));
      for (const [label,value] of [['Invoiced',t.billed],['Recorded Paid (allocated)',t.recorded_paid],['Balance Due',t.due],['Excess Collected',t.excess_collected || 0]]) {
        const line = element('div');
        line.append(element('span',label+': '));
        line.append(element('span',fmt(value),'money'));
        card.append(line);
      }
      card.append(element('div','Invoices: '+t.invoices+(t.excluded_review?' · Excluded for review: '+t.excluded_review:''),'tiny'));
      container.append(card);
    }
  }
  function render() {
    const body = el('sheet-body'); body.replaceChildren();
    for (const row of state.rows) body.append(...drawRow(row));
    if (!state.rows.length) {
      const tr=element('tr');const col=td(tr,'No invoices match this filter.');col.colSpan=10;body.append(tr);
    }
    el('previous').disabled = state.busy || state.saving || state.page<=1;
    el('next').disabled = state.busy || state.saving || state.page>=state.totalPages;
    el('page').textContent='Page '+state.page+' of '+state.totalPages;
    el('queue').hidden = !state.queue;
    if (state.queue) el('queue-status').textContent =
      `Unfinished submission for ${state.queue.bill_no}: ${state.queue.completed} saved, ${state.queue.parts.length} remaining. Retry with same keys to avoid duplicates.`;
    el('queue-retry').disabled = state.saving;
    updateSaveAllButton();
    el('add-bank-button').disabled = state.busy || state.saving || !!state.queue;
  }
  async function request(method, url, body) {
    const {data,error}=await state.client.auth.getSession();
    if(error || !data?.session?.access_token) throw new Error('Session expired. Sign in again.');
    const response = await fetch(url,{method,cache:'no-store',headers:{
      Authorization:'Bearer '+data.session.access_token, 'Content-Type':'application/json'
    },...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok){const ex=new Error(result.error||'Payment service unavailable.');ex.httpStatus=response.status;throw ex;}
    return result;
  }
  async function fetchAccounts() {
    const accessible=state.profile.role==='owner'||state.profile.role==='admin' ? branchesList :
      branchesList.filter(b=>state.profile.stores.includes(b));
    if(!accessible.length) throw new Error('No approved branch available.');
    const result=await request('GET','/api/accountant-payments?branch='+encodeURIComponent(accessible[0]));
    if(!Array.isArray(result.accounts)) throw new Error('Bank account list unavailable.');
    state.accounts=result.accounts;
    renderAccountList();
    const picker=el('branch');picker.replaceChildren(new Option('All permitted branches','all'));
    for(const name of accessible) picker.add(new Option(name,name));
    picker.value=state.branch;
    el('branch-note').textContent='Accessible branches: '+accessible.join(', ')+'. Other branches need Owner/Admin permission.';
    const accountPicker = el('ledger-account');
    const prior = accountPicker.value;
    accountPicker.replaceChildren(new Option('All Accounts','all'));
    for (const name of [...new Set(state.accounts.map(a=>a.account_name))].sort((a,b)=>a.localeCompare(b))) {
      accountPicker.add(new Option(name,name));
    }
    accountPicker.value = [...accountPicker.options].some(x=>x.value===prior)?prior:'all';
  }
  async function load() {
    if(state.busy || state.saving)return;
    state.busy=true;
    say('Loading invoice rows…');
    el('refresh').disabled=true;
    try {
      const from = el('date-from').value;
      const to = el('date-to').value;
      if (from && to && from > to) throw new Error('From date cannot be after To date.');
      const query=new URLSearchParams({view:'register',branch:state.branch,status:state.status,
        from, to, channel:el('sales-channel').value,account:el('ledger-account').value,
        q:el('search').value.trim(),page:String(state.page),page_size:'25'});
      const result=await request('GET','/api/accountant-payments?'+query);
      if(!Array.isArray(result.rows)) throw new Error('Invoice response is invalid.');
      const channelPicker = el('sales-channel');
      const chosen = channelPicker.value;
      channelPicker.replaceChildren(new Option('All Sales Channels','all'));
      for (const name of (result.sales_channels || [])) channelPicker.add(new Option(name,name));
      channelPicker.value = [...channelPicker.options].some(o=>o.value===chosen) ? chosen : 'all';
      state.rows=result.rows;state.totalPages=Math.max(1,Number(result.pages)||1);
      for(const tab of document.querySelectorAll('[data-status]')){
        const name=tab.dataset.status;
        tab.textContent=({all:'All',settled:'Settled',not_settled:'Not Settled'}[name])+ ' · '+(result.counts?.[name]??0);
        tab.setAttribute('aria-pressed',String(state.status===name));
      }
      renderBranchTotals(result.branch_totals);
      const ledger = el('receipt-ledger');
      ledger.replaceChildren();
      if (el('sales-channel').value !== 'all' || el('ledger-account').value !== 'all') {
        if (!Array.isArray(result.receipt_ledger)) throw new Error('Payment ledger data unavailable.');
        for (const item of result.receipt_ledger) {
          const card = element('article',undefined,'branch-amount');
          card.append(element('strong',item.branch+' · Matching Recorded Receipts'));
          card.append(element('div',fmt(item.recorded_amount),'money'));
          ledger.append(card);
        }
      }
      el('count').textContent=(result.total??0)+' matching invoices';
      say('Invoice rows ready. Tab between cells to enter payments. Save creates PENDING entries only.');
    } catch(e) {
      // Never allow saving against stale invoice balances if the live ledger
      // cannot be refreshed. Keep unsaved edits in memory for the next Refresh.
      state.rows = [];
      state.totalPages = 1;
      renderBranchTotals(null);
      el('receipt-ledger')?.replaceChildren();
      say((e.message||'Unable to load invoices.')+' Click Refresh to retry. Unsaved edits are preserved.');
    }
    finally {state.busy=false;el('refresh').disabled=false;render();}
  }
  function getQueue() {
    try {const parsed=JSON.parse(sessionStorage.getItem(state.storageKey)||'null');
      if (!parsed) return null;
      if (!parsed.bill_no || !Array.isArray(parsed.parts) || !Number.isSafeInteger(parsed.completed) ||
          parsed.completed<0 || parsed.parts.length>500 ||
          parsed.parts.some(p=>!p||typeof p.idempotency_key!=='string'||
            typeof p.bill_no!=='string'||!['Main Branch','KHPS'].includes(p.branch)) ||
          (parsed.bulk && (!Array.isArray(parsed.invoices)||parsed.invoices.length<1||parsed.invoices.length>25))) throw new Error();
      return parsed;
    } catch { throw new Error('Saved payment retry data is unreadable. Do not create a new request. Contact Owner/Admin.'); }
  }
  function keepQueue() {
    if(state.queue)sessionStorage.setItem(state.storageKey,JSON.stringify(state.queue));
    else sessionStorage.removeItem(state.storageKey);
  }
  async function finishQueue() {
    if(!state.queue || state.saving) return;
    state.saving=true;render();
    try {
      while (state.queue.parts.length) {
        const payload=state.queue.parts[0];
        say('Posting payment split '+(state.queue.completed+1)+' as a receipt. Do not close this page…');
        const result=await request('POST','/api/accountant-payments',payload);
        if (!result.id || result.status !== 'approved' || result.posted !== true) {
          throw new Error('Unexpected save response. Retry the SAME submission after checking history.');
        }
        state.queue.parts.shift();state.queue.completed++;keepQueue();
      }
      const completed=state.queue.completed,bill=state.queue.bill_no,branch=state.queue.branch;
      const keys=state.queue.bulk ? state.queue.invoices : [JSON.stringify([branch,bill])];
      state.queue=null;keepQueue();for(const k of keys)state.edits.delete(k);
      const message=`${completed} receipt split(s) posted for ${keys.length} invoice(s). Fully paid invoices become Settled; partial payments retain a balance. Bank reconciliation is separate.`;
      say(message);
      state.saving=false;
      // A successful receipt is permanent even if the subsequent register refresh
      // fails (e.g. upstream timeout). Do not ask staff to save it again.
      await load();
      say(message);
      return;
    } catch(e) {
      say((e.message||'Save interrupted.')+' Retry the SAME submission. Some earlier splits may already have been saved.');
      keepQueue();
    } finally {state.saving=false;render();}
  }
  async function saveAllEditedPage() {
    if(state.busy||state.saving||state.queue){say('Finish the earlier payment submission before bulk save.');return;}
    const selected=state.rows.filter(row=>hasDraft(state.edits.get(key(row))));
    if(!selected.length){say('Enter at least one payment on this page before Save All.');return;}
    const requests=[];let totalCents=0;
    for(const row of selected) {
      let valid;
      try{valid=Core.validate(row,editor(row).parts,state.accounts,today);}
      catch(e){say(row.bill_no+': '+e.message+' Nothing has been submitted.');return;}
      if(valid.estimatedExcessCents>0 && valid.splits.length>1){say(row.bill_no+': Excess payment across multiple splits needs separate review; enter it as one payment to avoid partial posting.');return;}
      totalCents+=valid.totalCents;
      for(const s of valid.splits)requests.push({...s,branch:row.branch,bill_no:row.bill_no,
        idempotency_key:crypto.randomUUID()});
    }
    if(requests.length>50){say('Limit is 50 payment splits per Save All. Save some invoices individually.');return;}
    const agree=window.confirm(`Submit ${requests.length} payment split(s) for ${selected.length} invoice(s) on the CURRENT PAGE, total ${fmt(totalCents/100)}?\n\nThese receipts are posted immediately. Extra money is recorded separately as excess, not sales. Fully paid invoices become Settled; partials remain outstanding. Check original bank records before recording. If a request fails, earlier requests may have been saved; use the on-screen RETRY with the same keys.`);
    if(!agree)return;
    state.queue={bulk:true,branch:'Multiple',bill_no:selected.length+' invoices',completed:0,
      invoices:selected.map(key),parts:requests};
    keepQueue();await finishQueue();
  }
  async function saveRow(row) {
    if(state.saving || state.queue) {say('Finish the earlier split submission first.');return;}
    let valid;
    try{valid=Core.validate(row,editor(row).parts,state.accounts,today);}catch(e){say(e.message);return;}
    if(valid.estimatedExcessCents>0 && valid.splits.length>1){say('For an excess collection use one payment entry; multi-bank excess splits cannot safely post individually.');return;}
    const total=fmt(valid.totalCents/100);
    const caution = row.status === 'unverified' ? '\nWARNING: Earlier payments have not been fully reconciled. Confirm this is a NEW receipt, not an old payment.' : '';
    const approved=window.confirm(`Submit ${valid.splits.length} payment row(s), total ${total}, for ${row.branch} / ${row.bill_no}?\n\nReceipt posts immediately. Invoice allocation is limited to the remaining bill amount. Excess ${fmt(valid.estimatedExcessCents/100)} is tracked separately, not added to sales. Partial payment leaves an actual due balance.${caution}`);
    if(!approved)return;
    state.queue={branch:row.branch,bill_no:row.bill_no,completed:0,
      parts:valid.splits.map(s=>({...s,branch:row.branch,bill_no:row.bill_no,idempotency_key:crypto.randomUUID()}))};
    keepQueue();await finishQueue();
  }
  // Keep Sign Out available even if authentication or permission fails.
  el('logout').addEventListener('click', async () => {
    const button = el('logout');
    button.disabled = true;
    try {
      const client = state.client || (
        window.supabase?.createClient && window.KK_STAFF_CONFIG
          ? window.supabase.createClient(
              KK_STAFF_CONFIG.url,
              KK_STAFF_CONFIG.anonKey
            )
          : null
      );
      if (!client) throw new Error('Authentication unavailable');

      const { error } = await client.auth.signOut();
      if (error) throw error;

      location.replace('accountant-login.html');
    } catch (error) {
      button.disabled = false;
      el('fatal').textContent =
        'Sign out failed. Clear this website site data in Chrome settings.';
    }
  });

  try {
    if(!Core || !window.supabase?.createClient || !window.KK_STAFF_CONFIG || !window.KKSecureAuth)
      throw new Error('Secure Accountant configuration is missing.');
    state.client=window.supabase.createClient(KK_STAFF_CONFIG.url,KK_STAFF_CONFIG.anonKey);
    state.profile=await KKSecureAuth.getStaff(state.client);
    if(!state.profile?.active || !(['owner','admin'].includes(state.profile.role) ||
      (state.profile.role==='employee' && state.profile.features.includes('payments') && state.profile.stores.length)))
      throw new Error('Your account does not have payment-entry permission.');
    state.storageKey='kk-accountant-grid-queue:'+state.profile.authUserId;
    state.queue=getQueue();
    await fetchAccounts();
    // Only authenticated Owner/Admin may see or use Add Bank; never tie it to a
    // branch or staff feature, and do not remove it during grid re-renders.
    const canAddBank = ['owner','admin'].includes(state.profile.role);
    el('add-bank-button').hidden = !canAddBank;
    el('add-bank-button').setAttribute('aria-hidden', String(!canAddBank));
    el('add-bank-button').addEventListener('click',()=>{el('bank-error').textContent='';el('bank-dialog').showModal();});
    el('bank-cancel').addEventListener('click',()=>el('bank-dialog').close());
    el('bank-form').addEventListener('submit',addBank);
    el('save-all-button').addEventListener('click',saveAllEditedPage);
    el('branch').addEventListener('change',()=>{state.branch=el('branch').value;state.page=1;load();});
    for (const id of ['date-from','date-to']) el(id).addEventListener('change',()=>{state.page=1;load();});
    for (const id of ['sales-channel','ledger-account'])
      el(id).addEventListener('change',()=>{state.page=1;load();});
    el('today-filter').addEventListener('click',()=>{el('date-from').value=today;el('date-to').value=today;state.page=1;load();});
    el('clear-dates').addEventListener('click',()=>{el('date-from').value='';el('date-to').value='';state.page=1;load();});
    el('search-button').addEventListener('click',()=>{state.page=1;load();});
    el('search').addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();state.page=1;load();}});
    el('refresh').addEventListener('click',load);
    el('previous').addEventListener('click',()=>{if(state.page>1){state.page--;load();}});
    el('next').addEventListener('click',()=>{if(state.page<state.totalPages){state.page++;load();}});
    for(const tab of document.querySelectorAll('[data-status]'))tab.addEventListener('click',()=>{
      state.status=tab.dataset.status;state.page=1;load();
    });
    el('queue-retry').addEventListener('click',finishQueue);

    await load();
    if(state.queue)say('An earlier split submission needs confirmation. Click Retry same submission.');
  } catch(e) {el('fatal').textContent=e.message||'Accountant grid unavailable.';say('Please sign in again or contact Owner/Admin.');}
})();
