import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

export const PORT = process.env.PORT || 3000;

// ─── ECDSA P-256 keypair (persisted to keypair.json) ───

const KEYPAIR_FILE = path.join(ROOT_DIR, 'keypair.json');

let ecKeyPair;
if (fs.existsSync(KEYPAIR_FILE)) {
  const saved = JSON.parse(fs.readFileSync(KEYPAIR_FILE, 'utf8'));
  ecKeyPair = {
    privateKey: crypto.createPrivateKey({ key: Buffer.from(saved.privateKey, 'base64'), format: 'der', type: 'pkcs8' }),
    publicKey: crypto.createPublicKey({ key: Buffer.from(saved.publicKey, 'base64'), format: 'der', type: 'spki' }),
  };
  console.log('Loaded ECDSA keypair from keypair.json');
} else {
  ecKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const saved = {
    privateKey: ecKeyPair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    publicKey: ecKeyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  fs.writeFileSync(KEYPAIR_FILE, JSON.stringify(saved, null, 2));
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

const DEVICE_FILE = path.join(ROOT_DIR, 'device.json');

let deviceId, installId, pinHash;
if (fs.existsSync(DEVICE_FILE)) {
  const saved = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
  ({ deviceId, installId, pinHash } = saved);
  console.log('Loaded device identity from device.json');
} else {
  deviceId = crypto.randomUUID().toUpperCase();
  installId = crypto.randomUUID().toUpperCase();
  pinHash = crypto.createHash('md5').update(crypto.randomBytes(16)).digest('hex');
  fs.writeFileSync(DEVICE_FILE, JSON.stringify({ deviceId, installId, pinHash }, null, 2));
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

console.log('  pk:', DEVICE.pk);
console.log('  x509:', DEVICE.x509);
console.log('  pkTag:', DEVICE.pkTag);

// ─── Kaspi Base URLs ───

export const KASPI_ENTRANCE_URL = 'https://entrance-pay.kaspi.kz';
export const KASPI_MTOKEN_URL = 'https://mtoken.kaspi.kz';
export const KASPI_QRPAY_URL = 'https://qrpay.kaspi.kz';

// ─── App version & device constants ───
// These values are hardcoded intentionally: the Kaspi API validates device
// parameters and may reject requests with arbitrary or unknown values.

export const APP = {
  version: process.env.KASPI_APP_VERSION || '4.110.1',
  build: process.env.KASPI_APP_BUILD || '1082',
  platform: 'iOS',
  platformVer: process.env.KASPI_PLATFORM_VERSION || '18.5',
  locale: 'ru-RU',
  model: 'iPhone17,3',
  brand: 'Apple',
  deviceName: 'iPhone',
  screenW: '393.0',
  screenH: '852.0',
  cfNetwork: 'CFNetwork/3826.500.131',
  darwin: 'Darwin/24.5.0',
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

export { ROOT_DIR };
