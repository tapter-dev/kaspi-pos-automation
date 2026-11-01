import { Router } from 'express';
import { DEVICE, APP, UA_NATIVE, ENTRANCE_HEADERS_BASE, KASPI_ENTRANCE_URL, KASPI_MTOKEN_URL } from '../config.js';
import { createEmptySession, applyOrgContext } from '../session.js';
import {
  generateECDH,
  completeECDH,
  computeTokenSnMac,
  signDataPayload,
  computeXSU,
  computeXSign,
  encryptSecret,
} from '../crypto.js';
import { loggedFetch, extractUserToken, entranceCookie, generateUUID, nowISO, normalizePhone } from '../helpers.js';

const router = Router();

// In-flight auth sessions keyed by processId (temporary, cleared after finish)
const authSessions = new Map();

// ═══════════════════════════════════════════════════
//  Step 1 — Init entrance (get processId)
// ═══════════════════════════════════════════════════

router.post('/init', async (req, res) => {
  const session = createEmptySession();

  try {
    const resp = await loggedFetch(`${KASPI_ENTRANCE_URL}/api/v1/entrance/step`, {
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

    const ut = extractUserToken(resp);
    if (ut) session.userToken = ut;

    const body = await resp.json();
    if (body.meta?.pId) {
      session.processId = body.meta.pId;
      authSessions.set(session.processId, session);
    }

    res.json({ success: !!session.processId, processId: session.processId, view: body.view?.code, body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════
//  Step 2 — Send phone number (triggers SMS)
// ═══════════════════════════════════════════════════

router.post('/send-phone', async (req, res) => {
  const { processId } = req.body;
  if (!req.body.phoneNumber) {
    return res.status(400).json({ error: 'phoneNumber required: 10 digits without country code (e.g. 7001234567)' });
  }
  const phoneNumber = normalizePhone(req.body.phoneNumber);
  if (phoneNumber.length !== 10) {
    return res.status(400).json({ error: 'phoneNumber must be 10 digits without country code (e.g. 7001234567)' });
  }
  if (!processId) return res.status(400).json({ error: 'processId required (from /api/auth/init)' });

  const session = authSessions.get(processId);
  if (!session) return res.status(400).json({ error: 'Unknown processId. Call /api/auth/init first' });

  session.phoneNumber = phoneNumber;

  try {
    const resp = await loggedFetch(`${KASPI_ENTRANCE_URL}/api/v1/entrance/step`, {
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

    const ut = extractUserToken(resp);
    if (ut) session.userToken = ut;

    const body = await resp.json();
    const smsSent = body.view?.code === 'EnterOtp';

    // Surface WHY Kaspi declined so callers can tell a phone-input rejection (fixable by the user) from a
    // system/config block that is NOT about the phone — e.g. OldVersionToUpdate (app version below Kaspi's
    // minimum). Kaspi puts the reason in the on-open alarm (version/system gates) or an error object (phone).
    const kaspiErr =
      body.view?.onOpenAlarm?.error || body.error || body.data?.error || null;
    const errorCode = smsSent ? undefined : kaspiErr?.code;
    const errorMessage = smsSent
      ? undefined
      : kaspiErr?.label || kaspiErr?.desc || kaspiErr?.description || body.data?.desc;

    res.json({
      success: smsSent,
      processId: session.processId,
      desc: body.data?.desc,
      view: body.view?.code,
      errorCode,
      errorMessage,
      body,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════
//  Step 3 — Submit SMS OTP code
// ═══════════════════════════════════════════════════

router.post('/verify-otp', async (req, res) => {
  const { otp, processId } = req.body;
  if (!otp) return res.status(400).json({ error: 'otp required' });
  if (!processId) return res.status(400).json({ error: 'processId required' });

  const session = authSessions.get(processId);
  if (!session) return res.status(400).json({ error: 'Unknown processId' });

  try {
    const resp = await loggedFetch(`${KASPI_ENTRANCE_URL}/api/v1/entrance/step`, {
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

    const ut = extractUserToken(resp);
    if (ut) session.userToken = ut;

    const body = await resp.json();

    if (body.data?.type === 'kpDeviceRegistration' || body.view?.code === 'KPMobileCall') {
      // OTP verified — automatically call finish
      const finishResult = await doFinish(session);
      authSessions.delete(processId);
      res.json({
        success: true,
        processId: session.processId,
        step: 'finished',
        message: 'OTP verified and finish completed',
        otpBody: body,
        ...finishResult,
      });
    } else {
      res.json({ success: false, processId: session.processId, step: 'otp_response', body });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════
//  Finish logic (shared by verify-otp and /finish)
// ═══════════════════════════════════════════════════

async function doFinish(session) {
  const ecdhX509 = generateECDH();
  console.log('Generated ECDH public key for guard.x509:', ecdhX509);

  const signedDataObj = {
    installId: DEVICE.installId,
    time: nowISO(),
    auth: [{ value: '', type: 'pincode' }],
    userIdHash: '',
  };
  const signedDataB64 = Buffer.from(JSON.stringify(signedDataObj)).toString('base64');

  const finishUrl = `${KASPI_ENTRANCE_URL}/api/v1/kpentrance/finish`;
  const finishHeaders = {
    'Content-Type': 'application/json',
    Accept: '*/*',
    'Accept-Language': 'ru',
    'Accept-Encoding': 'gzip, deflate, br',
    'User-Agent': UA_NATIVE,
    'X-Time': nowISO(),
    'X-Call': 'notConnected',
    'X-Platform-Type': APP.platform,
    'X-PkTag': DEVICE.pkTag,
    'X-SU': computeXSU(finishUrl),
    'X-Net-Type': 'WIFI/ETHERNET',
    'X-Emulator': '0',
    'X-Locale': APP.locale,
    'X-SV': '2',
    'X-Request-ID': generateUUID(),
    'X-Time-Zone': 'GMT+05:00',
    'X-SH': 'url,X-Time-Zone,X-Request-ID,X-Net-Type,X-Emulator,X-Call,X-Platform-Type,X-Locale,X-Time,X-SV',
  };
  const finishBody = JSON.stringify({
    signed: { sign: signDataPayload(signedDataB64), data: signedDataB64 },
    guard: { pinHash: DEVICE.pinHash, x509: ecdhX509 },
    processId: session.processId,
  });
  finishHeaders['X-Sign'] = computeXSign(finishUrl, finishHeaders, finishHeaders['X-SH'], finishBody);

  const resp = await loggedFetch(finishUrl, {
    method: 'POST',
    headers: finishHeaders,
    body: finishBody,
  });

  const body = await resp.json();

  if (body.success && body.data?.tokenSN) {
    session.tokenSN = body.data.tokenSN;

    let vtokenSecret = null;
    let rawSecret = null;
    if (body.data.x509) {
      try {
        rawSecret = completeECDH(body.data.x509);
        vtokenSecret = encryptSecret(rawSecret);
        console.log('vtoken activated successfully');
      } catch (e) {
        console.error('ECDH key agreement failed:', e.message);
      }
    }

    // Fetch org context
    const orgUrl = `${KASPI_MTOKEN_URL}/v08/organizations/org-context-otp`;
    const piValue = session.profileId != null ? String(session.profileId) : '';
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

    const orgResp = await loggedFetch(orgUrl, {
      method: 'POST',
      headers: orgHeaders,
      body: orgPayload,
    });

    const orgBody = await orgResp.json();

    if (orgBody.Data?.Current?.ProfileId) {
      applyOrgContext(session, orgBody.Data);
    }

    return {
      tokenSN: session.tokenSN,
      vtokenSecret,
      profileId: session.profileId,
      organizationId: session.organizationId,
      orgName: session.orgName,
      phone: session.phoneNumber,
      organizations: orgBody.Data?.Organizations,
    };
  } else {
    throw new Error('Finish failed: ' + JSON.stringify(body));
  }
}

// ─── Session status (client sends tokenSN) ───

router.post('/session', (req, res) => {
  const { tokenSN } = req.body || {};
  res.json({ authenticated: !!tokenSN, tokenSN });
});

// ─── Logout ───

router.post('/logout', (req, res) => {
  res.json({ success: true });
});

export default router;
