"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const handler = require("../api/owner-inventory.js");

const DEV = "https://yiaipfquxyrqxvkvjykp.supabase.co";

async function run({
  role = "owner",
  active = true,
  token = "test-token",
  method = "GET",
  database = DEV,
  snapshotValid = true,
  snapshotMissing = false,
  duplicateId = false
} = {}) {
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CATALOGUE_SUPABASE_URL",
    "CATALOGUE_SUPABASE_ANON_KEY",
    "KK_INVENTORY_LIVE_DEV", "KK_INVENTORY_SUPABASE_URL", "KK_INVENTORY_SUPABASE_SERVICE_ROLE_KEY"
  ];

  const original = Object.fromEntries(
    names.map(n => [n, process.env[n]])
  );

  const previousFetch = global.fetch;
  const requests = [];

  process.env.SUPABASE_URL = database;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-test-service-key";
  process.env.KK_INVENTORY_LIVE_DEV = "1";
  process.env.KK_INVENTORY_SUPABASE_URL = DEV;
  process.env.KK_INVENTORY_SUPABASE_SERVICE_ROLE_KEY = "fake-inventory-key";

  delete process.env.CATALOGUE_SUPABASE_URL;
  delete process.env.CATALOGUE_SUPABASE_ANON_KEY;

  const firstId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const secondId = duplicateId
    ? firstId
    : "bbbbbbbbbbbbbbbbbbbbbbbb";

  const snapshot = {
    source: "local_drive_csv_audit",
    snapshot: true,
    total_images: 2,
    items: [
      {
        stable_id: firstId,
        store: "Main Catalogue",
        fabric: "Silk",
        type: "Sarees",
        category: "Floral",
        design: "Floral",
        colour: "Red",
        filename: "Floral & Red.jpg",
        availability_status: "observed"
      },
      {
        stable_id: secondId,
        store: "KHPS",
        fabric: "Cotton",
        type: "Sarees",
        category: "Story",
        design: "Story",
        colour: "Blue",
        filename: "Story & Blue.jpg",
        availability_status: "observed"
      }
    ]
  };

  global.fetch = async (raw, options) => {
    const url = new URL(raw);
    requests.push({url, options});

    if (url.pathname === "/auth/v1/user") {
      return {
        ok: true,
        json: async () => ({id: "verified-user"})
      };
    }

    if (url.pathname === "/rest/v1/kk_staff_access") {
      return {
        ok: true,
        json: async () => [{role, active}]
      };
    }

    if (url.pathname === "/rest/v1/kk_inventory_snapshots") {
      return {
        ok: true,
        json: async () => snapshotMissing
          ? []
          : [{payload: snapshotValid ? snapshot : {bad: true}}]
      };
    }

    throw new Error("Unexpected upstream dependency: " + url.pathname);
  };

  const res = {
    setHeader() {},
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };

  try {
    await handler({
      method,
      headers: token ? {authorization: "Bearer " + token} : {}
    }, res);

    return {res, requests};
  } finally {
    global.fetch = previousFetch;

    for (const name of names) {
      if (original[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = original[name];
      }
    }
  }
}

test("DEV owner reads metadata without catalogue dependency", async () => {
  const {res, requests} = await run();

  assert.equal(res.code, 200);
  assert.equal(res.body.source, "dev_inventory_metadata");
  assert.equal(res.body.read_only, true);
  assert.equal(res.body.drive_audit.total_images, 2);
  assert.equal(res.body.saree_inventory.length, 0);
  assert.equal(
    res.body.drive_audit.items[0].stable_id,
    "aaaaaaaaaaaaaaaaaaaaaaaa"
  );

  assert.ok(
    requests.every(r => r.options.method === "GET")
  );

  assert.ok(
    requests.every(r => r.url.hostname === new URL(DEV).hostname)
  );

  assert.ok(
    !requests.some(r => r.url.pathname === "/rest/v1/products")
  );

  assert.ok(
    !JSON.stringify(res.body).includes("fake-test-service-key")
  );
});

test("DEV admin authorized", async () => {
  assert.equal((await run({role: "admin"})).res.code, 200);
});

test("employee denied before inventory read", async () => {
  const {res, requests} = await run({role: "employee"});

  assert.equal(res.code, 403);
  assert.ok(
    !requests.some(r => r.url.pathname === "/rest/v1/kk_inventory_snapshots")
  );
});

test("inactive owner denied", async () => {
  assert.equal((await run({active: false})).res.code, 403);
});

test("anonymous caller denied", async () => {
  assert.equal((await run({token: ""})).res.code, 401);
});

test("write methods denied", async () => {
  assert.equal((await run({method: "POST"})).res.code, 405);
});

test("production Sales auth uses separate DEV inventory", async () => {
  const {res, requests} = await run({
    database: "https://dqvqqrbvklpiibzqivbp.supabase.co"
  });

  assert.equal(res.code, 200);
  assert.equal(res.body.read_only, true);

  const salesHost = "dqvqqrbvklpiibzqivbp.supabase.co";
  const inventoryHost = "yiaipfquxyrqxvkvjykp.supabase.co";

  assert.ok(requests.some(r =>
    r.url.hostname === salesHost &&
    r.url.pathname === "/auth/v1/user"
  ));

  assert.ok(requests.some(r =>
    r.url.hostname === salesHost &&
    r.url.pathname === "/rest/v1/kk_staff_access"
  ));

  assert.ok(requests.some(r =>
    r.url.hostname === inventoryHost &&
    r.url.pathname === "/rest/v1/kk_inventory_snapshots"
  ));
});

test("missing snapshot fails closed", async () => {
  assert.equal((await run({snapshotMissing: true})).res.code, 503);
});

test("malformed snapshot fails closed", async () => {
  assert.equal((await run({snapshotValid: false})).res.code, 503);
});

test("duplicate stable identities rejected", async () => {
  assert.equal((await run({duplicateId: true})).res.code, 503);
});