#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT;
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const FILE = path.join(DATA_DIR, 'keypair.json');

if (fs.existsSync(FILE)) {
  fs.renameSync(FILE, `${FILE}.bak`);
  console.log('Backed up old keypair.json → keypair.json.bak');
}

const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const saved = {
  privateKey: keyPair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  publicKey: keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
};
fs.writeFileSync(FILE, JSON.stringify(saved, null, 2), { encoding: 'utf8', mode: 0o600 });
console.log('Generated new ECDSA keypair → keypair.json');
console.log('⚠️  Re-authentication (SMS) required after keypair change.');
