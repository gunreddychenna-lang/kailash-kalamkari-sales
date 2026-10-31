"use strict";

const DEV = "https://yiaipfquxyrqxvkvjykp.supabase.co";
const PROD = "https://dqvqqrbvklpiibzqivbp.supabase.co";

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const send = (status, data) => res.status(status).json(data);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(405, { error: "Method not allowed" });
  }

  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const devAllowed =
    process.env.VERCEL_ENV === "preview" &&
    base === DEV;

  const prodAllowed =
    process.env.VERCEL_ENV === "production" &&
    base === PROD &&
    process.env.PAYMENTS_WRITE_ENABLED === "true";

  if (!secret || (!devAllowed && !prodAllowed)) {
    return send(503, { error: "Opening approval disabled" });
  }

  const token = (req.headers.authorization || "")
    .match(/^Bearer ([^\s]+)$/i)?.[1];

  if (!token) return send(401, { error: "Login required" });

  const b = req.body;

  if (!b || typeof b !== "object" || Array.isArray(b) ||
      Object.keys(b).some(k =>
        !["bill_no", "branch", "opening_paid", "evidence"].includes(k)
      ) ||
      typeof b.bill_no !== "string" ||
      !(devAllowed
        ? /^TEST-[A-Za-z0-9_-]+$/.test(b.bill_no)
        : /^[A-Za-z0-9_-]{1,64}$/.test(b.bill_no)) ||
      !["Main Branch", "KHPS"].includes(b.branch) ||
      !["string", "number"].includes(typeof b.opening_paid) ||
      !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(String(b.opening_paid)) ||
      typeof b.evidence !== "string" ||
      b.evidence.trim().length < 3 ||
      b.evidence.trim().length > 500) {
    return send(400, { error: "Invalid approval details" });
  }

  async function upstream(path, bearer, body) {
    const response = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        apikey: secret,
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json"
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000)
    });

    return {
      ok: response.ok,
      status: response.status,
      data: await response.json()
    };
  }

  try {
    const auth = await upstream("/auth/v1/user", token);

    if (!auth.ok || !auth.data?.id) {
      return send(401, { error: "Invalid session" });
    }

    const staff = await upstream(
      "/rest/v1/kk_staff_access?auth_user_id=eq." +
      encodeURIComponent(auth.data.id) +
      "&select=role,active",
      secret
    );

    if (!staff.ok || !Array.isArray(staff.data) ||
        staff.data.length !== 1 ||
        staff.data[0].active !== true ||
        !["owner", "admin"].includes(staff.data[0].role)) {
      return send(403, { error: "Owner/Admin only" });
    }

    const result = await upstream(
      "/rest/v1/rpc/kk_approve_opening_balance",
      secret,
      {
        p_actor: auth.data.id,
        p_bill: b.bill_no,
        p_branch: b.branch,
        p_paid: b.opening_paid,
        p_evidence: b.evidence.trim()
      }
    );

    if (!result.ok) {
      if (result.data?.code === "23505") {
        return send(409, {
          error: "Opening balance already approved"
        });
      }

      if (result.data?.code === "42501") {
        return send(403, { error: "Access denied" });
      }

      if (result.data?.code === "22023") {
        return send(422, {
          error: result.data.message || "Approval rejected"
        });
      }

      return send(503, { error: "Approval unavailable" });
    }

    return send(200, result.data);

  } catch {
    return send(503, { error: "Approval service unavailable" });
  }
};