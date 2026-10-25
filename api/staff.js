"use strict";

// KK-CEO-003 - Development only.
// Environment variables (server only):
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY
//
// Owner/Admin: manage employee accounts.
// Employee: cannot access this endpoint.
// Never expose service-role keys in browser code.

const STORES = ["Main Branch", "KHPS"];
const FEATURES = [
  "dashboard", "sales_entry", "crm", "inventory",
  "attendance", "payments", "payroll", "reports"
];

function send(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PATCH");
    return send(res, 405, { error: "Method not allowed" });
  }

  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!base || !secret) {
    return send(res, 503, { error: "Backend not configured" });
  }

  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer ([^\s]+)$/i);

  if (!match) {
    return send(res, 401, { error: "Authentication required" });
  }

  const jwt = match[1];

  async function request(path, options = {}) {
    const response = await fetch(base + path, {
      ...options,
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    const raw = await response.text();
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch (_) {
      throw new Error("Invalid upstream response");
    }

    return { ok: response.ok, status: response.status, body };
  }

  try {
    // Validate the caller JWT with Supabase Auth.
    // The caller's token is used ONLY for identity verification.
    const identity = await request("/auth/v1/user", {
      headers: { Authorization: `Bearer ${jwt}` }
    });

    const userId = identity.body?.id;

    if (!identity.ok || !userId) {
      return send(res, 401, { error: "Invalid session" });
    }

    // Server-side profile lookup: browser-provided roles are ignored.
    const caller = await request(
      "/rest/v1/kk_staff_access" +
      "?auth_user_id=eq." + encodeURIComponent(userId) +
      "&select=role,active"
    );

    if (!caller.ok) {
      return send(res, 503, { error: "Staff authorization unavailable" });
    }

    const profile = caller.body?.[0];

    if (!profile?.active ||
        !["owner", "admin"].includes(profile.role)) {
      return send(res, 403, { error: "Access denied" });
    }

    if (req.method === "GET") {
      const result = await request(
        "/rest/v1/kk_staff_access" +
        "?select=id,login_id,display_name,employee_id," +
        "role,stores,features,active,created_at" +
        "&role=eq.employee&order=created_at.desc"
      );

      if (!result.ok) {
        return send(res, 500, { error: "Unable to load employees" });
      }

      return send(res, 200, { employees: result.body });
    }

    const input = req.body || {};

    if (req.method === "POST") {
      const loginId = String(input.loginId || "")
        .trim().toLowerCase();
      const displayName = String(input.displayName || "").trim();
      const email = String(input.email || "").trim().toLowerCase();
      const password = String(input.password || "");

      if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(loginId) ||
          !displayName || displayName.length > 100 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          password.length < 12 || password.length > 128) {
        return send(res, 400, {
          error: "Valid login ID, name, email and strong password required"
        });
      }

      const stores = input.stores;
      const features = input.features;

      if (!Array.isArray(stores) ||
          !Array.isArray(features) ||
          !stores.every(s => STORES.includes(s)) ||
          !features.every(f => FEATURES.includes(f))) {
        return send(res, 400, { error: "Invalid permissions" });
      }

      const created = await request("/auth/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          email_confirm: true
        })
      });

      if (!created.ok || !created.body?.id) {
        return send(res, 409, { error: "Unable to create Auth account" });
      }

      const authId = created.body.id;

      const saved = await request("/rest/v1/kk_staff_access", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          auth_user_id: authId,
          login_id: loginId,
          display_name: displayName,
          role: "employee",
          stores: [...new Set(stores)],
          features: [...new Set(features)],
          active: true
        })
      });

      if (!saved.ok) {
        // Compensate if staff-profile insertion fails.
        const cleanup = await request(
          "/auth/v1/admin/users/" + encodeURIComponent(authId),
          { method: "DELETE" }
        );

        if (!cleanup.ok) {
          console.error(
            "Staff provisioning cleanup requires administrator review"
          );
        }

        return send(res, 500, {
          error: "Employee profile creation failed"
        });
      }

      return send(res, 201, {
        success: true,
        employee: {
          loginId,
          displayName,
          stores: [...new Set(stores)],
          features: [...new Set(features)]
        }
      });
    }

    // PATCH: modify ONLY existing employee permission profiles.
    const id = String(input.id || "");

    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return send(res, 400, { error: "Invalid employee ID" });
    }

    const patch = {};

    if (Object.hasOwn(input, "stores")) {
      if (!Array.isArray(input.stores) ||
          !input.stores.every(s => STORES.includes(s))) {
        return send(res, 400, { error: "Invalid stores" });
      }

      patch.stores = [...new Set(input.stores)];
    }

    if (Object.hasOwn(input, "features")) {
      if (!Array.isArray(input.features) ||
          !input.features.every(f => FEATURES.includes(f))) {
        return send(res, 400, { error: "Invalid features" });
      }

      patch.features = [...new Set(input.features)];
    }

    if (Object.hasOwn(input, "active")) {
      if (typeof input.active !== "boolean") {
        return send(res, 400, { error: "Invalid active status" });
      }

      patch.active = input.active;
    }

    if (!Object.keys(patch).length) {
      return send(res, 400, { error: "No changes supplied" });
    }

    patch.updated_at = new Date().toISOString();

    const updated = await request(
      "/rest/v1/kk_staff_access" +
      "?id=eq." + encodeURIComponent(id) +
      "&role=eq.employee",
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch)
      }
    );

    if (!updated.ok) {
      return send(res, 500, { error: "Unable to update employee" });
    }

    if (!Array.isArray(updated.body) || updated.body.length !== 1) {
      return send(res, 404, { error: "Employee not found" });
    }

    return send(res, 200, { success: true });
  } catch (error) {
    console.error("Staff API failure:", error.message);
    return send(res, 500, { error: "Internal server error" });
  }
};