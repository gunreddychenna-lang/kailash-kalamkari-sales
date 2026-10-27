"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../common.js"),
  "utf8"
);

const context = { window: {} };
vm.runInNewContext(source, context);
const KK = context.window.KK;

const cases = [
  ["111BN0126", "2026-06-29", "2026-06-29", 12240],
  ["111BN0592", "2026-08-31", "2026-08-31", 6000],
  ["111BN0860", "2026-10-06", "2026-10-06", 12898],
  ["111SN0285", "2026-08-17", "2026-08-17", 182490],
  ["111SN0475", "2026-09-05", "2026-09-30", 110500]
];

for (const [bill_no, date1, date2, combined] of cases) {
  test(`repeated invoice ${bill_no} must stay ambiguous`, () => {
    const masters = [
      {
        bill_no,
        branch: "Main Branch",
        bill_date: date1,
        bill_amount: combined / 2
      },
      {
        bill_no,
        branch: "Main Branch",
        bill_date: date2,
        bill_amount: combined / 2
      }
    ];

    const sales = masters.map((m, i) => ({
      id: i + 1,
      bill_no,
      store_name: "Main Branch",
      bill_date: m.bill_date,
      amount: m.bill_amount
    }));

    const index = KK.invoiceIndex(masters);

    for (const row of sales) {
      assert.equal(
        KK.matchInvoice(row, index).ambiguous,
        true,
        `Invoice ${bill_no} must be flagged`
      );
    }

    const result = KK.invoiceGroups(sales, index);

    assert.equal(result.excluded, 2);
    assert.equal(result.groups.length, 0);
    assert.ok(result.issues.includes(bill_no));
  });
}

test("different branches may use the same invoice number", () => {
  const masters = [
    { bill_no: "B100", branch: "Main Branch", bill_date: "2026-10-20", bill_amount: 1000 },
    { bill_no: "B100", branch: "KHPS", bill_date: "2026-10-20", bill_amount: 2000 }
  ];

  const index = KK.invoiceIndex(masters);

  assert.notEqual(KK.matchInvoice(masters[0], index).ambiguous, true);
  assert.notEqual(KK.matchInvoice(masters[1], index).ambiguous, true);
});

test("inventory quantity column preserves units including zero", () => {
  assert.equal(KK.quantity({ quantity: 5 }), 5);
  assert.equal(KK.quantity({ quantity: 3 }), 3);
  assert.equal(KK.quantity({ quantity: 8 }), 8);
  assert.equal(KK.quantity({ quantity: 2 }), 2);
  assert.equal(KK.quantity({ quantity: 0 }), 0);
  assert.equal(KK.quantity({ quantity: 1.5 }), 1.5);
});
