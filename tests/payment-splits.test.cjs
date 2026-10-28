'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../common.js'), 'utf8'), context);
const KK = context.window.KK;
const plain = value => JSON.parse(JSON.stringify(value));

test('10000 bill accepts optional Cash 2000 / TD 8000 split without changing input', () => {
  const entries = Object.freeze([Object.freeze({ account: 'Cash', amount: 2000 }), Object.freeze({ account: 'TD', amount: 8000 })]);
  assert.deepEqual(plain(KK.paymentSummary(10000, entries)), { billAmount: 10000, paidAmount: 10000, balance: 0 });
  assert.deepEqual(plain(KK.validateSplits(entries, 10000)), entries);
});
test('single account full payment and partial payment both work', () => {
  assert.equal(KK.paymentSummary(10000, [{ account: 'TD', amount: 10000 }]).balance, 0);
  assert.deepEqual(plain(KK.paymentSummary(10000, [{ account: 'Cash', amount: 2000 }])), { billAmount: 10000, paidAmount: 2000, balance: 8000 });
});
test('paise are exact and excess precision is rejected rather than rounded', () => {
  assert.equal(KK.paymentSummary('0.30', [{ account: 'Cash', amount: '0.10' }, { account: 'TD', amount: '0.20' }]).balance, 0);
  for (const amount of ['0.005', '1e3', true, '', -1, 0, Infinity]) {
    assert.throws(() => KK.validateSplits([{ account: 'TD', amount }], 10000));
  }
});
test('overpayment, missing account and invalid bill cannot silently settle', () => {
  assert.throws(() => KK.validateSplits([{ account: 'Cash', amount: 2000 }, { account: 'TD', amount: '8000.01' }], 10000), /exceeds/);
  assert.throws(() => KK.validateSplits([{ account: ' ', amount: 2000 }], 10000));
  assert.throws(() => KK.validateSplits([{ account: 'TD', amount: 1 }], null));
  assert.throws(() => KK.validateSplits([], 10000));
});
