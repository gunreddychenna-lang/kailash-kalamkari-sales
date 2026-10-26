"use strict";

// KK-CEO-003: isolated development only.
// Owner/Admin read-only historical sales endpoint.
// Never expose SUPABASE_SERVICE_ROLE_KEY in browser code.

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(body);
}

async function request(base, secret, path, options = {}) {
  const response = await fetch(base + path, {
    method: "GET",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${options.jwt || secret}`,
      Accept: "application/json",
      ...(options.range
        ? { Range: options.range, "Range-Unit": "items" }
        : {})
    }
  });

  if (!response.ok) {
    throw new Error("Upstream request failed");
  }

  return response.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, {
      error: "Method not allowed"
    });
  }

  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!base || !secret) {
    return send(res, 503, {
      error: "Backend unavailable"
    });
  }

  const authorization = req.headers?.authorization || "";
  const match = authorization.match(/^Bearer ([^\s]+)$/i);

  if (!match) {
    return send(res, 401, {
      error: "Authentication required"
    });
  }

  try {
    // Validate caller JWT with Supabase Auth.
    const identity = await request(
      base,
      secret,
      "/auth/v1/user",
      { jwt: match[1] }
    );

    if (!identity?.id) {
      return send(res, 401, {
        error: "Invalid session"
      });
    }

    // Resolve role from trusted server-side database.
    const profiles = await request(
      base,
      secret,
      "/rest/v1/kk_staff_access" +
      "?auth_user_id=eq." +
      encodeURIComponent(identity.id) +
      "&select=role,active"
    );

    if (!Array.isArray(profiles) || profiles.length !== 1) {
      return send(res, 403, {
        error: "Access denied"
      });
    }

    const profile = profiles[0];

    if (
      profile.active !== true ||
      !["owner", "admin"].includes(profile.role)
    ) {
      return send(res, 403, {
        error: "Access denied"
      });
    }

    const sales = [];
    const pageSize = 500;
    const maxRows = 25000;

    for (let offset = 0; offset < maxRows; offset += pageSize) {
      const end = offset + pageSize - 1;

      const rows = await request(
        base,
        secret,
        "/rest/v1/sales?select=*&order=id.asc",
        { range: `${offset}-${end}` }
      );

      if (!Array.isArray(rows)) {
        throw new Error("Unexpected sales response");
      }

      sales.push(...rows);

      if (rows.length < pageSize) {
        return send(res, 200, {
          sales,
          count: sales.length,
          read_only: true
        });
      }
    }

    // Never silently present a truncated financial dataset.
    return send(res, 503, {
      error: "Sales dataset exceeds configured safe limit"
    });

  } catch (_) {
    return send(res, 503, {
      error: "Secure sales service unavailable"
    });
  }
};
