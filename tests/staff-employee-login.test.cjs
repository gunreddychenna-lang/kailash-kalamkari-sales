"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/staff-login.js");

function response() {
  return {
    statusCode: 200,
    setHeader() { return this; },
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

async function check(role, active, validPassword) {
  const previousFetch = global.fetch;
  const previous = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY:
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
  };

  const userId = "00000000-0000-4000-8000-000000000001";

  try {
    process.env.SUPABASE_URL =
      "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY =
      "test-service-key";
    process.env.SUPABASE_ANON_KEY =
      "test-anon-key";

    global.fetch = async (url, options) => {
      let data;

      if (url.includes("/rest/v1/kk_staff_access")) {
        data = [{
          auth_user_id: userId,
          role,
          active
        }];
      } else if (url.includes("/auth/v1/admin/users/")) {
        data = { email: "test@example.com" };
      } else if (url.includes("/auth/v1/token")) {
        if (!validPassword) {
          return { ok: false };
        }

        assert.equal(
          options.headers.apikey,
          "test-anon-key"
        );

        data = {
          access_token: "mock-access",
          refresh_token: "mock-refresh",
          user: { id: userId }
        };
      } else {
        throw new Error("Unexpected upstream call");
      }

      return {
        ok: true,
        json: async () => data
      };
    };

    const res = response();

    await handler({
      method: "POST",
      body: {
        loginId: "staff01",
        password: "test-password"
      }
    }, res);

    return res;
  } finally {
    global.fetch = previousFetch;

    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("active employee can authenticate", async () => {
  const result = await check("employee", true, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.access_token, "mock-access");
});

test("inactive employee is denied", async () => {
  assert.equal(
    (await check("employee", false, true)).statusCode,
    401
  );
});

test("invalid password is denied", async () => {
  assert.equal(
    (await check("employee", true, false)).statusCode,
    401
  );
});

test("unknown role is denied", async () => {
  assert.equal(
    (await check("unknown", true, true)).statusCode,
    401
  );
});
