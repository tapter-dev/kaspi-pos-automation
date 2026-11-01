# 📖 API құжаттамасы

Kaspi POS Automation Kaspi Pay төлемдерімен жұмыс істеу үшін REST API ұсынады: SMS арқылы авторизация, шот-фактуралар жасау, QR-төлем, операциялар тарихы және қайтарулар.

**Base URL:** `http://localhost:3000`

---

## Мазмұны

- [Аутентификация](#аутентификация)
  - [Сессия тақырыптары](#сессия-тақырыптары)
- [Health Check](#health-check)
- [Auth — Авторизация](#auth--авторизация)
  - [POST /api/auth/init](#post-apiauthinit)
  - [POST /api/auth/send-phone](#post-apiauthsend-phone)
  - [POST /api/auth/verify-otp](#post-apiauthverify-otp)
  - [POST /api/auth/session](#post-apiauthsession)
  - [POST /api/auth/logout](#post-apiauthlogout)
- [Invoice — Шот-фактуралар](#invoice--шот-фактуралар)
  - [GET /api/invoice/client-info](#get-apiinvoiceclient-info)
  - [POST /api/invoice/create](#post-apiinvoicecreate)
  - [GET /api/invoice/details](#get-apiinvoicedetails)
  - [POST /api/invoice/cancel](#post-apiinvoicecancel)
  - [POST /api/invoice/history](#post-apiinvoicehistory)
- [QR — QR-төлем](#qr--qr-төлем)
  - [POST /api/qr/create](#post-apiqrcreate)
  - [GET /api/qr/status](#get-apiqrstatus)
- [History — Операциялар тарихы](#history--операциялар-тарихы)
  - [POST /api/history/operations](#post-apihistoryoperations)
  - [POST /api/history/details](#post-apihistorydetails)
- [Refund — Қайтарулар](#refund--қайтарулар)
  - [POST /api/refund/create](#post-apirefundcreate)
- [Session — Сессияны тексеру](#session--сессияны-тексеру)
  - [GET /api/session/check](#get-apisessioncheck)
- [Webhooks — Хабарламалар](#webhooks--хабарламалар)
  - [Баптау](#баптау)
  - [Оқиғалар](#оқиғалар)
  - [Payload форматы](#payload-форматы)
  - [Қолтаңба (HMAC)](#қолтаңба-hmac)
  - [Қайта жіберу (Retry)](#қайта-жіберу-retry)

---

## Аутентификация

API 3 қадамды SMS-авторизацияны пайдаланады. Сәтті авторизациядан кейін клиент `tokenSN` және `vtokenSecret` алады, олар барлық қорғалған эндпоинттер үшін тақырыптарда жіберіледі.

### Сессия тақырыптары

`/api/auth/*` және `/health` басқа барлық эндпоинттер келесі тақырыптарды талап етеді:

| Тақырып | Түрі | Міндетті | Сипаттама |
|---|---|---|---|
| `X-Token-SN` | `string` | ✅ | Авторизация кезінде алынған сессия токені |
| `X-Vtoken-Secret` | `string` | ✅ | Шифрланған сессия құпиясы |
| `X-Profile-Id` | `string` | ❌ | Ұйым профилінің ID-сі |

---

## Health Check

### `GET /health`

Сервердің жұмыс қабілеттілігін тексеру.

**Жауап:**

```json
{ "status": "ok" }
```

---

## Auth — Авторизация

Kaspi SMS-коды арқылы үш қадамды авторизация процесі.

> ⚠️ **Маңызды:** Кіру үшін Kaspi Pay **кассирінің** аккаунтының телефон нөмірін пайдаланыңыз.

### `POST /api/auth/init`

Авторизация процесін инициализациялау. Келесі қадамдар үшін `processId` қайтарады.

**Сұраныс денесі:** қажет емес

**Сұраныс мысалы:**

```bash
curl -X POST http://localhost:3000/api/auth/init
```

**Сәтті жауап:**

```json
{
  "success": true,
  "processId": "abc123-...",
  "view": "EnterPhoneNumber",
  "body": { ... }
}
```

---

### `POST /api/auth/send-phone`

Телефон нөмірін жіберу — SMS-код жіберуді бастайды.

**Сұраныс денесі:**

| Өріс | Түрі | Міндетті | Сипаттама |
|---|---|---|---|
| `phoneNumber` | `string` | ✅ | Кассирдің телефон нөмірі: ел кодынсыз 10 цифр, мысалы `7001234567` |
| `processId` | `string` | ✅ | `/api/auth/init` процесінің ID-сі |

**Сұраныс мысалы:**

```bash
curl -X POST http://localhost:3000/api/auth/send-phone \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "7001234567", "processId": "abc123-..."}'
```

> ⚠️ **Маңызды:** Нөмір ел кодынсыз көрсетіледі. Ел коды бар нөмір (`+7` немесе `8`) автоматты түрде 10 таңбалы түрге келтіріледі.

**Сәтті жауап:**

```json
{
  "success": true,
  "processId": "abc123-...",
  "desc": "Код отправлен на номер +7 700 *** ** 67",
  "view": "EnterOtp",
  "body": { ... }
}
```

---

### `POST /api/auth/verify-otp`

SMS-кодты растау. Сәтті болған жағдайда авторизацияны автоматты түрде аяқтайды және сессия деректерін қайтарады.

**Сұраныс денесі:**

| Өріс | Түрі | Міндетті | Сипаттама |
|---|---|---|---|
| `otp` | `string` | ✅ | SMS-код |
| `processId` | `string` | ✅ | `/api/auth/init` процесінің ID-сі |

**Сұраныс мысалы:**

```bash
curl -X POST http://localhost:3000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"otp": "1234", "processId": "abc123-..."}'
```

**Сәтті жауап:**

```json
{
  "success": true,
  "processId": "abc123-...",
  "step": "finished",
  "message": "OTP verified and finish completed",
  "tokenSN": "TOKEN_SN_VALUE",
  "vtokenSecret": "ENCRYPTED_SECRET",
  "profileId": 12345,
  "organizationId": 67890,
  "orgName": "ЖК Иванов",
  "phone": "7001234567",
  "organizations": [ ... ]
}
```

> ⚠️ `tokenSN` және `vtokenSecret` сақтаңыз — олар барлық кейінгі сұраныстар үшін қажет.

---

### `POST /api/auth/session`

Токеннің бар-жоғын тексеру (клиенттік тексеру).

**Сұраныс денесі:**

| Өріс | Түрі | Міндетті | Сипаттама |
|---|---|---|---|
| `tokenSN` | `string` | ❌ | Сессия токені |

**Жауап:**

```json
{
  "authenticated": true,
  "tokenSN": "TOKEN_SN_VALUE"
}
```

---

### `POST /api/auth/logout`

Сессияны аяқтау.

**Сұраныс денесі:** қажет емес

**Жауап:**

```json
{ "success": true }
```

---

## Invoice — Шот-фактуралар

Клиенттің телефон нөмірі бойынша төлем шот-фактураларын жасау.

> 🔒 Барлық эндпоинттер [сессия тақырыптарын](#сессия-тақырыптары) талап етеді.

### `GET /api/invoice/client-info`

Телефон нөмірі бойынша клиент туралы ақпарат алу.

**Query-параметрлері:**

| Параметр | Түрі | Міндетті | Сипаттама |
|---|---|---|---|
| `phoneNumber` | `string` | ✅ | Клиенттің телефон нөмірі |

**Сұраныс мысалы:**

```bash
curl "http://localhost:3000/api/invoice/client-info?phoneNumber=77001234567" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..." \
  -H "X-Profile-Id: ..."
```

---

### `POST /api/invoice/create`

Төлем шот-фактурасын жасау.

**Сұраныс денесі:**

| Өріс | Түрі | Міндетті | Сипаттама |
|---|---|---|---|
| `phoneNumber` | `string` | ✅ | Клиенттің телефон нөмірі |
| `amount` | `number` | ✅ | Теңгемен сома |
| `comment` | `string` | ❌ | Төлемге түсініктеме |

**Сұраныс мысалы:**

```bash
curl -X POST http://localhost:3000/api/invoice/create \
  -H "Content-Type: application/json" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..." \
  -H "X-Profile-Id: ..." \
  -d '{"phoneNumber": "77001234567", "amount": 1000, "comment": "Тапсырыс #42 төлемі"}'
```

**Сәтті жауап:**

```json
{
  "StatusCode": 0,
  "Data": {
    "Id": 123456,
    "Status": "RemotePaymentCreated",
    "Amount": 1000,
    "ClientMobile": "77001234567",
    "ReceiptUrl": "https://...",
    "OrderNumber": "..."
  }
}
```

---

### `GET /api/invoice/details`

Шот-фактура мәліметтерін алу.

**Query-параметрлері:**

| Параметр | Түрі | Міндетті | Сипаттама |
|---|---|---|---|
| `operationId` | `string` | ✅ | Операция ID-сі |

**Сұраныс мысалы:**

```bash
curl "http://localhost:3000/api/invoice/details?operationId=123456" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..."
```

---

### `POST /api/invoice/cancel`

Жасалған шот-фактураны болдырмау.

**Сұраныс денесі:**

| Өріс | Түрі | Міндетті | Сипаттама |
|---|---|---|---|
| `operationId` | `string` | ✅ | Болдырмау үшін операция ID-сі |

**Сұраныс мысалы:**

```bash
curl -X POST http://localhost:3000/api/invoice/cancel \
  -H "Content-Type: application/json" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..." \
  -d '{"operationId": "123456"}'
```

---

### `POST /api/invoice/history`

Жасалған шот-фактуралар тарихын алу (соңғы 20).

**Сұраныс денесі:** қажет емес (бос JSON `{}`)

**Сұраныс мысалы:**

```bash
curl -X POST http://localhost:3000/api/invoice/history \
  -H "Content-Type: application/json" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..." \
  -d '{}'
```

---

## QR — QR-төлем

Kaspi Pay арқылы төлем үшін QR-кодтар генерациялау.

> 🔒 Барлық эндпоинттер [сессия тақырыптарын](#сессия-тақырыптары) талап етеді.

### `POST /api/qr/create`

Төлем үшін QR-токен жасау.

**Сұраныс денесі:**

| Өріс | Түрі | Міндетті | Сипаттама |
|---|---|---|---|
| `amount` | `number` | ✅ | Теңгемен сома |
| `latitude` | `number` | ❌ | Ендік (әдепкі: Алматы) |
| `longitude` | `number` | ❌ | Бойлық (әдепкі: Алматы) |

**Сұраныс мысалы:**

```bash
curl -X POST http://localhost:3000/api/qr/create \
  -H "Content-Type: application/json" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..." \
  -H "X-Profile-Id: ..." \
  -d '{"amount": 500}'
```

**Сәтті жауап:**

```json
{
  "StatusCode": 0,
  "Data": {
    "QrOperationId": 789012,
    "QrToken": "https://pay.kaspi.kz/pay/...",
    "ExpireDate": "2025-01-01T12:05:00",
    "Amount": 500,
    "ReceiptUrl": "https://..."
  }
}
```

> 💡 `QrToken` төлем сілтемесін қамтиды — оны QR-кодқа түрлендіруге болады.

---

### `GET /api/qr/status`

QR-төлем статусын тексеру.

**Query-параметрлері:**

| Параметр | Түрі | Міндетті | Сипаттама |
|---|---|---|---|
| `qrOperationId` | `string` | ✅ | `/api/qr/create` QR-операциясының ID-сі |

**Сұраныс мысалы:**

```bash
curl "http://localhost:3000/api/qr/status?qrOperationId=789012" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..."
```

---

## History — Операциялар тарихы

Барлық операциялар тарихын қарау (QR + шот-фактуралар).

> 🔒 Барлық эндпоинттер [сессия тақырыптарын](#сессия-тақырыптары) талап етеді.

### `POST /api/history/operations`

Кезең бойынша операциялар тізімін алу.

**Сұраныс денесі:**

| Өріс | Түрі | Міндетті | Сипаттама |
|---|---|---|---|
| `endDate` | `string` | ✅ | Аяқталу күні (формат: `YYYY-MM-DD`) |
| `lastTransactionDate` | `string` | ❌ | Соңғы транзакция күні (пагинация үшін) |
| `statementPeriodCode` | `number` | ❌ | Кезең коды (әдепкі: `0`) |

**Сұраныс мысалы:**

```bash
curl -X POST http://localhost:3000/api/history/operations \
  -H "Content-Type: application/json" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..." \
  -d '{"endDate": "2025-01-15"}'
```

---

### `POST /api/history/details`

Нақты операцияның мәліметтерін алу.

**Сұраныс денесі:**

| Өріс | Түрі | Міндетті | Сипаттама |
|---|---|---|---|
| `id` | `number` | ✅ | Операция ID-сі |
| `operationMethod` | `number` | ❌ | Операция әдісі (әдепкі: `0`) |

**Сұраныс мысалы:**

```bash
curl -X POST http://localhost:3000/api/history/details \
  -H "Content-Type: application/json" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..." \
  -d '{"id": 123456}'
```

---

## Refund — Қайтарулар

Бұрын жүргізілген операция бойынша қаражатты қайтару.

> 🔒 Барлық эндпоинттер [сессия тақырыптарын](#сессия-тақырыптары) талап етеді.

### `POST /api/refund/create`

Қайтару жасау.

**Сұраныс денесі:**

| Өріс | Түрі | Міндетті | Сипаттама |
|---|---|---|---|
| `qrOperationId` | `number` | ✅ | Қайтару үшін операция ID-сі |
| `returnAmount` | `number` | ✅ | Теңгемен қайтару сомасы |

**Сұраныс мысалы:**

```bash
curl -X POST http://localhost:3000/api/refund/create \
  -H "Content-Type: application/json" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..." \
  -d '{"qrOperationId": 789012, "returnAmount": 500}'
```

---

## Session — Сессияны тексеру

### `GET /api/session/check`

Kaspi API-ге сұраныс арқылы ағымдағы сессияның жарамдылығын тексеру.

> 🔒 [Сессия тақырыптарын](#сессия-тақырыптары) талап етеді.

**Сұраныс мысалы:**

```bash
curl "http://localhost:3000/api/session/check" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..."
```

**Белсенді сессия:**

```json
{ "active": true }
```

**Белсенді емес сессия:**

```json
{
  "active": false,
  "error": "Session rejected by Kaspi API.",
  "code": 401,
  "details": { ... }
}
```

---

## Қате кодтары

Барлық эндпоинттер қателерді келесі форматта қайтарады:

```json
{ "error": "Қатенің сипаттамасы" }
```

| HTTP-код | Сипаттама |
|---|---|
| `400` | Міндетті параметрлер жоқ немесе параметр форматы қате |
| `401` | Сессия тақырыптары жоқ немесе жарамсыз |
| `500` | Сервердің ішкі қатесі немесе Kaspi API қатесі |

---

## Webhooks — Хабарламалар

Жүйе жасалған QR және invoice төлемдерінің статустарын автоматты түрде бақылайды (әр 3 секунд сайын polling) және төлем статусы өзгерген кезде көрсетілген URL-дарға HTTP POST хабарламаларын (webhooks) жібереді.

### Баптау

Вебхуктар жобаның түбіріндегі `webhooks.json` файлында баптаулады. Файл объектілер массивін қамтиды:

```json
[
  {
    "url": "https://example.com/webhook",
    "events": ["payment.success", "payment.failed", "payment.expired", "payment.lost"],
    "secret": "your-webhook-secret"
  }
]
```

| Өріс | Түрі | Міндетті | Сипаттама |
|---|---|---|---|
| `url` | `string` | ✅ | Хабарламалар жіберілетін URL |
| `events` | `string[]` | ✅ | Жазылу оқиғаларының тізімі |
| `secret` | `string` | ❌ | HMAC қолтаңбасы үшін құпия (ұсынылады) |

> 💡 Бастау үшін `webhooks.example.json` → `webhooks.json` көшіріп, өңдеңіз.

Әр түрлі URL және оқиғалармен бірнеше вебхук көрсетуге болады:

```json
[
  {
    "url": "https://my-crm.com/kaspi-hook",
    "events": ["payment.success"],
    "secret": "crm-secret-key"
  },
  {
    "url": "https://my-accounting.com/hook",
    "events": ["payment.success", "payment.failed", "payment.expired", "payment.lost"],
    "secret": "accounting-secret"
  }
]
```

### Оқиғалар

| Оқиға | Сипаттама | Қашан іске қосылады |
|---|---|---|
| `payment.success` | Төлем сәтті өтті | QR: `Processed` статусы; Invoice: `Processed` статусы |
| `payment.failed` | Төлем қабылданбады / бас тартылды | QR: `CancelledByUser`, `Rejected`, `Error` және т.б.; Invoice: `RemotePaymentCanceled`, `RemotePaymentRejected` |
| `payment.expired` | Төлем уақыты аяқталды | QR: `QrTokenDiscarded`, `Expired`; Invoice: `Expired` |
| `payment.lost` | Төлем статусы белгісіз — қолмен тексеру қажет | Kaspi сессиясы ығыстырылды (`SessionExpired`) немесе сұрау әрекеттері таусылды (`PollingFailed`) |

### Payload форматы

Оқиға іске қосылғанда әрбір жазылған URL-ға JSON денесі бар POST сұрау жіберіледі:

```json
{
  "event": "payment.success",
  "paymentId": "123456",
  "type": "qr",
  "status": "Processed",
  "statusDesc": "Операция сәтті өтті",
  "amount": 5000,
  "qrToken": "QR-TOKEN-...",
  "receiptUrl": "https://...",
  "orderNumber": "ORDER-001",
  "data": { ... },
  "timestamp": "2026-05-10T00:00:00.000Z"
}
```

| Өріс | Түрі | Сипаттама |
|---|---|---|
| `event` | `string` | Оқиға атауы (`payment.success`, `payment.failed`, `payment.expired`, `payment.lost`) |
| `paymentId` | `string` | Төлем ID-сі (QR operationId немесе invoice operationId) |
| `type` | `string` | Төлем түрі: `qr` немесе `invoice` |
| `status` | `string` | Kaspi API-ден финалды статус |
| `statusDesc` | `string` | Статус сипаттамасы |
| `amount` | `number\|null` | Төлем сомасы теңгемен |
| `qrToken` | `string\|null` | QR-токен (тек QR-төлемдер үшін) |
| `receiptUrl` | `string\|null` | Чекке сілтеме |
| `orderNumber` | `string\|null` | Тапсырыс нөмірі |
| `data` | `object` | Kaspi API-ден толық жауап деректері |
| `timestamp` | `string` | Хабарлама жіберу уақыты (ISO 8601) |

### Қолтаңба (HMAC)

Әрбір сұрау вебхук конфигурациясындағы `secret` көмегімен HMAC SHA-256 арқылы қолтаңбаланады. Қолтаңба тақырыпта жіберіледі:

```
X-Webhook-Signature: sha256=<hex-digest>
```

**Қабылдаушы жағында қолтаңбаны тексеру (Node.js):**

```javascript
import crypto from 'crypto';

const verifySignature = (body, signature, secret) => {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
};

// Сұрау өңдеушісінде:
const rawBody = JSON.stringify(req.body); // немесе raw body пайдаланыңыз
const sig = req.headers['x-webhook-signature'];
if (!verifySignature(rawBody, sig, 'your-webhook-secret')) {
  return res.status(401).send('Invalid signature');
}
```

### Қайта жіберу (Retry)

Вебхук жеткізілмесе (желі қатесі, таймаут, HTTP қатесі), жүйе **3 әрекетке** дейін өсетін кідіріспен орындайды:

| Әрекет | Кідіріс |
|---|---|
| 1-ші (бірінші) | Бірден |
| 2-ші | 5 секунд |
| 3-ші | 30 секунд |

- Сұрау таймауты: **10 секунд**.
- Қайта жіберу кезегі `webhook-retries.json` файлында сақталады және сервер қайта іске қосылғанда жоғалмайды.
- 3 сәтсіз әрекеттен кейін хабарлама жойылады (қате логқа жазылады).

---

## Пайдаланудың типтік сценарийі

```
1. POST /api/auth/init              → processId алу
2. POST /api/auth/send-phone        → SMS жіберу
3. POST /api/auth/verify-otp        → кодты растау → tokenSN + vtokenSecret алу

4. POST /api/qr/create              → төлем үшін QR жасау
5. GET  /api/qr/status              → төлем статусын тексеру

   — немесе —

4. POST /api/invoice/create         → телефон нөмірі бойынша шот-фактура жасау
5. GET  /api/invoice/details        → шот-фактура статусын тексеру

6. POST /api/refund/create          → қаражатты қайтару (қажет болған жағдайда)
```
