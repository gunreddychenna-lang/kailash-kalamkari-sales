# Kailash Kalamkari Sales Portal

KK-CEO-003: Owner/Admin sales and inventory LOCAL REVIEW CANDIDATE.

NOT APPROVED FOR PRODUCTION.

See [CEO review and rollback package](review/CEO-REVIEW.md) for current scope, evidence, DEV startup instructions and release blockers. Run only `node release-server.cjs` with a separate DEV project. Do not deploy the full source directory as static/serverless hosting: deferred write APIs and legacy pages remain there.

Tests: `node --test tests/*.test.cjs`

Do not execute candidate SQL, change production data/schema, merge main or deploy production without separate approval.
