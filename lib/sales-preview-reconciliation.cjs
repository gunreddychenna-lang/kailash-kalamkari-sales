"use strict";
const { assessInvoiceGroups, invoiceReviewKey } = require('../review/invoice-match-candidate.cjs');

function previewReconciliation(data, env = process.env) {
  if (env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== 'codex/sales-invoice-preview') return null;
  // Only reviewed references. No change to the general invoice identity policy.
  const reviewed = new Set(['111BN0592', '111SN0285', '111SN0475']);
  const bill = row => String(row.bill_no ?? '').trim().toUpperCase();
  const masters = data.bills_master.filter(x => reviewed.has(bill(x)));
  const sales = data.sales.filter(x => reviewed.has(bill(x)));
  const result = assessInvoiceGroups(masters, sales);
  // A changed or incomplete reviewed dataset must not partially recover invoices.
  if (result.unresolved.length || result.candidates.length !== 6) return null;
  return {
    status: 'review_candidate',
    groups: result.candidates.map(x => ({ key: x.key, saleIds: x.saleIds,
      master: masters.find(m => invoiceReviewKey(m, true) === x.key) }))
  };
}
module.exports = { previewReconciliation };
