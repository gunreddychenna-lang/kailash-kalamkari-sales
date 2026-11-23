"use strict";

const { Client } = require("pg");

const TABLES = Object.freeze({
  sales: {
    source: "public.sales",
    order: "id ASC"
  },
  receivables: {
    source: "public.receivables",
    order: "id ASC"
  },
  bills_master: {
    source: "public.bills_master_dynamic_preview",
    order: "bill_no ASC, branch ASC, bill_date ASC, bill_amount ASC"
  }
});

function config(password) {
  if (!password || typeof password !== "string") {
    throw new Error("Local database password required");
  }

  return {
    host: "127.0.0.1",
    port: 55432,
    database: "kk_sales_dev",
    user: "kk_sales_app_reader",
    password,
    ssl: false,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
    statement_timeout: 15000,
    application_name: "kk-local-sales-reader"
  };
}

async function readRows(datasets, password) {
  if (!Array.isArray(datasets) || datasets.length === 0) {
    throw new Error("Datasets required");
  }

  const client = new Client(config(password));
  const output = {};
  let connected = false;
  let transaction = false;

  try {
    await client.connect();
    connected = true;

    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
    );
    transaction = true;

    const identity = await client.query(
      "SELECT current_user AS username, current_database() AS database, inet_server_port() AS port"
    );

    const row = identity.rows[0];

    if (
      row?.username !== "kk_sales_app_reader" ||
      row?.database !== "kk_sales_dev" ||
      Number(row?.port) !== 55432
    ) {
      throw new Error("Local database identity mismatch");
    }

    for (const entry of datasets) {
      if (!Array.isArray(entry) || entry.length !== 3) {
        throw new Error("Invalid dataset specification");
      }

      const [name, , maxRows] = entry;
      const table = TABLES[name];

      if (
        !table ||
        Object.prototype.hasOwnProperty.call(output, name) ||
        !Number.isSafeInteger(maxRows) ||
        maxRows < 0 ||
        maxRows > 100000
      ) {
        throw new Error("Unauthorized dataset");
      }

      const countResult = await client.query(
        `SELECT COUNT(*)::integer AS count FROM ${table.source}`
      );

      const count = Number(countResult.rows[0]?.count);

      if (!Number.isSafeInteger(count) || count > maxRows) {
        throw new Error("Dataset exceeds safe limit");
      }

      const result = await client.query(
        `SELECT * FROM ${table.source}
         ORDER BY ${table.order}
         LIMIT $1`,
        [count + 1]
      );

      if (result.rows.length !== count) {
        throw new Error("Incomplete dataset");
      }

      output[name] = result.rows;
    }

    await client.query("COMMIT");
    transaction = false;

    return output;
  } catch (error) {
    if (transaction) {
      try { await client.query("ROLLBACK"); }
      catch (_) {}
    }
    throw error;
  } finally {
    if (connected) await client.end();
  }
}

module.exports = { config, readRows };
