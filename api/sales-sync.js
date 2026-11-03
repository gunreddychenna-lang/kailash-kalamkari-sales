"use strict";

const crypto = require("node:crypto");

const FIELDS = new Set([
  "store_name", "bill_no", "sl_no", "item_name",
  "bill_date", "qty", "rate", "discount", "amount",
  "sm_name", "agent_name", "pay_mode", "sale_type",
  "bank_account"
]);

function reply(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

function authenticated(req) {
  const configured = process.env.KK_SALES_SYNC_TOKEN;
  const supplied = req.headers?.["x-kk-sync-token"];

  if (!configured || typeof supplied !== "string") return false;
  if (configured.length < 32) return false;

  const a = crypto.createHash("sha256").update(supplied).digest();
  const b = crypto.createHash("sha256").update(configured).digest();

  return crypto.timingSafeEqual(a, b);
}

function validDate(value) {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) &&
    number >= 0 &&
    Math.round(number * 100) / 100 === number;
}

function validate(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return "Invalid row";
  }

  if (Object.keys(row).some(key => !FIELDS.has(key))) {
    return "Unexpected column";
  }

  if (!["Main Branch", "KHPS"].includes(row.store_name)) {
    return "Invalid store";
  }

  if (typeof row.bill_no !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(row.bill_no)) {
    return "Invalid invoice number";
  }

  if (!Number.isInteger(row.sl_no) || row.sl_no < 1) {
    return "Invalid line number";
  }

  if (!validDate(row.bill_date)) return "Invalid date";

  if (!Number.isFinite(Number(row.qty)) || Number(row.qty) <= 0) {
    return "Invalid quantity";
  }

  if (!money(row.rate) || !money(row.discount) ||
      !money(row.amount) || Number(row.amount) <= 0) {
    return "Invalid financial amount";
  }

  for (const field of [
    "item_name", "sm_name", "agent_name",
    "pay_mode", "sale_type", "bank_account"
  ]) {
    if (typeof row[field] !== "string" ||
        !row[field].trim() || row[field].length > 200) {
      return "Invalid " + field;
    }
  }

  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { error: "Method not allowed" });
  }

  // No production import until financial release approval.
  if (process.env.VERCEL_ENV !== "preview") {
    return reply(res, 503, {
      error: "Sales import not enabled"
    });
  }

  if (!authenticated(req)) {
    return reply(res, 401, {
      error: "Unauthorized sync request"
    });
  }

  const rows = req.body?.rows;

  if (!Array.isArray(rows) || rows.length < 1 ||
      rows.length > 100 ||
      JSON.stringify(req.body).length > 100000) {
    return reply(res, 400, {
      error: "Invalid import batch"
    });
  }

  const errors = [];
  const seen = new Set();
  let totalPaise = 0;

  rows.forEach((row, index) => {
    const error = validate(row);

    if (error) {
      errors.push({ row: index + 1, error });
      return;
    }

    const key = JSON.stringify([
      row.store_name, row.bill_no, row.sl_no
    ]);

    if (seen.has(key)) {
      errors.push({
        row: index + 1,
        error: "Duplicate invoice line in submitted batch"
      });
      return;
    }

    seen.add(key);
    totalPaise += Math.round(Number(row.amount) * 100);
  });

  return reply(res, errors.length ? 422 : 200, {
    mode: "DRY_RUN_ONLY",
    database_writes: false,
    submitted_rows: rows.length,
    valid_rows: rows.length - errors.length,
    total_valid_amount: totalPaise / 100,
    errors
  });
};