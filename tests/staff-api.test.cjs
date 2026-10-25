"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/staff.js");

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

async function invoke(method, authorization) {
  const req = {
    method,
    headers: authorization
      ? { authorization }
      : {},
    body: {}
  };

  const res = response();
  await handler(req, res);
  return res;
}

test("unsupported HTTP methods are rejected", async () => {
  const res = await invoke("DELETE");
  assert.equal(res.statusCode, 405);
});

test("API fails closed without server configuration", async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const res = await invoke("GET");
    assert.equal(res.statusCode, 503);
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;

    if (oldKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    }
  }
});

test("API rejects anonymous callers", async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    process.env.SUPABASE_URL =
      "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY =
      "test-only-not-a-real-key";

    const res = await invoke("GET");
    assert.equal(res.statusCode, 401);
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;

    if (oldKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    }
  }
});