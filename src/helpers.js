import crypto from 'crypto';
import fetch from 'node-fetch';
import { DEVICE, APP, UA_NATIVE } from './config.js';
import { computeTokenSnMac, computeXSign } from './crypto.js';
import { redactForLog } from './redact.js';

// ─── Utilities ───

export const generateUUID = () => crypto.randomUUID().toUpperCase();

export const nowISO = () => {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  return (
    d
      .toISOString()
      .replace('Z', '')
      .replace(/\.\d{3}/, `.${String(d.getMilliseconds()).padStart(3, '0')}`) +
    sign +
    hh +
    mm
  );
};

// ─── Cookie builder ───

export const entranceCookie = (extraUserToken) => {
  let c = `deviceId=${DEVICE.deviceId}; installId=${DEVICE.installId}; is_mobile_app=true; locale=${APP.locale}; ma_bld=${APP.build}; ma_platform_type=${APP.platform}; ma_platform_ver=${APP.platformVer}; ma_ver=${APP.version}; pk=${DEVICE.pk}; pkTag=${DEVICE.pkTag}; xs=R:0|E:0|RH:0|N:0`;
  if (extraUserToken) c += `; user_token=${extraUserToken}`;
  return c;
};

// ─── Extract user_token from set-cookie ───

export const extractUserToken = (resp) => {
  const raw = resp.headers.raw()['set-cookie'] || [];
  for (const c of raw) {
    const m = c.match(/user_token=([^;]+)/);
    if (m) return m[1];
  }
  return null;
};

// ─── Logged fetch wrapper ───

export const loggedFetch = async (url, options = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  console.log(`\n>>> ${method} ${url}`);
  if (options.headers) console.log('>>> Headers:', JSON.stringify(redactForLog(options.headers), null, 2));
  if (options.body) {
    try {
      console.log('>>> Body:', redactForLog(JSON.parse(options.body)));
    } catch {
      console.log('>>> Body:', options.body);
    }
  }

  const resp = await fetch(url, options);
  const cloned = resp.clone();
  let body;
  try {
    body = await cloned.json();
  } catch {
    try {
      body = await cloned.text();
    } catch {
      body = '[unreadable]';
    }
  }
  console.log(`<<< ${resp.status} ${resp.statusText}`);
  console.log(
    '<<< Response:',
    typeof body === 'object' ? JSON.stringify(redactForLog(body), null, 2) : body,
  );
  return resp;
};

// ─── Signed QR-pay headers (session passed as parameter) ───

export const signedQrPayHeaders = (url, session, body) => {
  const xsh =
    'url,X-Install-ID,X-PI,X-App-Bld,X-Platform-Ver,X-Locale,X-App-Ver,X-Device-ID,X-SV,X-Time,X-Platform-Type,X-Call,X-Kb-TokenSnMac,X-Kb-TokenSn';
  const headers = {
    'X-Kb-TokenSn': session.tokenSN,
    'X-Kb-TokenSnMac': computeTokenSnMac(session.tokenSN, session.decryptedSecret),
    'X-PI': session.profileId != null ? String(session.profileId) : '',
    'X-Install-ID': DEVICE.installId,
    'X-Device-ID': DEVICE.deviceId,
    'X-App-Ver': APP.version,
    'X-App-Bld': APP.build,
    'X-Platform-Type': APP.platform,
    'X-Platform-Ver': APP.platformVer,
    'X-Locale': APP.locale,
    'X-Time': nowISO(),
    'X-Request-ID': generateUUID(),
    'X-Call': 'notConnected',
    'X-SV': '2',
    'X-SH': xsh,
    'User-Agent': UA_NATIVE,
    Accept: '*/*',
    'Accept-Language': 'ru',
    'Accept-Encoding': 'gzip, deflate, br',
  };
  headers['X-Sign'] = computeXSign(url, headers, xsh, body);
  return headers;
};
