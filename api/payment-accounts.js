"use strict";

const DEV = "https://yiaipfquxyrqxvkvjykp.supabase.co";
const PROD = "https://dqvqqrbvklpiibzqivbp.supabase.co";

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const send = (code, payload) =>
    res.status(code).json(payload);

  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return send(405, { error: "Method not allowed" });
  }

  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const isDev =
    process.env.VERCEL_ENV === "preview" &&
    base === DEV;

  const isProd =
    process.env.VERCEL_ENV === "production" &&
    base === PROD;

  if (!secret || (!isDev && !isProd)) {
    return send(503, { error: "Account service unavailable" });
  }

  // Production is strictly read-only.
  if (isProd && req.method !== "GET") {
    return send(405, { error: "Production account editing disabled" });
  }

  const token = (req.headers.authorization || "")
    .match(/^Bearer ([^\s]+)$/i)?.[1];

  if (!token) return send(401, { error: "Login required" });

  async function request(path, bearer, method = "GET", body) {
    const response = await fetch(base + path, {
      method,
      headers: {
        apikey: secret,
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        ...(method === "POST"
          ? { Prefer: "return=representation" }
          : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000)
    });

    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
  }

  try {
    // Confirm real Supabase Auth identity.
    const identity = await request("/auth/v1/user", token);

    if (!identity.ok || !identity.data?.id) {
      return send(401, { error: "Invalid session" });
    }

    // Confirm Owner/Admin from protected database record.
    const staff = await request(
      "/rest/v1/kk_staff_access?auth_user_id=eq." +
      encodeURIComponent(identity.data.id) +
      "&select=role,active",
      secret
    );

    if (
      !staff.ok ||
      !Array.isArray(staff.data) ||
      staff.data.length !== 1 ||
      staff.data[0].active !== true ||
      !["owner", "admin"].includes(staff.data[0].role)
    ) {
      return send(403, { error: "Owner/Admin only" });
    }

    async function listAccounts() {
      const result = await request(
        "/rest/v1/kk_payment_accounts" +
        "?select=account_name,account_type,is_active",
        secret
      );

      if (!result.ok || !Array.isArray(result.data)) {
        throw new Error("Account lookup failed");
      }

      return result.data;
    }

    if (req.method === "GET") {
      const accounts = await listAccounts();

      return send(200, {
        accounts: accounts
          .filter(a => a.is_active === true)
          .filter(a => !["Cash", "Reseller"].includes(a.account_type))
          .map(a => a.account_name)
          .sort((a, b) => a.localeCompare(b))
      });
    }

    const body = req.body;

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof body.account_name !== "string"
    ) {
      return send(400, { error: "Invalid request" });
    }

    const name = body.account_name.trim();

    if (
      !/^[A-Za-z0-9 ._-]{2,60}$/.test(name) ||
      ["cash", "take by hand"].includes(name.toLowerCase())
    ) {
      return send(400, { error: "Invalid bank name" });
    }

    const accounts = await listAccounts();

    if (
      accounts.some(a =>
        a.account_name.toLowerCase() === name.toLowerCase()
      )
    ) {
      return send(409, { error: "Account already exists" });
    }

    // Database insert is restricted to this audited DEV endpoint.
    const created = await request(
      "/rest/v1/kk_payment_accounts",
      secret,
      "POST",
      {
        account_name: name,
        account_type: "Bank Account",
        is_active: true
      }
    );

    if (created.status === 409) {
      return send(409, { error: "Account already exists" });
    }

    if (!created.ok || !Array.isArray(created.data) ||
        created.data.length !== 1) {
      throw new Error("Account creation failed");
    }

    return send(201, {
      account_name: created.data[0].account_name
    });

  } catch {
    return send(503, { error: "Bank service unavailable" });
  }
};