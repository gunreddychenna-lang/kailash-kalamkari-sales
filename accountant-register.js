'use strict';
// Branch-scoped invoice overview. Its settled status is based only on verified receipt evidence.
(async () => {
  const el = id => document.getElementById(id);
  const rupees = n => n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
  const statusText = { settled: 'Settled · verified', pending: 'Pending review / balance',
    unverified: 'Unverified', review: 'Needs reconciliation' };
  let client, branch = 'all', tab = 'all', page = 1, loading = false, reloadQueued = false;
  function say(s) { el('register-status').textContent = s; }
  function node(tag, value, className) {
    const n = document.createElement(tag);
    if (value !== undefined) n.textContent = String(value);
    if (className) n.className = className;
    return n;
  }
  function cell(tr, value, className) { const c = node('td', value, className); tr.append(c); return c; }
  function paymentDetails(r) {
    const tr = document.createElement('tr'); tr.className = 'register-details';
    const td = document.createElement('td'); td.colSpan = 9;
    const details = document.createElement('details');
    const summary = node('summary', 'Bank / transaction history (' + r.history.length + ' recorded entries)');
    details.append(summary);
    if (!r.history.length) {
      details.append(node('p', 'No verified receipt or submitted reference recorded yet. Historical sale bank is not a settlement confirmation.'));
    } else {
      const wrap = node('div', undefined, 'scroll');
      const t = node('table');
      const head = node('thead'); const hr = node('tr');
      for (const x of ['Date','Type','Amount','Account','UTR / Reference','Status']) hr.append(node('th', x));
      head.append(hr); t.append(head);
      const body = node('tbody');
      for (const p of r.history) {
        const pr = node('tr');
        for (const v of [p.date || '—', p.type, rupees(p.amount), p.account || '—', p.reference || '—', p.status]) cell(pr, v);
        body.append(pr);
      }
      t.append(body); wrap.append(t); details.append(wrap);
    }
    if (r.sale_bank) details.append(node('p', 'Bank recorded on sales lines (NOT verified as paid): ' + r.sale_bank, 'register-footnote'));
    td.append(details); tr.append(td); return tr;
  }
  function paint(data) {
    const tbody = el('register-body'); tbody.replaceChildren();
    for (const r of data.rows) {
      const tr = node('tr');
      cell(tr, r.bill_date || '—');
      cell(tr, r.branch);
      cell(tr, r.bill_no, 'bill-code');
      cell(tr, rupees(r.invoice_amount));
      cell(tr, rupees(r.verified_paid));
      cell(tr, rupees(r.pending_amount));
      const bank = r.account || r.sale_bank || '—';
      cell(tr, bank, r.history.length ? '' : 'register-unverified');
      cell(tr, r.reference || '—');
      const status = cell(tr, statusText[r.status] || r.status);
      status.className = 'ledger-status ledger-status-' + r.status;
      const actionRow = paymentDetails(r);
      const billCell = tr.children[2];
      const enter = node('button', 'Enter', 'register-enter');
      enter.type = 'button'; enter.disabled = ['review', 'settled'].includes(r.status) || !/^[A-Za-z0-9_-]{1,64}$/.test(r.bill_no);
      enter.addEventListener('click', () => {
        const entryBranch = el('branch');
        if (![...entryBranch.options].some(opt => opt.value === r.branch)) { say('This invoice branch is not authorized for payment entry.'); return; }
        entryBranch.value = r.branch;
        el('bill').value = r.bill_no;
        el('entry-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (!el('lookup-fields').disabled) el('lookup-form').requestSubmit();
        else say('Finish or retry the previous payment submission before loading another invoice.');
      });
      const action = node('div'); action.append(enter); billCell.append(action);
      tbody.append(tr, actionRow);
    }
    if (!data.rows.length) {
      const tr = node('tr'); const td = cell(tr, 'No invoices match the selected filter.'); td.colSpan = 9; tbody.append(tr);
    }
    for (const button of document.querySelectorAll('[data-ledger-tab]')) {
      const key = button.dataset.ledgerTab;
      button.textContent = { all: 'All invoices', settled: 'Settled', pending: 'Pending',
        unverified: 'Unverified', review: 'Review' }[key] + ' · ' + (data.counts[key] ?? 0);
      button.setAttribute('aria-pressed', String(key === tab));
    }
    el('register-page').textContent = `Page ${data.page} / ${data.pages} · ${data.total} invoices`;
    el('register-prev').disabled = data.page <= 1;
    el('register-next').disabled = data.page >= data.pages;
    say('Loaded ' + data.rows.length + ' invoices. Settled amounts require approved or posted receipt evidence.');
  }
  async function load() {
    if (loading) { reloadQueued = true; return; }
    loading = true; say('Loading invoice register…');
    for (const b of [el('register-prev'), el('register-next'), el('register-refresh')]) b.disabled = true;
    try {
      const { data, error } = await client.auth.getSession();
      if (error || !data?.session?.access_token) throw new Error('Session expired. Sign in again.');
      const params = new URLSearchParams({ branch, status: tab, q: el('register-search').value.trim(), page: String(page), page_size: '25' });
      const response = await fetch('/api/accountant-payments?view=register&' + params, {
        cache: 'no-store', headers: { Authorization: 'Bearer ' + data.session.access_token } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Unable to load invoice register.');
      paint(result);
    } catch (e) { say(e.message || 'Register unavailable. Payment entry remains separate.'); }
    finally { loading = false; el('register-refresh').disabled = false; if (reloadQueued) { reloadQueued = false; await load(); } }
  }
  try {
    if (!window.supabase?.createClient || !window.KK_STAFF_CONFIG || !window.KKSecureAuth)
      throw new Error('Login configuration unavailable.');
    client = window.supabase.createClient(KK_STAFF_CONFIG.url, KK_STAFF_CONFIG.anonKey);
    const profile = await KKSecureAuth.getStaff(client);
    const full = profile && ['owner', 'admin'].includes(profile.role);
    const branches = full ? ['Main Branch', 'KHPS'] :
      profile?.role === 'employee' && profile.features.includes('payments') ?
        ['Main Branch', 'KHPS'].filter(x => profile.stores.includes(x)) : [];
    if (!profile?.active || !branches.length) throw new Error('No branch payment permission.');
    const picker = el('register-branch'); picker.replaceChildren(new Option('All authorized branches', 'all'));
    for (const b of branches) picker.append(new Option(b, b));
    el('register-branch-note').textContent = branches.length === 2 ? 'Main Branch and KHPS authorized.' :
      'Authorized branch: ' + branches.join(', ') + '. Additional branches require Owner/Admin approval.';
    picker.addEventListener('change', () => { branch = picker.value; page = 1; load(); });
    for (const b of document.querySelectorAll('[data-ledger-tab]')) {
      b.addEventListener('click', () => { tab = b.dataset.ledgerTab; page = 1; load(); });
    }
    el('register-form').addEventListener('submit', e => { e.preventDefault(); page = 1; load(); });
    el('register-refresh').addEventListener('click', load);
    el('register-prev').addEventListener('click', () => { page--; load(); });
    el('register-next').addEventListener('click', () => { page++; load(); });
    window.addEventListener('kk-accountant-request-saved', () => { page = 1; load(); });
    await load();
  } catch (e) { say(e.message || 'Invoice register unavailable.'); }
})();
