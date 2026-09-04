# Kaspi Automation

A multi-tenant payment automation platform for startups and small businesses using Kaspi Pay. It includes a customer dashboard, scoped API keys, QR payments and phone invoices, refunds, durable status polling, signed webhooks, team roles, audit logs, and a platform-operations dashboard.

> This is an independent integration, not an official Kaspi product. Use it only for merchant accounts you are authorized to operate and complete legal/security review before processing real payments.

## What is included

- Customer dashboard at `/dashboard`: account registration/login, workspace switching, team invitations, server-side Kaspi SMS connection, payments, API keys, webhooks, delivery history, and audit logs.
- Platform dashboard at `/admin`: tenant status, payment/connection health, queue metrics, and suspension/reactivation.
- Public tenant API at `/api/v1`: bearer API-key authentication, scopes, persisted payments/refunds, and 24-hour idempotency.
- PostgreSQL persistence with forced row-level security and separate migration/runtime roles.
- BullMQ/Redis workers for payment polling and webhook delivery, with database reconciliation after restarts.
- AES-256-GCM Kaspi credential encryption, hashed API/session tokens, role authorization, rate limits, request IDs, log redaction, webhook SSRF defenses, and audit events.
- Legacy single-merchant demo routes and `/` interface remain available for compatibility.

## Local setup

Requirements: Node.js 20.6+ and Docker.

```bash
npm ci
cp .env.example .env
# Fill three independent values:
# TOKEN_SECRET_KEY=$(openssl rand -hex 32)
# API_KEY_PEPPER=$(openssl rand -hex 32)
# DASHBOARD_SESSION_SECRET=$(openssl rand -hex 32)

docker compose up -d
npm run db:migrate
npm start
```

In a second terminal:

```bash
npm run worker
```

Open `http://localhost:3000/dashboard`. On first startup, the shared `DATA_DIR` receives a Kaspi device identity and cryptographic keypair. Keep that directory persistent and private.

To run the complete containerized application profile:

```bash
docker compose --profile application up --build
```

## API example

Create a key under **Dashboard → Developers**, then:

```bash
curl -X POST http://localhost:3000/api/v1/payments \
  -H 'Authorization: Bearer kpa_live_…' \
  -H 'Idempotency-Key: order-1001-attempt-1' \
  -H 'Content-Type: application/json' \
  -d '{"method":"qr","amount":1250,"externalOrderId":"ORDER-1001"}'
```

The human-readable API reference is at `/api-docs`; the OpenAPI 3.1 document is at `/openapi.yaml`.

## Roles

| Role | Access |
| --- | --- |
| owner | Full workspace, team-role, connection, developer, payment, and audit access |
| admin | Workspace administration, connection, developer, payment, and audit access |
| developer | API keys, webhooks, and payments |
| operator | Read/write payments |
| viewer | Read-only payments and workspace status |

Promote a registered operator to the platform-admin view with:

```bash
npm run admin:promote -- owner@example.com
```

## Commands

```bash
npm run db:migrate       # forward-only PostgreSQL migrations
npm run tenant:create -- acme "Acme LLP"
npm run admin:promote -- owner@example.com
npm run lint
npm test
npm run worker
npm run regen:keypair    # invalidates associated Kaspi sessions
npm run regen:device     # invalidates associated Kaspi sessions
```

## Documentation

- [Architecture](docs/SAAS_FOUNDATION.md)
- [Production deployment](docs/DEPLOYMENT.md)
- [Operations runbook](docs/RUNBOOK.md)
- [Security model](docs/SECURITY.md)
- [Legacy API documentation](docs/API.md)

## Production notes

Set the exact HTTPS `APP_ORIGIN`, keep `TRUST_PROXY=false` unless requests arrive through a trusted proxy, configure SMTP for account email, run migrations with `DATABASE_MIGRATION_URL` only, and run API/worker processes with the restricted `DATABASE_URL`. Use a secret manager and encrypted PostgreSQL/`DATA_DIR` backups. See the deployment guide for release order and recovery requirements.

## License

[MIT](LICENSE)
