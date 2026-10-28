"use strict";
// Isolated DEV/preview server. Exposes only the reviewed first-release surface.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assets = new Set(['index.html', 'stock.html', 'app.js', 'styles.css',
  'common.js', 'security-auth.js', 'security-permissions.js', 'staff-config.js', 'payments.html', 'payments.js']);
const endpoints = {
  '/api/payments': require('./api/payments.js'),
  '/api/owner-dashboard': require('./api/owner-dashboard.js'),
  '/api/owner-inventory': require('./api/owner-inventory.js'),
  '/api/staff-login': require('./api/staff-login.js'),
  '/api/payment-requests': require('./api/payment-requests.js')
};
const productionHost = 'dqvqqrbvklpiibzqivbp.supabase.co';
function createServer({ base = process.env.SUPABASE_URL,
  anon = process.env.SUPABASE_ANON_KEY, root = __dirname } = {}) {
  if (!base || !anon || new URL(base).hostname === productionHost) {
    throw new Error('A separate DEV Supabase URL and public anon key are required. Production is blocked.');
  }
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res; };
    try {
      const url = new URL(req.url, 'http://localhost');
      const endpoint = endpoints[url.pathname];
      if (endpoint) {
        if (['/api/staff-login', '/api/payment-requests', '/api/payments'].includes(url.pathname) && req.method === 'POST') {
          let size = 0; const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 16384) return res.status(413).json({error:'Request too large'});
            chunks.push(chunk);
          }
          try { req.body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { return res.status(400).json({error:'Invalid JSON'}); }
        }
        return await endpoint(req, res);
      }
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!assets.has(file)) return res.status(404).json({error:'Not available in this release'});
      if (!['GET','HEAD'].includes(req.method)) {
        res.setHeader('Allow','GET, HEAD');
        return res.status(405).json({error:'Method not allowed'});
      }
      let content = fs.readFileSync(path.join(root, file), 'utf8');
      // Serve isolated public authentication settings dynamically.
      if (file === 'staff-config.js') {
        content = 'window.KK_STAFF_CONFIG = ' +
          JSON.stringify({ url: base, anonKey: anon }).replace(/</g, '\\u003c') +
          ';';
      }
      res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' :
        file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch {
      if (!res.writableEnded) res.status(503).json({error:'Preview unavailable'});
    }
  });
}
module.exports = { createServer, assets };
if (require.main === module) {
  const port = Number(process.env.PORT || 8766);
  createServer().listen(port, '127.0.0.1', () => console.log(`Owner/Admin DEV preview: http://127.0.0.1:${port}`));
}
