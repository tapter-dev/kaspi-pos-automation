import { Router } from 'express';
import { KASPI_QRPAY_URL } from '../config.js';
import { loggedFetch, signedQrPayHeaders } from '../helpers.js';
import { requireKaspiSession } from '../middleware/kaspiSession.js';

const router = Router();

router.use(requireKaspiSession);

// ─── Operations history (QR + remote) ───

router.post('/operations', async (req, res) => {
  const { endDate, lastTransactionDate, statementPeriodCode } = req.body;
  if (!endDate) return res.status(400).json({ error: 'endDate required' });
  try {
    const url = `${KASPI_QRPAY_URL}/v02/history/operations`;
    const payload = JSON.stringify({
      EndDate: endDate,
      LastTransactionDate: lastTransactionDate || '',
      StatementPeriodCode: statementPeriodCode ?? 0,
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

// ─── Operation details ───

router.post('/details', async (req, res) => {
  const { id, operationMethod } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const url = `${KASPI_QRPAY_URL}/v01/kaspi-qr/operations/details`;
    const payload = JSON.stringify({
      Id: Number(id),
      OperationMethod: operationMethod ?? 0,
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

export default router;
