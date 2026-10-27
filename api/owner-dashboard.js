"use strict";

// KK-CEO-003 — isolated development only.
// Owner/Admin authenticated, read-only financial dashboard API.

const DATASETS = Object.freeze([
  ["sales", "id.asc", 25000],
  ["receivables", "id.asc", 10000],
  ["bills_master", "bill_no.asc,branch.asc,bill_date.asc,bill_amount.asc", 15000]
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
  let priorLastSort = null;

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

    // A non-unique ordering key spanning pages makes offset pagination unsafe.
    // Reject ambiguous boundaries rather than quietly losing invoice records.
    if (name === "bills_master") {
      const sortKey = item => JSON.stringify([
        item.bill_no, item.branch, item.bill_date, item.bill_amount
      ]);
      if (priorLastSort !== null && sortKey(page[0]) === priorLastSort) {
        throw new Error("Ambiguous invoice page boundary");
      }
      priorLastSort = sortKey(page[page.length - 1]);
    }

    for (const item of page) {
      if (!item || typeof item !== "object") {
        throw new Error("Invalid dataset row");
      }

      if (name === "bills_master") {
        if (item.bill_no == null || item.branch == null) {
          throw new Error("Missing invoice reference");
        }
        // Preserve repeated invoice records for reconciliation.
        continue;
      }

      const identity = item.id != null ? String(item.id) : null;

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
function createHandler(datasets = DATASETS, readData = require("../lib/sales-db.cjs").readRows) {
return async function handler(req, res) {
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

    // Auth verified above. Restrict Production Sales to a separate database role.
    const data = await readData(datasets);

    const payload = {
      ...data,
      counts: {
        ...Object.fromEntries(datasets.map(([name]) => [name, data[name].length]))
      },
      read_only: true
    };

    if (Array.isArray(data.bills_master)) {
      const references = new Map();

      for (const bill of data.bills_master) {
        const key = JSON.stringify([bill.branch, bill.bill_no]);
        references.set(key, (references.get(key) || 0) + 1);
      }

      const repeats = [...references.values()].filter(n => n > 1);

      payload.reconciliation = {
        duplicate_invoice_references: repeats.length,
        repeated_invoice_rows: repeats.reduce((n, count) => n + count - 1, 0),
        status: repeats.length ? "under_reconciliation" : "no_duplicate_references"
      };
    }

    // Server-owned aggregate snapshot: only returned after Supabase Owner/Admin verification.
    payload.sales_source = {source: 'production_sales_live_readonly', is_live: true, checked_at: new Date().toISOString()};
    // Historical snapshot stays explicitly separate from transaction data.
    // Historical finance fixtures are not bundled in publicly deployable API paths.
    payload.production_monthly_snapshot = null;

    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    if (bytes > 3500000) {
      throw new Error("Dashboard response exceeds safe size");
    }

    return send(res, 200, payload);


  } catch (error) {
    const safeCode = String(error?.code || "UNKNOWN");
    const code = /^(?:[0-9A-Z]{5}|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNRESET|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/.test(safeCode)
      ? safeCode : "UNKNOWN";
    console.error("[KK_SALES_DIAGNOSTIC]", {
      category: error?.code ? "database_or_network" : "application",
      code
    });
    return send(res, 503, {
      error: "Dashboard data unavailable"
    });
  }
};

}
module.exports = createHandler();
module.exports.createHandler = createHandler;
