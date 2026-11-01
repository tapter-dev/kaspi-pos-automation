# 📖 API Documentation

Kaspi POS Automation предоставляет REST API для работы с платежами Kaspi Pay: авторизация по SMS, выставление счетов, QR-оплата, история операций и возвраты.

**Base URL:** `http://localhost:3000`

---

## Содержание

- [Аутентификация](#аутентификация)
  - [Заголовки сессии](#заголовки-сессии)
- [Health Check](#health-check)
- [Auth — Авторизация](#auth--авторизация)
  - [POST /api/auth/init](#post-apiauthinit)
  - [POST /api/auth/send-phone](#post-apiauthsend-phone)
  - [POST /api/auth/verify-otp](#post-apiauthverify-otp)
  - [POST /api/auth/session](#post-apiauthsession)
  - [POST /api/auth/logout](#post-apiauthlogout)
- [Invoice — Счета](#invoice--счета)
  - [GET /api/invoice/client-info](#get-apiinvoiceclient-info)
  - [POST /api/invoice/create](#post-apiinvoicecreate)
  - [GET /api/invoice/details](#get-apiinvoicedetails)
  - [POST /api/invoice/cancel](#post-apiinvoicecancel)
  - [POST /api/invoice/history](#post-apiinvoicehistory)
- [QR — QR-оплата](#qr--qr-оплата)
  - [POST /api/qr/create](#post-apiqrcreate)
  - [GET /api/qr/status](#get-apiqrstatus)
- [History — История операций](#history--история-операций)
  - [POST /api/history/operations](#post-apihistoryoperations)
  - [POST /api/history/details](#post-apihistorydetails)
- [Refund — Возвраты](#refund--возвраты)
  - [POST /api/refund/create](#post-apirefundcreate)
- [Session — Проверка сессии](#session--проверка-сессии)
  - [GET /api/session/check](#get-apisessioncheck)
- [Webhooks — Уведомления](#webhooks--уведомления)
  - [Настройка](#настройка)
  - [События](#события)
  - [Формат payload](#формат-payload)
  - [Подпись (HMAC)](#подпись-hmac)
  - [Повторные попытки (Retry)](#повторные-попытки-retry)

---

## Аутентификация

API использует 3-шаговую SMS-авторизацию. После успешной авторизации клиент получает `tokenSN` и `vtokenSecret`, которые передаются в заголовках для всех защищённых эндпоинтов.

### Заголовки сессии

Все эндпоинты кроме `/api/auth/*` и `/health` требуют следующие заголовки:

| Заголовок | Тип | Обязательный | Описание |
|---|---|---|---|
| `X-Token-SN` | `string` | ✅ | Токен сессии, полученный при авторизации |
| `X-Vtoken-Secret` | `string` | ✅ | Зашифрованный секрет сессии |
| `X-Profile-Id` | `string` | ❌ | ID профиля организации |

---

## Health Check

### `GET /health`

Проверка работоспособности сервера.

**Ответ:**

```json
{ "status": "ok" }
```

---

## Auth — Авторизация

Трёхшаговый процесс авторизации через SMS-код Kaspi.

> ⚠️ **Важно:** Для входа используйте номер телефона аккаунта **кассира** Kaspi Pay.

### `POST /api/auth/init`

Инициализация процесса авторизации. Возвращает `processId` для последующих шагов.

**Тело запроса:** не требуется

**Пример запроса:**

```bash
curl -X POST http://localhost:3000/api/auth/init
```

**Успешный ответ:**

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

Отправка номера телефона — инициирует отправку SMS-кода.

**Тело запроса:**

| Поле | Тип | Обязательный | Описание |
|---|---|---|---|
| `phoneNumber` | `string` | ✅ | Номер телефона кассира: 10 цифр без кода страны, например `7001234567` |
| `processId` | `string` | ✅ | ID процесса из `/api/auth/init` |

**Пример запроса:**

```bash
curl -X POST http://localhost:3000/api/auth/send-phone \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "7001234567", "processId": "abc123-..."}'
```

> ⚠️ **Важно:** Номер указывается без кода страны. Номер с кодом страны (`+7` или `8`) приводится к 10-значному виду автоматически.

**Успешный ответ:**

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

Подтверждение SMS-кода. При успехе автоматически завершает авторизацию и возвращает данные сессии.

**Тело запроса:**

| Поле | Тип | Обязательный | Описание |
|---|---|---|---|
| `otp` | `string` | ✅ | SMS-код |
| `processId` | `string` | ✅ | ID процесса из `/api/auth/init` |

**Пример запроса:**

```bash
curl -X POST http://localhost:3000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"otp": "1234", "processId": "abc123-..."}'
```

**Успешный ответ:**

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
  "orgName": "ИП Иванов",
  "phone": "7001234567",
  "organizations": [ ... ]
}
```

> ⚠️ Сохраните `tokenSN` и `vtokenSecret` — они нужны для всех последующих запросов.

---

### `POST /api/auth/session`

Проверка наличия токена (клиентская проверка).

**Тело запроса:**

| Поле | Тип | Обязательный | Описание |
|---|---|---|---|
| `tokenSN` | `string` | ❌ | Токен сессии |

**Ответ:**

```json
{
  "authenticated": true,
  "tokenSN": "TOKEN_SN_VALUE"
}
```

---

### `POST /api/auth/logout`

Завершение сессии.

**Тело запроса:** не требуется

**Ответ:**

```json
{ "success": true }
```

---

## Invoice — Счета

Выставление счетов на оплату по номеру телефона клиента.

> 🔒 Все эндпоинты требуют [заголовки сессии](#заголовки-сессии).

### `GET /api/invoice/client-info`

Получение информации о клиенте по номеру телефона.

**Query-параметры:**

| Параметр | Тип | Обязательный | Описание |
|---|---|---|---|
| `phoneNumber` | `string` | ✅ | Номер телефона клиента |

**Пример запроса:**

```bash
curl "http://localhost:3000/api/invoice/client-info?phoneNumber=77001234567" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..." \
  -H "X-Profile-Id: ..."
```

---

### `POST /api/invoice/create`

Создание счёта на оплату.

**Тело запроса:**

| Поле | Тип | Обязательный | Описание |
|---|---|---|---|
| `phoneNumber` | `string` | ✅ | Номер телефона клиента |
| `amount` | `number` | ✅ | Сумма в тенге |
| `comment` | `string` | ❌ | Комментарий к платежу |

**Пример запроса:**

```bash
curl -X POST http://localhost:3000/api/invoice/create \
  -H "Content-Type: application/json" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..." \
  -H "X-Profile-Id: ..." \
  -d '{"phoneNumber": "77001234567", "amount": 1000, "comment": "Оплата заказа #42"}'
```

**Успешный ответ:**

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

Получение деталей счёта.

**Query-параметры:**

| Параметр | Тип | Обязательный | Описание |
|---|---|---|---|
| `operationId` | `string` | ✅ | ID операции |

**Пример запроса:**

```bash
curl "http://localhost:3000/api/invoice/details?operationId=123456" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..."
```

---

### `POST /api/invoice/cancel`

Отмена выставленного счёта.

**Тело запроса:**

| Поле | Тип | Обязательный | Описание |
|---|---|---|---|
| `operationId` | `string` | ✅ | ID операции для отмены |

**Пример запроса:**

```bash
curl -X POST http://localhost:3000/api/invoice/cancel \
  -H "Content-Type: application/json" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..." \
  -d '{"operationId": "123456"}'
```

---

### `POST /api/invoice/history`

Получение истории выставленных счетов (последние 20).

**Тело запроса:** не требуется (пустой JSON `{}`)

**Пример запроса:**

```bash
curl -X POST http://localhost:3000/api/invoice/history \
  -H "Content-Type: application/json" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..." \
  -d '{}'
```

---

## QR — QR-оплата

Генерация QR-кодов для оплаты через Kaspi Pay.

> 🔒 Все эндпоинты требуют [заголовки сессии](#заголовки-сессии).

### `POST /api/qr/create`

Создание QR-токена для оплаты.

**Тело запроса:**

| Поле | Тип | Обязательный | Описание |
|---|---|---|---|
| `amount` | `number` | ✅ | Сумма в тенге |
| `latitude` | `number` | ❌ | Широта (по умолчанию: Алматы) |
| `longitude` | `number` | ❌ | Долгота (по умолчанию: Алматы) |

**Пример запроса:**

```bash
curl -X POST http://localhost:3000/api/qr/create \
  -H "Content-Type: application/json" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..." \
  -H "X-Profile-Id: ..." \
  -d '{"amount": 500}'
```

**Успешный ответ:**

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

> 💡 `QrToken` содержит ссылку для оплаты — можно преобразовать в QR-код.

---

### `GET /api/qr/status`

Проверка статуса QR-платежа.

**Query-параметры:**

| Параметр | Тип | Обязательный | Описание |
|---|---|---|---|
| `qrOperationId` | `string` | ✅ | ID QR-операции из `/api/qr/create` |

**Пример запроса:**

```bash
curl "http://localhost:3000/api/qr/status?qrOperationId=789012" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..."
```

---

## History — История операций

Просмотр истории всех операций (QR + счета).

> 🔒 Все эндпоинты требуют [заголовки сессии](#заголовки-сессии).

### `POST /api/history/operations`

Получение списка операций за период.

**Тело запроса:**

| Поле | Тип | Обязательный | Описание |
|---|---|---|---|
| `endDate` | `string` | ✅ | Конечная дата (формат: `YYYY-MM-DD`) |
| `lastTransactionDate` | `string` | ❌ | Дата последней транзакции (для пагинации) |
| `statementPeriodCode` | `number` | ❌ | Код периода (по умолчанию: `0`) |

**Пример запроса:**

```bash
curl -X POST http://localhost:3000/api/history/operations \
  -H "Content-Type: application/json" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..." \
  -d '{"endDate": "2025-01-15"}'
```

---

### `POST /api/history/details`

Получение деталей конкретной операции.

**Тело запроса:**

| Поле | Тип | Обязательный | Описание |
|---|---|---|---|
| `id` | `number` | ✅ | ID операции |
| `operationMethod` | `number` | ❌ | Метод операции (по умолчанию: `0`) |

**Пример запроса:**

```bash
curl -X POST http://localhost:3000/api/history/details \
  -H "Content-Type: application/json" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..." \
  -d '{"id": 123456}'
```

---

## Refund — Возвраты

Возврат средств по ранее проведённой операции.

> 🔒 Все эндпоинты требуют [заголовки сессии](#заголовки-сессии).

### `POST /api/refund/create`

Создание возврата.

**Тело запроса:**

| Поле | Тип | Обязательный | Описание |
|---|---|---|---|
| `qrOperationId` | `number` | ✅ | ID операции для возврата |
| `returnAmount` | `number` | ✅ | Сумма возврата в тенге |

**Пример запроса:**

```bash
curl -X POST http://localhost:3000/api/refund/create \
  -H "Content-Type: application/json" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..." \
  -d '{"qrOperationId": 789012, "returnAmount": 500}'
```

---

## Session — Проверка сессии

### `GET /api/session/check`

Проверка валидности текущей сессии через запрос к Kaspi API.

> 🔒 Требует [заголовки сессии](#заголовки-сессии).

**Пример запроса:**

```bash
curl "http://localhost:3000/api/session/check" \
  -H "X-Token-SN: ..." \
  -H "X-Vtoken-Secret: ..."
```

**Активная сессия:**

```json
{ "active": true }
```

**Неактивная сессия:**

```json
{
  "active": false,
  "error": "Session rejected by Kaspi API.",
  "code": 401,
  "details": { ... }
}
```

---

## Коды ошибок

Все эндпоинты возвращают ошибки в формате:

```json
{ "error": "Описание ошибки" }
```

| HTTP-код | Описание |
|---|---|
| `400` | Отсутствуют обязательные параметры или параметр имеет неверный формат |
| `401` | Отсутствуют или невалидные заголовки сессии |
| `500` | Внутренняя ошибка сервера или ошибка Kaspi API |

---

## Webhooks — Уведомления

Система автоматически отслеживает статусы созданных QR- и invoice-платежей (polling каждые 3 секунды) и отправляет HTTP POST-уведомления (webhooks) на указанные URL при изменении статуса платежа.

### Настройка

Вебхуки настраиваются в файле `webhooks.json` в корне проекта. Файл содержит массив объектов:

```json
[
  {
    "url": "https://example.com/webhook",
    "events": ["payment.success", "payment.failed", "payment.expired", "payment.lost"],
    "secret": "your-webhook-secret"
  }
]
```

| Поле | Тип | Обязательный | Описание |
|---|---|---|---|
| `url` | `string` | ✅ | URL, на который будут отправляться уведомления |
| `events` | `string[]` | ✅ | Список событий для подписки |
| `secret` | `string` | ❌ | Секрет для HMAC-подписи (рекомендуется) |

> 💡 Для начала скопируйте `webhooks.example.json` → `webhooks.json` и отредактируйте.

Можно указать несколько вебхуков с разными URL и событиями:

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

### События

| Событие | Описание | Когда срабатывает |
|---|---|---|
| `payment.success` | Платёж успешно проведён | QR: статус `Processed`; Invoice: статус `Processed` |
| `payment.failed` | Платёж отклонён / отменён | QR: `CancelledByUser`, `Rejected`, `Error` и др.; Invoice: `RemotePaymentCanceled`, `RemotePaymentRejected` |
| `payment.expired` | Время оплаты истекло | QR: `QrTokenDiscarded`, `Expired`; Invoice: `Expired` |
| `payment.lost` | Статус платежа неизвестен — требуется ручная проверка | Сессия Kaspi вытеснена (`SessionExpired`) или исчерпаны попытки опроса (`PollingFailed`) |

### Формат payload

При срабатывании события на каждый подписанный URL отправляется POST-запрос с JSON-телом:

```json
{
  "event": "payment.success",
  "paymentId": "123456",
  "type": "qr",
  "status": "Processed",
  "statusDesc": "Операция проведена успешно",
  "amount": 5000,
  "qrToken": "QR-TOKEN-...",
  "receiptUrl": "https://...",
  "orderNumber": "ORDER-001",
  "data": { ... },
  "timestamp": "2026-05-10T00:00:00.000Z"
}
```

| Поле | Тип | Описание |
|---|---|---|
| `event` | `string` | Название события (`payment.success`, `payment.failed`, `payment.expired`, `payment.lost`) |
| `paymentId` | `string` | ID платежа (QR operationId или invoice operationId) |
| `type` | `string` | Тип платежа: `qr` или `invoice` |
| `status` | `string` | Финальный статус от Kaspi API |
| `statusDesc` | `string` | Описание статуса |
| `amount` | `number\|null` | Сумма платежа в тенге |
| `qrToken` | `string\|null` | QR-токен (только для QR-платежей) |
| `receiptUrl` | `string\|null` | Ссылка на чек |
| `orderNumber` | `string\|null` | Номер заказа |
| `data` | `object` | Полные данные ответа от Kaspi API |
| `timestamp` | `string` | Время отправки уведомления (ISO 8601) |

### Подпись (HMAC)

Каждый запрос подписывается HMAC SHA-256 с использованием `secret` из конфигурации вебхука. Подпись передаётся в заголовке:

```
X-Webhook-Signature: sha256=<hex-digest>
```

**Проверка подписи на стороне получателя (Node.js):**

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

// В обработчике запроса:
const rawBody = JSON.stringify(req.body); // или используйте raw body
const sig = req.headers['x-webhook-signature'];
if (!verifySignature(rawBody, sig, 'your-webhook-secret')) {
  return res.status(401).send('Invalid signature');
}
```

### Повторные попытки (Retry)

Если доставка вебхука не удалась (ошибка сети, таймаут, HTTP-ошибка), система выполняет до **3 попыток** с нарастающей задержкой:

| Попытка | Задержка |
|---|---|
| 1-я (первая) | Немедленно |
| 2-я | 5 секунд |
| 3-я | 30 секунд |

- Таймаут запроса: **10 секунд**.
- Очередь повторных попыток сохраняется в `webhook-retries.json` и переживает перезапуск сервера.
- После 3 неудачных попыток уведомление отбрасывается (логируется ошибка).

---

## Типичный сценарий использования

```
1. POST /api/auth/init              → получить processId
2. POST /api/auth/send-phone        → отправить SMS
3. POST /api/auth/verify-otp        → подтвердить код → получить tokenSN + vtokenSecret

4. POST /api/qr/create              → создать QR для оплаты
5. GET  /api/qr/status              → проверить статус оплаты

   — или —

4. POST /api/invoice/create         → выставить счёт по номеру телефона
5. GET  /api/invoice/details        → проверить статус счёта

6. POST /api/refund/create          → возврат средств (при необходимости)
```
