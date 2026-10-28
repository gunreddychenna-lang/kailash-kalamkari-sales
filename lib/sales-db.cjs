"use strict";
const { TLS_CODES } = require('./sales-db-diagnostic.cjs');

// Restricted PostgreSQL reader; never called before DEV owner/admin verification.
const PROJECT = "dqvqqrbvklpiibzqivbp";
const USER = "kk_sales_api_login";
const TABLES = Object.freeze({
  sales: 'id ASC',
  receivables: 'id ASC',
  bills_master: 'bill_no ASC, branch ASC, bill_date ASC, bill_amount ASC'
});

function validatedDatabaseConfig(raw) {
  if (!raw) throw new Error('Sales database connection is not configured');
  let u;
  try { u = new URL(raw); } catch { throw new Error('Invalid sales database connection'); }
  const correctHost = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname);
  if (u.protocol !== 'postgresql:' || !correctHost || u.port !== '6543' ||
      decodeURIComponent(u.username) !== `${USER}.${PROJECT}` ||
      !u.password || u.pathname !== '/postgres' || u.search || u.hash) {
    throw new Error('Sales database connection violates restricted configuration');
  }
  return {
    connectionString: raw,
    ssl: {
      ca: require("node:fs").readFileSync(
        require("node:path").join(
          __dirname, "..", "certs", "prod-ca-2021.crt"
        ),
        "utf8"
      ),
      rejectUnauthorized: true
    },
    connectionTimeoutMillis: 6000,
    query_timeout: 12000,
    statement_timeout: 12000,
    application_name: 'kk-owner-sales-readonly'
  };
}

async function readRows(datasets, injectedClientFactory) {
  const config = validatedDatabaseConfig(process.env.SALES_DATABASE_URL);
  const client = injectedClientFactory ? injectedClientFactory(config) : new (require('pg').Client)(config);
  const data = {};
  let connected = false;
  let inTransaction = false;
  let stage = 'connect';
  try {
    await client.connect(); connected = true;
    stage = 'begin_readonly';
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    inTransaction = true;
    stage = 'verify_role';
    const identity = await client.query(
      "SELECT current_user AS username, pg_has_role(current_user, 'kk_sales_reader', 'USAGE') AS authorized"
    );
    if (identity.rows?.length !== 1 || identity.rows[0].username !== USER ||
        identity.rows[0].authorized !== true) throw new Error('Database role identity mismatch');
    stage = 'read_datasets';
    for (const [table, , maxRows] of datasets) {
      if (!Object.prototype.hasOwnProperty.call(TABLES, table) || !Number.isSafeInteger(maxRows)) {
        throw new Error('Unexpected Sales dataset');
      }
      const totals = await client.query(`SELECT count(*)::integer AS count FROM public.${table}`);
      const total = Number(totals.rows?.[0]?.count);
      if (!Number.isSafeInteger(total) || total < 0 || total > maxRows) {
        throw new Error('Sales dataset exceeds safe count');
      }
      const result = await client.query(`SELECT * FROM public.${table} ORDER BY ${TABLES[table]} LIMIT $1`, [total + 1]);
      if (!Array.isArray(result.rows) || result.rows.length !== total) {
        throw new Error('Incomplete Sales dataset');
      }
      if (table !== 'bills_master') {
        const seen = new Set();
        for (const row of result.rows) {
          const id = row?.id == null ? null : String(row.id);
          if (!id || seen.has(id)) throw new Error('Duplicate/missing Sales row id');
          seen.add(id);
        }
      } else {
        for (const bill of result.rows) {
          if (bill?.bill_no == null || bill?.branch == null) {
            throw new Error('Incomplete invoice reference');
          }
        }
      }
      data[table] = result.rows;
    }
    stage = 'commit';
    await client.query('COMMIT'); inTransaction = false;
    return data;
  } catch (error) {
    error.kkStage = stage;
    const diagnostic = String(error?.message || "").toLowerCase();
    error.kkFailureType =
      TLS_CODES.has(error?.code) || /certificate|self.signed|ssl|tls/.test(diagnostic) ? "TLS" :
      /password|authentication|sasl|scram/.test(diagnostic) ? "AUTH" :
      /tenant|identifier|pooler/.test(diagnostic) ? "POOLER" :
      /timeout|timed out|connect|network|refused|unreachable/.test(diagnostic) ? "NETWORK" :
      "OTHER";
    if (inTransaction) { try { await client.query('ROLLBACK'); } catch { /* no-op */ } }
    throw error;
  } finally {
    if (connected) await client.end();
  }
}

module.exports = { readRows, validatedDatabaseConfig };
