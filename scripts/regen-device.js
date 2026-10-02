#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'device.json');

if (fs.existsSync(FILE)) {
  fs.renameSync(FILE, `${FILE}.bak`);
  console.log('Backed up old device.json → device.json.bak');
}

const device = {
  deviceId: crypto.randomUUID().toUpperCase(),
  installId: crypto.randomUUID().toUpperCase(),
  pinHash: crypto.createHash('sha256').update(crypto.randomBytes(16)).digest('hex'),
};
fs.writeFileSync(FILE, JSON.stringify(device, null, 2));
console.log('Generated new device identity → device.json');
console.log(`  deviceId:  ${device.deviceId}`);
console.log(`  installId: ${device.installId}`);
console.log(`  pinHash:   ${device.pinHash}`);
console.log('⚠️  Re-authentication (SMS) required after device change.');
