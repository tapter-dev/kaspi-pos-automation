import { KASPI_QRPAY_URL } from '../config.js';
import { decryptSecret } from '../crypto.js';
import { loggedFetch, signedQrPayHeaders } from '../helpers.js';

const sessionFromCredentials = (credentials) => ({
  tokenSN: credentials.tokenSN,
  profileId: credentials.profileId || null,
  decryptedSecret: decryptSecret(credentials.vtokenSecret),
});

export class KaspiProviderError extends Error {
  constructor(message, providerStatus) {
    super(message);
    this.name = 'KaspiProviderError';
    this.status = 502;
    this.providerStatus = providerStatus;
  }
}

const request = async (url, credentials, { method = 'GET', body } = {}) => {
  const headers = signedQrPayHeaders(url, sessionFromCredentials(credentials), body);
  if (body) headers['Content-Type'] = 'application/json';
  const response = await loggedFetch(url, { method, headers, ...(body && { body }) });
  const result = await response.json();
  if (!response.ok) throw new KaspiProviderError(`Kaspi returned HTTP ${response.status}`, response.status);
  return result;
};

export const createQrPayment = async (credentials, { amount, latitude, longitude }) => {
  const url = `${KASPI_QRPAY_URL}/v01/qr-token/create`;
  const body = JSON.stringify({
    PaymentAmount: amount,
    DeviceInterface: 'Pos',
    Latitude: latitude || 43.204643483375889,
    Longitude: longitude || 76.891962364115912,
  });
  return request(url, credentials, { method: 'POST', body });
};

export const createInvoicePayment = async (credentials, { amount, phoneNumber, description }) => {
  const url = `${KASPI_QRPAY_URL}/v01/remote/create`;
  const body = JSON.stringify({ PhoneNumber: phoneNumber, Amount: amount, Comment: description || '' });
  return request(url, credentials, { method: 'POST', body });
};

export const getPaymentStatus = async (credentials, type, operationId) => {
  const url =
    type === 'qr'
      ? `${KASPI_QRPAY_URL}/v02/kaspi-qr/status?qrOperationId=${operationId}`
      : `${KASPI_QRPAY_URL}/v02/remote/details?operationId=${operationId}`;
  return request(url, credentials);
};

export const cancelInvoicePayment = async (credentials, operationId) => {
  const url = `${KASPI_QRPAY_URL}/v01/remote/cancel`;
  const body = JSON.stringify({ qrOperationId: Number(operationId) });
  return request(url, credentials, { method: 'POST', body });
};

export const createKaspiRefund = async (credentials, operationId, amount) => {
  const url = `${KASPI_QRPAY_URL}/v01/kaspi-qr/history-pos-return`;
  const body = JSON.stringify({ ReturnAmount: amount, QrOperationId: Number(operationId), DeviceInterface: 'Pos' });
  return request(url, credentials, { method: 'POST', body });
};
