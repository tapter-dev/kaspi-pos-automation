# Operations runbook

## First checks

1. Check `/ready`; a 503 means PostgreSQL or Redis is unavailable.
2. Open `/admin` and inspect waiting/failed payment and webhook job counts.
3. Correlate structured HTTP logs with `X-Request-Id` or the `requestId` in an error response.
4. Inspect the affected tenant's audit log and webhook delivery history.

## Payments remain pending

- Confirm the worker is running and Redis answers `PING`.
- Restarting the worker is safe; its startup reconciliation queues database-backed pending work.
- Check the tenant Kaspi connection. A `displaced` state means Kaspi rejected the session; reconnect from the customer dashboard.
- Do not manually mark a payment paid. If provider status cannot be proven, leave it `unknown` and reconcile against Kaspi records.

## Webhook failures

- The dashboard records HTTP status, duration, a capped response body, and the latest error.
- Test the endpoint and verify public DNS, HTTPS, and a response within ten seconds.
- Confirm the receiver uses the exact raw body and timestamp header when calculating HMAC.
- Rotate a leaked secret, update the receiver, then replay failed deliveries.
- Endpoints disable after ten consecutive failures; re-enable only after fixing the receiver.

## Suspected credential exposure

- Kaspi session: disconnect/reconnect the tenant and rotate device identity only if necessary; device rotation invalidates every session using that shared identity.
- API key: revoke it in the dashboard and create a replacement.
- Webhook secret: rotate it from the endpoint controls.
- Platform secret: rotate through the secret manager and redeploy. Rotating `TOKEN_SECRET_KEY` requires a planned Kaspi reconnection for all tenants unless a key-migration procedure is used.

## Tenant suspension

Platform administrators can suspend a customer from `/admin`. Suspension invalidates that tenant's dashboard sessions and makes API-key authentication fail. Reactivation does not restore revoked sessions; users must sign in again.

## Database changes

Never run migrations with the runtime role. Migrations are forward-only and tracked in `schema_migrations`. Back up first, run `npm run db:migrate` once with `DATABASE_MIGRATION_URL`, and verify `/ready`, the worker, and a test payment afterward.
