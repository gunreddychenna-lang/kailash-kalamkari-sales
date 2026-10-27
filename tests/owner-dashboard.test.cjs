"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/owner-dashboard.js");

async function invoke({ method = "GET", token = "jwt",
                        role = "owner", active = true,
                        failTable = "" } = {}) {
  const oldFetch = global.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.SUPABASE_URL = "https://mock.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-secret";

  const calls = [];

  global.fetch = async (url, options) => {
    calls.push({ url, options });

    let data;

    if (url.includes("/auth/v1/user")) {
      data = { id: "verified-user" };
    } else if (url.includes("/kk_staff_access")) {
      data = [{ role, active }];
    } else if (url.includes("/rest/v1/sales?")) {
      data = [{ id: 1, store_name: "Main Branch" }];
    } else if (url.includes("/rest/v1/receivables?")) {
      data = [{ id: 2, amount: 500 }];
    } else if (url.includes("/rest/v1/bills_master?")) {
      data = [{ bill_no: "TEST-001", branch: "Main Branch" }];
    } else {
      throw new Error("Unexpected API call");
    }

    if (failTable && url.includes(`/rest/v1/${failTable}?`)) {
      return { ok: false, status: 503 };
    }

    return {
      ok: true,
      headers: {
        get(name) {
          if (name.toLowerCase() !== "content-range") return null;
          if (!Array.isArray(data)) return null;
          return data.length
            ? `0-${data.length - 1}/${data.length}`
            : "*/0";
        }
      },
      json: async () => data
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
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {}
    }, res);

    return { res, calls };
  } finally {
    global.fetch = oldFetch;

    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;

    if (oldKey === undefined)
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
}

test("anonymous caller denied before database calls", async () => {
  const { res, calls } = await invoke({ token: "" });
  assert.equal(res.code, 401);
  assert.equal(calls.length, 0);
});

test("write methods rejected", async () => {
  const { res, calls } = await invoke({ method: "POST" });
  assert.equal(res.code, 405);
  assert.equal(calls.length, 0);
});

test("employee denied before financial reads", async () => {
  const { res, calls } = await invoke({ role: "employee" });
  assert.equal(res.code, 403);
  assert.equal(
    calls.some(c => c.url.includes("/rest/v1/sales?")),
    false
  );
});

test("inactive Owner denied", async () => {
  const { res } = await invoke({ active: false });
  assert.equal(res.code, 403);
});

test("Owner receives all three read-only datasets", async () => {
  const { res, calls } = await invoke();
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.counts, {
    sales: 1, receivables: 1, bills_master: 1
  });
  assert.equal(res.body.read_only, true);
  assert.equal(res.body.production_monthly_snapshot, null);
  
  assert.equal(calls.every(c => c.options.method === "GET"), true);
});

test("Admin has same dashboard access", async () => {
  const { res } = await invoke({ role: "admin" });
  assert.equal(res.code, 200);
});

test("upstream error fails closed without partial data", async () => {
  const { res } = await invoke({ failTable: "receivables" });
  assert.equal(res.code, 503);
  assert.equal(res.body.sales, undefined);
});
