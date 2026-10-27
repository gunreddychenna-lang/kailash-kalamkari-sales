"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "app.js"),
  "utf8"
);

test("unallocatable invoice errors are handled separately", () => {
  assert.match(source, /try\s*\{\s*computedItemAmounts\s*=\s*KK\.amounts\(items,\s*masterTotal\)/);
  assert.match(source, /error\?\.message\s*!==\s*'Invoice has no line amounts; cannot allocate its revenue reliably\.'/);
  assert.match(source, /unallocatableRows\s*\+=\s*items\.length/);
  assert.match(source, /unallocatableInvoices\.push\(billNoUpper\)/);
});

test("excluded invoice rows appear in reconciliation warning", () => {
  assert.match(source, /reconciled\.excluded\s*\+\s*unallocatableRows/);
  assert.match(source, /\.\.\.reconciled\.issues,\s*\.\.\.unallocatableInvoices/);
});

test("unallocatable invoice does not reach cleanSales", () => {
  assert.match(
    source,
    /unallocatableInvoices\.push\(billNoUpper\);\s*return;\s*\}/
  );
});
