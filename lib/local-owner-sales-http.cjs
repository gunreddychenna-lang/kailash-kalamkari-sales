"use strict";

const http = require("node:http");
const { Client } = require("pg");
const auth = require("./local-auth-store.cjs");
const crypto = require("./local-auth-crypto.cjs");
const { config } = require("./local-sales-db.cjs");
const {
  getOwnerSalesReport
} = require("./local-owner-sales-report.cjs");

const HOST = "127.0.0.1";
const PORT = 8765;
const ORIGIN = `http://${HOST}:${PORT}`;
const SESSION_COOKIE = "kk_local_session";
const MAX_BODY = 4096;
const ATTEMPT_LIMIT = 8;
const WINDOW_MS = 15 * 60 * 1000;

function json(res, status, body, cookie) {
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

function tokenFromRequest(req) {
  const cookies = String(req.headers.cookie || "");

  if (cookies.length > MAX_BODY) return null;

  const match = cookies.match(
    /(?:^|;\s*)kk_local_session=([A-Za-z0-9_-]{43})(?:;|$)/
  );

  return match ? match[1] : null;
}

function validPost(req) {
  return req.headers.origin === ORIGIN &&
    req.headers["x-kk-local-request"] === "1" &&
    req.headers["content-type"]
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() === "application/json";
}

async function readBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > MAX_BODY) {
      throw new Error("Request too large");
    }

    chunks.push(chunk);
  }

  const value = JSON.parse(
    Buffer.concat(chunks).toString("utf8")
  );

  if (!value || Array.isArray(value) ||
      typeof value !== "object") {
    throw new Error("Invalid request body");
  }

  return value;
}

async function report(readerPassword, filters) {
  const client = new Client(config(readerPassword));
  let connected = false;

  try {
    await client.connect();
    connected = true;

    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
    );

    const identity = await client.query(`
      SELECT current_user AS username,
             current_database() AS database,
             inet_server_port() AS port
    `);

    const row = identity.rows[0];

    if (row?.username !== "kk_sales_app_reader" ||
        row?.database !== "kk_sales_dev" ||
        Number(row?.port) !== 55432) {
      throw new Error("Database identity mismatch");
    }

    const data = await getOwnerSalesReport(
      client,
      filters
    );

    await client.query("COMMIT");

    return {
      ...data,
      read_only: true
    };
  } catch (error) {
    if (connected) {
      try {
        await client.query("ROLLBACK");
      } catch {}
    }
    throw error;
  } finally {
    if (connected) await client.end();
  }
}

function createOwnerServer(options = {}) {
  const store = options.store || auth;
  const readReport = options.readReport || report;
  const authPassword = options.authPassword;
  const readerPassword = options.readerPassword;
  const attempts = new Map();

  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Production execution is blocked");
  }

  if (!authPassword || !readerPassword) {
    throw new Error("Both database credentials required");
  }

  return http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== `${HOST}:${PORT}` ||
          req.socket.localAddress !== HOST) {
        return json(res, 403, { error: "Forbidden" });
      }

      const url = new URL(req.url, ORIGIN);

      if (req.method === "POST" &&
          !validPost(req)) {
        return json(res, 403, { error: "Forbidden" });
      }

      if (req.method === "POST" &&
          url.pathname === "/api/local-auth/login") {

        const key = req.socket.remoteAddress || "local";
        const now = Date.now();
        const prior = attempts.get(key);

        const attempt = !prior ||
          now - prior.start >= WINDOW_MS
          ? { start: now, count: 1 }
          : { start: prior.start, count: prior.count + 1 };

        attempts.set(key, attempt);

        if (attempt.count > ATTEMPT_LIMIT) {
          return json(res, 429, {
            error: "Too many login attempts"
          });
        }

        let body;

        try {
          body = await readBody(req);
        } catch {
          return json(res, 400, {
            error: "Invalid request"
          });
        }

        if (typeof body.loginId !== "string" ||
            typeof body.password !== "string") {
          return json(res, 400, {
            error: "Invalid request"
          });
        }

        const result = await store.login(
          body.loginId,
          body.password,
          authPassword
        );

        if (!result ||
            !["owner", "admin"].includes(result.profile?.role)) {
          return json(res, 401, {
            error: "Invalid credentials"
          });
        }

        return json(
          res,
          200,
          { profile: result.profile },
          crypto.sessionCookie(result.token, false)
        );
      }

      if (req.method === "GET" &&
          url.pathname === "/api/local-auth/session") {
        const token = tokenFromRequest(req);

        const profile = token
          ? await store.getSession(token, authPassword)
          : null;

        if (!profile ||
            !["owner", "admin"].includes(profile.role)) {
          return json(res, 401, {
            error: "Authentication required"
          });
        }

        return json(res, 200, { profile });
      }

      if (req.method === "POST" &&
          url.pathname === "/api/local-auth/logout") {
        const token = tokenFromRequest(req);

        if (token) {
          await store.logout(token, authPassword);
        }

        return json(
          res,
          200,
          { success: true },
          crypto.sessionCookie("", false)
        );
      }

      if (req.method === "GET" &&
          url.pathname === "/api/owner-sales-report") {
        const token = tokenFromRequest(req);

        const profile = token
          ? await store.getSession(token, authPassword)
          : null;

        if (!profile ||
            !["owner", "admin"].includes(profile.role)) {
          return json(res, 401, {
            error: "Authentication required"
          });
        }

        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");

        if (url.searchParams.has("from") && !from ||
            url.searchParams.has("to") && !to) {
          return json(res, 400, {
            error: "Invalid date filter"
          });
        }

        let data;

        try {
          data = await readReport(readerPassword, {
            from,
            to
          });
        } catch (error) {
          if (error.message === "Invalid date" ||
              error.message === "Invalid date range") {
            return json(res, 400, {
              error: "Invalid date filter"
            });
          }
          throw error;
        }

        return json(res, 200, data);
      }

      return json(res, 404, {
        error: "Endpoint unavailable"
      });
    } catch (error) {
      console.error("Owner API request failed:", error.code || error.message);

      return json(res, 503, {
        error: "Service unavailable"
      });
    }
  });
}

if (require.main === module) {
  try {
    const server = createOwnerServer({
      authPassword: process.env.KK_LOCAL_AUTH_DB_PASSWORD,
      readerPassword: process.env.KK_SALES_READER_PASSWORD
    });

    server.listen(PORT, HOST, () => {
      console.log(`OWNER SALES API: ${ORIGIN}`);
      console.log("Mode: DEV / Owner-only / Read-only sales");
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  createOwnerServer,
  report
};
