'use strict';
(async () => {
  const el = id => document.getElementById(id);
  const status = message => { el('status').textContent = message; };
  const money = value => Number(value).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
  let client, invoice, pending, storageKey, busy = false;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  function lock() {
    el('lookup-fields').disabled = busy || !!pending;
    el('payment-fields').disabled = busy || !!pending;
    el('retry-payment').hidden = !pending;
    el('retry-payment').disabled = busy;
  }
  async function api(method, payload) {
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.access_token) throw new Error('Please sign in again on the dashboard.');
    const response = await fetch('/api/payments' + (method === 'GET' ? '?' + new URLSearchParams(payload) : ''), {
      method, cache: 'no-store', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify(payload) } : {})
    });
    const result = await response.json();
    if (!response.ok) { const e = new Error(result.error || 'Payment unavailable'); e.status = response.status; throw e; }
    return result;
  }
  function readRows() {
    return [...el('payment-rows').children].map(row => ({
      account: row.querySelector('[name=account]').value.trim(),
      amount: row.querySelector('[name=amount]').value,
      payment_date: row.querySelector('[name=date]').value,
      reference: row.querySelector('[name=reference]').value.trim()
    }));
  }
  function draft() {
    try {
      const value = KK.paymentSummary(invoice.balance, readRows());
      el('draft-summary').textContent = `This entry: ${money(value.paidAmount)} · Balance after saving: ${money(value.balance)}`;
    } catch { el('draft-summary').textContent = 'Enter valid payment amounts within the remaining balance.'; }
  }
  function addRow() {
    if (el('payment-rows').children.length >= 20) return;
    const row = document.createElement('div'); row.className = 'payment';
    row.innerHTML = '<div class="grid"><label>Received date<input name="date" type="date" required min="2026-09-01"></label><label>Cash / bank account<input name="account" required maxlength="120" placeholder="e.g. Cash or TD"></label><label>Amount (₹)<input name="amount" type="number" required min="0.01" step="0.01"></label><label>Receipt reference (optional)<input name="reference" maxlength="120"></label></div><button type="button">Remove payment</button>';
    row.querySelector('[name=date]').value = today;
    row.querySelector('[name=date]').max = today;
    row.querySelector('button').addEventListener('click', () => { if (el('payment-rows').children.length > 1) { row.remove(); draft(); } });
    row.addEventListener('input', draft); el('payment-rows').append(row);
  }
  function render(data) {
    invoice = data; el('invoice').hidden = false;
    el('invoice-title').textContent = `${data.bill_no} · ${data.branch}`;
    el('bill-total').textContent = money(data.bill_amount); el('paid-total').textContent = money(data.paid_amount); el('balance').textContent = money(data.balance);
    el('history').replaceChildren();
    for (const batch of data.history) for (const payment of batch.payments) {
      const tr = document.createElement('tr');
      for (const value of [payment.payment_date, payment.account, money(payment.amount), payment.reference || '—', new Date(batch.entered_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })]) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      el('history').append(tr);
    }
    el('payment-rows').replaceChildren(); addRow(); draft();
    el('save-payment').disabled = Number(data.balance) <= 0;
  }
  async function submitPending() {
    if (!pending || busy) return;
    busy = true; lock(); status('Saving payment…');
    try {
      const result = await api('POST', pending);
      sessionStorage.removeItem(storageKey); pending = null;
      render(result); status(result.replayed ? 'Already saved. The retry did not count it again.' : 'Payment recorded in receipt ledger. Bill amount unchanged.');
    } catch (e) {
      // A definite validation rejection can be corrected; unknown outcomes retain the same key.
      if ([400,403,409,422].includes(e.status)) { sessionStorage.removeItem(storageKey); pending = null; }
      status(e.message + (pending ? ' Use “Retry same submission”; do not create a new entry.' : ' Refresh receipts before entering again.'));
    } finally { busy = false; lock(); }
  }
  el('lookup').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || pending) return; busy = true; lock(); status('Loading bill…');
    el('invoice').hidden = true; invoice = null;
    try { render(await api('GET', { bill_no: el('bill').value.trim(), branch: el('branch').value })); status('Test bill loaded.'); }
    catch (e) { status(e.message); } finally { busy = false; lock(); }
  });
  el('add-payment').addEventListener('click', addRow);
  el('retry-payment').addEventListener('click', submitPending);
  el('payment-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || pending || !invoice) return;
    try {
      const payments = readRows(); KK.paymentSummary(invoice.balance, payments);
      const candidate = { bill_no: invoice.bill_no, branch: invoice.branch, expected_bill_amount: invoice.bill_amount,
        idempotency_key: crypto.randomUUID(), payments };
      // Persist before sending so a reload after a lost response can safely retry.
      sessionStorage.setItem(storageKey, JSON.stringify(candidate)); pending = candidate;
      await submitPending();
    } catch (e) { status(e.message); }
  });
  try {
    client = supabase.createClient(KK_STAFF_CONFIG.url, KK_STAFF_CONFIG.anonKey);
    const profile = await KK.session(client);
    if (!profile) throw new Error('Please sign in as Owner or Admin on the sales dashboard, then return here.');
    storageKey = 'kk-payment-retry:' + profile.authUserId;
    pending = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    lock();
    if (pending) { el('invoice').hidden = false; status('An earlier submission needs confirmation. Retry the same submission safely.'); }
    else status('Ready. Load a test bill to begin.');
  } catch (e) { status(e.message); }
})();
