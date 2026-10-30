"use strict";

const DEV = "https://yiaipfquxyrqxvkvjykp.supabase.co";
const PROD = "https://dqvqqrbvklpiibzqivbp.supabase.co";

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const send = (status, data) => res.status(status).json(data);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(405, { error: "Method not allowed" });
  }

  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const allowed =
    (process.env.VERCEL_ENV === "preview" && base === DEV) ||
    (process.env.VERCEL_ENV === "production" && base === PROD);

  if (!secret || !allowed) {
    return send(503, { error: "Invoice search unavailable" });
  }

  const token = (req.headers.authorization || "")
    .match(/^Bearer ([^\s]+)$/i)?.[1];

  if (!token) return send(401, { error: "Sign in required" });

  async function get(path, jwt) {
    const response = await fetch(base + path, {
      headers: {
        apikey: secret,
        Authorization: `Bearer ${jwt}`,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) throw new Error("Upstream unavailable");
    return response.json();
  }

  try {
    const user = await get("/auth/v1/user", token);
    if (!user?.id) return send(401, { error: "Invalid session" });

    const staff = await get(
      "/rest/v1/kk_staff_access?auth_user_id=eq." +
      encodeURIComponent(user.id) +
      "&select=role,active",
      secret
    );

    if (
      !Array.isArray(staff) ||
      staff.length !== 1 ||
      staff[0].active !== true ||
      !["owner", "admin"].includes(staff[0].role)
    ) {
      return send(403, { error: "Owner or Admin required" });
    }

    const url = new URL(req.url, "http://localhost");
    const search = (url.searchParams.get("search") || "").trim();
    const branch = url.searchParams.get("branch") || "All";
    const page = Number(url.searchParams.get("page") || "1");

    if (
      search.length > 60 ||
      !/^[a-zA-Z0-9 _-]*$/.test(search) ||
      !["All", "Main Branch", "KHPS"].includes(branch) ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 100
    ) {
      return send(400, { error: "Invalid filters" });
    }

    const params = new URLSearchParams();
    params.set(
      "select",
      "bill_no,branch,bill_date,bill_amount,customer_name,sm_name,channel"
    );
    params.set("order", "bill_date.desc,bill_no.asc,branch.asc");
    params.set("limit", "50");
    params.set("offset", String((page - 1) * 50));

    if (branch !== "All") params.set("branch", "eq." + branch);

    if (search) {
      params.set(
        "or",
        `(bill_no.ilike.*${search}*,customer_name.ilike.*${search}*)`
      );
    }

    const rows = await get(
      "/rest/v1/bills_master?" + params.toString(),
      secret
    );

    if (!Array.isArray(rows) || rows.length > 50) {
      throw new Error("Invalid invoice response");
    }

    // Read original sale payment type, without modifying Sales records.
    let saleModes = [];
    if (rows.length) {
      const billNumbers = [...new Set(rows.map(r => r.bill_no))];
      const params = new URLSearchParams();
      params.set("select", "bill_no,bill_date,store_name,pay_mode");
      params.set(
        "bill_no",
        "in.(" + billNumbers.map(v =>
          '"' + String(v).replace(/["\\]/g, "") + '"'
        ).join(",") + ")"
      );
      params.set("limit", "1000");

      try {
        const matches = await get(
          "/rest/v1/sales?" + params.toString(),
          secret
        );
        if (Array.isArray(matches)) saleModes = matches;
      } catch (_) {
        // DEV fixtures may not have pay_mode yet.
      }
    }

    const invoices = rows.map(row => {
      const matching = saleModes.filter(s =>
        s.bill_no === row.bill_no &&
        s.bill_date === row.bill_date &&
        s.store_name === row.branch
      );
      const modes = [...new Set(
        matching.map(s => String(s.pay_mode || "").trim())
          .filter(Boolean)
      )];

      return {
        ...row,
        original_payment_type: modes.length
          ? modes.join(" + ")
          : null
      };
    });

    return send(200, {
      invoices,
      page,
      has_more: rows.length === 50,
      read_only: true
    });
  } catch (_) {
    return send(503, { error: "Invoice search unavailable" });
  }
};