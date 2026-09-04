CREATE TABLE plan_catalog (
  code TEXT PRIMARY KEY CHECK (code ~ '^[a-z0-9-]+$'),
  name JSONB NOT NULL,
  description JSONB NOT NULL DEFAULT '{}'::jsonb,
  price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'KZT' CHECK (currency = 'KZT'),
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO plan_catalog (code, name, description, price_minor, limits, features, sort_order) VALUES
  ('beta', '{"en":"Beta","ru":"Бета","kk":"Бета"}', '{"en":"Everything needed while the service is in beta.","ru":"Все возможности на время бета-тестирования.","kk":"Бета кезеңіндегі барлық мүмкіндік."}', 0, '{"paymentsPerMonth":null,"teamMembers":null,"apiKeys":null}', '["payments","recurring","printableQr","api","webhooks","team"]', 10),
  ('start', '{"en":"Start","ru":"Старт","kk":"Старт"}', '{"en":"For solo founders and small shops.","ru":"Для предпринимателей и небольших магазинов.","kk":"Кәсіпкерлер мен шағын дүкендерге."}', 990000, '{"paymentsPerMonth":500,"teamMembers":3,"apiKeys":2}', '["payments","printableQr","api","webhooks"]', 20),
  ('growth', '{"en":"Growth","ru":"Рост","kk":"Өсу"}', '{"en":"For teams automating sales and subscriptions.","ru":"Для команд, автоматизирующих продажи и подписки.","kk":"Сатылым мен жазылымды автоматтандыратын командаларға."}', 2490000, '{"paymentsPerMonth":5000,"teamMembers":15,"apiKeys":10}', '["payments","recurring","printableQr","api","webhooks","team","prioritySupport"]', 30)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE tenant_plan_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES plan_catalog(code),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'cancelled')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
  current_period_end TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()) + INTERVAL '1 month',
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tenant_plan_current_idx ON tenant_plan_subscriptions (tenant_id) WHERE status IN ('active', 'past_due');

CREATE TABLE plan_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_plan_code TEXT NOT NULL REFERENCES plan_catalog(code),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE billing_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_code TEXT REFERENCES plan_catalog(code),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'KZT' CHECK (currency = 'KZT'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  provider_reference TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE partner_programs (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL UNIQUE CHECK (referral_code ~ '^[A-Z0-9]{8}$'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  commission_percent NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (commission_percent BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE partner_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  referred_tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'qualified', 'rewarded', 'cancelled')),
  reward_minor BIGINT NOT NULL DEFAULT 0 CHECK (reward_minor >= 0),
  qualified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tenant_id <> referred_tenant_id)
);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['tenant_plan_subscriptions', 'plan_change_requests', 'billing_transactions', 'partner_programs', 'partner_referrals']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', table_name);
  END LOOP;
END $$;

GRANT SELECT ON plan_catalog TO kaspi_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_plan_subscriptions, plan_change_requests, billing_transactions, partner_programs, partner_referrals TO kaspi_app;

CREATE OR REPLACE FUNCTION register_partner_referral(input_code TEXT, input_referred_tenant UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE partner_tenant UUID;
BEGIN
  SELECT tenant_id INTO partner_tenant FROM partner_programs WHERE referral_code = upper(input_code) AND status = 'active';
  IF partner_tenant IS NULL OR partner_tenant = input_referred_tenant THEN RETURN false; END IF;
  INSERT INTO partner_referrals (tenant_id, referred_tenant_id) VALUES (partner_tenant, input_referred_tenant)
  ON CONFLICT (referred_tenant_id) DO NOTHING;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION register_partner_referral(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_partner_referral(TEXT, UUID) TO kaspi_app;
