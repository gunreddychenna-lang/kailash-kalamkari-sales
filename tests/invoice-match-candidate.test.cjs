"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessInvoiceGroups: assess } = require('../review/invoice-match-candidate.cjs');
function fixture(bill, entries) {
  const masters = entries.map(([date, channel, amount, qty]) => ({
    bill_no: bill, branch: 'Main Branch', bill_date: date, channel, bill_amount: amount, total_qty: qty
  }));
  const sales = masters.map((m, i) => ({ id: i + 1, bill_no: bill, store_name: m.branch,
    bill_date: m.bill_date, sale_type: m.channel, amount: m.bill_amount, qty: m.total_qty }));
  return { masters, sales };
}
for (const [bill, entries] of [
  ['111BN0592', [['2026-08-31','Offline',1500,1],['2026-08-31','Online',4500,3]]],
  ['111SN0285', [['2026-08-17','Offline',14000,1],['2026-08-17','Wholesale',168490,24]]],
  ['111SN0475', [['2026-09-05','Wholesale',26000,4],['2026-09-30','Wholesale',84500,13]]]
]) test(`${bill}: distinct date/channel groups are review candidates`, () => {
  const { masters, sales } = fixture(bill, entries);
  const result = assess(masters, sales);
  assert.equal(result.candidates.length, 2); assert.equal(result.unresolved.length, 0);
  assert.notEqual(result.candidates[0].key, result.candidates[1].key);
  assert.ok(result.candidates.every(x => x.status === 'review_candidate'));
});
for (const [bill, amounts] of [['111BN0126',[5940,6300]],['111BN0860',[2762.41,10135.59]]]) {
  test(`${bill}: same date/channel remains unresolved even when combined totals match`, () => {
    const { masters, sales } = fixture(bill, amounts.map(x => ['2026-06-29','Online',x,1]));
    const result = assess(masters, sales);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.unresolved[0].reason, 'ambiguous_or_missing_match');
  });
}
test('inconsistent, partial, duplicate and incomplete input cannot silently match', () => {
  for (const mutation of [
    f => { f.sales[0].amount++; }, f => { f.sales[0].qty++; },
    f => { f.sales[0].amount = ''; }, f => { f.sales[0].sale_type = ''; },
    f => { f.sales[0].bill_date = '2026-02-30'; },
    f => { f.sales.push({ ...f.sales[0] }); }, f => { f.sales = []; },
    f => { f.masters.push({ ...f.masters[0] }); }
  ]) {
    const f = fixture('A', [['2026-08-31','Offline',100,1]]); mutation(f);
    const result = assess(f.masters, f.sales);
    assert.equal(result.candidates.length, 0); assert.ok(result.unresolved.length);
  }
});
test('split lines match decimal totals and preserve input', () => {
  const f = fixture('A', [['2026-08-31','Offline',0.3,2]]);
  f.sales = [ { ...f.sales[0], amount: 0.1, qty: 1 }, { ...f.sales[0], id: 2, amount: 0.2, qty: 1 } ];
  const before = JSON.stringify(f);
  assert.equal(assess(f.masters, f.sales).candidates.length, 1);
  assert.equal(JSON.stringify(f), before);
});
