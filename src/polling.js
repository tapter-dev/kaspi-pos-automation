import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { DATA_DIR, KASPI_QRPAY_URL } from './config.js';
import { signedQrPayHeaders } from './helpers.js';
import { decryptSecret } from './crypto.js';
import { getWebhooksByEvent } from './webhookStore.js';
import { logger } from './logger.js';
import { createWebhookSignature, isRetryableWebhookStatus, isSuccessfulWebhookStatus } from './webhookDelivery.js';

const TRACKED_FILE = path.join(DATA_DIR, 'tracked-payments.json');

// ─── Tracked payments ───

const trackedPayments = new Map();

// ─── Persistence ───

const saveTracked = () => {
  try {
    const data = Object.fromEntries(trackedPayments);
    fs.writeFileSync(TRACKED_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error('POLLING', 'Failed to save tracked payments', err.message);
  }
};

const loadTracked = () => {
  try {
    if (!fs.existsSync(TRACKED_FILE)) return;
    const raw = fs.readFileSync(TRACKED_FILE, 'utf8');
    const data = JSON.parse(raw);
    for (const [id, entry] of Object.entries(data)) {
      trackedPayments.set(id, entry);
    }
    if (trackedPayments.size > 0) {
      logger.info('POLLING', `Restored ${trackedPayments.size} tracked payments from file`);
    }
  } catch (err) {
    logger.error('POLLING', 'Failed to load tracked payments', err.message);
  }
};

// ─── Pending retries (persisted) ───

const RETRY_FILE = path.join(DATA_DIR, 'webhook-retries.json');
let pendingRetries = [];

const saveRetries = () => {
  try {
    fs.writeFileSync(RETRY_FILE, JSON.stringify(pendingRetries, null, 2));
  } catch (err) {
    logger.error('WEBHOOK', 'Failed to save retries', err.message);
  }
};

const loadRetries = () => {
  try {
    if (!fs.existsSync(RETRY_FILE)) return;
    const raw = fs.readFileSync(RETRY_FILE, 'utf8');
    pendingRetries = JSON.parse(raw);
    if (pendingRetries.length > 0) {
      logger.info('WEBHOOK', `Restored ${pendingRetries.length} pending retries from file`);
    }
  } catch (err) {
    logger.error('WEBHOOK', 'Failed to load retries', err.message);
    pendingRetries = [];
  }
};

// ─── Status → event mapping ───

const QR_FINAL_STATUSES = {
  Processed: 'payment.success',
  CancelledByUser: 'payment.failed',
  NotConfirmedByUser: 'payment.failed',
  CancelledByExternalSource: 'payment.failed',
  ProcessingFailed: 'payment.failed',
  Rejected: 'payment.failed',
  InsufficientFunds: 'payment.failed',
  InsufficientFundsError: 'payment.failed',
  Error: 'payment.failed',
  IrisSrcBlockCode1: 'payment.failed',
  IrisSrcBlockCode3: 'payment.failed',
  IrisSrcBlockCode9: 'payment.failed',
  IrisDestBlockCode3: 'payment.failed',
  IrisDestBlockCode5: 'payment.failed',
  IrisDestBlockCode7: 'payment.failed',
  IrisDestBlockCode10: 'payment.failed',
  QrTokenDiscarded: 'payment.expired',
  Expired: 'payment.expired',
};

const INVOICE_FINAL_STATUSES = {
  Processed: 'payment.success',
  RemotePaymentCanceled: 'payment.failed',
  RemotePaymentRejected: 'payment.failed',
  Expired: 'payment.expired',
};

const QR_INTERMEDIATE = new Set(['QrTokenCreated', 'Wait']);
const INVOICE_INTERMEDIATE = new Set(['RemotePaymentCreated']);

// ─── Track a payment ───

export const trackPayment = (paymentId, type, sessionHeaders, meta = {}) => {
  trackedPayments.set(String(paymentId), {
    paymentId: String(paymentId),
    type,
    status: type === 'qr' ? 'QrTokenCreated' : 'RemotePaymentCreated',
    sessionHeaders,
    meta,
    createdAt: Date.now(),
    retryCount: 0,
  });
  saveTracked();
  logger.info('POLLING', `Tracking ${type} payment ${paymentId}`);
};

// ─── Fetch status from Kaspi (quiet — no loggedFetch) ───

const fetchStatus = async (entry) => {
  const { paymentId, type, sessionHeaders } = entry;

  let decryptedSecret;
  try {
    decryptedSecret = decryptSecret(sessionHeaders.vtokenSecret);
  } catch {
    logger.error('POLLING', `Failed to decrypt session for payment ${paymentId} — session may have expired`);
    return { error: 'session_expired' };
  }

  const session = {
    tokenSN: sessionHeaders.tokenSN,
    decryptedSecret,
    profileId: sessionHeaders.profileId,
  };

  let url;
  if (type === 'qr') {
    url = `${KASPI_QRPAY_URL}/v02/kaspi-qr/status?qrOperationId=${paymentId}`;
  } else {
    url = `${KASPI_QRPAY_URL}/v02/remote/details?operationId=${paymentId}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, {
      headers: signedQrPayHeaders(url, session),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const json = await resp.json();
    return json;
  } catch (err) {
    logger.error('POLLING', `Error fetching status for ${paymentId}:`, err.message);
    return null;
  }
};

// ─── Send webhooks ───

const fetchWithTimeout = async (url, options, timeoutMs = 10000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
};

const sendWebhook = async (hook, payload, attempt = 1) => {
  const body = JSON.stringify(payload);
  const signature = createWebhookSignature(body, hook.secret);

  const clearPendingRetry = () => {
    pendingRetries = pendingRetries.filter(
      (r) =>
        !(r.hook.url === hook.url && r.payload.paymentId === payload.paymentId && r.payload.event === payload.event),
    );
  };

  const queueRetry = () => {
    clearPendingRetry();
    pendingRetries.push({
      hook,
      payload,
      attempt: attempt + 1,
      executeAfter: Date.now() + (attempt === 1 ? 5000 : 30000),
    });
    saveRetries();
  };

  try {
    const resp = await fetchWithTimeout(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
      },
      body,
    });

    if (!isSuccessfulWebhookStatus(resp.status)) {
      const retryable = isRetryableWebhookStatus(resp.status);
      logger.warn('WEBHOOK', `→ ${hook.url} | attempt ${attempt} returned ${resp.status} ${resp.statusText}`);
      if (retryable && attempt < 3) {
        queueRetry();
      } else {
        clearPendingRetry();
        saveRetries();
        logger.error(
          'WEBHOOK',
          `→ ${hook.url} | ${retryable ? 'exhausted retries' : 'permanent delivery failure'} (${resp.status})`,
        );
      }
      return;
    }

    logger.info('WEBHOOK', `→ ${hook.url} | ${resp.status} ${resp.statusText}`);
    clearPendingRetry();
    saveRetries();
  } catch (err) {
    logger.error('WEBHOOK', `→ ${hook.url} | attempt ${attempt} FAILED: ${err.message}`);
    if (attempt < 3) {
      queueRetry();
    } else {
      logger.error('WEBHOOK', `→ ${hook.url} | FAILED after 3 attempts`);
      clearPendingRetry();
      saveRetries();
    }
  }
};

const sendWebhooks = (event, payload) => {
  const hooks = getWebhooksByEvent(event);
  for (const hook of hooks) {
    sendWebhook(hook, payload);
  }
};

// ─── Process pending retries ───

const processRetries = async () => {
  const now = Date.now();
  const due = pendingRetries.filter((r) => r.executeAfter <= now);
  // Remove due items from list before executing (they'll be re-added on failure)
  pendingRetries = pendingRetries.filter((r) => r.executeAfter > now);
  saveRetries();

  for (const r of due) {
    await sendWebhook(r.hook, r.payload, r.attempt);
  }
};

// ─── Resolve event from status ───

const resolveEvent = (type, status) => {
  if (type === 'qr') {
    if (QR_INTERMEDIATE.has(status)) return null;
    return QR_FINAL_STATUSES[status] || 'payment.failed';
  } else {
    if (INVOICE_INTERMEDIATE.has(status)) return null;
    return INVOICE_FINAL_STATUSES[status] || 'payment.failed';
  }
};

// ─── Poll cycle ───

const pollOnce = async () => {
  let changed = false;

  for (const [id, entry] of trackedPayments) {
    // TTL check via expireDate
    if (entry.meta.expireDate) {
      const expiry = new Date(entry.meta.expireDate).getTime();
      if (Date.now() > expiry && resolveEvent(entry.type, entry.status) === null) {
        logger.info('POLLING', `Payment ${id} expired (TTL)`);
        sendWebhooks(
          'payment.expired',
          buildPayload('payment.expired', entry, { Status: 'Expired', StatusDesc: 'Время оплаты истекло' }),
        );
        trackedPayments.delete(id);
        changed = true;
        continue;
      }
    }

    const result = await fetchStatus(entry);

    // Handle session expiration
    if (result && result.error === 'session_expired') {
      entry.retryCount++;
      if (entry.retryCount > 3) {
        logger.warn('POLLING', `Payment ${id} — session expired, sending session.expired webhook`);
        sendWebhooks(
          'payment.failed',
          buildPayload('payment.failed', entry, {
            Status: 'SessionExpired',
            StatusDesc: 'Сессия Kaspi истекла, невозможно проверить статус платежа',
          }),
        );
        trackedPayments.delete(id);
        changed = true;
      }
      continue;
    }

    if (!result || !result.Data) {
      // Kaspi returns StatusCode -101001 when session was evicted (login from another device)
      if (result && result.StatusCode === -101001) {
        logger.warn('POLLING', `Payment ${id} — session evicted (StatusCode -101001)`);
        sendWebhooks(
          'payment.lost',
          buildPayload('payment.lost', entry, {
            Status: 'SessionExpired',
            StatusDesc: 'Сессия Kaspi вытеснена (вход с другого устройства), статус платежа неизвестен',
          }),
        );
        trackedPayments.delete(id);
        changed = true;
        continue;
      }

      entry.retryCount++;
      if (entry.retryCount > 10) {
        logger.warn('POLLING', `Removing payment ${id} after 10 failed attempts`);
        sendWebhooks(
          'payment.lost',
          buildPayload('payment.lost', entry, {
            Status: 'PollingFailed',
            StatusDesc: `Не удалось получить статус платежа после ${entry.retryCount} попыток`,
          }),
        );
        trackedPayments.delete(id);
        changed = true;
      }
      continue;
    }

    // Reset retry count on successful fetch
    entry.retryCount = 0;

    const newStatus = result.Data.Status;
    if (newStatus === entry.status) continue;

    logger.info('POLLING', `Payment ${id}: ${entry.status} → ${newStatus}`);
    entry.status = newStatus;
    changed = true;

    const event = resolveEvent(entry.type, newStatus);
    if (event) {
      sendWebhooks(event, buildPayload(event, entry, result.Data));
      trackedPayments.delete(id);
    }
  }

  if (changed) {
    saveTracked();
  }
};

const buildPayload = (event, entry, data) => ({
  event,
  paymentId: entry.paymentId,
  type: entry.type,
  status: data.Status || entry.status,
  statusDesc: data.StatusDesc || '',
  amount: entry.meta.amount || data.Amount || null,
  qrToken: entry.meta.qrToken || null,
  receiptUrl: entry.meta.receiptUrl || data.ReceiptUrl || null,
  orderNumber: entry.meta.orderNumber || data.OrderNumber || null,
  data,
  timestamp: new Date().toISOString(),
});

// ─── Polling loop (setTimeout-based, no overlap) ───

let pollActive = false;
let pollTimer = null;
const POLL_MS = 3000;

const scheduleNext = () => {
  if (!pollActive) return;
  pollTimer = setTimeout(async () => {
    try {
      if (trackedPayments.size > 0) {
        await pollOnce();
      }
      // Process pending webhook retries
      if (pendingRetries.length > 0) {
        await processRetries();
      }
    } catch (err) {
      logger.error('POLLING', 'Unexpected error:', err.message);
    }
    scheduleNext();
  }, POLL_MS);
};

export const startPolling = () => {
  if (pollActive) return;

  // Load persisted state
  loadTracked();
  loadRetries();

  pollActive = true;
  scheduleNext();
  logger.info('POLLING', 'Started (interval: 3s, persistence: enabled)');
};

export const stopPolling = () => {
  pollActive = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  saveTracked();
  saveRetries();
  logger.info('POLLING', 'Stopped');
};

export const getTrackedPayments = () => Object.fromEntries(trackedPayments);
