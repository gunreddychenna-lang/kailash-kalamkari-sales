"use strict";
// DEV Owner/Admin-authenticated, read-only Google Drive-backed catalogue inventory.
// Uses only public/read-only catalogue credentials, never production sales credentials.
const DEV_URL = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const DEV_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
const CATALOGUE_URL = () => process.env.CATALOGUE_SUPABASE_URL?.replace(/\/$/, "");
const CATALOGUE_KEY = () => process.env.CATALOGUE_SUPABASE_ANON_KEY;

function reply(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(data);
}
async function jsonRequest(url, key, bearer) {
  const response = await fetch(url, {
    method: "GET",
    headers: { apikey: key, Authorization: `Bearer ${bearer}`, Accept: "application/json" }
  });
  if (!response.ok) throw new Error("Upstream rejected request");
  return response.json();
}
async function catalogueRows(base, key) {
  const all = [], codes = new Set();
  let expected = null;
  const cols = "code,fabric,qty,department,is_available,store_code";
  for (let offset = 0; offset < 25000; ) {
    const response = await fetch(
      `${base}/rest/v1/products?select=${cols}&is_available=eq.true&qty=gt.0&order=code.asc&limit=500&offset=${offset}`,
      { method: "GET", headers: {
        apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", Prefer: "count=exact"
      }}
    );
    if (!response.ok) throw new Error("Catalogue unavailable");
    const rows = await response.json();
    const countRange = response.headers?.get("content-range") || "";
    if (!Array.isArray(rows) || rows.length > 500) throw new Error("Invalid inventory page");
    if (countRange === "*/0" && offset === 0 && rows.length === 0) return [];
    const m = /^(\d+)-(\d+)\/(\d+)$/.exec(countRange);
    if (!m) throw new Error("Incomplete inventory count");
    const [start, end, total] = m.slice(1).map(Number);
    if (![start, end, total].every(Number.isSafeInteger) || total > 25000 ||
      start !== offset || end !== offset + rows.length - 1 || !rows.length ||
      (expected !== null && expected !== total)) throw new Error("Inventory changed mid-read");
    expected = total;
    for (const row of rows) {
      if (typeof row.code !== "string" || !row.code.trim() || codes.has(row.code) ||
        !Number.isFinite(Number(row.qty)) || Number(row.qty) <= 0 || row.is_available !== true) {
        throw new Error("Invalid inventory record");
      }
      codes.add(row.code);
      // Existing stock UI compatibility, with no fabricated theme, design, or colour.
      all.push({ id: row.code, code: row.code, department: row.department || "Unspecified",
        fabric_name: row.fabric || "Unspecified", design_name: "Not Defined", theme: "Not Defined",
        colour: "Not Defined", qty: Number(row.qty), branch: row.store_code || "Unassigned",
        store_code: row.store_code || null });
    }
    if (all.length === total) return all;
    if (all.length > total) throw new Error("Unexpected inventory total");
    offset += rows.length;
  }
  throw new Error("Inventory limit reached");
}
async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return reply(res, 405, {error:"Method not allowed"});
  }
  const base = DEV_URL(), secret = DEV_KEY();
  const catalog = CATALOGUE_URL(), publicKey = CATALOGUE_KEY();
  const token = (req.headers?.authorization || "").match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!base || !secret || !catalog || !publicKey ||
      base.includes("dqvqqrbvklpiibzqivbp") ||
      !/^https:\/\/ehovvhckvgwfkbgfvchi\.supabase\.co$/.test(catalog)) {
    return reply(res, 503, {error:"Inventory backend unavailable"});
  }
  if (!token) return reply(res, 401, {error:"Authentication required"});
  try {
    const user = await jsonRequest(base + "/auth/v1/user", secret, token);
    if (!user?.id) return reply(res, 401, {error:"Invalid session"});
    const staff = await jsonRequest(
      base + "/rest/v1/kk_staff_access?auth_user_id=eq." +
        encodeURIComponent(user.id) + "&select=role,active", secret, secret);
    if (!Array.isArray(staff) || staff.length !== 1 || staff[0].active !== true ||
      !["owner","admin"].includes(staff[0].role)) {
      return reply(res, 403, {error:"Access denied"});
    }
    const saree_inventory = await catalogueRows(catalog, publicKey);
    const response = { saree_inventory, counts:{saree_inventory:saree_inventory.length},
      source:"catalogue_products", read_only:true, source_note:"Catalogue sync; not physically audited" };
    if (Buffer.byteLength(JSON.stringify(response)) > 3500000) throw Error("Response too large");
    return reply(res, 200, response);
  } catch (_) {
    return reply(res, 503, {error:"Inventory data unavailable"});
  }
}
module.exports = handler;
