import dns from 'dns/promises';
import net from 'net';

const isPrivateIpv4 = (address) => {
  const parts = address.split('.').map(Number);
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] === 0 ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 0 && [0, 2].includes(parts[2])) ||
    (parts[0] === 192 && parts[1] === 88 && parts[2] === 99) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 198 && [18, 19].includes(parts[1])) ||
    (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
    (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
    parts[0] >= 224
  );
};

const isPrivateIp = (address) => {
  if (net.isIPv4(address)) return isPrivateIpv4(address);
  if (!net.isIPv6(address)) return true;
  const normalized = address.toLowerCase();
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('::ffff:') ||
    normalized.includes('.') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8') ||
    normalized.startsWith('2001:10') ||
    normalized.startsWith('2001:20') ||
    normalized.startsWith('2002:')
  );
};

export const validateWebhookUrl = async (value, { allowHttp = process.env.NODE_ENV !== 'production' } = {}) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Webhook URL is invalid.');
  }
  if (!['https:', ...(allowHttp ? ['http:'] : [])].includes(url.protocol)) {
    throw new Error('Webhook URL must use HTTPS.');
  }
  if (url.username || url.password) throw new Error('Webhook URL cannot contain credentials.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Webhook URL cannot target localhost.');
  }
  let addresses;
  try {
    addresses = net.isIP(hostname)
      ? [{ address: hostname, family: net.isIP(hostname) }]
      : await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Webhook URL hostname could not be resolved.');
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('Webhook URL resolves to a private or reserved address.');
  }
  url.resolvedAddress = addresses[0].address;
  url.resolvedFamily = addresses[0].family || net.isIP(addresses[0].address);
  return url;
};
