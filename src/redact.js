const SENSITIVE_KEY = /(authorization|cookie|secret|token|otp|pin[-_]?hash|password|signature|x-sign|phone|email)/i;

const redactObject = (value, seen) => {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';

  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => redactObject(item, seen));
    seen.delete(value);
    return result;
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactObject(item, seen);
  }
  seen.delete(value);
  return result;
};

export const redactForLog = (value) => redactObject(value, new WeakSet());
