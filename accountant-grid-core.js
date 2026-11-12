'use strict';
/* Shared validation used by the browser and Node test runner. No database writes. */
(function (root) {
  const METHODS = new Set(['cash', 'upi', 'bank_transfer', 'card']);
  const BILL = /^[A-Za-z0-9_-]{1,64}$/;
  const MONEY = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/;
  const EARLIEST_DATE = '2026-09-01';

  function cents(value) {
    const match = MONEY.exec(String(value ?? ''));
    if (!match) return null;
    const whole = Number(String(value).split('.')[0]);
    const fractional = ((String(value).split('.')[1] || '') + '00').slice(0, 2);
    const result = whole * 100 + Number(fractional);
    return Number.isSafeInteger(result) ? result : null;
  }
  function isDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function availableCents(invoice) {
    const bill = cents(invoice?.invoice_amount);
    const verified = cents(invoice?.verified_paid ?? 0);
    const pending = cents(invoice?.pending_amount ?? 0);
    if (bill === null || verified === null || pending === null) throw new Error('Invoice totals are unavailable.');
    return bill - verified - pending;
  }
  function validate(invoice, parts, accounts, today) {
    if (!invoice || !['Main Branch', 'KHPS'].includes(invoice.branch) || !BILL.test(invoice.bill_no || '')) {
      throw new Error('Select a valid invoice.');
    }
    if (invoice.status === 'review' || invoice.status === 'settled') {
      throw new Error('Settled or reconciliation-required invoices cannot accept new requests.');
    }
    if (!Array.isArray(parts) || parts.length < 1 || parts.length > 20) {
      throw new Error('Enter between 1 and 20 payment splits.');
    }
    if (!Array.isArray(accounts) || !isDate(today)) throw new Error('Payment account configuration unavailable.');
    const allowed = new Set(accounts.map(a => `${a.account_type}\u0000${a.account_name}`));
    const seenReferences = new Set();
    let totalCents = 0;
    const clean = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const amount = cents(p.amount);
      if (amount === null || amount <= 0) throw new Error(`Split ${i + 1}: enter a positive amount with at most two decimals.`);
      if (!METHODS.has(p.method)) throw new Error(`Split ${i + 1}: choose a payment mode.`);
      const account = String(p.account || '').trim();
      const reference = String(p.reference || '').trim();
      const kind = p.method === 'cash' ? 'Cash' : 'electronic';
      const hasAccount = kind === 'Cash' ? allowed.has(`Cash\u0000${account}`) :
        ['Bank', 'Bank Account', 'Payment Service'].some(t => allowed.has(`${t}\u0000${account}`));
      if (!hasAccount) throw new Error(`Split ${i + 1}: choose a valid active bank/cash account.`);
      if (reference.length > 120 || (p.method !== 'cash' && !reference)) {
        throw new Error(`Split ${i + 1}: UTR / transaction reference is required for non-cash.`);
      }
      if (!isDate(p.date) || p.date < EARLIEST_DATE || p.date > today) {
        throw new Error(`Split ${i + 1}: choose a valid received date.`);
      }
      if (p.method !== 'cash') {
        const token = account.toLowerCase() + '\u0000' + reference.toLowerCase();
        if (seenReferences.has(token)) throw new Error('The same bank/reference was entered in multiple splits.');
        seenReferences.add(token);
      }
      totalCents += amount;
      if (!Number.isSafeInteger(totalCents)) throw new Error('Invalid payment amount.');
      clean.push({ amount: (amount / 100).toFixed(2), payment_method: p.method,
        account_name: account, payment_reference: reference, payment_date: p.date });
    }
    const available = availableCents(invoice);
    if (available <= 0) throw new Error('No unallocated invoice balance is available for another request.');
    if (totalCents > available) throw new Error('Received amounts exceed the invoice balance after verified and pending entries.');
    return { totalCents, availableCents: available, splits: clean };
  }
  const api = Object.freeze({ cents, isDate, availableCents, validate });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KKAccountantGridCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
