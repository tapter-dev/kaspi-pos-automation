#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT;
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const FILE = path.join(DATA_DIR, 'device.json');

if (fs.existsSync(FILE)) {
  fs.renameSync(FILE, `${FILE}.bak`);
  console.log('Backed up old device.json → device.json.bak');
}

const device = {
  deviceId: crypto.randomUUID().toUpperCase(),
  installId: crypto.randomUUID().toUpperCase(),
  pinHash: crypto.createHash('md5').update(crypto.randomBytes(16)).digest('hex'),
};
fs.writeFileSync(FILE, JSON.stringify(device, null, 2), { encoding: 'utf8', mode: 0o600 });
console.log('Generated new device identity → device.json');
console.log('⚠️  Re-authentication (SMS) required after device change.');
