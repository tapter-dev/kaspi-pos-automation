import { Router } from 'express';
import { z } from 'zod';
import { createDashboardAuth, requireRole } from '../middleware/dashboardAuth.js';
import { disableKaspiConnection, getKaspiConnection, saveKaspiConnection } from '../kaspi/connectionStore.js';
import { recordAudit } from '../audit.js';
import {
  finishKaspiAuthentication,
  initializeKaspiAuthentication,
  sendKaspiPhone,
  verifyKaspiOtp,
} from '../kaspi/authFlow.js';

const router = Router();
router.use(createDashboardAuth());

const pendingAuthentication = new Map();
const AUTH_TTL_MS = 10 * 60 * 1000;
const cleanPendingAuthentication = () => {
  const now = Date.now();
  for (const [processId, entry] of pendingAuthentication) {
    if (entry.expiresAt <= now) pendingAuthentication.delete(processId);
  }
};

const findPendingAuthentication = (req, processId) => {
  cleanPendingAuthentication();
  const entry = pendingAuthentication.get(processId);
  if (!entry || entry.tenantId !== req.auth.tenant_id || entry.userId !== req.auth.user_id) return null;
  entry.expiresAt = Date.now() + AUTH_TTL_MS;
  return entry.session;
};

const connectionSchema = z.object({
  tokenSN: z.string().min(1).max(500),
  vtokenSecret: z.string().min(1).max(2000),
  profileId: z.union([z.string(), z.number()]).optional().nullable(),
  organizationId: z.union([z.string(), z.number()]).optional().nullable(),
  orgName: z.string().max(300).optional().nullable(),
  phoneMasked: z.string().max(50).optional().nullable(),
});

router.get('/connection', async (req, res, next) => {
  try {
    res.json({ data: await getKaspiConnection(req.auth.tenant_id) });
  } catch (err) {
    next(err);
  }
});

router.post('/connection/auth/init', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    cleanPendingAuthentication();
    if (pendingAuthentication.size >= 1000) {
      return res.status(503).json({ error: 'Too many Kaspi authentication sessions are active.' });
    }
    const { session, body } = await initializeKaspiAuthentication();
    if (!session.processId) return res.status(502).json({ error: 'Kaspi did not start an authentication session.' });
    pendingAuthentication.set(session.processId, {
      tenantId: req.auth.tenant_id,
      userId: req.auth.user_id,
      session,
      expiresAt: Date.now() + AUTH_TTL_MS,
    });
    res.json({ data: { processId: session.processId, view: body.view?.code } });
  } catch (err) {
    err.status = 502;
    next(err);
  }
});

router.post('/connection/auth/send-phone', requireRole('owner', 'admin'), async (req, res, next) => {
  const parsed = z
    .object({ processId: z.string().min(1).max(200), phoneNumber: z.string().regex(/^7?\d{10}$/) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A valid processId and phone number are required.' });
  const session = findPendingAuthentication(req, parsed.data.processId);
  if (!session) return res.status(400).json({ error: 'Kaspi authentication session is invalid or expired.' });
  try {
    const body = await sendKaspiPhone(session, parsed.data.phoneNumber);
    if (body.view?.code !== 'EnterOtp') {
      return res.status(400).json({ error: body.data?.desc || 'Kaspi did not accept the phone number.' });
    }
    res.json({ data: { processId: session.processId, otpSent: true, description: body.data?.desc || null } });
  } catch (err) {
    err.status = 502;
    next(err);
  }
});

router.post('/connection/auth/verify-otp', requireRole('owner', 'admin'), async (req, res, next) => {
  const parsed = z
    .object({ processId: z.string().min(1).max(200), otp: z.string().regex(/^\d{4,8}$/) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A valid processId and OTP are required.' });
  const session = findPendingAuthentication(req, parsed.data.processId);
  if (!session) return res.status(400).json({ error: 'Kaspi authentication session is invalid or expired.' });
  try {
    const verification = await verifyKaspiOtp(session, parsed.data.otp);
    if (!verification.verified) return res.status(400).json({ error: 'Kaspi did not accept the OTP.' });
    const credentials = await finishKaspiAuthentication(session);
    pendingAuthentication.delete(parsed.data.processId);
    const connection = await saveKaspiConnection(req.auth.tenant_id, credentials, {
      phoneMasked: credentials.phone ? `***${String(credentials.phone).slice(-4)}` : null,
    });
    await recordAudit(req, 'kaspi_connection.authenticated', {
      resourceType: 'kaspi_connection',
      resourceId: connection.id,
      metadata: { organizationId: connection.organization_id, organizationName: connection.organization_name },
    });
    res.json({ data: connection });
  } catch (err) {
    pendingAuthentication.delete(parsed.data.processId);
    err.status = 502;
    next(err);
  }
});

router.put('/connection', requireRole('owner', 'admin'), async (req, res, next) => {
  const parsed = connectionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid Kaspi connection data.' });
  try {
    const { phoneMasked, ...credentials } = parsed.data;
    const connection = await saveKaspiConnection(req.auth.tenant_id, credentials, { phoneMasked });
    await recordAudit(req, 'kaspi_connection.saved', {
      resourceType: 'kaspi_connection',
      resourceId: connection.id,
      metadata: { organizationId: connection.organization_id, organizationName: connection.organization_name },
    });
    res.json({ data: connection });
  } catch (err) {
    if (/vtoken|tokenSN/.test(err.message)) return res.status(400).json({ error: 'Invalid Kaspi credentials.' });
    next(err);
  }
});

router.delete('/connection', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    await disableKaspiConnection(req.auth.tenant_id);
    await recordAudit(req, 'kaspi_connection.disabled', { resourceType: 'kaspi_connection' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
