import { PORT } from './src/config.js';
import { createApp } from './src/app.js';
import { startPolling, stopPolling } from './src/polling.js';
import { closePool } from './src/database/client.js';
import { closeQueues } from './src/queue/client.js';
import 'dotenv/config';

const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`\n  🟢 Kaspi Pay App running at http://localhost:${PORT}\n`);
  if (app.locals.legacyApiEnabled) startPolling();
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  stopPolling();
  const forceTimer = setTimeout(() => process.exit(1), 10_000);
  forceTimer.unref();
  server.close(async () => {
    try {
      await Promise.all([closeQueues(), closePool()]);
      process.exit(0);
    } catch (err) {
      console.error('Graceful shutdown failed:', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
