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
      // Never treat two invoice-master rows as one verified invoice.
      if (old) old.conflict = true;
      byBill.set(part.bill, bucket);
    }
    // Same bill number + branch on different dates is still ambiguous.
    // We have no trusted unique invoice-row identifier for matching.
    for (const bucket of byBill.values()) {
      const branchCounts = new Map();
      for (const candidate of bucket.values()) {
        branchCounts.set(candidate.branch, (branchCounts.get(candidate.branch) || 0) + 1);
      }
      for (const candidate of bucket.values()) {
        if (branchCounts.get(candidate.branch) > 1) candidate.conflict = true;
      }
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
  function reconciliationNotice(excluded, issues, duplicateReferences = 0) {
    let el = document.getElementById('reconciliation-warning');
    if (!el && (excluded || duplicateReferences)) {
      el = document.createElement('div');
      el.id = 'reconciliation-warning';
      el.setAttribute('role', 'note');
      el.style.cssText = 'font:11px sans-serif;color:#78716c;margin:10px 0;padding:4px 0;';
      const main = document.getElementById('standard-main');
      if (main) main.appendChild(el);
    }
    if (el) {
      el.hidden = !(excluded || duplicateReferences);

      el.textContent = (excluded || duplicateReferences) ? 'Data quality review pending. Dashboard totals exclude unresolved sales records.' : '';
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
  let authClient = null;

  function logout() {
    identity = null;
    // Remove legacy browser-only login state.
    ['kk_simple_session', 'kk_user', 'kk_role',
     'kk_emp_id', 'kk_display_name', 'kk_login_time']
      .forEach(key => localStorage.removeItem(key));
    const client = authClient;
    if (client?.auth) {
      return KKSecureAuth.signOut(client);
    }
    return Promise.resolve();
  }

  async function login(client, username, password) {
    if (!window.KKSecureAuth) {
      throw new Error('Secure authentication module unavailable.');
    }

    authClient = client;
    const profile = await KKSecureAuth.login(
      client, username, password
    );

    if (!['owner', 'admin'].includes(profile.role)) {
      await logout();
      throw new Error('This release requires Owner or Admin access.');
    }
    identity = {
      ...profile,
      role: ['owner', 'admin'].includes(profile.role)
        ? 'Admin'
        : 'Viewer',
      secureRole: profile.role
    };

    return identity;
  }

  async function session(client, redirect = false) {
    identity = null;

    if (!window.KKSecureAuth) {
      if (redirect) location.replace('index.html');
      return null;
    }

    authClient = client;
    const profile = await KKSecureAuth.getStaff(client);

    if (!profile || !['owner', 'admin'].includes(profile.role)) {
      if (redirect) location.replace('index.html');
      return null;
    }

    identity = {
      ...profile,
      role: ['owner', 'admin'].includes(profile.role)
        ? 'Admin'
        : 'Viewer',
      secureRole: profile.role
    };

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
    quantity: row => number(row.qty ?? row.quantity ?? row.QTY ?? row.Qty, 1)
  };
})();
