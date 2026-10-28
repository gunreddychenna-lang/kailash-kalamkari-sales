"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/payment-requests.js");

const userId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const paymentId = "33333333-3333-4333-8333-333333333333";

async function check(options = {}) {
  const oldFetch = global.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-secret";

  const calls = [];

  global.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, url, init });

    let status = 200;
    let body;

    if (path === "/auth/v1/user") {
      body = { id: userId };
    } else if (path === "/rest/v1/kk_staff_access") {
      body = [{
        role: options.role || "employee",
        active: options.active ?? true,
        stores: options.stores ?? ["Main Branch"],
        features: options.features ?? ["payments"]
      }];
    } else if (path === "/rest/v1/bills_master") {
      body = options.invoice ?? [{ bill_amount: 1000 }];
    } else if (path === "/rest/v1/kk_payment_requests") {
      status = options.duplicate ? 409 : 201;
      body = options.duplicate
        ? { code: "23505" }
        : [{ id: paymentId, status: "pending" }];
    } else {
      throw new Error("Unexpected API request");
    }

    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body)
    };
  };

  const req = {
    method: options.method || "POST",
    headers: options.noToken
      ? {}
      : { authorization: "Bearer fake-test-token" },
    body: {
      store_name: "Main Branch",
      bill_no: "TEST-M001",
      amount: 100,
      payment_method: "cash",
      idempotency_key: requestId,
      ...(options.body || {})
    }
  };

  const result = {};

  const res = {
    setHeader() {},
    status(code) {
      result.status = code;
      return this;
    },
    json(data) {
      result.body = data;
      return this;
    }
  };

  try {
    await handler(req, res);
    return { ...result, calls };
  } finally {
    global.fetch = oldFetch;

    if (oldUrl === undefined)
      delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;

    if (oldKey === undefined)
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
}

test("Missing authentication denied", async () => {
  assert.equal((await check({ noToken: true })).status, 401);
});

test("Sales employee denied", async () => {
  assert.equal(
    (await check({ features: ["sales_entry"] })).status, 403
  );
});

test("Wrong branch denied", async () => {
  assert.equal(
    (await check({ stores: ["KHPS"] })).status, 403
  );
});

test("Inactive employee denied", async () => {
  assert.equal(
    (await check({ active: false })).status, 403
  );
});

test("Forged approved status denied", async () => {
  assert.equal(
    (await check({ body: { status: "approved" } })).status, 400
  );
});

test("Forged employee identity denied", async () => {
  assert.equal(
    (await check({
      body: { entered_by_auth_user_id: userId }
    })).status, 400
  );
});

test("Missing invoice denied", async () => {
  assert.equal(
    (await check({ invoice: [] })).status, 422
  );
});

test("Excess payment denied", async () => {
  assert.equal(
    (await check({ body: { amount: 1500 } })).status, 422
  );
});

test("Duplicate request denied", async () => {
  assert.equal(
    (await check({ duplicate: true })).status, 409
  );
});

test("Accountant pending request allowed", async () => {
  const result = await check();

  assert.equal(result.status, 201);
  assert.equal(result.body.status, "pending");

  const insert = result.calls.find(
    x => x.path === "/rest/v1/kk_payment_requests"
  );

  assert.ok(insert);

  const saved = JSON.parse(insert.init.body);

  assert.equal(saved.entered_by_auth_user_id, userId);
  assert.equal(saved.status, "pending");
});

test("Owner request allowed", async () => {
  assert.equal(
    (await check({ role: "owner" })).status, 201
  );
});

test("Admin request allowed", async () => {
  assert.equal(
    (await check({ role: "admin" })).status, 201
  );
});

test("September backfill preserves received date and never writes invoice totals", async () => {
  const invoice = [{ bill_amount: 1000 }];
  const before = JSON.stringify(invoice);
  const result = await check({ invoice, body: { payment_date: "2026-09-01", amount: "125.50" } });
  assert.equal(result.status, 201);
  const writes = result.calls.filter(call => call.init.method !== "GET");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/rest/v1/kk_payment_requests");
  const saved = JSON.parse(writes[0].init.body);
  assert.equal(saved.payment_date, "2026-09-01");
  assert.equal(saved.amount, "125.50");
  assert.equal(saved.status, "pending");
  assert.equal(saved.idempotency_key, requestId);
  assert.equal(Object.hasOwn(saved, "created_at"), false);
  assert.equal(JSON.stringify(invoice), before);
});

test("Invalid dates and forged invoice totals cannot reach storage", async () => {
  for (const body of [{ payment_date: "2026-09-31" }, { bill_amount: 1 }, { created_at: "2026-09-01" }]) {
    const result = await check({ body });
    assert.equal(result.status, 400);
    assert.equal(result.calls.length, 0);
  }
});

test("Repeated invoice masters fail closed without writing payments", async () => {
  const result = await check({ invoice: [{ bill_amount: 600 }, { bill_amount: 400 }] });
  assert.equal(result.status, 422);
  assert.equal(result.calls.some(call => call.init.method === "POST"), false);
});

test("Payment limit uses the branch invoice master, not a single item amount", async () => {
  const result = await check({ invoice: [{ bill_amount: 10000 }], body: { amount: 8000 } });
  assert.equal(result.status, 201);
  const lookup = result.calls.find(call => call.path === '/rest/v1/bills_master');
  const query = new URL(lookup.url).searchParams;
  assert.equal(query.get('bill_no'), 'eq.TEST-M001');
  assert.equal(query.get('branch'), 'eq.Main Branch');
  assert.equal(query.get('select'), 'bill_amount');
  assert.equal(query.get('limit'), '2');
  assert.equal(result.calls.some(call => call.path === '/rest/v1/sales'), false);
});
