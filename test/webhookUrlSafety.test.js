import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateWebhookUrl } from '../src/webhooks/urlSafety.js';

describe('webhook URL safety', () => {
  it('rejects localhost and private addresses', async () => {
    await assert.rejects(() => validateWebhookUrl('http://localhost/hook'), /localhost/);
    await assert.rejects(() => validateWebhookUrl('http://127.0.0.1/hook'), /private/);
    await assert.rejects(() => validateWebhookUrl('http://10.0.0.1/hook'), /private/);
    await assert.rejects(() => validateWebhookUrl('http://169.254.169.254/latest/meta-data'), /private/);
    await assert.rejects(() => validateWebhookUrl('http://100.64.0.1/hook'), /reserved/);
    await assert.rejects(() => validateWebhookUrl('http://198.51.100.1/hook'), /reserved/);
    await assert.rejects(() => validateWebhookUrl('http://[::ffff:127.0.0.1]/hook'), /reserved/);
  });

  it('rejects non-HTTPS callbacks in production mode', async () => {
    await assert.rejects(() => validateWebhookUrl('http://8.8.8.8/hook', { allowHttp: false }), /HTTPS/);
  });

  it('accepts a public HTTPS address', async () => {
    const url = await validateWebhookUrl('https://8.8.8.8/hook', { allowHttp: false });
    assert.equal(url.hostname, '8.8.8.8');
  });
});
