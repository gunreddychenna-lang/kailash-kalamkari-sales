# Preview TLS investigation — 28 October 2026

Base: `engineering/kk-ceo-006-checkpoint`, `8c45cda39204f5eddbbbe8df701e1d22dcb61655`.

## Findings

- Earlier conversation reported `stage: connect`, `failureType: TLS`; the precise error code was unavailable.
- The bundled Supabase Root 2021 CA is valid until 26 April 2031.
- Credential-free PostgreSQL TLS negotiation to `aws-0-ap-south-1.pooler.supabase.com:6543` verified both the chain and hostname with the bundled CA, using TLS 1.3.
- Node 24.18.0 and the locked pg 8.16.3 configuration reached password authentication on that endpoint using a deliberately invalid password. No SQL was issued. The aws-1 endpoint also completed TLS, then returned a tenant lookup error.
- Existing Preview `dpl_GhGXFJCfg9osykephk5H97jmWru2` identifies the same base commit. Its source-file API was unavailable; deployed file contents were not independently compared.
- The authenticated Preview dashboard completed a fresh UI refresh and displayed all-time revenue of INR 4,51,27,356. No browser console errors were captured after refresh. This does not independently establish raw counts of 5,051 sales, 67 receivables, or 2,183 bills.
- Vercel logs returned no entries for the recent query. Wider queries were rejected by retention limits. The original failure is not reproduced and its root cause remains unconfirmed.

## Scoped change

Preserve known certificate failure codes in server diagnostics instead of replacing them with UNKNOWN. Classify those codes as TLS even when error wording is opaque. Continue logging no raw error messages, URLs, passwords, or certificates. Browser responses remain generic 503 errors.

No CA replacement, security downgrade, retry fallback, authentication change, SQL change, or financial-data mutation. This is a diagnostic fix, not a demonstrated repair of the historical TLS failure.

## Validation

`node --test tests/*.test.cjs`: 110 passed, zero failed. New tests verify pg retains the CA and verification policy, URL TLS overrides are rejected, TLS failures issue no SQL or insecure retries, and diagnostic output excludes secrets.

Before declaring the historical issue resolved, reproduce or obtain a precise server error on an affected Preview and reconcile authenticated raw dataset counts. No production deployment or main merge is authorized by this change.

References: https://node-postgres.com/features/ssl and https://supabase.com/docs/guides/platform/ssl-enforcement.
