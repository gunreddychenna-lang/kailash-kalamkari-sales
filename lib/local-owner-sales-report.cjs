"use strict";

function validateDate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid date");
  }

  const parsed = new Date(value + "T00:00:00Z");

  if (!Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid date");
  }

  return value;
}

async function getOwnerSalesReport(client, filters = {}) {
  if (!client || typeof client.query !== "function") {
    throw new Error("Database client required");
  }

  const from = validateDate(filters.from);
  const to = validateDate(filters.to);

  if (from && to && from > to) {
    throw new Error("Invalid date range");
  }

  const conditions = [
    "($1::date IS NULL OR bill_date >= $1::date)",
    "($2::date IS NULL OR bill_date <= $2::date)"
  ];

  const where = conditions.join(" AND ");
  const params = [from, to];

  const summary = await client.query(`
    SELECT
      COUNT(*)::integer AS sale_lines,
      COUNT(DISTINCT (store_name, bill_no))::integer
        AS invoice_count,
      COALESCE(SUM(amount), 0)::text AS net_sales,
      COALESCE(
        SUM(amount) FILTER (WHERE amount > 0), 0
      )::text AS positive_sales,
      COALESCE(
        SUM(amount) FILTER (WHERE amount < 0), 0
      )::text AS negative_sales,
      COUNT(*) FILTER (WHERE amount < 0)::integer
        AS negative_lines
    FROM public.sales
    WHERE ${where}
  `, params);

  const branches = await client.query(`
    SELECT
      COALESCE(NULLIF(BTRIM(store_name), ''), 'UNMAPPED')
        AS branch,
      COUNT(*)::integer AS sale_lines,
      COUNT(DISTINCT bill_no)::integer AS invoice_count,
      COALESCE(SUM(amount), 0)::text AS net_sales
    FROM public.sales
    WHERE ${where}
    GROUP BY 1
    ORDER BY 1
  `, params);

  const staff = await client.query(`
    SELECT
      COALESCE(NULLIF(BTRIM(store_name), ''), 'UNMAPPED')
        AS branch,
      COALESCE(NULLIF(BTRIM(agent_name), ''), 'UNMAPPED')
        AS staff_name,
      COUNT(*)::integer AS sale_lines,
      COALESCE(SUM(amount), 0)::text AS net_sales
    FROM public.sales
    WHERE ${where}
    GROUP BY 1, 2
    ORDER BY 1, SUM(amount) DESC
  `, params);

  return {
    period: { from, to },
    summary: summary.rows[0],
    branches: branches.rows,
    staff: staff.rows
  };
}

module.exports = Object.freeze({
  getOwnerSalesReport
});
