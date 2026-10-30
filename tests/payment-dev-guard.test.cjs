"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const handler = require("../api/payments.js");

function invoke(method, body, environment = "preview") {
  const previous = {
    env: process.env.VERCEL_ENV,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    write: process.env.PAYMENTS_WRITE_ENABLED
  };

  process.env.VERCEL_ENV = environment;
  process.env.SUPABASE_URL =
    environment === "production"
      ? "https://dqvqqrbvklpiibzqivbp.supabase.co"
      : "https://yiaipfquxyrqxvkvjykp.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "TEST_ONLY_NOT_A_SECRET";
  delete process.env.PAYMENTS_WRITE_ENABLED;

  const req = {
    method,
    url: "/api/payments",
    headers: { authorization: "Bearer test-token" },
    body
  };

  const result = { statusCode: 200, payload: null };

  const res = {
    setHeader() {},
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(value) {
      result.payload = value;
      return this;
    }
  };

  return Promise.resolve(handler(req, res)).then(() => result).finally(() => {
    for (const [key, value] of Object.entries({
      VERCEL_ENV: previous.env,
      SUPABASE_URL: previous.url,
      SUPABASE_SERVICE_ROLE_KEY: previous.key,
      PAYMENTS_WRITE_ENABLED: previous.write
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function payment(bill_no) {
  return {
    bill_no,
    branch: "Main Branch",
    expected_bill_amount: 2000,
    idempotency_key: "123e4567-e89b-42d3-a456-426614174000",
    payments: [{
      account: "Cash",
      amount: "100",
      payment_date: "2026-10-30",
      reference: ""
    }]
  };
}

test("DEV rejects non-TEST payment write", async () => {
  const result = await invoke("POST", payment("REAL001"));
  assert.equal(result.statusCode, 403);
  assert.match(result.payload.error, /TEST invoices/);
});

test("DEV rejects another non-TEST invoice format", async () => {
  const result = await invoke("POST", payment("M002"));
  assert.equal(result.statusCode, 403);
});

test("Production payments remain disabled", async () => {
  const result = await invoke(
    "POST", payment("TEST-M002"), "production"
  );
  assert.equal(result.statusCode, 503);
});

test("Unsupported HTTP method rejected", async () => {
  const result = await invoke("DELETE", null);
  assert.equal(result.statusCode, 405);
});