"use strict";

// KK-CEO-003 — isolated development only.
// Owner/Admin authenticated, read-only financial dashboard API.

const DATASETS = Object.freeze([
  ["sales", "id.asc", 25000],
  ["receivables", "id.asc", 10000],
  ["bills_master", "bill_no.asc,branch.asc", 15000]
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
  const rows = [];
  const seen = new Set();
  let expected = null;
  let offset = 0;

  while (offset <= maxRows) {
    const response = await fetch(
      `${base}/rest/v1/${name}?select=*&order=${order}&limit=500&offset=${offset}`,
      {
        method: "GET",
        headers: {
          apikey: secret,
          Authorization: `Bearer ${secret}`,
          Accept: "application/json",
          Prefer: "count=exact"
        }
      }
    );

    if (!response.ok) throw new Error("Dataset request failed");

    const range = response.headers?.get("content-range") || "";
    const page = await response.json();

    if (!Array.isArray(page) || page.length > 500) {
      throw new Error("Invalid dataset page");
    }

    if (range === "*/0" && offset === 0 && page.length === 0) {
      return [];
    }

    const match = /^(\d+)-(\d+)\/(\d+)$/.exec(range);
    if (!match) throw new Error("Missing exact row count");

    const [start, end, total] = match.slice(1).map(Number);

    if (
      ![start, end, total].every(Number.isSafeInteger) ||
      total > maxRows ||
      total < 0
    ) {
      throw new Error("Invalid dataset range");
    }

    if (expected === null) expected = total;
    if (total !== expected) throw new Error("Dataset count changed");

    if (
      page.length === 0 ||
      start !== offset ||
      end !== offset + page.length - 1 ||
      rows.length + page.length > total
    ) {
      throw new Error("Incomplete dataset");
    }

    for (const item of page) {
      if (!item || typeof item !== "object") {
        throw new Error("Invalid dataset row");
      }

      const identity = name === "bills_master"
        ? item.bill_no != null && item.branch != null
          ? JSON.stringify([item.bill_no, item.branch])
          : null
        : item.id != null ? String(item.id) : null;

      if (identity === null || seen.has(identity)) {
        throw new Error("Missing or duplicate record");
      }

      seen.add(identity);
    }

    rows.push(...page);

    if (rows.length === total) return rows;
    offset += page.length;
  }

  throw new Error("Dataset limit reached");
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

    const payload = {
      ...data,
      counts: {
        sales: data.sales.length,
        receivables: data.receivables.length,
        bills_master: data.bills_master.length
      },
      read_only: true
    };

    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    if (bytes > 3500000) {
      throw new Error("Dashboard response exceeds safe size");
    }

    return send(res, 200, payload);


  } catch (_) {
    return send(res, 503, {
      error: "Dashboard data unavailable"
    });
  }
};
