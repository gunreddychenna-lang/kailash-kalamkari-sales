"use strict";

// Log only known codes, never messages (which may contain connection secrets).
const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_CERTIFICATE_VERIFY_FAILED'
]);

function safeDatabaseCode(value) {
  if (typeof value !== 'string') return 'UNKNOWN';
  return TLS_CODES.has(value) ||
    /^(?:[0-9A-Z]{5}|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNRESET)$/.test(value)
    ? value : 'UNKNOWN';
}

module.exports = { TLS_CODES, safeDatabaseCode };
