import crypto from 'crypto';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import path from 'path';
import { ROOT_DIR } from './config.js';
import authRoutes from './routes/auth.js';
import invoiceRoutes from './routes/invoice.js';
import qrRoutes from './routes/qr.js';
import historyRoutes from './routes/history.js';
import refundRoutes from './routes/refund.js';
import sessionRoutes from './routes/session.js';
import v1Routes from './routes/v1.js';
import { getPool } from './database/client.js';
import dashboardAuthRoutes from './routes/dashboardAuth.js';
import { requireSameOrigin } from './middleware/sameOrigin.js';
import dashboardKaspiRoutes from './routes/dashboardKaspi.js';
import dashboardWebhookRoutes from './routes/dashboardWebhooks.js';
import dashboardApiKeyRoutes from './routes/dashboardApiKeys.js';
import dashboardDataRoutes from './routes/dashboardData.js';
import dashboardTeamRoutes from './routes/dashboardTeam.js';
import dashboardPaymentRoutes from './routes/dashboardPayments.js';
import dashboardSubscriptionRoutes from './routes/dashboardSubscriptions.js';
import dashboardPrintableQrRoutes from './routes/dashboardPrintableQr.js';
import dashboardBillingRoutes from './routes/dashboardBilling.js';
import dashboardAccessRoutes from './routes/dashboardAccess.js';
import publicPaymentRequestRoutes from './routes/publicPaymentRequests.js';
import adminRoutes from './routes/admin.js';
import { getPaymentStatusQueue } from './queue/client.js';

const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' },
});

const dashboardAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => !['/login', '/register', '/request-password-reset', '/reset-password'].includes(req.path),
  message: { error: 'Too many sign-in attempts. Try again later.' },
});

const publicApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.API_RATE_LIMIT || 600),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'API rate limit exceeded. Try again shortly.' },
});

const kaspiAuthLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many Kaspi authentication attempts. Try again later.' },
});

const publicPaymentRequestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many payment QR requests. Try again in a minute.' },
});

const validatePublicOrigin = () => {
  if (!process.env.DATABASE_URL || process.env.NODE_ENV !== 'production') return;
  if (!process.env.APP_ORIGIN) throw new Error('APP_ORIGIN is required in production.');
  let origin;
  try {
    origin = new URL(process.env.APP_ORIGIN);
  } catch {
    throw new Error('APP_ORIGIN must be a valid absolute origin.');
  }
  const localDevelopment = ['localhost', '127.0.0.1', '::1'].includes(origin.hostname);
  if ((!localDevelopment && origin.protocol !== 'https:') || origin.origin !== process.env.APP_ORIGIN) {
    throw new Error('APP_ORIGIN must be an exact HTTPS origin without a path or trailing slash.');
  }
};

const waitForRedis = async () => {
  let timeout;
  try {
    await Promise.race([
      getPaymentStatusQueue().waitUntilReady(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Redis readiness timed out.')), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

export const createApp = () => {
  if (process.env.DATABASE_URL && (!process.env.API_KEY_PEPPER || process.env.API_KEY_PEPPER.length < 32)) {
    throw new Error('API_KEY_PEPPER must contain at least 32 characters when DATABASE_URL is configured.');
  }
  if (
    process.env.DATABASE_URL &&
    (!process.env.DASHBOARD_SESSION_SECRET || process.env.DASHBOARD_SESSION_SECRET.length < 32)
  ) {
    throw new Error('DASHBOARD_SESSION_SECRET must contain at least 32 characters when DATABASE_URL is configured.');
  }
  validatePublicOrigin();

  const app = express();
  const databaseEnabled = Boolean(process.env.DATABASE_URL);
  const legacyApiEnabled =
    process.env.ENABLE_LEGACY_API === 'true' || (!databaseEnabled && process.env.ENABLE_LEGACY_API !== 'false');
  app.locals.legacyApiEnabled = legacyApiEnabled;

  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

  app.use((req, res, next) => {
    req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    const started = Date.now();
    res.on('finish', () => {
      if (process.env.REQUEST_LOGS === 'false') return;
      console.log(
        JSON.stringify({
          type: 'http_request',
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - started,
          tenantId: req.auth?.tenantId || req.auth?.tenant_id,
        }),
      );
    });
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", ...(legacyApiEnabled ? ["'unsafe-inline'"] : [])],
          scriptSrcAttr: legacyApiEnabled ? ["'unsafe-inline'"] : ["'none'"],
          styleSrc: ["'self'", ...(legacyApiEnabled ? ["'unsafe-inline'"] : [])],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(express.static(path.join(ROOT_DIR, 'public'), { index: false }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/', (req, res) => {
    if (databaseEnabled) return res.redirect('/dashboard');
    return res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
  });
  app.get('/dashboard', (req, res) => res.sendFile(path.join(ROOT_DIR, 'public', 'dashboard.html')));
  app.get('/admin', (req, res) => res.sendFile(path.join(ROOT_DIR, 'public', 'admin.html')));
  app.get('/api-docs', (req, res) => res.sendFile(path.join(ROOT_DIR, 'public', 'api-docs.html')));
  app.get(['/pay', '/pay/:token'], (req, res) => res.sendFile(path.join(ROOT_DIR, 'public', 'pay.html')));
  app.get([
    '/guides/cashier-number',
    '/guides/cashier-troubleshooting',
    '/guides/trebovaniya-k-nomeru-kassira',
    '/guides/kassir-ne-podklyuchaetsya',
  ], (req, res) =>
    res.sendFile(path.join(ROOT_DIR, 'public', 'guide.html')),
  );

  app.get('/health', (req, res) => res.json({ status: 'ok', requestId: req.requestId }));
  app.get('/ready', async (req, res) => {
    if (!process.env.DATABASE_URL) return res.json({ status: 'ready', database: 'not-configured' });
    try {
      await Promise.all([
        getPool().query('SELECT 1'),
        waitForRedis(),
      ]);
      return res.json({ status: 'ready', database: 'ok', redis: 'ok' });
    } catch {
      return res.status(503).json({ status: 'not-ready', dependency: 'unavailable' });
    }
  });

  if (legacyApiEnabled) {
    app.use('/api/auth', authLimiter, authRoutes);
    app.use('/api/invoice', invoiceRoutes);
    app.use('/api/qr', qrRoutes);
    app.use('/api/history', historyRoutes);
    app.use('/api/refund', refundRoutes);
    app.use('/api/session', sessionRoutes);
  }
  if (databaseEnabled) {
    app.use('/api/dashboard/auth', dashboardAuthLimiter, requireSameOrigin, dashboardAuthRoutes);
    app.use('/api/dashboard/kaspi/connection/auth', kaspiAuthLimiter);
    app.use('/api/dashboard/kaspi', requireSameOrigin, dashboardKaspiRoutes);
    app.use('/api/dashboard/webhooks', requireSameOrigin, dashboardWebhookRoutes);
    app.use('/api/dashboard/api-keys', requireSameOrigin, dashboardApiKeyRoutes);
    app.use('/api/dashboard/data', requireSameOrigin, dashboardDataRoutes);
    app.use('/api/dashboard/team', requireSameOrigin, dashboardTeamRoutes);
    app.use('/api/dashboard/payments', requireSameOrigin, dashboardPaymentRoutes);
    app.use('/api/dashboard/subscriptions', requireSameOrigin, dashboardSubscriptionRoutes);
    app.use('/api/dashboard/printable-qr', requireSameOrigin, dashboardPrintableQrRoutes);
    app.use('/api/dashboard/billing', requireSameOrigin, dashboardBillingRoutes);
    app.use('/api/dashboard/access', requireSameOrigin, dashboardAccessRoutes);
    app.use('/api/public/payment-requests', publicPaymentRequestLimiter, publicPaymentRequestRoutes);
    app.use('/api/admin', requireSameOrigin, adminRoutes);
    app.use('/api/v1', publicApiLimiter, v1Routes);
  }

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found.', requestId: req.requestId });
  });

  app.use((err, req, res, _next) => {
    console.error(`[${req.requestId}] Unhandled request error:`, err);
    res.status(err.status || 500).json({
      error: err.status && err.status < 500 ? err.message : 'Internal server error.',
      requestId: req.requestId,
    });
  });

  return app;
};
