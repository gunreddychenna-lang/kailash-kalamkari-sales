"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createLocalAuthServer } =
  require("../lib/local-auth-http.cjs");
const crypto = require("../lib/local-auth-crypto.cjs");

const BASE = "http://127.0.0.1:8765";

// Each test starts and stops a server on the same port.
// Close client connections instead of reusing stale pooled sockets.
const nativeFetch = globalThis.fetch;
function fetch(url, options = {}) {
  return nativeFetch(url, {
    ...options,
    headers: {
      Connection: "close",
      ...(options.headers || {})
    }
  });
}
const HEADERS = {
  Origin: BASE,
  "Content-Type": "application/json",
  "x-kk-local-request": "1"
};

async function withServer(action) {
  const token = crypto.createSessionToken();
  let revoked = false;

  const profile = {
    user: "test.owner",
    role: "owner",
    active: true
  };

  const mock = {
    async login(id, password) {
      return id === "test.owner" &&
        password === "Strong-Test-Password-2026!"
        ? { token, profile }
        : null;
    },
    async getSession(candidate) {
      return candidate === token && !revoked
        ? profile
        : null;
    },
    async logout(candidate) {
      if (candidate !== token || revoked) return false;
      revoked = true;
      return true;
    }
  };

  const server = createLocalAuthServer({
    store: mock,
    dbPassword: "mock-database-password"
  });

  server.listen(8765, "127.0.0.1");

  try {
    await once(server, "listening");
    await action({ token, profile });
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

function post(path, body, headers = HEADERS) {
  return fetch(BASE + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

test("HTTP login, cookie, session and logout", async () => {
  await withServer(async ({ token }) => {
    const anonymous = await fetch(
      BASE + "/api/local-auth/session"
    );
    assert.equal(anonymous.status, 401);

    const invalid = await post("/api/local-auth/login", {
      loginId: "test.owner",
      password: "Wrong-Test-Password-2026!"
    });
    assert.equal(invalid.status, 401);

    const login = await post("/api/local-auth/login", {
      loginId: "test.owner",
      password: "Strong-Test-Password-2026!"
    });

    assert.equal(login.status, 200);
    assert.equal(login.headers.get("cache-control"), "no-store");

    const cookie = login.headers.get("set-cookie");
    assert.ok(cookie);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.ok(cookie.includes(token));

    const body = await login.json();
    assert.equal(body.profile.role, "owner");
    assert.equal(JSON.stringify(body).includes(token), false);

    const session = await fetch(
      BASE + "/api/local-auth/session",
      { headers: { Cookie: cookie.split(";")[0] } }
    );
    assert.equal(session.status, 200);

    const logout = await post(
      "/api/local-auth/logout",
      {},
      { ...HEADERS, Cookie: cookie.split(";")[0] }
    );
    assert.equal(logout.status, 200);
    assert.match(
      logout.headers.get("set-cookie"),
      /Max-Age=0/
    );

    const afterLogout = await fetch(
      BASE + "/api/local-auth/session",
      { headers: { Cookie: cookie.split(";")[0] } }
    );
    assert.equal(afterLogout.status, 401);
  });
});

test("HTTP cross-origin login is denied", async () => {
  await withServer(async () => {
    const response = await post(
      "/api/local-auth/login",
      {
        loginId: "test.owner",
        password: "Strong-Test-Password-2026!"
      },
      {
        ...HEADERS,
        Origin: "http://malicious.example"
      }
    );

    assert.equal(response.status, 403);
  });
});

test("HTTP unknown routes remain unavailable", async () => {
  await withServer(async () => {
    const response = await fetch(BASE + "/api/payments");
    assert.equal(response.status, 404);
  });
});

test("HTTP login rate limit blocks excess attempts", async () => {
  await withServer(async () => {
    for (let i = 0; i < 8; i++) {
      const response = await post(
        "/api/local-auth/login",
        { loginId: "unknown", password: "Invalid" }
      );
      assert.equal(response.status, 401);
    }

    const blocked = await post(
      "/api/local-auth/login",
      {
        loginId: "test.owner",
        password: "Strong-Test-Password-2026!"
      }
    );
    assert.equal(blocked.status, 429);
  });
});
