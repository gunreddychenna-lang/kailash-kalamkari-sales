"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/owner-dashboard.js");

async function scenario({ sales = [], bills = [], cap = 500 } = {}) {
  const originalFetch = global.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.SUPABASE_URL = "https://mock.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-key";

  const offsets = [];

  global.fetch = async raw => {
    const url = new URL(raw);

    if (url.pathname === "/auth/v1/user") {
      return { ok: true, json: async () => ({ id: "owner" }) };
    }

    if (url.pathname.includes("kk_staff_access")) {
      return {
        ok: true,
        json: async () => [{ role: "owner", active: true }]
      };
    }

    const table = url.pathname.split("/").at(-1);
    const items = {
      sales,
      receivables: [],
      bills_master: bills
    }[table];

    if (!items) throw Error("Unexpected request");

    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    const page = items.slice(offset, offset + Math.min(limit, cap));

    if (table === "sales") offsets.push(offset);

    return {
      ok: true,
      headers: {
        get(name) {
          return name.toLowerCase() === "content-range"
            ? page.length
              ? `${offset}-${offset + page.length - 1}/${items.length}`
              : `*/${items.length}`
            : null;
        }
      },
      json: async () => page
    };
  };

  const res = {
    code: 200,
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };

  try {
    await handler({
      method: "GET",
      headers: { authorization: "Bearer test-jwt" }
    }, res);

    return { res, offsets };
  } finally {
    global.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
}

test("empty datasets succeed", async () => {
  const { res } = await scenario();
  assert.equal(res.code, 200);
  assert.equal(res.body.counts.sales, 0);
  assert.equal(res.body.counts.bills_master, 0);
});

test("501 sales are complete with 300-row server cap", async () => {
  const sales = Array.from({ length: 501 }, (_, i) => ({
    id: i + 1, amount: 100
  }));
  const { res, offsets } = await scenario({ sales, cap: 300 });
  assert.equal(res.code, 200);
  assert.equal(res.body.sales.length, 501);
  assert.deepEqual(offsets, [0, 300]);
});

test("duplicate invoice identities fail closed", async () => {
  const bills = [
    { bill_no: "A1", branch: "Main Branch" },
    { bill_no: "A1", branch: "Main Branch" }
  ];
  const { res } = await scenario({ bills });
  assert.equal(res.code, 503);
  assert.equal(res.body.bills_master, undefined);
});