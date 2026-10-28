"use strict";
const { assessInvoiceGroups, invoiceReviewKey } = require('../review/invoice-match-candidate.cjs');
const branches = new Set(['codex/sales-invoice-preview', 'engineering/hide-preview-invoice-review-banner']);
const bill = row => String(row.bill_no ?? '').trim().toUpperCase();
const staff = row => String(row.sm_name ?? row.agent_name ?? '').trim().toUpperCase();
function previewReconciliation(data, env = process.env) {
  if (env.VERCEL_ENV !== 'preview' || !branches.has(env.VERCEL_GIT_COMMIT_REF)) return null;
  if (!Array.isArray(data?.bills_master) || !Array.isArray(data?.sales)) return null;
  const reviewed = new Set(['111BN0592', '111SN0285', '111SN0475']);
  const masters = data.bills_master.filter(x => reviewed.has(bill(x)));
  const sales = data.sales.filter(x => reviewed.has(bill(x)));
  const original = assessInvoiceGroups(masters, sales);
  if (original.unresolved.length || original.candidates.length !== 6) return null;
  const groups = original.candidates.map(x => ({
    key: x.key, saleIds: x.saleIds,
    master: masters.find(m => invoiceReviewKey(m, true) === x.key)
  }));
  if (groups.some(g => !g.master)) return null;
  // Distinct invoices reuse these two bill numbers on the same branch and date.
  // Match by invoice identity AND staff, require exact line amount/quantity agreement.
  // This is Preview-only display reconciliation; payment matching remains unchanged.
  for (const ref of ['111BN0126', '111BN0860']) {
    const duplicateMasters = data.bills_master.filter(x => bill(x) === ref);
    const duplicateSales = data.sales.filter(x => bill(x) === ref);
    if (!duplicateMasters.length && !duplicateSales.length) continue;
    if (duplicateMasters.length !== 2 || !duplicateSales.length) return null;
    const matched = new Set();
    const identities = new Set();
    for (const master of duplicateMasters) {
      const identity = invoiceReviewKey(master, true);
      const who = staff(master);
      if (!identity || !who || identities.has(identity + '|' + who)) return null;
      identities.add(identity + '|' + who);
      const lines = duplicateSales.filter(line => staff(line) === who && invoiceReviewKey(line, false) === identity);
      if (!lines.length || lines.some(line => matched.has(String(line.id)))) return null;
      const result = assessInvoiceGroups([master], lines);
      if (result.unresolved.length || result.candidates.length !== 1) return null;
      for (const line of lines) matched.add(String(line.id));
      groups.push({ key: JSON.stringify([identity, who]), saleIds: result.candidates[0].saleIds, master });
    }
    if (matched.size !== duplicateSales.length) return null;
  }
  if (![6, 10].includes(groups.length)) return null;
  return { status: 'review_candidate', groups };
}
module.exports = { previewReconciliation };
