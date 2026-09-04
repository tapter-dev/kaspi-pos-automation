-- The runtime role must not own these tables and must not be a superuser;
-- otherwise PostgreSQL row-level security can be bypassed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kaspi_app') THEN
    GRANT USAGE ON SCHEMA public TO kaspi_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      tenants,
      memberships,
      kaspi_connections,
      api_keys,
      payment_orders,
      payment_events,
      refunds,
      webhook_endpoints,
      webhook_deliveries,
      idempotency_keys,
      audit_logs
    TO kaspi_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kaspi_app;
  END IF;
END $$;
