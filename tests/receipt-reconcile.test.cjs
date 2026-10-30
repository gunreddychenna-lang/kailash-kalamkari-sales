"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { status, normalizeAccount } =
  require("../lib/receipt-reconcile.cjs");

test("partly paid invoice remains pending", () => {
  assert.equal(status(2000, 600), "Pending");
});

test("fully paid invoice is settled", () => {
  assert.equal(status(10000, 10000), "Settled");
});

test("unpaid invoice remains pending", () => {
  assert.equal(status(3000, 0), "Pending");
});

test("overpaid invoice requires review", () => {
  assert.equal(status(1000, 1200), "Needs Review");
});

test("invalid invoice requires review", () => {
  assert.equal(status(0, 0), "Needs Review");
});

test("cash labels normalize consistently", () => {
  assert.equal(normalizeAccount("cash"), "Cash");
  assert.equal(normalizeAccount("Cash"), "Cash");
});

test("UPI bank account is extracted", () => {
  assert.equal(normalizeAccount("UPI_STORE::SBI"), "SBI");
});

test("historical unknown account remains identifiable", () => {
  assert.equal(normalizeAccount("TD"), "TD");
});