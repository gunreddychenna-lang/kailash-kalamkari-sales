"use strict";

// KK-CEO-003: ISOLATED DEVELOPMENT ONLY.
// Required SERVER environment variables:
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY
// SUPABASE_ANON_KEY
//
// Never place service-role credentials in browser code.

function respond(res, code, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).json(body);
}

const invalid = (res) =>
  respond(res, 401, { error: "Invalid credentials." });

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return respond(res, 405, { error: "Method not allowed" });
  }

  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!base || !serviceKey || !anonKey) {
    return respond(res, 503, {
      error: "Authentication backend unavailable"
    });
  }

  const body = req.body;

  if (!body || Array.isArray(body) ||
      typeof body !== "object") {
    return invalid(res);
  }

  const loginId = String(body.loginId || "")
    .trim().toLowerCase();
  const password = body.password;

  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(loginId) ||
      typeof password !== "string" ||
      password.length < 1 ||
      password.length > 128) {
    return invalid(res);
  }

  async function upstream(path, key, options = {}) {
    const response = await fetch(base + path, {
      method: options.method || "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      ...(options.body
        ? { body: JSON.stringify(options.body) }
        : {})
    });

    if (!response.ok) return null;

    return response.json().catch(() => null);
  }

  try {
    // Resolve login ID privately. Never return account email.
    const profiles = await upstream(
      "/rest/v1/kk_staff_access" +
      "?login_id=eq." + encodeURIComponent(loginId) +
      "&select=auth_user_id,active,role",
      serviceKey
    );

    if (!Array.isArray(profiles) ||
        profiles.length !== 1 ||
        profiles[0].active !== true ||
        !["owner", "admin"]
          .includes(profiles[0].role) ||
        !profiles[0].auth_user_id) {
      return invalid(res);
    }

    const authId = profiles[0].auth_user_id;

    const authUser = await upstream(
      "/auth/v1/admin/users/" + encodeURIComponent(authId),
      serviceKey
    );

    if (!authUser?.email) return invalid(res);

    // Actual password verification happens in Supabase Auth.
    const result = await upstream(
      "/auth/v1/token?grant_type=password",
      anonKey,
      {
        method: "POST",
        body: {
          email: authUser.email,
          password
        }
      }
    );

    if (!result?.access_token ||
        !result?.refresh_token ||
        result.user?.id !== authId) {
      return invalid(res);
    }

    // Return session tokens, never service credentials or email.
    return respond(res, 200, {
      access_token: result.access_token,
      refresh_token: result.refresh_token
    });

  } catch (_) {
    return respond(res, 503, {
      error: "Authentication temporarily unavailable"
    });
  }
};