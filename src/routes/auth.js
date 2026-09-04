import { Router } from 'express';
import {
  finishKaspiAuthentication,
  initializeKaspiAuthentication,
  sendKaspiPhone,
  verifyKaspiOtp,
} from '../kaspi/authFlow.js';

const router = Router();
const authSessions = new Map();
const AUTH_TTL_MS = 10 * 60 * 1000;
const MAX_AUTH_SESSIONS = 1000;

const retainSession = (session) => {
  const now = Date.now();
  for (const [id, entry] of authSessions) {
    if (entry.expiresAt <= now) authSessions.delete(id);
  }
  if (authSessions.size >= MAX_AUTH_SESSIONS) {
    const oldest = authSessions.keys().next().value;
    authSessions.delete(oldest);
  }
  authSessions.set(session.processId, { session, expiresAt: now + AUTH_TTL_MS });
};

const findSession = (processId) => {
  const entry = authSessions.get(processId);
  if (!entry || entry.expiresAt <= Date.now()) {
    authSessions.delete(processId);
    return null;
  }
  entry.expiresAt = Date.now() + AUTH_TTL_MS;
  return entry.session;
};

router.post('/init', async (_req, res) => {
  try {
    const { session, body } = await initializeKaspiAuthentication();
    if (session.processId) retainSession(session);
    res.json({ success: Boolean(session.processId), processId: session.processId, view: body.view?.code, body });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/send-phone', async (req, res) => {
  const { phoneNumber, processId } = req.body || {};
  if (!/^7?\d{10}$/.test(phoneNumber || '')) {
    return res.status(400).json({ error: 'phoneNumber must use the 7XXXXXXXXX format.' });
  }
  if (!processId) return res.status(400).json({ error: 'processId is required.' });
  const session = findSession(processId);
  if (!session) return res.status(400).json({ error: 'Authentication session is unknown or expired.' });
  try {
    const body = await sendKaspiPhone(session, phoneNumber);
    res.json({
      success: body.view?.code === 'EnterOtp',
      processId: session.processId,
      desc: body.data?.desc,
      view: body.view?.code,
      body,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/verify-otp', async (req, res) => {
  const { otp, processId } = req.body || {};
  if (!/^\d{4,8}$/.test(otp || '')) return res.status(400).json({ error: 'A valid OTP is required.' });
  const session = findSession(processId);
  if (!session) return res.status(400).json({ error: 'Authentication session is unknown or expired.' });
  try {
    const result = await verifyKaspiOtp(session, otp);
    if (!result.verified) {
      return res.json({ success: false, processId: session.processId, step: 'otp_response', body: result.body });
    }
    const finished = await finishKaspiAuthentication(session);
    authSessions.delete(processId);
    res.json({
      success: true,
      processId: session.processId,
      step: 'finished',
      message: 'OTP verified and finish completed',
      otpBody: result.body,
      ...finished,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/session', (req, res) => {
  const { tokenSN } = req.body || {};
  res.json({ authenticated: Boolean(tokenSN), tokenSN });
});

router.post('/logout', (_req, res) => res.json({ success: true }));

export default router;
