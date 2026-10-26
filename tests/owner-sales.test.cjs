"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const handler = require("../api/owner-sales.js");

function response() {
  return {
    code: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(n) {
      this.code = n;
      return this;
    },
    json(v) {
      this.body = v;
      return this;
    }
  };
}

async function run({
  method = "GET",
  token = "test-jwt",
  role = "owner",
  active = true,
  rows = [{ id: 1, amount: 1000 }],
  failure = false
} = {}) {
  const oldFetch = global.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-server-secret";

  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, options });

    if (failure) {
      return { ok: false, status: 503 };
    }

    let data;

    if (url.includes("/auth/v1/user")) {
      data = { id: "verified-auth-user" };
    } else if (url.includes("/kk_staff_access")) {
      data = [{ role, active }];
    } else if (url.includes("/rest/v1/sales")) {
      data = rows;
    } else {
      throw new Error("Unexpected endpoint");
    }

    return {
      ok: true,
      json: async () => data
    };
  };

  const res = response();

  try {
    await handler({
      method,
      headers: token
        ? { authorization: `Bearer ${token}` }
        : {}
    }, res);

    return { res, calls };
  } finally {
    global.fetch = oldFetch;

    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;

    if (oldSecret === undefined)
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldSecret;
  }
}

test("rejects anonymous users without database access", async () => {
  const { res, calls } = await run({ token: "" });
  assert.equal(res.code, 401);
  assert.equal(calls.length, 0);
});

test("rejects POST without database access", async () => {
  const { res, calls } = await run({ method: "POST" });
  assert.equal(res.code, 405);
  assert.equal(calls.length, 0);
});

test("rejects ordinary employees", async () => {
  const { res, calls } = await run({ role: "employee" });
  assert.equal(res.code, 403);
  assert.equal(calls.some(c => c.url.includes("/rest/v1/sales")), false);
});

test("rejects inactive owners", async () => {
  const { res } = await run({ active: false });
  assert.equal(res.code, 403);
});

test("allows active owners read-only access", async () => {
  const { res, calls } = await run();
  assert.equal(res.code, 200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.read_only, true);
  assert.equal(
    calls.every(c => c.options.method === "GET"),
    true
  );
});

test("allows active admins read-only access", async () => {
  const { res } = await run({ role: "admin" });
  assert.equal(res.code, 200);
});

test("fails closed when Supabase is unavailable", async () => {
  const { res } = await run({ failure: true });
  assert.equal(res.code, 503);
});
