"use strict";

module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  const project = process.env.VERCEL_ENV === "production"
    ? "dqvqqrbvklpiibzqivbp"
    : "yiaipfquxyrqxvkvjykp";

  if (
    url !== `https://${project}.supabase.co` ||
    !anonKey ||
    typeof anonKey !== "string" ||
    !anonKey.trim()
  ) {
    return res.status(503).end();
  }

  return res.status(200).end(
    "window.KK_STAFF_CONFIG = " +
    JSON.stringify({ url, anonKey }) + ";"
  );
};
