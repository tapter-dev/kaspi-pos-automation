import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';

const WEBHOOKS_FILE = path.join(DATA_DIR, 'webhooks.json');

/**
 * Читает webhooks.json и возвращает массив вебхуков.
 * При ошибке чтения/парсинга возвращает [].
 */
export const loadWebhooks = () => {
  try {
    const raw = fs.readFileSync(WEBHOOKS_FILE, 'utf8');
    const hooks = JSON.parse(raw);
    if (!Array.isArray(hooks)) return [];
    return hooks;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[WEBHOOK STORE] Error reading webhooks.json:', err.message);
    }
    return [];
  }
};

/**
 * Возвращает вебхуки, подписанные на указанное событие.
 */
export const getWebhooksByEvent = (event) => {
  return loadWebhooks().filter((hook) => hook.url && Array.isArray(hook.events) && hook.events.includes(event));
};
