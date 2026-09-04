import crypto from 'crypto';

export const hashApiKey = (apiKey, pepper = process.env.API_KEY_PEPPER || '') =>
  crypto.createHmac('sha256', pepper).update(apiKey).digest('hex');

export const generateApiKey = (environment = 'live', pepper = process.env.API_KEY_PEPPER || '') => {
  if (!['live', 'test'].includes(environment)) throw new Error('API key environment must be live or test.');

  const prefix = `kpa_${environment}_${crypto.randomBytes(5).toString('hex')}`;
  const apiKey = `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
  return { apiKey, prefix, hash: hashApiKey(apiKey, pepper) };
};

export const verifyApiKeyHash = (apiKey, expectedHash, pepper = process.env.API_KEY_PEPPER || '') => {
  if (!apiKey || !expectedHash) return false;
  const actual = Buffer.from(hashApiKey(apiKey, pepper), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};
