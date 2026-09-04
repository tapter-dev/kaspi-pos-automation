# Production deployment

## Required services

- Node.js 20.6 or newer (the container uses Node 22)
- PostgreSQL 15 or newer
- Redis 7 or newer with persistence enabled
- a TLS-terminating ingress or load balancer
- SMTP credentials if invitation, verification, and password-reset email should be delivered

Run at least one API process and one worker process from the same image. Apply migrations as a release job before starting the new version.

## Required configuration

Generate independent secrets; do not reuse them:

```bash
openssl rand -hex 32 # TOKEN_SECRET_KEY
openssl rand -hex 32 # API_KEY_PEPPER
openssl rand -hex 32 # DASHBOARD_SESSION_SECRET
```

Set `DATABASE_MIGRATION_URL` only on the migration job. API and worker processes receive only the restricted `DATABASE_URL`. Set `APP_ORIGIN` to the exact public HTTPS origin, without a trailing slash; startup rejects a missing or unsafe production origin. Set `TRUST_PROXY=true` only behind a trusted reverse proxy. Persist and share `DATA_DIR` between API and worker because it holds the Kaspi device identity and signing keys.

If the platform cannot mount one volume into both processes, set `KASPI_KEYPAIR_JSON_BASE64` and `KASPI_DEVICE_JSON_BASE64` to the same base64-encoded JSON secrets on the API and worker. Set `DATABASE_RUNTIME_PASSWORD` only on the migration process; it creates or rotates the restricted `kaspi_app` login used by `DATABASE_URL`.

See `.env.example` for all settings. In production, inject secrets through the hosting platform's secret manager rather than an image or checked-in file.

Kaspi client-emulation overrides use the `KASPI_APP_*` prefix. Generic hosting variables such as `APP_VERSION` are intentionally ignored in database-backed mode so a release identifier cannot silently change the Kaspi protocol signature.

## Release sequence

```bash
npm ci
npm run db:migrate
npm run lint
npm test
npm audit --audit-level=high
docker build -t registry.example/kaspi-automation:$GIT_SHA .
```

Deploy the migration job, then the API and worker. Health probes use `/health` for liveness and `/ready` for database readiness. Use a rolling strategy for API processes. Kaspi SMS authentication is temporarily held in one API process for at most ten minutes, so configure load-balancer stickiness while an authentication flow is in progress.

## Backups and recovery

- Take encrypted PostgreSQL backups at least daily and retain point-in-time WAL recovery appropriate to the business SLA.
- Back up the persistent `DATA_DIR` separately. Losing or regenerating it invalidates Kaspi device sessions.
- Redis jobs are recoverable from PostgreSQL reconciliation, but Redis persistence still reduces recovery time.
- Perform a restore drill quarterly and verify tenant RLS with the integration tests against the restored staging database.

## Scaling

API replicas are stateless except for the short Kaspi SMS handshake. Worker replicas are safe: BullMQ claims jobs and database compare-and-set transitions prevent duplicate state events. Start with worker concurrency from `worker.js`; lower it if Kaspi or callback rate limits require it. PostgreSQL pool size is controlled by `DATABASE_POOL_SIZE` per process.
