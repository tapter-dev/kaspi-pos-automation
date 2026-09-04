import { Router } from 'express';
import { KASPI_QRPAY_URL } from '../config.js';
import { loggedFetch, signedQrPayHeaders } from '../helpers.js';
import { requireKaspiSession } from '../middleware/kaspiSession.js';

const router = Router();

router.use(requireKaspiSession);

// ─── Return (refund) ───

router.post('/create', async (req, res) => {
  const { qrOperationId, returnAmount } = req.body;
  if (!qrOperationId || !returnAmount)
    return res.status(400).json({ error: 'qrOperationId and returnAmount required' });
  try {
    const url = `${KASPI_QRPAY_URL}/v01/kaspi-qr/history-pos-return`;
    const payload = JSON.stringify({
      ReturnAmount: Number(returnAmount),
      QrOperationId: Number(qrOperationId),
      DeviceInterface: 'Pos',
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
