import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../database/client.js';
import { requireScope } from '../middleware/scopes.js';
import { toMinorUnits } from '../payments/money.js';
import { defaultFirstRecurringAt } from '../payments/recurring.js';
import { enqueueRecurringBilling } from '../queue/client.js';

const router = Router();

const periods = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
const schema = z
  .object({
    customerName: z.string().trim().max(200).optional(),
    customerPhone: z.string().regex(/^7\d{10}$/),
    amount: z.number().positive().max(999_999_999),
    billingPeriod: z.enum(periods),
    billingDay: z.number().int().min(1).max(28).optional(),
    billingTime: z.string().regex(/^(0[6-9]|1\d|2[0-2]):[0-5]\d$/).default('09:00'),
    totalCycles: z.number().int().positive().max(1000).nullable().optional(),
    maxRetryAttempts: z.number().int().min(0).max(10).default(3),
    retryIntervalHours: z.number().int().min(1).max(168).default(24),
    gracePeriodDays: z.number().int().min(0).max(30).default(3),
    description: z.string().trim().max(60).optional(),
    firstPaymentAt: z.string().datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (toMinorUnits(value.amount) === null) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'amount supports at most two decimal places' });
    }
    if (['monthly', 'quarterly', 'yearly'].includes(value.billingPeriod) && !value.billingDay) {
      ctx.addIssue({ code: 'custom', path: ['billingDay'], message: 'billingDay is required for this period' });
    }
  });

const serialize = (row) => ({
  id: row.id,
  customerName: row.customer_name,
  customerPhone: row.customer_phone,
  amount: Number(row.amount_minor) / 100,
  currency: row.currency,
  billingPeriod: row.billing_period,
  billingDay: row.billing_day,
  billingTime: String(row.billing_time).slice(0, 5),
  totalCycles: row.total_cycles,
  generatedCycles: row.generated_cycles,
  successfulCycles: row.successful_cycles,
  status: row.status,
  nextPaymentAt: row.next_payment_at,
  maxRetryAttempts: row.max_retry_attempts,
  retryIntervalHours: row.retry_interval_hours,
  gracePeriodDays: row.grace_period_days,
  description: row.description,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

router.post('/', requireScope('payments:write'), async (req, res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid recurring schedule.', details: parsed.error.issues });
  const tenantId = req.auth.tenantId;
  const value = parsed.data;
  const firstPaymentAt = value.firstPaymentAt ? new Date(value.firstPaymentAt) : defaultFirstRecurringAt(value.billingTime);
  if (firstPaymentAt <= new Date()) return res.status(400).json({ error: 'firstPaymentAt must be in the future.' });
  try {
    const schedule = await withTenant(tenantId, async (db) => {
      const result = await db.query(
        `INSERT INTO recurring_schedules
          (tenant_id, customer_name, customer_phone, amount_minor, billing_period, billing_day,
           billing_time, total_cycles, next_payment_at, max_retry_attempts, retry_interval_hours,
           grace_period_days, description, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [tenantId, value.customerName || null, value.customerPhone, toMinorUnits(value.amount), value.billingPeriod,
          value.billingDay || null, value.billingTime, value.totalCycles || null, firstPaymentAt,
          value.maxRetryAttempts, value.retryIntervalHours, value.gracePeriodDays, value.description || null,
          req.auth.userId || req.auth.user_id || null],
      );
      return result.rows[0];
    });
    const delay = Math.max(firstPaymentAt.getTime() - Date.now(), 0);
    await enqueueRecurringBilling(tenantId, schedule.id, delay);
    res.status(201).json({ data: serialize(schedule) });
  } catch (err) {
    next(err);
  }
});

router.get('/', requireScope('payments:read'), async (req, res, next) => {
  const status = typeof req.query.status === 'string' && ['active', 'paused', 'cancelled', 'completed'].includes(req.query.status)
    ? req.query.status : null;
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  try {
    const rows = await withTenant(req.auth.tenantId, async (db) => {
      const result = await db.query(
        `SELECT * FROM recurring_schedules WHERE tenant_id = $1
           AND ($2::text IS NULL OR status = $2)
           AND ($3::text = '' OR customer_name ILIKE '%' || $3 || '%' OR customer_phone ILIKE '%' || $3 || '%')
         ORDER BY created_at DESC LIMIT 100`,
        [req.auth.tenantId, status, search],
      );
      return result.rows;
    });
    res.json({ data: rows.map(serialize) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireScope('payments:read'), async (req, res, next) => {
  try {
    const data = await withTenant(req.auth.tenantId, async (db) => {
      const schedule = await db.query('SELECT * FROM recurring_schedules WHERE tenant_id = $1 AND id = $2', [req.auth.tenantId, req.params.id]);
      if (!schedule.rows[0]) return null;
      const runs = await db.query(
        `SELECT run.id, run.scheduled_for, run.attempt, run.status, run.failure_reason,
                run.created_at, payment.id AS payment_id, payment.status AS payment_status,
                payment.paid_at
         FROM recurring_runs AS run
         LEFT JOIN payment_orders AS payment ON payment.id = run.payment_id
         WHERE run.tenant_id = $1 AND run.schedule_id = $2 ORDER BY run.created_at DESC LIMIT 100`,
        [req.auth.tenantId, req.params.id],
      );
      return { ...serialize(schedule.rows[0]), runs: runs.rows };
    });
    if (!data) return res.status(404).json({ error: 'Recurring schedule not found.' });
    res.json({ data });
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'Recurring schedule not found.' });
    next(err);
  }
});

router.put('/:id', requireScope('payments:write'), async (req, res, next) => {
  const parsed = schema.omit({ firstPaymentAt: true }).partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid recurring schedule update.', details: parsed.error.issues });
  try {
    const schedule = await withTenant(req.auth.tenantId, async (db) => {
      const current = await db.query('SELECT * FROM recurring_schedules WHERE tenant_id = $1 AND id = $2', [req.auth.tenantId, req.params.id]);
      if (!current.rows[0]) return null;
      const old = current.rows[0];
      const value = parsed.data;
      const result = await db.query(
        `UPDATE recurring_schedules SET customer_name=$3, customer_phone=$4, amount_minor=$5,
           billing_period=$6, billing_day=$7, billing_time=$8, total_cycles=$9,
           max_retry_attempts=$10, retry_interval_hours=$11, grace_period_days=$12,
           description=$13, updated_at=now()
         WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [req.auth.tenantId, req.params.id, value.customerName ?? old.customer_name,
          value.customerPhone ?? old.customer_phone, value.amount === undefined ? old.amount_minor : toMinorUnits(value.amount),
          value.billingPeriod ?? old.billing_period, value.billingDay ?? old.billing_day,
          value.billingTime ?? String(old.billing_time).slice(0, 5), value.totalCycles === undefined ? old.total_cycles : value.totalCycles,
          value.maxRetryAttempts ?? old.max_retry_attempts, value.retryIntervalHours ?? old.retry_interval_hours,
          value.gracePeriodDays ?? old.grace_period_days, value.description === undefined ? old.description : value.description || null],
      );
      return result.rows[0];
    });
    if (!schedule) return res.status(404).json({ error: 'Recurring schedule not found.' });
    res.json({ data: serialize(schedule) });
  } catch (err) {
    next(err);
  }
});

const transition = (path, from, to) => router.post(`/:id/${path}`, requireScope('payments:write'), async (req, res, next) => {
  try {
    const schedule = await withTenant(req.auth.tenantId, async (db) => {
      const result = await db.query(
        `UPDATE recurring_schedules SET status=$3,
           next_payment_at=CASE WHEN $3='active' AND next_payment_at IS NULL THEN now() + interval '1 minute' ELSE next_payment_at END,
           cancelled_at=CASE WHEN $3='cancelled' THEN now() ELSE cancelled_at END, updated_at=now()
         WHERE tenant_id=$1 AND id=$2 AND status=ANY($4::text[]) RETURNING *`,
        [req.auth.tenantId, req.params.id, to, from],
      );
      return result.rows[0];
    });
    if (!schedule) return res.status(409).json({ error: `Schedule cannot be ${path}d from its current state.` });
    if (to === 'active' && schedule.next_payment_at) {
      await enqueueRecurringBilling(req.auth.tenantId, schedule.id, Math.max(new Date(schedule.next_payment_at).getTime() - Date.now(), 0));
    }
    res.json({ data: serialize(schedule) });
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'Recurring schedule not found.' });
    next(err);
  }
});

transition('pause', ['active'], 'paused');
transition('resume', ['paused'], 'active');
transition('cancel', ['active', 'paused'], 'cancelled');

router.get('/:id/invoices', requireScope('payments:read'), async (req, res, next) => {
  try {
    const rows = await withTenant(req.auth.tenantId, async (db) => {
      const result = await db.query(
        `SELECT id, external_order_id, amount_minor, currency, status, paid_at, created_at
         FROM payment_orders WHERE tenant_id=$1 AND recurring_schedule_id=$2 ORDER BY created_at DESC`,
        [req.auth.tenantId, req.params.id],
      );
      return result.rows;
    });
    res.json({ data: rows.map((row) => ({ ...row, amount: Number(row.amount_minor) / 100, amount_minor: undefined })) });
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'Recurring schedule not found.' });
    next(err);
  }
});

export default router;
