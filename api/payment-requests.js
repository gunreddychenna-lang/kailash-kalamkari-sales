"use strict";

// KK-CEO-003: ISOLATED DEVELOPMENT ONLY.
// Accept pending payment requests; never post financial settlements.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STORES = new Set(["Main Branch", "KHPS"]);
const METHODS = new Set(["cash", "upi", "bank_transfer", "card"]);

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed" });
  }

  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!base || !key) {
    return send(res, 503, { error: "Backend not configured" });
  }

  const match = (req.headers.authorization || "")
    .match(/^Bearer ([^\s]+)$/i);

  if (!match) {
    return send(res, 401, { error: "Authentication required" });
  }

  const input = req.body;

  if (!input || Array.isArray(input) ||
      typeof input !== "object") {
    return send(res, 400, { error: "Invalid request" });
  }

  const allowed = new Set([
    "store_name",
    "bill_no",
    "amount",
    "payment_method",
    "payment_reference",
    "payment_date",
    "idempotency_key"
  ]);

  if (Object.keys(input).some(k => !allowed.has(k))) {
    return send(res, 400, { error: "Unexpected field" });
  }

  const store = input.store_name;
  const bill = input.bill_no;
  const amount = input.amount;
  const method = input.payment_method;
  const idem = input.idempotency_key;
  const reference = input.payment_reference ?? null;
  const date = input.payment_date ??
    new Date().toISOString().slice(0, 10);

  const amountText = String(amount);
  const validAmount =
    (typeof amount === "number" || typeof amount === "string") &&
    /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(amountText) &&
    Number(amount) > 0;

  const validDate =
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date + "T00:00:00Z")) &&
    new Date(date + "T00:00:00Z")
      .toISOString().slice(0, 10) === date;

  if (!STORES.has(store) ||
      typeof bill !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(bill) ||
      !validAmount ||
      !METHODS.has(method) ||
      typeof idem !== "string" ||
      !UUID.test(idem) ||
      !validDate ||
      (reference !== null &&
        (typeof reference !== "string" ||
         reference.length > 120))) {
    return send(res, 400, { error: "Invalid payment details" });
  }

  async function upstream(path, options = {}) {
    const response = await fetch(base + path, {
      method: options.method || "GET",
      headers: {
        apikey: key,
        Authorization: "Bearer " + (options.jwt || key),
        "Content-Type": "application/json",
        ...(options.prefer
          ? { Prefer: options.prefer }
          : {})
      },
      ...(options.body
        ? { body: JSON.stringify(options.body) }
        : {})
    });

    const raw = await response.text();
    let body = null;

    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      throw new Error("Invalid upstream response");
    }

    return {
      ok: response.ok,
      status: response.status,
      body
    };
  }

  try {
    // Validate actual Supabase JWT.
    const identity = await upstream("/auth/v1/user", {
      jwt: match[1]
    });

    const userId = identity.body?.id;

    if (!identity.ok || !UUID.test(userId || "")) {
      return send(res, 401, { error: "Invalid session" });
    }

    const profileResult = await upstream(
      "/rest/v1/kk_staff_access" +
      "?auth_user_id=eq." + encodeURIComponent(userId) +
      "&select=role,active,stores,features"
    );

    if (!profileResult.ok ||
        !Array.isArray(profileResult.body) ||
        profileResult.body.length !== 1) {
      return send(res, 503, {
        error: "Staff authorization unavailable"
      });
    }

    const staff = profileResult.body[0];

    const fullAccess =
      ["owner", "admin"].includes(staff.role);

    const accountantAccess =
      staff.role === "employee" &&
      Array.isArray(staff.stores) &&
      staff.stores.includes(store) &&
      Array.isArray(staff.features) &&
      staff.features.includes("payments");

    if (staff.active !== true ||
        (!fullAccess && !accountantAccess)) {
      return send(res, 403, { error: "Access denied" });
    }

    // Verify that invoice belongs to the requested branch.
    const invoiceResult = await upstream(
      "/rest/v1/sales" +
      "?bill_no=eq." + encodeURIComponent(bill) +
      "&store_name=eq." + encodeURIComponent(store) +
      "&select=id,amount&limit=2"
    );

    if (!invoiceResult.ok ||
        !Array.isArray(invoiceResult.body)) {
      return send(res, 503, {
        error: "Invoice lookup unavailable"
      });
    }

    if (invoiceResult.body.length !== 1) {
      return send(res, 422, {
        error: "Invoice not uniquely verified"
      });
    }

    const invoiceAmount = Number(invoiceResult.body[0].amount);

    if (!Number.isFinite(invoiceAmount) ||
        invoiceAmount <= 0 ||
        Number(amount) > invoiceAmount) {
      return send(res, 422, {
        error: "Amount exceeds verified invoice total"
      });
    }

    // Pending only. No balance, sales, or settlement updates.
    const saved = await upstream(
      "/rest/v1/kk_payment_requests",
      {
        method: "POST",
        prefer: "return=representation",
        body: {
          store_name: store,
          bill_no: bill,
          amount: Number(amount).toFixed(2),
          payment_method: method,
          payment_reference: reference,
          payment_date: date,
          idempotency_key: idem,
          entered_by_auth_user_id: userId,
          status: "pending"
        }
      }
    );

    if (!saved.ok) {
      if (saved.status === 409 &&
          saved.body?.code === "23505") {
        return send(res, 409, {
          error: "Duplicate submission key"
        });
      }

      return send(res, 503, {
        error: "Payment request could not be saved"
      });
    }

    const row = saved.body?.[0];

    if (!row?.id || row.status !== "pending") {
      return send(res, 503, {
        error: "Unexpected storage result"
      });
    }

    return send(res, 201, {
      id: row.id,
      status: "pending"
    });

  } catch (error) {
    console.error(
      "Payment request API failure:",
      error.message
    );

    return send(res, 503, {
      error: "Payment request temporarily unavailable"
    });
  }
};
