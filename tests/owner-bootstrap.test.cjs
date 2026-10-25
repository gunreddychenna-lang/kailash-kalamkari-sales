"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(
  path.join(
    __dirname,
    "../security/005_owner_admin_bootstrap_TEMPLATE.sql"
  ),
  "utf8"
);

test("Bootstrap requires verified Auth identities", () => {
  assert.match(sql, /__OWNER_AUTH_UUID__/);
  assert.match(sql, /__ADMIN_AUTH_UUID__/);
  assert.match(sql, /auth\.users/);
  assert.match(sql, /distinct Auth users/);
});

test("Bootstrap grants both Owner and Admin full access", () => {
  assert.match(sql, /'Main Branch', 'KHPS'/);
  assert.match(sql, /'staff_management'/);
  assert.match(sql, /'owner'/);
  assert.match(sql, /'admin'/);
});

test("Bootstrap does not modify financial tables", () => {
  assert.doesNotMatch(
    sql,
    /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+(?:public\.)?(?:sales|attendance|receivables|payment_splits|bank_accounts)\b/i
  );
});

test("Bootstrap does not create password credentials", () => {
  assert.doesNotMatch(
    sql,
    /\b(?:CREATE\s+USER|CREATE\s+ROLE|INSERT\s+INTO\s+auth\.users)\b/i
  );
});