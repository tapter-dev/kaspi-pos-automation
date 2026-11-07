import { Router } from 'express';
import { KASPI_MTOKEN_URL } from '../config.js';
import { loggedFetch, signedQrPayHeaders } from '../helpers.js';
import { decryptSecret } from '../crypto.js';

const router = Router();

const extractSession = (req) => ({
  tokenSN: req.headers['x-token-sn'] || null,
  profileId: req.headers['x-profile-id'] || null,
  vtokenSecret: req.headers['x-vtoken-secret'] || null,
});

const requireAuth = (req, res, next) => {
  const session = extractSession(req);
  if (!session.tokenSN) return res.status(401).json({ error: 'Missing X-Token-SN header.' });
  if (!session.vtokenSecret) return res.status(401).json({ error: 'Missing X-Vtoken-Secret header.' });
  try {
    session.decryptedSecret = decryptSecret(session.vtokenSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired vtokenSecret. Re-authenticate.' });
  }
  req.session = session;
  next();
};

router.use(requireAuth);

router.get('/list', async (req, res) => {
  try {
    const url = `${KASPI_MTOKEN_URL}/v08/organizations/accounts`;
    const payload = JSON.stringify({});
    const headers = { ...signedQrPayHeaders(url, req.session, payload), 'Content-Type': 'application/json' };
    const resp = await loggedFetch(url, {
      method: 'POST',
      headers,
      body: payload,
    });
    res.json(await resp.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/statement', async (req, res) => {
  const { accountId, dateFrom, dateTo, direction, page, size } = req.body;
  if (!accountId) return res.status(400).json({ error: 'accountId required' });
  if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom and dateTo required (YYYY-MM-DD)' });

  try {
    const url = `${KASPI_MTOKEN_URL}/v08/organizations/account-statement`;
    const payload = JSON.stringify({
      AccountId: accountId,
      DateFrom: dateFrom,
      DateTo: dateTo,
      Direction: direction || 'in',
      Page: page ?? 0,
      Size: size ?? 100,
    });
    const headers = { ...signedQrPayHeaders(url, req.session, payload), 'Content-Type': 'application/json' };
    const resp = await loggedFetch(url, {
      method: 'POST',
      headers,
      body: payload,
    });
    res.json(await resp.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/statement/export', async (req, res) => {
  const { accountId, dateFrom, dateTo, format } = req.query;
  if (!accountId) return res.status(400).json({ error: 'accountId required' });
  if (!dateFrom || !dateTo) return res.status(400).json({ error: 'dateFrom and dateTo required (YYYY-MM-DD)' });
  if (format !== '1c') return res.status(400).json({ error: 'Only format=1c supported' });

  try {
    const url = `${KASPI_MTOKEN_URL}/v08/organizations/account-statement/export`;
    const payload = JSON.stringify({
      AccountId: accountId,
      DateFrom: dateFrom,
      DateTo: dateTo,
      Format: '1CClientBankExchange',
    });
    const headers = { ...signedQrPayHeaders(url, req.session, payload), 'Content-Type': 'application/json' };
    const resp = await loggedFetch(url, {
      method: 'POST',
      headers,
      body: payload,
    });
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      res.json(await resp.json());
    } else {
      res.set('Content-Type', 'text/plain; charset=windows-1251');
      res.set('Content-Disposition', `attachment; filename="statement_${accountId}_${dateFrom}_${dateTo}.txt"`);
      res.send(await resp.text());
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
