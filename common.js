/* Shared, dependency-free data and authentication helpers. */
window.KK = (() => {
  const number = (value, fallback = 0) => {
    if (value === null || value === undefined || String(value).trim() === '') return fallback;
    const n = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(n) ? n : fallback;
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const phone = value => {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (digits.length === 10) return '91' + digits;
    if (digits.length === 11 && digits.startsWith('0')) return '91' + digits.slice(1);
    return digits;
  };
  function invoiceParts(row) {
    const bill = String(row.bill_no ?? row['BILL NO'] ?? row['Bill No'] ?? row['Bil No'] ?? '').trim().toUpperCase();
    let branch = String(row.branch ?? row.branch_name ?? row.store_name ?? row.store ?? row['Branch Name'] ?? row['Branch'] ?? row['STORE NAME'] ?? row['Store'] ?? '').trim().toUpperCase();
    if (branch.startsWith('KHPS')) branch = 'KHPS';
    const rawDate = String(row.bill_date ?? row.date ?? row['Bill Date'] ?? row['BILL DATE'] ?? '').trim();
    const iso = rawDate.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    const dmy = rawDate.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    let date = iso ? `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
      : dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : rawDate;
    return { bill, branch, date, key: JSON.stringify([bill, branch, date]) };
  }
  function invoiceIndex(masters) {
    const byBill = new Map();
    for (const row of masters) {
      const part = invoiceParts(row);
      if (!part.bill) continue;
      const bucket = byBill.get(part.bill) || new Map();
      const old = bucket.get(part.key);
      if (!old) bucket.set(part.key, { ...part, master: row, conflict: false });
      else if (number(old.master.bill_amount) !== number(row.bill_amount) ||
        String(old.master.sm_name || '').trim().toLowerCase() !== String(row.sm_name || '').trim().toLowerCase() ||
        String(old.master.channel || '') !== String(row.channel || '')) old.conflict = true;
      byBill.set(part.bill, bucket);
    }
    return byBill;
  }
  function matchInvoice(row, index) {
    const part = invoiceParts(row);
    const all = [...(index.get(part.bill)?.values() || [])];
    if (!all.length) return { ...part, master: null };
    const matches = all.filter(candidate => (!part.branch || candidate.branch === part.branch) && (!part.date || candidate.date === part.date));
    if (matches.length !== 1 || matches[0].conflict) return { ...part, ambiguous: true };
    return matches[0];
  }
  function invoiceGroups(sales, index) {
    const groups = new Map(), issues = new Set();
    let excluded = 0;
    sales.forEach((row, i) => {
      const match = matchInvoice(row, index);
      if (match.ambiguous) { excluded++; issues.add(match.bill); return; }
      const key = match.bill ? match.key : `MISSING_${i}`;
      if (!groups.has(key)) groups.set(key, { key, master: match.master, items: [] });
      groups.get(key).items.push(row);
    });
    return { groups: [...groups.values()], issues: [...issues], excluded };
  }
  function reconciliationNotice(excluded, issues) {
    let el = document.getElementById('reconciliation-warning');
    if (!el && excluded) {
      el = document.createElement('div');
      el.id = 'reconciliation-warning';
      el.setAttribute('role', 'alert');
      el.style.cssText = 'padding:12px;margin:12px;border:1px solid #b45309;background:#fffbeb;color:#78350f;font:14px sans-serif';
      document.body.prepend(el);
    }
    if (el) {
      el.hidden = !excluded;
      el.textContent = excluded ? `Totals are incomplete: ${excluded} sales rows excluded because invoice branch/date or master totals are ambiguous. Review: ${issues.slice(0, 10).join(', ')}${issues.length > 10 ? '…' : ''}.` : '';
    }
  }
  function amounts(items, masterTotal = null) {
    const lines = items.map(r => {
      const rate = r.rate ?? r.RATE ?? r.Rate;
      return rate != null && rate !== ''
        ? number(rate) * number(r.qty ?? r.QTY ?? r.Qty, 1) - number(r.discount ?? r.DISCOUNT ?? r.Discoun)
        : number(r.amount ?? r.AMOUNT ?? r.bill_amount);
    });
    if (masterTotal === null || masterTotal === undefined) return lines;
    const total = number(masterTotal);
    const sum = lines.reduce((a, b) => a + b, 0);
    if (sum === 0 && total !== 0 && items.length > 1) throw new Error('Invoice has no line amounts; cannot allocate its revenue reliably.');
    const result = lines.map(line => sum ? Math.round(line / sum * total * 100) / 100 : total / items.length);
    if (result.length) result[result.length - 1] = Math.round((total - result.slice(0, -1).reduce((a, b) => a + b, 0)) * 100) / 100;
    return result;
  }
  async function rows(client, table, columns = '*', order = 'id') {
    const result = [];
    // Continue until an empty page: also works with server caps below 1,000.
    for (let offset = 0; ; ) {
      const { data, error } = await client.from(table).select(columns).order(order).range(offset, offset + 999);
      if (error) throw error;
      if (!data?.length) return result;
      result.push(...data);
      offset += data.length;
    }
  }
  let identity = null;
  const sessionKey = 'kk_simple_session';
  function logout() {
    identity = null;
    localStorage.removeItem(sessionKey);
    ['kk_user', 'kk_role', 'kk_emp_id', 'kk_display_name', 'kk_login_time'].forEach(key => localStorage.removeItem(key));
  }
  // User-requested simple login. This is a UI gate, not server authentication.
  async function login(client, username, password) {
    logout();
    const user = String(username || '').trim().toLowerCase();
    let profile;
    if (user === 'admin') {
      if (password !== 'admin') throw new Error('Invalid user ID or password.');
      profile = { role: 'Admin', employee_id: 'KS-001', display_name: 'Store Management' };
    } else {
      // Preserve any other user IDs already configured in the existing users table.
      const { data, error } = await client.from('users')
        .select('username, role, employee_id, display_name')
        .eq('username', user).eq('password', password).maybeSingle();
      if (error || !data || !['Admin', 'Viewer'].includes(data.role)) throw new Error('Invalid user ID or password.');
      profile = data;
    }
    const saved = { user, role: profile.role, empId: profile.employee_id || '', displayName: profile.display_name || user, signedIn: Date.now() };
    localStorage.setItem(sessionKey, JSON.stringify(saved));
    return session(client);
  }
  async function session(client, redirect = false) {
    identity = null;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(sessionKey)); } catch (_) { saved = null; }
    const age = Date.now() - saved?.signedIn;
    if (!saved?.user || !['Admin', 'Viewer'].includes(saved.role) || !Number.isFinite(age) || age < 0 || age >= 21600000) {
      logout();
      if (redirect) location.replace('index.html');
      return null;
    }
    identity = { valid: true, user: saved.user, role: saved.role, empId: saved.empId || '', displayName: saved.displayName || saved.user };
    return identity;
  }
  async function saveSettlements(client, invoices) {
    const { error } = await client.rpc('replace_settlements', { invoices });
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') throw new Error('Bank saving needs one-time setup: run database-settlements.sql in Supabase SQL Editor. Existing settlements have not been changed.');
      throw error;
    }
  }
  function validateSplits(splits, total) {
    if (!splits.length || splits.some(s => !s.account?.trim() || !Number.isFinite(Number(s.amount)) || Number(s.amount) <= 0)) throw new Error('Enter a bank account and a positive amount for every split.');
    const sum = splits.reduce((n, s) => n + number(s.amount), 0);
    if (Math.round(sum * 100) > Math.round(number(total) * 100)) throw new Error('Settlement exceeds the invoice total.');
    return splits.map(s => ({ account: s.account.trim(), amount: Math.round(number(s.amount) * 100) / 100 }));
  }
  return { number, escape, phone, invoiceParts, invoiceIndex, matchInvoice, invoiceGroups, reconciliationNotice, rows, session, login, logout, saveSettlements, amounts, validateSplits, identity: () => identity,
    eventArg: value => escape(JSON.stringify(String(value ?? ''))),
    quantity: row => number(row.qty ?? row.QTY ?? row.Qty, 1)
  };
})();
