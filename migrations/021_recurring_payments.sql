CREATE TABLE recurring_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_name TEXT CHECK (customer_name IS NULL OR length(customer_name) <= 200),
  customer_phone TEXT NOT NULL CHECK (customer_phone ~ '^7[0-9]{10}$'),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'KZT' CHECK (currency = 'KZT'),
  billing_period TEXT NOT NULL CHECK (billing_period IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  billing_day INTEGER,
  billing_time TIME NOT NULL DEFAULT '09:00',
  total_cycles INTEGER CHECK (total_cycles IS NULL OR total_cycles > 0),
  generated_cycles INTEGER NOT NULL DEFAULT 0 CHECK (generated_cycles >= 0),
  successful_cycles INTEGER NOT NULL DEFAULT 0 CHECK (successful_cycles >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled', 'completed')),
  next_payment_at TIMESTAMPTZ,
  max_retry_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_retry_attempts BETWEEN 0 AND 10),
  retry_interval_hours INTEGER NOT NULL DEFAULT 24 CHECK (retry_interval_hours BETWEEN 1 AND 168),
  grace_period_days INTEGER NOT NULL DEFAULT 3 CHECK (grace_period_days BETWEEN 0 AND 30),
  description TEXT CHECK (description IS NULL OR length(description) <= 60),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX recurring_schedules_due_idx
  ON recurring_schedules (next_payment_at)
  WHERE status = 'active';

CREATE TABLE recurring_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  schedule_id UUID NOT NULL REFERENCES recurring_schedules(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES payment_orders(id) ON DELETE SET NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'invoice_created', 'paid', 'failed', 'expired', 'cancelled')),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, scheduled_for, attempt)
);

CREATE INDEX recurring_runs_schedule_idx ON recurring_runs (schedule_id, created_at DESC);

ALTER TABLE payment_orders
  ADD COLUMN recurring_schedule_id UUID REFERENCES recurring_schedules(id) ON DELETE SET NULL,
  ADD COLUMN recurring_run_id UUID REFERENCES recurring_runs(id) ON DELETE SET NULL;

ALTER TABLE recurring_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recurring_schedules
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE recurring_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recurring_runs
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON recurring_schedules, recurring_runs TO kaspi_app;

CREATE OR REPLACE FUNCTION list_due_recurring_work()
RETURNS TABLE (tenant_id UUID, schedule_id UUID)
LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT schedule.tenant_id, schedule.id
  FROM recurring_schedules AS schedule
  JOIN kaspi_connections AS connection
    ON connection.tenant_id = schedule.tenant_id AND connection.state = 'active'
  WHERE schedule.status = 'active'
    AND schedule.next_payment_at IS NOT NULL
    AND schedule.next_payment_at <= now()
  ORDER BY schedule.next_payment_at
  LIMIT 500
$$;

REVOKE ALL ON FUNCTION list_due_recurring_work() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_due_recurring_work() TO kaspi_app;
