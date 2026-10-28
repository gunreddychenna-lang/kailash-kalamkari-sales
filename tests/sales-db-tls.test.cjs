"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { readRows, validatedDatabaseConfig } = require('../lib/sales-db.cjs');
const { TLS_CODES, safeDatabaseCode } = require('../lib/sales-db-diagnostic.cjs');
const dashboard = require('../api/owner-dashboard.js');
const url = 'postgresql://kk_sales_api_login.dqvqqrbvklpiibzqivbp:dummy@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';

test('pg retains CA and certificate verification; URL TLS overrides are rejected', () => {
  const config = validatedDatabaseConfig(url);
  const client = new Client(config);
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  assert.equal(client.connectionParameters.ssl.ca, config.ssl.ca);
  assert.equal(client.connectionParameters.host, new URL(url).hostname);
  for (const query of ['sslmode=disable', 'sslmode=require', 'sslrootcert=other.crt',
    'sslcert=other.crt', 'sslkey=other.key', 'uselibpqcompat=true']) {
    assert.throws(() => validatedDatabaseConfig(url + '?' + query), /restricted/);
  }
});

test('known TLS codes survive redaction; arbitrary values and messages never do', () => {
  for (const code of TLS_CODES) assert.equal(safeDatabaseCode(code), code);
  for (const value of [undefined, null, {}, 'password=secret', 'ERR_TLS_CERT_ALTNAME_INVALID\nsecret']) {
    assert.equal(safeDatabaseCode(value), 'UNKNOWN');
  }
});

test('TLS connect failure is classified without queries or insecure retries', async () => {
  const saved = process.env.SALES_DATABASE_URL;
  process.env.SALES_DATABASE_URL = url;
  try {
    for (const code of TLS_CODES) {
      const error = Object.assign(new Error('opaque failure'), { code });
      let attempts = 0;
      await assert.rejects(readRows([], () => ({
        async connect() { attempts++; throw error; },
        async query() { assert.fail('TLS failure must not issue SQL'); }
      })), e => e === error && e.kkStage === 'connect' && e.kkFailureType === 'TLS');
      assert.equal(attempts, 1);
    }
  } finally {
    if (saved === undefined) delete process.env.SALES_DATABASE_URL;
    else process.env.SALES_DATABASE_URL = saved;
  }
});

test('dashboard logs precise TLS code while keeping response and logs free of secrets', async () => {
  const saved = { fetch: global.fetch, log: console.error,
    url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const logs = [];
  process.env.SUPABASE_URL = 'https://mock.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-key';
  global.fetch = async u => ({ ok: true, json: async () =>
    u.includes('/auth/v1/user') ? { id: 'owner' } : [{ role: 'owner', active: true }] });
  console.error = (...args) => logs.push(args);
  const handler = dashboard.createHandler(undefined, async () => {
    throw Object.assign(new Error('postgresql://secret-password@private-host'), {
      code: 'SELF_SIGNED_CERT_IN_CHAIN', kkStage: 'connect', kkFailureType: 'TLS'
    });
  });
  const res = { setHeader() {}, status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; } };
  try {
    await handler({ method: 'GET', headers: { authorization: 'Bearer fixture' } }, res);
    assert.equal(res.code, 503);
    assert.deepEqual(res.body, { error: 'Dashboard data unavailable' });
    assert.equal(logs[0][1].code, 'SELF_SIGNED_CERT_IN_CHAIN');
    assert.equal(logs[0][1].stage, 'connect');
    assert.doesNotMatch(JSON.stringify([logs, res.body]), /secret-password|private-host|fixture-key/);
  } finally {
    global.fetch = saved.fetch; console.error = saved.log;
    for (const [name, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_SERVICE_ROLE_KEY', saved.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
