ALTER TABLE webhook_deliveries ADD COLUMN attempt_started_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION list_pending_payment_work()
RETURNS TABLE (tenant_id UUID, payment_id UUID)
LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT payment.tenant_id, payment.id FROM payment_orders AS payment
  JOIN kaspi_connections AS connection
    ON connection.tenant_id = payment.tenant_id AND connection.state = 'active'
  WHERE payment.status IN ('created', 'pending', 'requires_customer_action', 'unknown')
    AND payment.provider_operation_id IS NOT NULL
    AND (payment.expires_at IS NULL OR payment.expires_at > now() - interval '1 day')
  ORDER BY payment.updated_at LIMIT 1000
$$;

CREATE OR REPLACE FUNCTION list_pending_webhook_work()
RETURNS TABLE (tenant_id UUID, delivery_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE webhook_deliveries SET status = 'failed', next_attempt_at = now(),
    last_error = 'Delivery lease expired', attempt_started_at = NULL
  WHERE status = 'delivering' AND attempt_started_at < now() - interval '2 minutes';

  RETURN QUERY
    SELECT delivery.tenant_id, delivery.id FROM webhook_deliveries AS delivery
    JOIN webhook_endpoints AS endpoint ON endpoint.id = delivery.endpoint_id
    WHERE delivery.status IN ('pending', 'failed') AND endpoint.enabled = true
      AND (delivery.next_attempt_at IS NULL OR delivery.next_attempt_at <= now())
    ORDER BY delivery.created_at LIMIT 1000;
END;
$$;

REVOKE ALL ON FUNCTION list_pending_payment_work() FROM PUBLIC;
REVOKE ALL ON FUNCTION list_pending_webhook_work() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_pending_payment_work() TO kaspi_app;
GRANT EXECUTE ON FUNCTION list_pending_webhook_work() TO kaspi_app;
