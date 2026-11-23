"use strict";

const { Client } = require("pg");
const crypto = require("./local-auth-crypto.cjs");

const LOGIN_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function config(password) {
  if (typeof password !== "string" || !password) {
    throw new Error("Authentication DB password required");
  }

  return {
    host: "127.0.0.1",
    port: 55432,
    database: "kk_sales_dev",
    user: "kk_local_auth_api",
    password,
    ssl: false,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    statement_timeout: 10000,
    application_name: "kk-local-auth"
  };
}

async function withDatabase(password, action) {
  const client = new Client(config(password));

  try {
    await client.connect();

    const identity = await client.query(
      `SELECT current_user AS username,
              current_database() AS database,
              inet_server_port() AS port`
    );

    const row = identity.rows[0];

    if (
      row?.username !== "kk_local_auth_api" ||
      row?.database !== "kk_sales_dev" ||
      Number(row?.port) !== 55432
    ) {
      throw new Error("Authentication DB identity mismatch");
    }

    return await action(client);
  } finally {
    await client.end();
  }
}

function ownerOrAdmin(row) {
  return row?.user_active === true &&
    row?.staff_active === true &&
    ["owner", "admin"].includes(row.role) &&
    row.auth_user_id === row.user_id;
}

function publicProfile(row) {
  return {
    authUserId: row.user_id,
    user: row.login_id,
    displayName: row.display_name,
    empId: row.employee_id || "",
    role: row.role,
    stores: row.stores,
    features: row.features,
    active: true
  };
}

async function login(loginId, password, dbPassword) {
  const identifier = String(loginId || "").trim().toLowerCase();

  if (
    !LOGIN_PATTERN.test(identifier) ||
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  ) {
    return null;
  }

  return withDatabase(dbPassword, async (client) => {
    const result = await client.query(
      `SELECT
          u.id AS user_id,
          u.password_hash,
          u.active AS user_active,
          s.auth_user_id,
          s.login_id,
          s.display_name,
          s.employee_id,
          s.role,
          s.stores,
          s.features,
          s.active AS staff_active
       FROM public.kk_local_auth_users u
       LEFT JOIN public.kk_staff_access s
         ON s.auth_user_id = u.id
       WHERE u.login_id = $1`,
      [identifier]
    );

    if (result.rows.length !== 1) return null;

    const row = result.rows[0];

    if (!ownerOrAdmin(row)) return null;

    if (!await crypto.verifyPassword(
      password,
      row.password_hash
    )) {
      return null;
    }

    const token = crypto.createSessionToken();
    const tokenHash = crypto.hashSessionToken(token);

    await client.query(
      `INSERT INTO public.kk_local_auth_sessions
          (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '8 hours')`,
      [row.user_id, tokenHash]
    );

    return {
      token,
      profile: publicProfile(row)
    };
  });
}

async function getSession(token, dbPassword) {
  if (typeof token !== "string" ||
      !TOKEN_PATTERN.test(token)) {
    return null;
  }

  return withDatabase(dbPassword, async (client) => {
    const result = await client.query(
      `SELECT
          u.id AS user_id,
          u.active AS user_active,
          s.auth_user_id,
          s.login_id,
          s.display_name,
          s.employee_id,
          s.role,
          s.stores,
          s.features,
          s.active AS staff_active
       FROM public.kk_local_auth_sessions sess
       JOIN public.kk_local_auth_users u
         ON u.id = sess.user_id
       JOIN public.kk_staff_access s
         ON s.auth_user_id = u.id
       WHERE sess.token_hash = $1
         AND sess.expires_at > now()
         AND sess.revoked_at IS NULL`,
      [crypto.hashSessionToken(token)]
    );

    const row = result.rows[0];

    return ownerOrAdmin(row)
      ? publicProfile(row)
      : null;
  });
}

async function logout(token, dbPassword) {
  if (typeof token !== "string" ||
      !TOKEN_PATTERN.test(token)) {
    return false;
  }

  return withDatabase(dbPassword, async (client) => {
    const result = await client.query(
      `UPDATE public.kk_local_auth_sessions
       SET revoked_at = now()
       WHERE token_hash = $1
         AND revoked_at IS NULL
       RETURNING id`,
      [crypto.hashSessionToken(token)]
    );

    return result.rowCount > 0;
  });
}

module.exports = Object.freeze({
  config,
  login,
  getSession,
  logout
});
