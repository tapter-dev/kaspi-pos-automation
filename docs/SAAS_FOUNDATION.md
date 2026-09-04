# SaaS platform architecture

Kaspi Automation is a multi-tenant service with two execution processes:

- the Express API serves the customer dashboard, platform operations interface, legacy demo, and `/api/v1`;
- the BullMQ worker polls Kaspi payment states and delivers signed webhooks.

PostgreSQL is the source of truth. Redis is only a durable work scheduler; reconciliation functions repopulate missing jobs every 30 seconds. The worker and API can therefore restart without losing payment or delivery state.

## Tenant isolation

Every business-owned row carries a `tenant_id`. Runtime queries use `withTenant`, which starts a transaction and sets the transaction-local PostgreSQL `app.tenant_id`. Forced row-level-security policies then reject cross-tenant reads and writes even if a repository omits a filter. The `kaspi_app` role is restricted and must never own tables, migrate the schema, or receive superuser privileges.

Authentication lookup functions are `SECURITY DEFINER`, have a fixed `search_path`, expose only the fields needed by the caller, and have public execution revoked. API keys are HMAC-hashed. Dashboard session tokens are random, server-side, hashed, expiring, revocable, and stored in `HttpOnly`, `Secure` production cookies.

## Payment lifecycle

`POST /api/v1/payments` reserves an idempotency key and local order before calling Kaspi. Provider identifiers and customer-action links are persisted, a `payment.created` event is recorded, and polling is queued. State changes are compare-and-set updates, so concurrent workers cannot publish the same transition twice. Final states stop polling. A rejected Kaspi session displaces the tenant connection and marks the unresolved payment `unknown` for operator attention.

Refunds use the same idempotency model, enforce the remaining refundable balance, and update a payment to `partially_refunded` or `refunded`.

## Webhook lifecycle

An event creates one delivery per enabled subscribed endpoint. Before every attempt the worker resolves DNS and blocks loopback, link-local, and private/reserved destinations. Production callbacks must use HTTPS. Requests do not follow redirects and have a 10-second timeout.

The signature is lowercase hexadecimal HMAC-SHA256 over:

```text
X-Webhook-Timestamp + "." + raw HTTP request body
```

using the endpoint's `whsec_…` secret. Only 2xx is success. Transient errors retry with exponential BullMQ backoff; repeated failures increment endpoint health and disable the endpoint at ten failures. Secrets can be rotated and test deliveries can be queued in the dashboard.

## Compatibility

The original `/api/auth`, `/api/qr`, `/api/invoice`, `/api/history`, and `/api/refund` demo routes remain available. New integrations should use `/api/v1`, because those routes provide tenant authentication, persistence, idempotency, auditing, and durable background work.
