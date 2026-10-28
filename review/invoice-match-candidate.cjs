"use strict";

// Offline review only. Not imported by the dashboard, APIs, or payment matching.
// Matching totals are evidence for review, not proof of invoice identity.
function key(row, master) {
  const bill = String(row.bill_no ?? '').trim().toUpperCase();
  let branch = String((master ? row.branch : row.store_name) ?? '').trim().toUpperCase();
  if (branch.startsWith('KHPS')) branch = 'KHPS';
  const rawDate = row.bill_date;
  const date = rawDate instanceof Date && Number.isFinite(rawDate.getTime())
    ? `${rawDate.getFullYear()}-${String(rawDate.getMonth() + 1).padStart(2, '0')}-${String(rawDate.getDate()).padStart(2, '0')}`
    : rawDate;
  const channel = String((master ? row.channel : row.sale_type) ?? '').trim().toLowerCase();
  if (!bill || !branch || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ||
      !['online', 'offline', 'wholesale'].includes(channel)) return null;
  const parsed = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return JSON.stringify([bill, branch, date, channel]);
}

function number(value) {
  if (!['number', 'string'].includes(typeof value) ||
      !/^-?\d+(?:\.\d+)?$/.test(String(value))) return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) < 1e10 ? n : null;
}

function assessInvoiceGroups(masters, sales) {
  const candidates = [], unresolved = [];
  const byKey = new Map(), lines = new Map(), ids = new Set();
  for (const master of masters) {
    const k = key(master, true);
    if (!k) return { candidates: [], unresolved: [{ reason: 'incomplete_master_identity' }] };
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(master);
  }
  for (const sale of sales) {
    const k = key(sale, false);
    if (!k || sale.id == null || !String(sale.id).trim() || ids.has(String(sale.id))) {
      return { candidates: [], unresolved: [{ reason: 'incomplete_or_duplicate_sale_identity' }] };
    }
    ids.add(String(sale.id));
    if (!lines.has(k)) lines.set(k, []);
    lines.get(k).push(sale);
  }
  for (const k of new Set([...byKey.keys(), ...lines.keys()])) {
    const matches = byKey.get(k) || [], items = lines.get(k) || [];
    if (matches.length !== 1 || !items.length) {
      unresolved.push({ key: k, reason: 'ambiguous_or_missing_match' }); continue;
    }
    const master = matches[0];
    const amount = number(master.bill_amount), qty = number(master.total_qty);
    const amounts = items.map(x => number(x.amount)), quantities = items.map(x => number(x.qty));
    if (amount === null || qty === null || amounts.includes(null) || quantities.includes(null) ||
        amount < 0 || qty <= 0 || amounts.some(x => x < 0) || quantities.some(x => x <= 0)) {
      unresolved.push({ key: k, reason: 'invalid_amount_or_quantity' }); continue;
    }
    const cents = amounts.map(x => Math.round(x * 100));
    if (cents.reduce((a, b) => a + b, 0) !== Math.round(amount * 100) ||
        Math.abs(quantities.reduce((a, b) => a + b, 0) - qty) > 1e-8) {
      unresolved.push({ key: k, reason: 'amount_or_quantity_mismatch' }); continue;
    }
    candidates.push({ key: k, saleIds: items.map(x => x.id), amount, qty, status: 'review_candidate' });
  }
  return { candidates, unresolved };
}

module.exports = { assessInvoiceGroups, invoiceReviewKey: key };
