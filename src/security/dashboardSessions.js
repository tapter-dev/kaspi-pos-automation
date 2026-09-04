import crypto from 'crypto';

export const DASHBOARD_COOKIE = 'kpa_session';

export const createSessionToken = () => crypto.randomBytes(32).toString('base64url');

export const hashSessionToken = (token, secret = process.env.DASHBOARD_SESSION_SECRET || '') =>
  crypto.createHmac('sha256', secret).update(token).digest('hex');

export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

export const clearSessionCookieOptions = () => {
  const options = sessionCookieOptions();
  delete options.maxAge;
  return options;
};
