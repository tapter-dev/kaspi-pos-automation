# Security model

## Controls implemented

- forced PostgreSQL RLS and explicit tenant context for all business data;
- separate migration and restricted runtime database roles;
- AES-256-GCM encryption for tenant Kaspi credentials;
- HMAC-only storage for API keys and dashboard session tokens;
- scoped API keys, role-based dashboard authorization, expiration, and revocation;
- strict same-site HTTP-only cookies, origin checks on mutations, Helmet headers, small JSON bodies, and authentication/API rate limits;
- idempotency keys on payment and refund creation;
- SSRF-resistant webhook URL resolution, HTTPS enforcement in production, no redirects, bounded response capture, signed payloads, retries, and automatic endpoint disabling;
- sensitive-field log redaction, request correlation IDs, audit records, account recovery, and session revocation after password reset;
- dependency audit and tenant integration tests in CI.

The unauthenticated legacy demo API is automatically disabled whenever `DATABASE_URL` is configured. It can be re-enabled explicitly for controlled compatibility testing with `ENABLE_LEGACY_API=true`; do not expose it on a production internet ingress.

## Secret handling

`TOKEN_SECRET_KEY`, `API_KEY_PEPPER`, and `DASHBOARD_SESSION_SECRET` must be independent high-entropy values. The Kaspi device files under `DATA_DIR` are also secrets. Restrict access to application operators, exclude them from backups shared with developers, and never print them in support tickets.

API keys and webhook secrets are displayed only at creation/rotation. Customers must store them in their own secret manager.

## Responsible use

This repository automates an observed Kaspi Pay mobile protocol and is not an official Kaspi integration. Obtain permission for every merchant account, comply with Kaspi terms and applicable Kazakhstan payment/privacy requirements, and prefer an official partner API when available. Do not collect customer card data. Restrict production access and complete legal/security review before processing real funds.

## Reporting

Do not include credentials, OTPs, customer phone numbers, payment links, or raw database exports in a vulnerability report. Provide reproduction steps with synthetic tenant and payment identifiers.
