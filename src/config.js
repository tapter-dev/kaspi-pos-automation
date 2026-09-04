import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT_DIR;
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

const readPrivateJson = (file) => {
  fs.chmodSync(file, 0o600);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

const writePrivateJson = (file, value) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });

const readBase64Json = (name) => {
  const encoded = process.env[name];
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    throw new Error(`${name} must contain base64-encoded JSON.`);
  }
};

export const PORT = process.env.PORT || 3000;

// ─── ECDSA P-256 keypair (persisted to keypair.json) ───

const KEYPAIR_FILE = path.join(DATA_DIR, 'keypair.json');

let ecKeyPair;
if (fs.existsSync(KEYPAIR_FILE)) {
  const saved = readPrivateJson(KEYPAIR_FILE);
  ecKeyPair = {
    privateKey: crypto.createPrivateKey({ key: Buffer.from(saved.privateKey, 'base64'), format: 'der', type: 'pkcs8' }),
    publicKey: crypto.createPublicKey({ key: Buffer.from(saved.publicKey, 'base64'), format: 'der', type: 'spki' }),
  };
  console.log('Loaded ECDSA keypair from keypair.json');
} else if (process.env.KASPI_KEYPAIR_JSON_BASE64) {
  const saved = readBase64Json('KASPI_KEYPAIR_JSON_BASE64');
  ecKeyPair = {
    privateKey: crypto.createPrivateKey({ key: Buffer.from(saved.privateKey, 'base64'), format: 'der', type: 'pkcs8' }),
    publicKey: crypto.createPublicKey({ key: Buffer.from(saved.publicKey, 'base64'), format: 'der', type: 'spki' }),
  };
  console.log('Loaded ECDSA keypair from the deployment secret.');
} else {
  ecKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const saved = {
    privateKey: ecKeyPair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    publicKey: ecKeyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  writePrivateJson(KEYPAIR_FILE, saved);
  console.log('Generated new ECDSA keypair → saved to keypair.json');
}

export { ecKeyPair };

// Uncompressed EC public key point (base64)
const pubKeyDer = ecKeyPair.publicKey.export({ type: 'spki', format: 'der' });
const x509B64 = pubKeyDer.toString('base64');
const uncompressedPoint = pubKeyDer.slice(pubKeyDer.length - 65);
const pkB64 = uncompressedPoint.toString('base64');
const pkTagHash = crypto.createHash('md5').update(pkB64).digest('hex');

// ─── Device identity (persisted to device.json) ───

const DEVICE_FILE = path.join(DATA_DIR, 'device.json');

let deviceId, installId, pinHash;
if (fs.existsSync(DEVICE_FILE)) {
  const saved = readPrivateJson(DEVICE_FILE);
  ({ deviceId, installId, pinHash } = saved);
  console.log('Loaded device identity from device.json');
} else if (process.env.KASPI_DEVICE_JSON_BASE64) {
  const saved = readBase64Json('KASPI_DEVICE_JSON_BASE64');
  ({ deviceId, installId, pinHash } = saved);
  if (![deviceId, installId, pinHash].every((value) => typeof value === 'string' && value.length > 0)) {
    throw new Error('KASPI_DEVICE_JSON_BASE64 is missing required identity fields.');
  }
  console.log('Loaded device identity from the deployment secret.');
} else {
  deviceId = crypto.randomUUID().toUpperCase();
  installId = crypto.randomUUID().toUpperCase();
  pinHash = crypto.createHash('md5').update(crypto.randomBytes(16)).digest('hex');
  writePrivateJson(DEVICE_FILE, { deviceId, installId, pinHash });
  console.log('Generated new device identity → saved to device.json');
}

export const DEVICE = {
  deviceId,
  installId,
  pk: pkB64,
  pkTag: pkTagHash,
  pinHash,
  x509: x509B64,
};

if (process.env.NODE_ENV !== 'test') console.log('Kaspi device identity is ready.');

// ─── Kaspi Base URLs ───

export const KASPI_ENTRANCE_URL = process.env.KASPI_ENTRANCE_URL || 'https://entrance-pay.kaspi.kz';
export const KASPI_MTOKEN_URL = process.env.KASPI_MTOKEN_URL || 'https://mtoken.kaspi.kz';
export const KASPI_QRPAY_URL = process.env.KASPI_QRPAY_URL || 'https://qrpay.kaspi.kz';

// ─── App version & device constants ───
// Defaults match a known-good Kaspi Pay client. Override via .env if needed.
// ⚠️ The Kaspi API validates these parameters and may reject unknown values.

const kaspiClientSetting = (name, fallback) =>
  process.env[`KASPI_${name}`] || (!process.env.DATABASE_URL ? process.env[name] : undefined) || fallback;

export const APP = {
  version: kaspiClientSetting('APP_VERSION', '4.112.1'),
  build: kaspiClientSetting('APP_BUILD', '1107'),
  platform: kaspiClientSetting('APP_PLATFORM', 'iOS'),
  platformVer: kaspiClientSetting('APP_PLATFORM_VER', '18.4'),
  locale: kaspiClientSetting('APP_LOCALE', 'ru-RU'),
  model: kaspiClientSetting('APP_MODEL', 'iPhone16,2'),
  brand: kaspiClientSetting('APP_BRAND', 'Apple'),
  deviceName: kaspiClientSetting('APP_DEVICE_NAME', 'iPhone'),
  screenW: kaspiClientSetting('APP_SCREEN_W', '430.0'),
  screenH: kaspiClientSetting('APP_SCREEN_H', '932.0'),
  cfNetwork: kaspiClientSetting('APP_CFNETWORK', 'CFNetwork/3826.400.120'),
  darwin: kaspiClientSetting('APP_DARWIN', 'Darwin/24.4.0'),
};

export const UA_NATIVE = `Kaspi%20Pay/${APP.build} ${APP.cfNetwork} ${APP.darwin}`;
export const UA_BROWSER = `Mozilla/5.0 (iPhone; CPU iPhone OS ${APP.platformVer.replace('.', '_')} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148`;

export const ENTRANCE_HEADERS_BASE = {
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  'Accept-Language': 'ru',
  'Accept-Encoding': 'gzip, deflate, br',
  Origin: KASPI_ENTRANCE_URL,
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  'User-Agent': UA_BROWSER,
};

export { DATA_DIR, ROOT_DIR };
