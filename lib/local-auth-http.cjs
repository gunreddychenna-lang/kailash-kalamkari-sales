"use strict";

const http = require("node:http");
const store = require("./local-auth-store.cjs");
const crypto = require("./local-auth-crypto.cjs");

const HOST = "127.0.0.1";
const PORT = 8765;
const ORIGIN = `http://${HOST}:${PORT}`;
const MAX_BODY = 4096;
const LIMIT = 8;
const WINDOW_MS = 15 * 60 * 1000;

function createLocalAuthServer(options = {}) {
  const auth = options.store || store;
  const dbPassword = options.dbPassword;
  const attempts = new Map();

  function respond(res, status, body, cookie) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'",
      ...(cookie ? { "Set-Cookie": cookie } : {})
    });
    res.end(JSON.stringify(body));
  }

  function sessionToken(req) {
    const cookie = String(req.headers.cookie || "");
    if (cookie.length > 4096) return null;

    const match = cookie.match(
      /(?:^|;\s*)kk_local_session=([A-Za-z0-9_-]{43})(?:;|$)/
    );
    return match ? match[1] : null;
  }

  function rejectCrossOrigin(req) {
    return req.headers.origin !== ORIGIN ||
      req.headers["x-kk-local-request"] !== "1" ||
      req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !==
        "application/json";
  }

  function limited(key) {
    const now = Date.now();

    // Keep the in-memory limiter bounded.
    for (const [item, value] of attempts) {
      if (now - value.start >= WINDOW_MS) attempts.delete(item);
    }

    const record = attempts.get(key);

    if (!record) {
      attempts.set(key, { start: now, count: 1 });
      return false;
    }

    record.count += 1;
    return record.count > LIMIT;
  }

  async function readJSON(req) {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk.toString("utf8");
      if (Buffer.byteLength(raw, "utf8") > MAX_BODY) {
        throw new Error("Request body too large");
      }
    }

    const body = JSON.parse(raw);
    if (!body || Array.isArray(body) || typeof body !== "object") {
      throw new Error("Invalid body");
    }
    return body;
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (
        req.headers.host !== ORIGIN.slice(7) ||
        req.socket.localAddress !== HOST
      ) {
        return respond(res, 403, { error: "Forbidden" });
      }

      if (!dbPassword || typeof dbPassword !== "string") {
        return respond(res, 503, { error: "Authentication unavailable" });
      }

      if (
        req.method === "POST" &&
        (req.url === "/api/local-auth/login" ||
         req.url === "/api/local-auth/logout") &&
        rejectCrossOrigin(req)
      ) {
        return respond(res, 403, { error: "Forbidden" });
      }

      if (req.method === "POST" &&
          req.url === "/api/local-auth/login") {
        const key = req.socket.remoteAddress || "unknown";
        if (limited(key)) {
          return respond(res, 429, { error: "Too many attempts" });
        }

        let body;
        try {
          body = await readJSON(req);
        } catch {
          return respond(res, 400, { error: "Invalid request" });
        }

        if (
          typeof body.loginId !== "string" ||
          typeof body.password !== "string"
        ) {
          return respond(res, 400, { error: "Invalid request" });
        }

        const result = await auth.login(
          body.loginId, body.password, dbPassword
        );

        if (!result) {
          return respond(res, 401, { error: "Invalid credentials" });
        }

        return respond(
          res,
          200,
          { profile: result.profile },
          crypto.sessionCookie(result.token, false)
        );
      }

      if (req.method === "GET" &&
          req.url === "/api/local-auth/session") {
        const token = sessionToken(req);

        if (!token) {
          return respond(res, 401, { error: "Not authenticated" });
        }

        const profile = await auth.getSession(token, dbPassword);

        return profile
          ? respond(res, 200, { profile })
          : respond(res, 401, { error: "Not authenticated" });
      }

      if (req.method === "POST" &&
          req.url === "/api/local-auth/logout") {
        const token = sessionToken(req);
        if (token) await auth.logout(token, dbPassword);

        return respond(
          res,
          200,
          { success: true },
          crypto.sessionCookie("", false)
        );
      }

      return respond(res, 404, { error: "Not found" });
    } catch {
      return respond(res, 503, { error: "Authentication unavailable" });
    }
  });

  return server;
}

if (require.main === module) {
  if (!process.env.KK_LOCAL_AUTH_DB_PASSWORD ||
      process.env.VERCEL_ENV === "production") {
    console.error("Local authentication configuration unavailable");
    process.exitCode = 1;
  } else {
    createLocalAuthServer({
      dbPassword: process.env.KK_LOCAL_AUTH_DB_PASSWORD
    }).listen(PORT, HOST, () => {
      console.log(`LOCAL AUTH SERVER: ${ORIGIN}`);
    });
  }
}

module.exports = { createLocalAuthServer };
