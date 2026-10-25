"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/staff-login.js");

function mockResponse() {
  return {
    code: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

async function run(method, body) {
  const res = mockResponse();
  await handler({ method, body }, res);
  return res;
}

test("Login endpoint blocks unsupported methods", async () => {
  const res = await run("GET", {});
  assert.equal(res.code, 405);
});

test("Login endpoint fails closed without configuration", async () => {
  const old = {
    url: process.env.SUPABASE_URL,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anon: process.env.SUPABASE_ANON_KEY
  };

  try {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;

    const res = await run("POST", {
      loginId: "staff01",
      password: "password"
    });

    assert.equal(res.code, 503);
  } finally {
    for (const [key, env] of Object.entries({
      SUPABASE_URL: old.url,
      SUPABASE_SERVICE_ROLE_KEY: old.service,
      SUPABASE_ANON_KEY: old.anon
    })) {
      if (env === undefined) delete process.env[key];
      else process.env[key] = env;
    }
  }
});

test("Invalid Login IDs are rejected", async () => {
  const old = {
    url: process.env.SUPABASE_URL,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anon: process.env.SUPABASE_ANON_KEY
  };

  try {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-key";
    process.env.SUPABASE_ANON_KEY = "mock-anon-key";

    for (const loginId of ["", "x", "a b", "../../admin"]) {
      const res = await run("POST", {
        loginId,
        password: "test-password"
      });
      assert.equal(res.code, 401);
    }
  } finally {
    for (const [key, env] of Object.entries({
      SUPABASE_URL: old.url,
      SUPABASE_SERVICE_ROLE_KEY: old.service,
      SUPABASE_ANON_KEY: old.anon
    })) {
      if (env === undefined) delete process.env[key];
      else process.env[key] = env;
    }
  }
});