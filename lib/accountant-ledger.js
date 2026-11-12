'use strict';
// Read-only, branch-scoped accountant register. Does not settle invoices or write financial data.
const PROJECT_URL = 'https://dqvqqrbvklpiibzqivbp.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BRANCHES = ['Main Branch', 'KHPS'];
const STATUS = new Set(['all', 'settled', 'pending', 'unverified', 'review']);
const BILL = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_ROWS = 8000;
function send(res, code, data) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  return res.status(code).json(data);
}
function paise(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 && n < 1e11 ? Math.round(n * 100) : null;
}
function invoiceKey(branch, bill) { return JSON.stringify([branch, bill]); }
function parseKey(value) {
  try {
    const a = JSON.parse(value);
    return Array.isArray(a) && a.length === 2 && a.every(x => typeof x === 'string') ? invoiceKey(a[0], a[1]) : null;
  } catch { return null; }
}
function validDate(value) { return typeof value === 'string' ? value.slice(0, 10) : ''; }
function summarize(invoices, requests, openings, batches) {
  const byInvoice = new Map();
  for (const row of invoices) {
    if (!BRANCHES.includes(row.branch) || typeof row.bill_no !== 'string') continue;
    const key = invoiceKey(row.branch, row.bill_no);
    let value = byInvoice.get(key);
    if (!value) {
      value = { branch: row.branch, bill_no: row.bill_no, bill_date: validDate(row.bill_date), sales_girl: String(row.sm_name || ""), sales_channel: String(row.channel || ""),
        invoice_amount: paise(row.bill_amount), matches: 0, opening: 0, posted: 0,
        pending_amount: 0, request_count: 0, history: [], verified: false, conflict: false };
      byInvoice.set(key, value);
    }
    value.matches += 1;
    if (value.invoice_amount !== paise(row.bill_amount)) value.conflict = true;
    if (validDate(row.bill_date) > value.bill_date) value.bill_date = validDate(row.bill_date);
  }
  for (const row of openings) {
    const record = byInvoice.get(parseKey(row.invoice_key));
    if (!record) continue;
    if (row.locked !== true || paise(row.bill_amount) !== record.invoice_amount || paise(row.opening_paid) === null) {
      record.conflict = true; continue;
    }
    record.opening += paise(row.opening_paid); record.verified = true;
    if (row.evidence_reference) record.history.push({ type: 'Approved opening balance', amount: paise(row.opening_paid) / 100,
      account: 'Opening balance (bank not recorded)', reference: String(row.evidence_reference), date: '', status: 'verified' });
  }
  for (const row of batches) {
    const record = byInvoice.get(parseKey(row.invoice_key));
    if (!record) continue;
    const amount = paise(row.amount);
    if (amount === null) { record.conflict = true; continue; }
    record.posted += amount; record.verified = true;
    if (Array.isArray(row.payments)) {
      for (const p of row.payments) record.history.push({ type: 'Posted receipt',
        amount: Number(p.amount) || 0, account: String(p.account || ''),
        reference: String(p.reference || ''), date: validDate(p.payment_date), status: 'verified' });
    }
  }
  for (const r of requests) {
    const record = byInvoice.get(invoiceKey(r.store_name, r.bill_no));
    if (!record) continue;
    record.request_count += 1;
    if (r.status === 'pending') record.pending_amount += paise(r.amount) ?? 0;
    record.history.push({ type: 'Submitted payment', amount: Number(r.amount) || 0,
      account: String(r.account_name || ''), reference: String(r.payment_reference || ''),
      date: validDate(r.payment_date), status: r.status || 'unknown', submitted: r.created_at || '' });
  }
  const result = [];
  for (const row of byInvoice.values()) {
    if (!Number.isSafeInteger(row.invoice_amount) || row.invoice_amount <= 0 || row.matches !== 1 ||
      row.conflict || row.posted + row.opening > row.invoice_amount) {
      row.status = 'review';
    } else if (row.verified && row.opening + row.posted === row.invoice_amount) {
      row.status = 'settled';
    } else if (row.pending_amount > 0 || row.verified || row.request_count > 0) {
      row.status = 'pending';
    } else row.status = 'unverified';
    row.verified_paid = (row.opening + row.posted) / 100;
    row.pending_amount /= 100;
    row.invoice_amount = row.invoice_amount === null ? null : row.invoice_amount / 100;
    row.history.sort((a, b) => String(b.submitted || b.date || '').localeCompare(String(a.submitted || a.date || '')));
    row.account = row.history[0]?.account || '';
    row.reference = row.history[0]?.reference || '';
    delete row.posted; delete row.opening; delete row.verified; delete row.conflict;
    result.push(row);
  }
  return result;
}
async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Read-only endpoint. GET required.' });
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.VERCEL_ENV !== 'production' || base !== PROJECT_URL || !key)
    return send(res, 503, { error: 'Invoice register is not configured for this environment.' });
  const jwt = (req.headers?.authorization || '').match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!jwt) return send(res, 401, { error: 'Sign in required.' });
  const params = new URL(req.url || '/', 'http://localhost').searchParams;
  const branch = params.get('branch') || 'all';
  const status = params.get('status') || 'all';
  const q = (params.get('q') || '').trim().toUpperCase();
  const page = Number(params.get('page') || 1);
  const size = Number(params.get('page_size') || 25);
  if ((!BRANCHES.includes(branch) && branch !== 'all') || !STATUS.has(status) || q.length > 64 ||
      !Number.isSafeInteger(page) || page < 1 || page > 9999 || !Number.isSafeInteger(size) || size < 1 || size > 50)
    return send(res, 400, { error: 'Invalid register filters.' });
  async function upstream(path, jwtOverride) {
    const response = await fetch(base + path, { method: 'GET', headers: {
      apikey: key, Authorization: 'Bearer ' + (jwtOverride || key), Accept: 'application/json' },
    signal: AbortSignal.timeout(12000) });
    const data = await response.json().catch(() => null);
    if (!response.ok || data === null) throw new Error('Database read failed: ' + response.status);
    return data;
  }
  async function all(path) {
    const rows = [];
    while (rows.length < MAX_ROWS) {
      const separator = path.includes('?') ? '&' : '?';
      const batch = await upstream(path + separator + 'limit=1000&offset=' + rows.length);
      if (!Array.isArray(batch)) throw new Error('Unexpected database response');
      rows.push(...batch);
      if (batch.length < 1000) return rows;
    }
    throw new Error('Register too large; safe server limit exceeded');
  }
  try {
    const identity = await upstream('/auth/v1/user', jwt);
    if (!UUID.test(identity?.id || '')) return send(res, 401, { error: 'Invalid session.' });
    const staff = await upstream('/rest/v1/kk_staff_access?auth_user_id=eq.' + encodeURIComponent(identity.id) +
      '&select=role,active,stores,features');
    if (!Array.isArray(staff) || staff.length !== 1) return send(res, 403, { error: 'Staff access unavailable.' });
    const profile = staff[0];
    if (profile.active !== true) return send(res, 403, { error: 'Account inactive.' });
    const full = ['owner', 'admin'].includes(profile.role);
    const stores = full ? BRANCHES : (profile.role === 'employee' &&
      Array.isArray(profile.features) && profile.features.includes('payments') &&
      Array.isArray(profile.stores) ? BRANCHES.filter(x => profile.stores.includes(x)) : []);
    if (!stores.length || (branch !== 'all' && !stores.includes(branch)))
      return send(res, 403, { error: 'Branch permission denied.' });
    const visible = branch === 'all' ? stores : [branch];
    const [invoiceArrays, reqArrays, openings, batches] = await Promise.all([
      Promise.all(visible.map(b => all('/rest/v1/bills_master?branch=eq.' + encodeURIComponent(b) + '&select=branch,bill_no,bill_amount,bill_date,sm_name,channel'))),
      Promise.all(visible.map(b => all('/rest/v1/kk_payment_requests?store_name=eq.' + encodeURIComponent(b) +
        '&select=store_name,bill_no,amount,payment_method,account_name,payment_reference,payment_date,status,created_at'))),
      all('/rest/v1/kk_opening_balances?select=invoice_key,bill_amount,opening_paid,locked,evidence_reference'),
      all('/rest/v1/kk_receipt_batches?select=invoice_key,amount,payments,entered_at')
    ]);
    const records = summarize(invoiceArrays.flat(), reqArrays.flat(), openings, batches);
    const matchSearch = records.filter(r => !q || r.bill_no.toUpperCase().includes(q));
    const counts = { all: matchSearch.length, settled: 0, pending: 0, unverified: 0, review: 0 };
    for (const r of matchSearch) counts[r.status]++;
    const filtered = matchSearch.filter(r => status === 'all' || r.status === status);
    filtered.sort((a, b) => b.bill_date.localeCompare(a.bill_date) || b.bill_no.localeCompare(a.bill_no));
    const paged = filtered.slice((page - 1) * size, page * size);
    const byBranch = new Map();
    for (const r of paged) {
      if (!BILL.test(r.bill_no)) continue;
      if (!byBranch.has(r.branch)) byBranch.set(r.branch, new Set());
      byBranch.get(r.branch).add(r.bill_no);
    }
    const saleGroups = await Promise.all([...byBranch.entries()].map(async ([b, bills]) => {
      const encoded = [...bills].map(encodeURIComponent).join(',');
      const rows = await all('/rest/v1/sales?store_name=eq.' + encodeURIComponent(b) +
        '&bill_no=in.(' + encoded + ')&select=store_name,bill_no,bank_account');
      return rows;
    }));
    const banks = new Map();
    for (const s of saleGroups.flat()) {
      const name = typeof s.bank_account === 'string' ? s.bank_account.trim() : '';
      if (!name) continue;
      const k = invoiceKey(s.store_name, s.bill_no);
      if (!banks.has(k)) banks.set(k, new Set());
      banks.get(k).add(name);
    }
    for (const row of paged) {
      row.sale_bank = [...(banks.get(invoiceKey(row.branch, row.bill_no)) || new Set())].slice(0, 5).join(', ');
      if (!row.account) row.account = row.sale_bank;
      row.history = row.history.slice(0, 50);
    }
    return send(res, 200, { branches: stores, branch, status, counts, total: filtered.length,
      page, page_size: size, pages: Math.max(1, Math.ceil(filtered.length / size)),
      rows: paged, note: 'Settled requires verified opening or posted receipts. Old sales bank information alone is not proof of settlement. Submitted payment requests remain pending for review.' });
  } catch (err) {
    console.error('Accountant register read failed', err?.name || 'Error');
    return send(res, 503, { error: 'Invoice register temporarily unavailable. No data was changed.' });
  }
}
module.exports = handler;
module.exports._test = { summarize, paise, parseKey };
