CREATE TABLE printable_payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  public_token_hash TEXT NOT NULL UNIQUE,
  short_code TEXT NOT NULL UNIQUE CHECK (short_code ~ '^[A-Z2-9]{8}$'),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'KZT' CHECK (currency = 'KZT'),
  description TEXT CHECK (description IS NULL OR length(description) <= 100),
  external_order_id TEXT CHECK (external_order_id IS NULL OR length(external_order_id) <= 200),
  single_use BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'paid')),
  scan_count INTEGER NOT NULL DEFAULT 0 CHECK (scan_count >= 0),
  last_payment_id UUID REFERENCES payment_orders(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ
);

CREATE INDEX printable_payment_requests_tenant_idx
  ON printable_payment_requests (tenant_id, created_at DESC);

ALTER TABLE payment_orders
  ADD COLUMN printable_request_id UUID REFERENCES printable_payment_requests(id) ON DELETE SET NULL;

ALTER TABLE printable_payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE printable_payment_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON printable_payment_requests
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON printable_payment_requests TO kaspi_app;

CREATE OR REPLACE FUNCTION resolve_printable_payment_request(p_token_hash TEXT, p_short_code TEXT)
RETURNS TABLE (
  id UUID, tenant_id UUID, tenant_name TEXT, amount_minor BIGINT, currency CHAR(3),
  description TEXT, external_order_id TEXT, single_use BOOLEAN, status TEXT,
  short_code TEXT, scan_count INTEGER, last_payment_id UUID
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT request.id, request.tenant_id, tenant.name, request.amount_minor, request.currency,
         request.description, request.external_order_id, request.single_use, request.status,
         request.short_code, request.scan_count, request.last_payment_id
  FROM printable_payment_requests AS request
  JOIN tenants AS tenant ON tenant.id = request.tenant_id
  WHERE tenant.status = 'active'
    AND ((p_token_hash IS NOT NULL AND request.public_token_hash = p_token_hash)
      OR (p_short_code IS NOT NULL AND request.short_code = upper(p_short_code)))
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION resolve_printable_payment_request(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_printable_payment_request(TEXT, TEXT) TO kaspi_app;
