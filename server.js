import express from 'express';
import path from 'path';
import { PORT, ROOT_DIR } from './src/config.js';
import authRoutes from './src/routes/auth.js';
import invoiceRoutes from './src/routes/invoice.js';
import qrRoutes from './src/routes/qr.js';
import historyRoutes from './src/routes/history.js';
import refundRoutes from './src/routes/refund.js';
import sessionRoutes from './src/routes/session.js';
import accountRoutes from './src/routes/account.js';
import { startPolling } from './src/polling.js';
import 'dotenv/config';

const app = express();

app.use(express.json());
app.use(express.static(path.join(ROOT_DIR, 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/invoice', invoiceRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/refund', refundRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/account', accountRoutes);

app.listen(PORT, () => {
  console.log(`\n  🟢 Kaspi Pay App running at http://localhost:${PORT}\n`);
  startPolling();
});
