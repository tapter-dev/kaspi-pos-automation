import { APP, DEVICE, ENTRANCE_HEADERS_BASE, KASPI_ENTRANCE_URL, KASPI_MTOKEN_URL, UA_NATIVE } from '../config.js';
import { applyOrgContext, createEmptySession } from '../session.js';
import {
  completeECDHAgreement,
  computeTokenSnMac,
  computeXSign,
  computeXSU,
  encryptSecret,
  createECDHAgreement,
  signDataPayload,
} from '../crypto.js';
import { entranceCookie, extractUserToken, generateUUID, loggedFetch, nowISO } from '../helpers.js';

export const initializeKaspiAuthentication = async () => {
  const session = createEmptySession();
  const response = await loggedFetch(`${KASPI_ENTRANCE_URL}/api/v1/entrance/step`, {
    method: 'POST',
    headers: {
      ...ENTRANCE_HEADERS_BASE,
      Referer: `${KASPI_ENTRANCE_URL}/process/entrance/?auth=2&appBuild=${APP.build}&appVersion=${APP.version}&platformVersion=${APP.platformVer}&platformType=IOS&deviceBrand=${APP.brand}&deviceModel=${APP.model}&deviceId=${DEVICE.deviceId}&installId=${DEVICE.installId}&frontCameraAvailable=true&sf=registration&pc=KPEntrance&noPass=0`,
      Cookie: entranceCookie(),
    },
    body: JSON.stringify({
      data: {},
      Data: {
        auth: '2',
        appBuild: APP.build,
        appVersion: APP.version,
        platformVersion: APP.platformVer,
        platformType: 'IOS',
        deviceBrand: APP.brand,
        deviceModel: APP.model,
        deviceId: DEVICE.deviceId,
        installId: DEVICE.installId,
        frontCameraAvailable: 'true',
        sf: 'registration',
        pc: 'KPEntrance',
        noPass: '0',
      },
      actType: 'Success',
    }),
  });
  const userToken = extractUserToken(response);
  if (userToken) session.userToken = userToken;
  const body = await response.json();
  session.processId = body.meta?.pId || null;
  return { session, body };
};

export const sendKaspiPhone = async (session, phoneNumber) => {
  session.phoneNumber = phoneNumber;
  const response = await loggedFetch(`${KASPI_ENTRANCE_URL}/api/v1/entrance/step`, {
    method: 'POST',
    headers: {
      ...ENTRANCE_HEADERS_BASE,
      Referer: `${KASPI_ENTRANCE_URL}/process/universal-enter-phone-number?pId=${session.processId}&firstPage=KPUniversalEnterPhoneNumber`,
      Cookie: entranceCookie(session.userToken),
    },
    body: JSON.stringify({
      meta: { pId: session.processId, sn: 'EnterPhoneNumber' },
      data: { phoneNumber },
      actType: 'Success',
    }),
  });
  const userToken = extractUserToken(response);
  if (userToken) session.userToken = userToken;
  return response.json();
};

export const verifyKaspiOtp = async (session, otp) => {
  const response = await loggedFetch(`${KASPI_ENTRANCE_URL}/api/v1/entrance/step`, {
    method: 'POST',
    headers: {
      ...ENTRANCE_HEADERS_BASE,
      Referer: `${KASPI_ENTRANCE_URL}/process/universal-enter-phone-number?pId=${session.processId}&firstPage=KPUniversalEnterPhoneNumber`,
      Cookie: entranceCookie(session.userToken),
    },
    body: JSON.stringify({
      meta: { pId: session.processId, sn: 'ViewEnterOtp' },
      data: { userOtp: otp, inputType: 'auto' },
      actType: 'Success',
    }),
  });
  const userToken = extractUserToken(response);
  if (userToken) session.userToken = userToken;
  const body = await response.json();
  const verified = body.data?.type === 'kpDeviceRegistration' || body.view?.code === 'KPMobileCall';
  return { body, verified };
};

export const finishKaspiAuthentication = async (session) => {
  const agreement = createECDHAgreement();
  const signedData = Buffer.from(
    JSON.stringify({ installId: DEVICE.installId, time: nowISO(), auth: [{ value: '', type: 'pincode' }], userIdHash: '' }),
  ).toString('base64');
  const url = `${KASPI_ENTRANCE_URL}/api/v1/kpentrance/finish`;
  const headers = {
    'Content-Type': 'application/json',
    Accept: '*/*',
    'Accept-Language': 'ru',
    'Accept-Encoding': 'gzip, deflate, br',
    'User-Agent': UA_NATIVE,
    'X-Time': nowISO(),
    'X-Call': 'notConnected',
    'X-Platform-Type': APP.platform,
    'X-PkTag': DEVICE.pkTag,
    'X-SU': computeXSU(url),
    'X-Net-Type': 'WIFI/ETHERNET',
    'X-Emulator': '0',
    'X-Locale': APP.locale,
    'X-SV': '2',
    'X-Request-ID': generateUUID(),
    'X-Time-Zone': 'GMT+05:00',
    'X-SH': 'url,X-Time-Zone,X-Request-ID,X-Net-Type,X-Emulator,X-Call,X-Platform-Type,X-Locale,X-Time,X-SV',
  };
  const requestBody = JSON.stringify({
    signed: { sign: signDataPayload(signedData), data: signedData },
    guard: { pinHash: DEVICE.pinHash, x509: agreement.publicX509 },
    processId: session.processId,
  });
  headers['X-Sign'] = computeXSign(url, headers, headers['X-SH'], requestBody);
  const response = await loggedFetch(url, { method: 'POST', headers, body: requestBody });
  const body = await response.json();
  if (!body.success || !body.data?.tokenSN) throw new Error(body.message || 'Kaspi authentication could not finish.');

  session.tokenSN = body.data.tokenSN;
  if (!body.data.x509) throw new Error('Kaspi did not return a device agreement key.');
  const rawSecret = completeECDHAgreement(body.data.x509, agreement.privateKey);
  const vtokenSecret = encryptSecret(rawSecret);
  const orgUrl = `${KASPI_MTOKEN_URL}/v08/organizations/org-context-otp`;
  const orgHeaders = {
    'Content-Type': 'application/json',
    Accept: '*/*',
    'Accept-Language': 'ru',
    'Accept-Encoding': 'gzip, deflate, br',
    'User-Agent': UA_NATIVE,
    'X-Kb-TokenSn': session.tokenSN,
    'X-Kb-TokenSnMac': computeTokenSnMac(session.tokenSN, rawSecret),
    'X-Install-ID': DEVICE.installId,
    'X-App-Ver': APP.version,
    'X-App-Bld': APP.build,
    'X-Locale': APP.locale,
    'X-Call': 'notConnected',
    'X-Time': nowISO(),
    'X-S': 'R:0|E:0|RH:0|N:0',
    'X-SV': '2',
    'X-Kb-Client-Ip': '192.168.1.96',
    'X-PkTag': DEVICE.pkTag,
    'X-SU': computeXSU(orgUrl),
    'X-SH':
      'url,X-Kb-Client-Ip,X-Time,X-App-Ver,X-SV,X-Locale,X-App-Bld,X-Install-ID,X-Kb-TokenSn,X-S,X-Kb-TokenSnMac,X-Call',
    'X-Request-ID': generateUUID(),
  };
  const orgPayload = JSON.stringify({
    DeviceInformation: {
      SdkVersion: 'AOTP service',
      DeviceId: DEVICE.deviceId,
      ApplicationId: 'kz.kaspi.business',
      ScreenWidth: APP.screenW,
      Model: APP.model,
      ScreenHeight: APP.screenH,
      DeviceName: APP.deviceName,
      VersionName: APP.version,
      BuildRelease: `${APP.platform} ${APP.platformVer}`,
      Brand: APP.brand,
      Board: APP.platformVer,
      Platform: APP.platform,
      Product: 'Kaspi Pay',
      frontCameraAvailable: true,
      VersionCode: APP.build,
      InstallId: DEVICE.installId,
    },
    OrganizationId: 0,
  });
  orgHeaders['X-Sign'] = computeXSign(orgUrl, orgHeaders, orgHeaders['X-SH'], orgPayload);
  const orgResponse = await loggedFetch(orgUrl, { method: 'POST', headers: orgHeaders, body: orgPayload });
  const orgBody = await orgResponse.json();
  if (orgBody.Data?.Current?.ProfileId) applyOrgContext(session, orgBody.Data);

  return {
    tokenSN: session.tokenSN,
    vtokenSecret,
    profileId: session.profileId,
    organizationId: session.organizationId,
    orgName: session.orgName,
    phone: session.phoneNumber,
    organizations: orgBody.Data?.Organizations,
  };
};
