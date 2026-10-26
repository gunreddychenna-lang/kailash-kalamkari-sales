"use strict";

// KK-CEO-003 — isolated development only.
// Owner/Admin authenticated, read-only financial dashboard API.

const DATASETS = Object.freeze([
  ["sales", "id", 25000],
  ["receivables", "id", 10000],
  ["bills_master", "bill_no", 15000]
]);

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(body);
}

async function getJSON(base, secret, path, jwt) {
  const response = await fetch(base + path, {
    method: "GET",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${jwt || secret}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) throw new Error("Upstream failure");

  const data = await response.json();
  if (data === null || typeof data !== "object") {
    throw new Error("Invalid upstream result");
  }
  return data;
}

async function allRows(base, secret, name, order, maxRows) {
  const result = [];
  const size = 500;

  for (let offset = 0; offset <= maxRows; offset += size) {
    const url =
      `/rest/v1/${name}?select=*&order=${order}.asc` +
      `&limit=${size}&offset=${offset}`;

    const page = await getJSON(base, secret, url);

    if (!Array.isArray(page)) throw new Error("Invalid dataset");

    if (page.length > size || result.length + page.length > maxRows) {
      throw new Error("Dataset safety limit reached");
    }

    result.push(...page);

    if (page.length < size) return result;
  }

  throw new Error("Dataset safety limit reached");
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Method not allowed" });
  }

  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!base || !secret) {
    return send(res, 503, { error: "Backend unavailable" });
  }

  const match = (req.headers?.authorization || "")
    .match(/^Bearer ([^\s]+)$/i);

  if (!match) {
    return send(res, 401, { error: "Authentication required" });
  }

  try {
    // Verify actual Supabase Auth session.
    const identity = await getJSON(
      base, secret, "/auth/v1/user", match[1]
    );

    if (!identity.id) {
      return send(res, 401, { error: "Invalid session" });
    }

    // Trusted role comes from DB, never the browser.
    const profiles = await getJSON(
      base,
      secret,
      "/rest/v1/kk_staff_access?auth_user_id=eq." +
        encodeURIComponent(identity.id) +
        "&select=role,active"
    );

    if (!Array.isArray(profiles) || profiles.length !== 1) {
      return send(res, 403, { error: "Access denied" });
    }

    const staff = profiles[0];

    if (
      staff.active !== true ||
      !["owner", "admin"].includes(staff.role)
    ) {
      return send(res, 403, { error: "Access denied" });
    }

    const data = {};

    // No partial successful response if any dataset fails.
    for (const [table, order, maximum] of DATASETS) {
      data[table] = await allRows(
        base, secret, table, order, maximum
      );
    }

    return send(res, 200, {
      ...data,
      counts: {
        sales: data.sales.length,
        receivables: data.receivables.length,
        bills_master: data.bills_master.length
      },
      read_only: true
    });

  } catch (_) {
    return send(res, 503, {
      error: "Dashboard data unavailable"
    });
  }
};
