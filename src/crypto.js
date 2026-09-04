import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR, ecKeyPair } from './config.js';

const ECDH_FILE = path.join(DATA_DIR, 'ecdh-keypair.json');

// ─── ECDH ───

const vtokenSuite = 'OCRA-1:HOTP-SHA256-6:QH64-T1M';

// ─── AES-256-GCM encryption for vtokenSecret ───

if (!/^[0-9a-fA-F]{64}$/.test(process.env.TOKEN_SECRET_KEY || '')) {
  throw new Error(
    'TOKEN_SECRET_KEY must be exactly 64 hexadecimal characters. Generate one with: openssl rand -hex 32',
  );
}
const ENCRYPTION_KEY = Buffer.from(process.env.TOKEN_SECRET_KEY, 'hex');

export const encryptSecret = (secretBuffer) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(secretBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
};

export const decryptSecret = (tokenB64) => {
  const buf = Buffer.from(tokenB64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
};

export const encryptJson = (value) => Buffer.from(encryptSecret(Buffer.from(JSON.stringify(value), 'utf8')), 'base64');

export const decryptJson = (encrypted) => {
  const token = Buffer.isBuffer(encrypted) ? encrypted.toString('base64') : String(encrypted);
  return JSON.parse(decryptSecret(token).toString('utf8'));
};

let lastEcdhKeyPair = null;

export const createECDHAgreement = () => {
  const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicX509: keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: keyPair.privateKey,
  };
};

export const completeECDHAgreement = (serverX509B64, privateKey) => {
  const serverPublicKey = crypto.createPublicKey({
    key: Buffer.from(serverX509B64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  return crypto.diffieHellman({ privateKey, publicKey: serverPublicKey });
};

export const generateECDH = () => {
  lastEcdhKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  // Persist ECDH private key so refresh (SignInLite) can reuse it
  const saved = {
    privateKey: lastEcdhKeyPair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    publicKey: lastEcdhKeyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  fs.writeFileSync(ECDH_FILE, JSON.stringify(saved, null, 2), { encoding: 'utf8', mode: 0o600 });
  const spki = lastEcdhKeyPair.publicKey.export({ type: 'spki', format: 'der' });
  return spki.toString('base64');
};

export const completeECDH = (serverX509B64) => {
  if (!lastEcdhKeyPair) throw new Error('No ECDH keypair generated');
  const serverPubKey = crypto.createPublicKey({
    key: Buffer.from(serverX509B64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  const secret = crypto.diffieHellman({
    privateKey: lastEcdhKeyPair.privateKey,
    publicKey: serverPubKey,
  });
  console.log('ECDH shared secret derived, length:', secret.length);
  lastEcdhKeyPair = null;
  return secret;
};

export const completeECDHWithSaved = (serverX509B64) => {
  if (!fs.existsSync(ECDH_FILE)) throw new Error('No saved ECDH keypair (ecdh-keypair.json missing)');
  fs.chmodSync(ECDH_FILE, 0o600);
  const saved = JSON.parse(fs.readFileSync(ECDH_FILE, 'utf8'));
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(saved.privateKey, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const serverPubKey = crypto.createPublicKey({
    key: Buffer.from(serverX509B64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  const secret = crypto.diffieHellman({ privateKey, publicKey: serverPubKey });
  console.log('ECDH (saved key) shared secret derived, length:', secret.length);
  return secret;
};

// ─── Helpers ───

const hexToBytes = (hex) => {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return Buffer.from(bytes);
};

// ─── OCRA-1 TOTP (matches Kaspi vtoken) ───

export const computeTokenSnMac = (tokenSN, secret) => {
  if (!secret) return '000000';

  const timeStep = BigInt(Date.now()) / BigInt(30000);
  const timeHex = timeStep.toString(16);

  const qHex = Buffer.from(tokenSN || '00000000')
    .toString('hex')
    .substring(0, 64);

  const suiteBytes = Buffer.from(vtokenSuite);
  const separator = Buffer.from([0x00]);

  const qPadded = qHex.padEnd(256, '0');
  const qBytes = hexToBytes(qPadded);

  const tPadded = timeHex.padStart(16, '0');
  const tBytes = hexToBytes(tPadded);

  const dataBuffer = Buffer.concat([suiteBytes, separator, qBytes, tBytes]);

  const hash = crypto.createHmac('sha256', secret).update(dataBuffer).digest();

  // Dynamic truncation (RFC 4226)
  const offset = hash[hash.length - 1] & 0x0f;
  const binCode =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  return (binCode % 1000000).toString().padStart(6, '0');
};

// ─── ECDSA signing ───

export const ecSign = (data) => {
  const sign = crypto.createSign('SHA256');
  sign.update(data);
  sign.end();
  return sign.sign(ecKeyPair.privateKey).toString('base64');
};

export const signDataPayload = (dataB64) => ecSign(dataB64);

export const computeXSU = (url) => crypto.createHash('md5').update(url.toLowerCase()).digest('hex');

export const computeXSign = (url, headers, xshList, body) => {
  const keys = xshList.split(',');
  const lines = [];
  for (const name of keys) {
    if (name === 'url') {
      lines.push('url:' + url.toLowerCase());
    } else {
      lines.push(name.toLowerCase() + ':' + (headers[name] || ''));
    }
  }
  let signText = lines.join('\n');
  if (body) {
    signText += '\n' + body;
  }
  const hash = crypto.createHash('sha256').update(signText, 'utf8').digest();
  return ecSign(hash);
};
