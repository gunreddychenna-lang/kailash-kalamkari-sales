"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(__dirname,
    "../security/008_consolidated_rls_REVIEW_ONLY.sql"),
  "utf8"
);

test("Candidate blocks execution explicitly", () => {
  assert.match(sql, /RAISE EXCEPTION[\s\S]*REVIEW ONLY/);
  assert.match(sql, /\bROLLBACK;\s*$/);
});

test("Candidate removes known anonymous policies", () => {
  assert.match(sql, /DROP POLICY IF EXISTS "Allow anon full access on sales"/);
  assert.match(sql, /DROP POLICY IF EXISTS "Allow anon all on receivables"/);
  assert.match(sql, /DROP POLICY IF EXISTS "Allow anon all on attendance"/);
  assert.match(sql, /DROP POLICY IF EXISTS "Allow anon all on bank_accounts"/);
});

test("Sales access requires store and feature", () => {
  assert.match(sql, /'sales_entry' = ANY\(s\.features\)/);
  assert.match(sql, /sales\.store_name = ANY\(s\.stores\)/);
});

test("Receivables access requires store and payments permission", () => {
  assert.match(sql, /'payments' = ANY\(s\.features\)/);
  assert.match(sql, /receivables\.store_name = ANY\(s\.stores\)/);
});

test("Owner Admin allowed and inactive staff rejected", () => {
  assert.match(sql, /s\.role IN \('owner', 'admin'\)/);
  assert.match(sql, /s\.active IS TRUE/);
});

test("Dangerous RPC execution is revoked", () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_total_sales/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.replace_settlements/);
});

test("Legacy user passwords are not granted to browser roles", () => {
  assert.match(sql, /REVOKE ALL ON public\.users/);
  assert.doesNotMatch(sql,
    /GRANT\s+SELECT\s+ON\s+public\.users/i);
});

test("Candidate does not mutate business records", () => {
  assert.doesNotMatch(sql,
    /\b(?:DELETE\s+FROM|INSERT\s+INTO|UPDATE|TRUNCATE)\s+public\.(?:sales|receivables|payment_splits|attendance|bank_accounts)\b/i);
});