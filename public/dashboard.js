import { applyTranslations, getLanguage, supportedLanguages, translate } from './dashboard-i18n.js';

const $ = (id) => document.getElementById(id);
let language = getLanguage();
let registering = false;
let profile;
let kaspiProcessId;
let kaspiStep = 0;
let integrationStep = 1;
let currentPage = 'overview';
let currentMode;
let organizationWorkMode = 'test';
let overviewPeriod = 'today';
let paymentsPage = 1;
let paymentsTotal = 0;
let selectedPayment;
const query = new URLSearchParams(window.location.search);
const invitationToken = query.get('invite');
const resetToken = query.get('reset');
const verificationToken = query.get('verify');
const referralCode = query.get('ref');
const t = (key, fallback) => translate(language, key, fallback);

const uiText = {
  en: {
    signedOut: 'Signed out', noPayments: 'No invoices yet', noRefunds: 'No refunds yet', cancel: 'Cancel', refund: 'Refund', payLink: 'Pay link',
    invoiceCancelled: 'Invoice cancelled', refundProcessed: 'Refund processed', paymentReady: 'Payment ready', openPaymentLink: 'Open universal payment link',
    paymentCreated: 'Payment created', failedDeliveries: 'Failed deliveries', notConnected: 'Not connected', copyNow: 'Copy now', revoke: 'Revoke',
    test: 'Test', disable: 'Disable', enable: 'Enable', rotate: 'Rotate secret', delete: 'Delete', replay: 'Replay', queued: 'queued',
    keyRevoked: 'API key revoked', testQueued: 'Test webhook queued', secretRotated: 'Webhook secret rotated', endpointDeleted: 'Webhook endpoint deleted',
    deliveryQueued: 'Webhook delivery queued again', invitationCreated: 'Invitation created', invitationLink: 'Invitation link', invitationEmailed: 'Invitation emailed',
    memberRemoved: 'Member removed', roleUpdated: 'Member role updated', authenticator: 'Authenticator app', emailAddress: 'Email address', active: 'active', disabled: 'disabled',
    verified: 'verified', unverified: 'unverified', verificationSent: 'Verification email sent', emailNotConfigured: 'Email delivery is not configured',
    authenticatorEnabled: 'Authenticator enabled', authenticatorDisabled: 'Authenticator disabled', kaspiConnected: 'Kaspi Pay connected', kaspiDisconnected: 'Kaspi Pay disconnected',
    disconnectConfirm: 'Disconnect Kaspi Pay? New payments will stop until it is connected again.', cancelConfirm: 'Cancel this pending invoice?', refundPrompt: 'Refund amount in KZT',
    step: 'Step', of: 'of', checked: 'checked', sendingSms: 'Sending SMS…', smsSent: 'SMS code sent', generating: 'Generating…', printCaption: 'Scan with Kaspi to pay',
    copied: 'Copied', creatingIntegration: 'Creating integration…', integrationCreatedToast: 'API key and webhook created', apiKeyCreated: 'API key created',
    webhookProtectionAt: 'Signed payment notifications will be sent to',
    webhookHelperPrompt: 'I am connecting Kaspi payment acceptance to my website or server. I need an HTTPS webhook URL that accepts POST notifications about payment status. Please tell me which URL to enter, or help me create the handler. API documentation: http://localhost:3000/api-docs',
    roleOwner: 'Owner', roleAdmin: 'Admin', roleDeveloper: 'Developer', roleOperator: 'Operator', roleViewer: 'Viewer',
    details: 'Details', page: 'Page', amountLabel: 'Amount', statusLabel: 'Status', methodLabel: 'Method', customerLabel: 'Customer',
    descriptionLabel: 'Description', createdLabel: 'Created', paidLabel: 'Paid', providerIdLabel: 'Provider status', receipt: 'Receipt',
    repeatInvoice: 'Repeat invoice', noteSaved: 'Private note saved',
    defaultKey: 'Default', edit: 'Edit', invoiceCount: 'Invoices', lastUsed: 'Last used', notConfigured: 'Not configured',
    rotateSecret: 'Rotate secret', rotateKey: 'Rotate API key', makeDefault: 'Make default', integrationNamePrompt: 'Integration name',
    webhookUrlPrompt: 'Webhook URL (leave empty to disable)', integrationUpdated: 'Integration updated', defaultUpdated: 'Default integration updated',
    rotateKeyConfirm: 'Rotate this API key? The old key will stop working immediately.', copyNewKey: 'Copy the new API key now',
    keyRotated: 'API key rotated', deleteIntegrationConfirm: 'Delete this integration? Its API key and webhook will stop working.',
    pause: 'Pause', resume: 'Resume', noSubscriptions: 'No recurring schedules yet', cancelSubscriptionConfirm: 'Cancel this recurring schedule?',
    subscriptionUpdated: 'Recurring schedule updated', subscriptionCreated: 'Recurring schedule created', periodLabel: 'Period', nextInvoiceLabel: 'Next invoice',
    generatedLabel: 'Invoices generated', successfulLabel: 'Payments completed', noInvoicesGenerated: 'No invoices generated yet',
    shortCode: 'Fallback code', scans: 'scans', preview: 'Preview', noPrintableRequests: 'No printable requests yet',
    printableDisabled: 'Printable request disabled', printableEnabled: 'Printable request enabled', printableCreated: 'Printable request created',
    enableLiveConfirm: 'Switch to Live mode? New invoices and QR requests can contact Kaspi and reach real customers.', organizationSaved: 'Organization settings saved',
    kaspiOrganizationId: 'Kaspi organization ID', lastRefreshed: 'Last checked', kaspiOrganizationNotConnected: 'Connect a Kaspi cashier to load provider organization details.',
    allApiKeys: 'All API keys', standaloneWebhook: 'Standalone webhook', noDeliveries: 'No deliveries match these filters.', apiKeySingular: 'API key',
    requestPlan: 'Request plan', current: 'Current', requestPending: 'Request pending', planRequested: 'Plan request sent', requestCancelled: 'Plan request cancelled', cancelRequest: 'Cancel request', noPlanRequests: 'No plan requests yet.', noBillingHistory: 'No payments yet.', noReferrals: 'No referred businesses yet.', partnerLinkCopied: 'Referral link copied', unlimited: 'Unlimited', perMonth: 'per month', payments: 'Payments', recurring: 'Recurring billing', printableQr: 'Printable QR', api: 'API access', webhooks: 'Signed webhooks', team: 'Team access', prioritySupport: 'Priority support',
    accessCodeCreated: 'Copy this one-use access code now', accessRevoked: 'Access revoked', businessConnected: 'Business added to your workspace switcher', noAccessGrants: 'No external access grants yet.', accepted: 'accepted', expired: 'expired', revoked: 'revoked', emailOptional: 'Any verified email',
    volume_today: 'Volume today', volume_week: 'Volume, last 7 days', volume_month: 'Volume this month', volume_year: 'Volume this year', invoices_today: 'Invoices today', invoices_week: 'Invoices, last 7 days', invoices_month: 'Invoices this month', invoices_year: 'Invoices this year',
  },
  ru: {
    signedOut: 'Вы вышли', noPayments: 'Счетов пока нет', noRefunds: 'Возвратов пока нет', cancel: 'Отменить', refund: 'Возврат', payLink: 'Ссылка на оплату',
    invoiceCancelled: 'Счёт отменён', refundProcessed: 'Возврат выполнен', paymentReady: 'Платёж готов', openPaymentLink: 'Открыть ссылку на оплату',
    paymentCreated: 'Платёж создан', failedDeliveries: 'Неудачные отправки', notConnected: 'Не подключено', copyNow: 'Скопируйте сейчас', revoke: 'Отозвать',
    test: 'Тест', disable: 'Отключить', enable: 'Включить', rotate: 'Сменить секрет', delete: 'Удалить', replay: 'Повторить', queued: 'в очереди',
    keyRevoked: 'API-ключ отозван', testQueued: 'Тестовый вебхук поставлен в очередь', secretRotated: 'Секрет вебхука изменён', endpointDeleted: 'Адрес вебхука удалён',
    deliveryQueued: 'Вебхук снова поставлен в очередь', invitationCreated: 'Приглашение создано', invitationLink: 'Ссылка приглашения', invitationEmailed: 'Приглашение отправлено',
    memberRemoved: 'Сотрудник удалён', roleUpdated: 'Роль сотрудника изменена', authenticator: 'Приложение-аутентификатор', emailAddress: 'Электронная почта', active: 'активно', disabled: 'отключено',
    verified: 'подтверждена', unverified: 'не подтверждена', verificationSent: 'Письмо отправлено', emailNotConfigured: 'Отправка почты не настроена',
    authenticatorEnabled: 'Аутентификатор включён', authenticatorDisabled: 'Аутентификатор отключён', kaspiConnected: 'Kaspi Pay подключён', kaspiDisconnected: 'Kaspi Pay отключён',
    disconnectConfirm: 'Отключить Kaspi Pay? Новые платежи остановятся до повторного подключения.', cancelConfirm: 'Отменить этот счёт?', refundPrompt: 'Сумма возврата, ₸',
    step: 'Шаг', of: 'из', checked: 'отмечено', sendingSms: 'Отправляем SMS…', smsSent: 'Код отправлен по SMS', generating: 'Создаём…', printCaption: 'Отсканируйте в Kaspi для оплаты',
    copied: 'Скопировано', creatingIntegration: 'Создаём интеграцию…', integrationCreatedToast: 'API-ключ и вебхук созданы', apiKeyCreated: 'API-ключ создан',
    webhookProtectionAt: 'Подписанные уведомления о платежах будут отправляться на',
    webhookHelperPrompt: 'Я подключаю приём платежей Kaspi к своему сайту или серверу. Мне нужен HTTPS-адрес вебхука, который принимает POST-уведомления о статусе оплаты. Подскажи, какой URL указать, или помоги создать обработчик. Документация API: http://localhost:3000/api-docs',
    roleOwner: 'Владелец', roleAdmin: 'Администратор', roleDeveloper: 'Разработчик', roleOperator: 'Оператор', roleViewer: 'Наблюдатель',
    details: 'Подробнее', page: 'Страница', amountLabel: 'Сумма', statusLabel: 'Статус', methodLabel: 'Способ', customerLabel: 'Клиент',
    descriptionLabel: 'Описание', createdLabel: 'Создан', paidLabel: 'Оплачен', providerIdLabel: 'Статус провайдера', receipt: 'Чек',
    repeatInvoice: 'Повторить счёт', noteSaved: 'Внутренняя заметка сохранена',
    defaultKey: 'По умолчанию', edit: 'Изменить', invoiceCount: 'Счета', lastUsed: 'Последнее использование', notConfigured: 'Не настроено',
    rotateSecret: 'Сменить секрет', rotateKey: 'Сменить API-ключ', makeDefault: 'Сделать основным', integrationNamePrompt: 'Название интеграции',
    webhookUrlPrompt: 'Адрес вебхука (оставьте пустым, чтобы отключить)', integrationUpdated: 'Интеграция обновлена', defaultUpdated: 'Основная интеграция обновлена',
    rotateKeyConfirm: 'Сменить API-ключ? Старый ключ сразу перестанет работать.', copyNewKey: 'Скопируйте новый API-ключ сейчас',
    keyRotated: 'API-ключ изменён', deleteIntegrationConfirm: 'Удалить интеграцию? API-ключ и вебхук перестанут работать.',
    pause: 'Пауза', resume: 'Возобновить', noSubscriptions: 'Регулярных расписаний пока нет', cancelSubscriptionConfirm: 'Отменить это расписание?',
    subscriptionUpdated: 'Расписание обновлено', subscriptionCreated: 'Расписание создано', periodLabel: 'Период', nextInvoiceLabel: 'Следующий счёт',
    generatedLabel: 'Счетов создано', successfulLabel: 'Оплат завершено', noInvoicesGenerated: 'Счета ещё не создавались',
    shortCode: 'Резервный код', scans: 'сканирований', preview: 'Предпросмотр', noPrintableRequests: 'Печатных запросов пока нет',
    printableDisabled: 'Печатный запрос отключён', printableEnabled: 'Печатный запрос включён', printableCreated: 'Печатный запрос создан',
    enableLiveConfirm: 'Перейти в рабочий режим? Новые счета и QR-запросы смогут обращаться в Kaspi и приходить реальным покупателям.', organizationSaved: 'Настройки организации сохранены',
    kaspiOrganizationId: 'ID организации Kaspi', lastRefreshed: 'Последняя проверка', kaspiOrganizationNotConnected: 'Подключите кассира Kaspi, чтобы загрузить данные организации.',
    allApiKeys: 'Все API-ключи', standaloneWebhook: 'Отдельный вебхук', noDeliveries: 'Отправок с такими фильтрами нет.', apiKeySingular: 'API-ключ',
    requestPlan: 'Запросить тариф', current: 'Текущий', requestPending: 'Запрос отправлен', planRequested: 'Запрос тарифа отправлен', requestCancelled: 'Запрос тарифа отменён', cancelRequest: 'Отменить запрос', noPlanRequests: 'Запросов тарифа пока нет.', noBillingHistory: 'Платежей пока нет.', noReferrals: 'Приглашённых компаний пока нет.', partnerLinkCopied: 'Партнёрская ссылка скопирована', unlimited: 'Без лимита', perMonth: 'в месяц', payments: 'Платежи', recurring: 'Регулярные платежи', printableQr: 'Печатный QR', api: 'Доступ к API', webhooks: 'Подписанные вебхуки', team: 'Командный доступ', prioritySupport: 'Приоритетная поддержка',
    accessCodeCreated: 'Скопируйте одноразовый код доступа сейчас', accessRevoked: 'Доступ отозван', businessConnected: 'Компания добавлена в переключатель кабинетов', noAccessGrants: 'Внешних доступов пока нет.', accepted: 'принят', expired: 'истёк', revoked: 'отозван', emailOptional: 'Любая подтверждённая почта',
    volume_today: 'Оборот сегодня', volume_week: 'Оборот за 7 дней', volume_month: 'Оборот за месяц', volume_year: 'Оборот за год', invoices_today: 'Счетов сегодня', invoices_week: 'Счетов за 7 дней', invoices_month: 'Счетов за месяц', invoices_year: 'Счетов за год',
  },
  kk: {
    signedOut: 'Сіз шықтыңыз', noPayments: 'Шоттар әлі жоқ', noRefunds: 'Қайтарымдар әлі жоқ', cancel: 'Болдырмау', refund: 'Қайтару', payLink: 'Төлем сілтемесі',
    invoiceCancelled: 'Шот болдырылмады', refundProcessed: 'Қайтарым орындалды', paymentReady: 'Төлем дайын', openPaymentLink: 'Төлем сілтемесін ашу',
    paymentCreated: 'Төлем жасалды', failedDeliveries: 'Сәтсіз жіберілімдер', notConnected: 'Қосылмаған', copyNow: 'Қазір көшіріңіз', revoke: 'Кері қайтару',
    test: 'Тест', disable: 'Өшіру', enable: 'Қосу', rotate: 'Құпияны ауыстыру', delete: 'Жою', replay: 'Қайталау', queued: 'кезекте',
    keyRevoked: 'API кілті қайтарылды', testQueued: 'Тест вебхук кезекке қойылды', secretRotated: 'Вебхук құпиясы ауыстырылды', endpointDeleted: 'Вебхук мекенжайы жойылды',
    deliveryQueued: 'Вебхук қайта кезекке қойылды', invitationCreated: 'Шақыру жасалды', invitationLink: 'Шақыру сілтемесі', invitationEmailed: 'Шақыру жіберілді',
    memberRemoved: 'Қызметкер жойылды', roleUpdated: 'Қызметкер рөлі өзгертілді', authenticator: 'Аутентификатор қолданбасы', emailAddress: 'Электрондық пошта', active: 'белсенді', disabled: 'өшірулі',
    verified: 'расталды', unverified: 'расталмаған', verificationSent: 'Растау хаты жіберілді', emailNotConfigured: 'Пошта жіберу бапталмаған',
    authenticatorEnabled: 'Аутентификатор қосылды', authenticatorDisabled: 'Аутентификатор өшірілді', kaspiConnected: 'Kaspi Pay қосылды', kaspiDisconnected: 'Kaspi Pay ажыратылды',
    disconnectConfirm: 'Kaspi Pay-ді ажырату керек пе? Қайта қосылғанша жаңа төлемдер тоқтайды.', cancelConfirm: 'Бұл шотты болдырмау керек пе?', refundPrompt: 'Қайтарым сомасы, ₸',
    step: 'Қадам', of: '/', checked: 'белгіленді', sendingSms: 'SMS жіберілуде…', smsSent: 'SMS коды жіберілді', generating: 'Жасалуда…', printCaption: 'Төлеу үшін Kaspi-де сканерлеңіз',
    copied: 'Көшірілді', creatingIntegration: 'Интеграция жасалуда…', integrationCreatedToast: 'API кілті және вебхук жасалды', apiKeyCreated: 'API кілті жасалды',
    webhookProtectionAt: 'Қол қойылған төлем хабарламалары мына мекенжайға жіберіледі:',
    webhookHelperPrompt: 'Мен Kaspi төлемдерін сайтымда немесе серверімде қабылдауды қосып жатырмын. Төлем күйі туралы POST хабарламаларын қабылдайтын HTTPS вебхук мекенжайы қажет. Қай URL енгізу керегін айт немесе өңдеуші жасауға көмектес. API құжаттамасы: http://localhost:3000/api-docs',
    roleOwner: 'Иесі', roleAdmin: 'Әкімші', roleDeveloper: 'Әзірлеуші', roleOperator: 'Оператор', roleViewer: 'Көруші',
    details: 'Толығырақ', page: 'Бет', amountLabel: 'Сома', statusLabel: 'Күйі', methodLabel: 'Әдіс', customerLabel: 'Клиент',
    descriptionLabel: 'Сипаттама', createdLabel: 'Жасалды', paidLabel: 'Төленді', providerIdLabel: 'Провайдер күйі', receipt: 'Чек',
    repeatInvoice: 'Шотты қайталау', noteSaved: 'Ішкі ескерту сақталды',
    defaultKey: 'Негізгі', edit: 'Өзгерту', invoiceCount: 'Шоттар', lastUsed: 'Соңғы қолдану', notConfigured: 'Бапталмаған',
    rotateSecret: 'Құпияны ауыстыру', rotateKey: 'API кілтін ауыстыру', makeDefault: 'Негізгі ету', integrationNamePrompt: 'Интеграция атауы',
    webhookUrlPrompt: 'Вебхук мекенжайы (өшіру үшін бос қалдырыңыз)', integrationUpdated: 'Интеграция жаңартылды', defaultUpdated: 'Негізгі интеграция жаңартылды',
    rotateKeyConfirm: 'API кілтін ауыстыру керек пе? Ескі кілт бірден жұмысын тоқтатады.', copyNewKey: 'Жаңа API кілтін қазір көшіріңіз',
    keyRotated: 'API кілті ауыстырылды', deleteIntegrationConfirm: 'Интеграцияны жою керек пе? API кілті мен вебхук тоқтайды.',
    pause: 'Кідірту', resume: 'Жалғастыру', noSubscriptions: 'Тұрақты кестелер әлі жоқ', cancelSubscriptionConfirm: 'Бұл кестені тоқтату керек пе?',
    subscriptionUpdated: 'Кесте жаңартылды', subscriptionCreated: 'Кесте жасалды', periodLabel: 'Кезең', nextInvoiceLabel: 'Келесі шот',
    generatedLabel: 'Жасалған шоттар', successfulLabel: 'Аяқталған төлемдер', noInvoicesGenerated: 'Шоттар әлі жасалмады',
    shortCode: 'Қосалқы код', scans: 'скан', preview: 'Алдын ала қарау', noPrintableRequests: 'Баспа сұраулары әлі жоқ',
    printableDisabled: 'Баспа сұрауы өшірілді', printableEnabled: 'Баспа сұрауы қосылды', printableCreated: 'Баспа сұрауы жасалды',
    enableLiveConfirm: 'Жұмыс режиміне ауысу керек пе? Жаңа шоттар мен QR сұраулары Kaspi-ге жіберіліп, нақты клиенттерге жетуі мүмкін.', organizationSaved: 'Ұйым баптаулары сақталды',
    kaspiOrganizationId: 'Kaspi ұйым ID', lastRefreshed: 'Соңғы тексеру', kaspiOrganizationNotConnected: 'Ұйым деректерін жүктеу үшін Kaspi кассирін қосыңыз.',
    allApiKeys: 'Барлық API кілттері', standaloneWebhook: 'Бөлек вебхук', noDeliveries: 'Бұл сүзгілерге сай жіберілімдер жоқ.', apiKeySingular: 'API кілті',
    requestPlan: 'Тарифті сұрау', current: 'Ағымдағы', requestPending: 'Сұрау жіберілді', planRequested: 'Тариф сұрауы жіберілді', requestCancelled: 'Тариф сұрауы жойылды', cancelRequest: 'Сұрауды жою', noPlanRequests: 'Тариф сұраулары әлі жоқ.', noBillingHistory: 'Төлемдер әлі жоқ.', noReferrals: 'Шақырылған бизнестер әлі жоқ.', partnerLinkCopied: 'Серіктестік сілтеме көшірілді', unlimited: 'Шектеусіз', perMonth: 'айына', payments: 'Төлемдер', recurring: 'Тұрақты төлемдер', printableQr: 'Баспа QR', api: 'API рұқсаты', webhooks: 'Қол қойылған вебхуктар', team: 'Команда рұқсаты', prioritySupport: 'Басым қолдау',
    accessCodeCreated: 'Бір реттік кіру кодын қазір көшіріңіз', accessRevoked: 'Рұқсат қайтарылды', businessConnected: 'Бизнес кабинет ауыстырғышына қосылды', noAccessGrants: 'Сыртқы рұқсаттар әлі жоқ.', accepted: 'қабылданды', expired: 'мерзімі өтті', revoked: 'қайтарылды', emailOptional: 'Кез келген расталған пошта',
    volume_today: 'Бүгінгі айналым', volume_week: '7 күндегі айналым', volume_month: 'Осы айдағы айналым', volume_year: 'Осы жылдағы айналым', invoices_today: 'Бүгінгі шоттар', invoices_week: '7 күндегі шоттар', invoices_month: 'Осы айдағы шоттар', invoices_year: 'Осы жылдағы шоттар',
  },
};
const u = (key) => uiText[language]?.[key] || uiText.en[key] || key;

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(body?.error || `Request failed (${response.status})`);
    error.code = body?.code;
    throw error;
  }
  return body;
};
const post = (path, body, method = 'POST', headers = {}) => api(path, { method, headers, body: JSON.stringify(body) });
const safe = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const badge = (status, label = status) => `<span class="badge ${safe(status || '')}">${safe(label || u('notConnected'))}</span>`;
const money = (amount) => new Intl.NumberFormat(language === 'kk' ? 'kk-KZ' : language === 'ru' ? 'ru-KZ' : 'en-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 2 }).format(amount || 0);
const dateTime = (value) => new Date(value).toLocaleString(language === 'kk' ? 'kk-KZ' : language === 'ru' ? 'ru-KZ' : 'en-GB');
const toast = (message) => {
  $('toast').textContent = message;
  $('toast').hidden = false;
  setTimeout(() => { $('toast').hidden = true; }, 3500);
};

const updateLanguage = async (nextLanguage, refresh = true) => {
  if (!supportedLanguages.includes(nextLanguage)) return;
  language = nextLanguage;
  localStorage.setItem('kaspi-language', language);
  applyTranslations(language);
  if (profile) {
    const activeNavigation = document.querySelector('nav button[data-page].active');
    $('pageTitle').textContent = activeNavigation?.querySelector('span')?.textContent || currentPage;
    $('roleBadge').textContent = roleLabel(profile.role);
  }
  document.querySelectorAll('[data-language-menu]').forEach((menu) => { menu.hidden = true; });
  updateAuthCopy();
  updateKaspiProgress();
  refreshIntegrationLanguage();
  if (refresh && profile) await loaders[currentPage]?.();
};

document.querySelectorAll('[data-language-toggle]').forEach((button) => button.addEventListener('click', (event) => {
  event.stopPropagation();
  const root = button.closest('#authView, #appView');
  const menu = root.querySelector('[data-language-menu]');
  const opening = menu.hidden;
  document.querySelectorAll('[data-language-menu]').forEach((item) => { item.hidden = true; });
  menu.hidden = !opening;
}));
document.querySelectorAll('[data-language]').forEach((button) => button.addEventListener('click', () => updateLanguage(button.dataset.language)));
document.addEventListener('click', () => document.querySelectorAll('[data-language-menu]').forEach((menu) => { menu.hidden = true; }));
window.addEventListener('unhandledrejection', (event) => { toast(event.reason?.message || 'The operation could not be completed.'); event.preventDefault(); });

const roleLabel = (role) => u(`role${role[0].toUpperCase()}${role.slice(1)}`);
const statusLabel = (status) => ({ active: u('active'), disabled: u('disabled'), verified: u('verified'), unverified: u('unverified') })[status] || status;

const updateAuthCopy = () => {
  if (resetToken) return;
  if (invitationToken) {
    $('authTitle').textContent = t('acceptInvitation', language === 'ru' ? 'Примите приглашение' : language === 'kk' ? 'Шақыруды қабылдаңыз' : 'Accept your invitation');
    $('authSubtitle').textContent = t('acceptInvitationText', language === 'ru' ? 'Создайте аккаунт, чтобы присоединиться к организации.' : language === 'kk' ? 'Ұйымға қосылу үшін аккаунт жасаңыз.' : 'Create your account to join the business workspace.');
    return;
  }
  $('authTitle').textContent = registering ? (language === 'ru' ? 'Создайте свой кабинет' : language === 'kk' ? 'Кабинетіңізді ашыңыз' : 'Create your workspace') : t('welcome', 'Welcome back');
  $('authSubtitle').textContent = registering ? (language === 'ru' ? 'Начните с изолированного аккаунта бизнеса.' : language === 'kk' ? 'Оқшауланған бизнес аккаунтынан бастаңыз.' : 'Start with an isolated business account.') : t('signInSubtitle', 'Sign in to manage payments and integrations.');
  $('toggleAuth').textContent = registering ? (language === 'ru' ? 'Уже есть аккаунт?' : language === 'kk' ? 'Аккаунтыңыз бар ма?' : 'Already have an account?') : t('createAccount', 'Create a new business account');
  $('authForm').querySelector('button[type="submit"]').textContent = registering ? (language === 'ru' ? 'Создать аккаунт' : language === 'kk' ? 'Аккаунт ашу' : 'Create account') : t('signIn', 'Sign in');
};

const configurePageMode = (page, mode) => {
  if (page === 'payments') {
    $('paymentCreatePanel').hidden = mode === 'list';
    $('paymentListPanel').hidden = mode === 'create';
  }
  if (page === 'team') {
    $('staffPanel').hidden = mode === 'access';
    $('accessPanel').hidden = mode === 'staff';
  }
};

const showPage = async (page, mode, sourceButton) => {
  currentPage = page;
  currentMode = mode;
  document.querySelectorAll('nav button[data-page]').forEach((item) => item.classList.toggle('active', item === sourceButton));
  document.querySelectorAll('.page').forEach((section) => { section.hidden = section.id !== `${page}Page`; });
  configurePageMode(page, mode);
  $('pageTitle').textContent = sourceButton?.querySelector('span')?.textContent || t(`nav${page[0].toUpperCase()}${page.slice(1)}`, page);
  await loaders[page]?.();
};

document.querySelectorAll('nav button[data-page]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page, button.dataset.mode, button)));
document.querySelectorAll('[data-open-kaspi]').forEach((button) => button.addEventListener('click', () => {
  const target = document.querySelector('nav button[data-page="kaspi"]');
  showPage('kaspi', undefined, target);
}));

const showApp = async (data) => {
  profile = data;
  $('authView').hidden = true;
  $('appView').hidden = false;
  $('tenantLabel').textContent = data.tenantName;
  $('userLabel').textContent = data.email || data.displayName;
  $('roleBadge').textContent = roleLabel(data.role);
  const canManage = ['owner', 'admin'].includes(data.role);
  const canDevelop = ['owner', 'admin', 'developer'].includes(data.role);
  document.querySelector('nav button[data-page="audit"]').hidden = !canManage;
  document.querySelectorAll('nav button[data-page="developers"]').forEach((button) => { button.hidden = !canDevelop; });
  document.querySelector('nav button[data-page="payments"][data-mode="create"]').hidden = data.role === 'viewer';
  document.querySelector('nav button[data-page="printQr"]').hidden = data.role === 'viewer';
  $('paymentForm').hidden = data.role === 'viewer';
  $('openIntegrationWizard').hidden = !canDevelop;
  $('inviteForm').hidden = !canManage;
  $('accessGrantForm').hidden = !canManage;
  $('kaspiWizard').hidden = !canManage;
  const home = document.querySelector('nav button[data-page="overview"]');
  await Promise.all([showPage('overview', undefined, home), loadTenantChoices()]);
};
const showAuth = () => { $('appView').hidden = true; $('authView').hidden = false; };

$('toggleAuth').addEventListener('click', () => {
  registering = !registering;
  $('registerFields').hidden = !registering;
  $('forgotPassword').hidden = registering;
  updateAuthCopy();
});
$('forgotPassword').addEventListener('click', async () => {
  if (!$('email').value) { $('authError').textContent = language === 'ru' ? 'Сначала введите электронную почту.' : language === 'kk' ? 'Алдымен электрондық поштаны енгізіңіз.' : 'Enter your email address first.'; $('authError').hidden = false; return; }
  try {
    const result = await post('/api/dashboard/auth/request-password-reset', { email: $('email').value });
    $('authError').textContent = result.developmentResetUrl ? `Development reset link: ${result.developmentResetUrl}` : (language === 'ru' ? 'Если аккаунт существует, ссылка отправлена.' : language === 'kk' ? 'Аккаунт бар болса, сілтеме жіберілді.' : 'If that account exists, a reset link has been sent.');
    $('authError').hidden = false;
  } catch (error) { $('authError').textContent = error.message; $('authError').hidden = false; }
});
$('resetForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { await post('/api/dashboard/auth/reset-password', { token: resetToken, password: $('resetPassword').value }); window.history.replaceState({}, '', '/dashboard'); $('resetForm').hidden = true; $('authForm').hidden = false; $('forgotPassword').hidden = false; $('authTitle').textContent = language === 'ru' ? 'Пароль изменён' : language === 'kk' ? 'Құпиясөз өзгертілді' : 'Password updated'; $('authSubtitle').textContent = language === 'ru' ? 'Войдите с новым паролем.' : language === 'kk' ? 'Жаңа құпиясөзбен кіріңіз.' : 'Sign in with your new password.'; } catch (error) { $('authError').textContent = error.message; $('authError').hidden = false; }
});
$('authForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('authError').hidden = true;
  try {
    const body = { email: $('email').value, password: $('password').value, ...($('mfaLoginCode').value && { totpCode: $('mfaLoginCode').value }) };
    if (registering) { Object.assign(body, { displayName: $('displayName').value }); if (invitationToken) body.invitationToken = invitationToken; else Object.assign(body, { tenantName: $('tenantName').value, tenantSlug: $('tenantSlug').value, ...(referralCode && { referralCode }) }); }
    const result = await post(`/api/dashboard/auth/${registering ? 'register' : 'login'}`, body);
    if (invitationToken) window.history.replaceState({}, '', '/dashboard');
    await showApp(result.data);
  } catch (error) { if (error.code === 'MFA_REQUIRED') { $('mfaLoginField').hidden = false; $('mfaLoginCode').required = true; $('mfaLoginCode').focus(); } $('authError').textContent = error.message; $('authError').hidden = false; }
});
$('logoutButton').addEventListener('click', async () => { await post('/api/dashboard/auth/logout', {}); profile = undefined; showAuth(); toast(u('signedOut')); });

async function loadTenantChoices() {
  const { data } = await api('/api/dashboard/auth/tenants');
  $('tenantSwitcher').innerHTML = data.map((tenant) => `<option value="${tenant.tenant_id}" ${tenant.tenant_id === profile.tenantId ? 'selected' : ''}>${safe(tenant.tenant_name)}</option>`).join('');
  $('tenantSwitcher').hidden = data.length < 2;
}
$('tenantSwitcher').addEventListener('change', async (event) => { await post('/api/dashboard/auth/switch-tenant', { tenantId: event.target.value }); const { data } = await api('/api/dashboard/auth/me'); await showApp(data); });

async function loadOverview(period = overviewPeriod) {
  overviewPeriod = period;
  const { data } = await api(`/api/dashboard/data/overview?period=${encodeURIComponent(period)}`);
  organizationWorkMode = data.workMode;
  $('volumePeriodLabel').textContent = u(`volume_${data.period}`);
  $('paymentsPeriodLabel').textContent = u(`invoices_${data.period}`);
  document.querySelectorAll('[data-period]').forEach((button) => button.classList.toggle('active', button.dataset.period === data.period));
  $('volumeToday').textContent = money(Number(data.stats.volume_today_minor) / 100);
  $('paymentsToday').textContent = data.stats.payments_today;
  $('paidCount').textContent = data.stats.paid_count;
  $('problemCount').textContent = data.stats.problem_count;
  $('overviewConnection').innerHTML = `<div class="status-line"><span>${safe(data.connection?.organization_name || 'Kaspi Pay')}</span>${badge(data.connection?.state, statusLabel(data.connection?.state))}</div>`;
  $('overviewWebhooks').innerHTML = `<div class="status-line"><span>${u('failedDeliveries')}</span><strong>${data.failedWebhooks}</strong></div>`;
  $('setupBanner').hidden = data.connection?.state === 'active';
  $('workModeChip').textContent = data.workMode === 'test' ? '● TEST' : '● LIVE';
  $('workModeChip').classList.toggle('test-mode', data.workMode === 'test');
}
document.querySelectorAll('[data-period]').forEach((button) => button.addEventListener('click', () => loadOverview(button.dataset.period).catch((error) => toast(error.message))));

async function loadPayments() {
  const params = paymentFilterParams();
  params.set('page', String(paymentsPage));
  params.set('perPage', '25');
  const { data, meta } = await api(`/api/dashboard/data/payments?${params}`);
  paymentsTotal = meta.total;
  $('paymentsBody').innerHTML = data.length ? data.map((payment) => `<tr><td>${dateTime(payment.created_at)}</td><td><button class="table-link" data-open-payment="${payment.id}">${safe(payment.external_order_id || payment.id.slice(0, 8))}</button></td><td>${safe(payment.customer_phone || '—')}</td><td><strong>${safe(payment.description || '—')}</strong>${payment.internal_comment ? `<small>${safe(payment.internal_comment)}</small>` : ''}</td><td>${safe(payment.method)}</td><td>${badge(payment.status)}</td><td>${money(payment.amount)}</td><td><div class="row-actions"><button data-open-payment="${payment.id}">${u('details')}</button>${payment.qr_original_token && ['created', 'requires_customer_action', 'pending'].includes(payment.status) ? `<a href="${safe(payment.qr_original_token)}" target="_blank" rel="noopener">${u('payLink')}</a>` : ''}${payment.method === 'invoice' && ['created', 'pending'].includes(payment.status) ? `<button data-cancel-payment="${payment.id}">${u('cancel')}</button>` : ''}${['paid', 'partially_refunded'].includes(payment.status) ? `<button data-refund-payment="${payment.id}" data-payment-amount="${payment.amount}">${u('refund')}</button>` : ''}</div></td></tr>`).join('') : `<tr><td colspan="8" class="empty">${u('noPayments')}</td></tr>`;
  const totalPages = Math.max(Math.ceil(paymentsTotal / 25), 1);
  $('paymentsPageLabel').textContent = `${u('page')} ${meta.page} ${u('of')} ${totalPages} · ${paymentsTotal}`;
  $('paymentsPrevious').disabled = meta.page <= 1;
  $('paymentsNext').disabled = meta.page >= totalPages;
  $('exportPayments').href = `/api/dashboard/data/payments/export?${paymentFilterParams()}`;
  document.querySelectorAll('[data-open-payment]').forEach((button) => button.addEventListener('click', () => openPaymentDetail(button.dataset.openPayment)));
  document.querySelectorAll('[data-cancel-payment]').forEach((button) => button.addEventListener('click', async () => { if (!window.confirm(u('cancelConfirm'))) return; await post(`/api/dashboard/payments/${button.dataset.cancelPayment}/cancel`, {}); toast(u('invoiceCancelled')); await loadPayments(); }));
  document.querySelectorAll('[data-refund-payment]').forEach((button) => button.addEventListener('click', async () => { const amount = Number(window.prompt(`${u('refundPrompt')} (max ${button.dataset.paymentAmount})`)); if (!Number.isFinite(amount) || amount <= 0) return; await post(`/api/dashboard/payments/${button.dataset.refundPayment}/refunds`, { amount }, 'POST', { 'Idempotency-Key': crypto.randomUUID() }); toast(u('refundProcessed')); await Promise.all([loadPayments(), loadOverview()]); }));
}

const paymentFilterParams = () => {
  const params = new URLSearchParams();
  if ($('paymentStatus').value) params.set('status', $('paymentStatus').value);
  if ($('paymentSearch').value.trim()) params.set('search', $('paymentSearch').value.trim());
  if ($('paymentDateFrom').value) params.set('dateFrom', $('paymentDateFrom').value);
  if ($('paymentDateTo').value) params.set('dateTo', $('paymentDateTo').value);
  params.set('dateField', $('paymentDateField').value);
  return params;
};

const closePaymentDetail = () => {
  $('paymentDetailBackdrop').hidden = true;
  document.body.classList.remove('modal-open');
  selectedPayment = undefined;
};

async function openPaymentDetail(id) {
  const { data } = await api(`/api/dashboard/payments/${id}`);
  selectedPayment = data;
  $('paymentDetailTitle').textContent = data.externalOrderId || data.id.slice(0, 8);
  $('paymentDetailContent').innerHTML = [
    [u('amountLabel'), money(data.amount)], [u('statusLabel'), badge(data.status)],
    [u('methodLabel'), safe(data.method)], [u('customerLabel'), safe(data.customerPhone || '—')],
    [u('descriptionLabel'), safe(data.description || '—')], [u('createdLabel'), dateTime(data.createdAt)],
    [u('paidLabel'), data.paidAt ? dateTime(data.paidAt) : '—'], [u('providerIdLabel'), safe(data.providerStatus || '—')],
  ].map(([label, value]) => `<div><small>${label}</small><strong>${value}</strong></div>`).join('');
  $('paymentDetailNote').value = data.internalComment || '';
  $('paymentDetailActions').innerHTML = `${data.receiptUrl ? `<a class="button-link" href="${safe(data.receiptUrl)}" target="_blank" rel="noopener">${u('receipt')}</a>` : ''}<button type="button" data-repeat-payment>${u('repeatInvoice')}</button>${data.qrOriginalToken && ['created', 'requires_customer_action', 'pending'].includes(data.status) ? `<a class="button-link primary" href="${safe(data.qrOriginalToken)}" target="_blank" rel="noopener">${u('payLink')}</a>` : ''}`;
  $('paymentDetailActions').querySelector('[data-repeat-payment]')?.addEventListener('click', () => {
    $('paymentMethod').value = data.method;
    $('paymentAmount').value = data.amount;
    $('paymentPhone').value = data.customerPhone || '';
    $('paymentDescription').value = data.description || '';
    $('paymentInternalComment').value = data.internalComment || '';
    closePaymentDetail();
    const target = document.querySelector('nav button[data-page="payments"][data-mode="create"]');
    showPage('payments', 'create', target);
  });
  $('paymentDetailBackdrop').hidden = false;
  document.body.classList.add('modal-open');
}

$('refreshPayments').addEventListener('click', loadPayments);
$('paymentFilters').addEventListener('submit', async (event) => { event.preventDefault(); paymentsPage = 1; await loadPayments(); });
$('resetPaymentFilters').addEventListener('click', async () => { $('paymentFilters').reset(); paymentsPage = 1; await loadPayments(); });
$('paymentsPrevious').addEventListener('click', async () => { paymentsPage = Math.max(paymentsPage - 1, 1); await loadPayments(); });
$('paymentsNext').addEventListener('click', async () => { paymentsPage += 1; await loadPayments(); });
$('closePaymentDetail').addEventListener('click', closePaymentDetail);
$('paymentDetailBackdrop').addEventListener('click', (event) => { if (event.target === $('paymentDetailBackdrop')) closePaymentDetail(); });
$('paymentNoteForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedPayment) return;
  const { data } = await post(`/api/dashboard/payments/${selectedPayment.id}`, { internalComment: $('paymentDetailNote').value || null }, 'PATCH');
  selectedPayment = data;
  toast(u('noteSaved'));
  await loadPayments();
});
$('paymentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { const body = { method: $('paymentMethod').value, amount: Number($('paymentAmount').value), currency: 'KZT', externalOrderId: $('paymentOrder').value || undefined, customerPhone: $('paymentPhone').value || undefined, description: $('paymentDescription').value || undefined, internalComment: $('paymentInternalComment').value || undefined }; const result = await post('/api/dashboard/payments', body, 'POST', { 'Idempotency-Key': crypto.randomUUID() }); $('createdPayment').innerHTML = result.data.qrOriginalToken ? `<img class="payment-qr" src="${safe(result.data.qrCodeDataUrl)}" alt="Payment QR code" /><strong>${u('paymentReady')}</strong><a href="${safe(result.data.qrOriginalToken)}" target="_blank" rel="noopener">${u('openPaymentLink')}</a>` : `${u('paymentCreated')}: ${safe(result.data.id)}`; $('createdPayment').hidden = false; event.target.reset(); } catch (error) { toast(error.message); }
});

const setRecurringDayVisibility = () => {
  const needsDay = ['monthly', 'quarterly', 'yearly'].includes($('recurringPeriod').value);
  $('recurringDayField').hidden = !needsDay;
  $('recurringDay').required = needsDay;
};

async function loadRecurring() {
  const params = new URLSearchParams();
  if ($('recurringSearch').value.trim()) params.set('search', $('recurringSearch').value.trim());
  if ($('recurringStatus').value) params.set('status', $('recurringStatus').value);
  const { data } = await api(`/api/dashboard/subscriptions?${params}`);
  $('recurringBody').innerHTML = data.length ? data.map((item) => `<tr><td><strong>${safe(item.customerName || item.customerPhone)}</strong><small>${safe(item.customerPhone)}</small></td><td>${money(item.amount)}</td><td>${safe(item.billingPeriod)}</td><td>${badge(item.status)}</td><td>${item.nextPaymentAt ? dateTime(item.nextPaymentAt) : '—'}</td><td>${item.successfulCycles}${item.totalCycles ? ` / ${item.totalCycles}` : ''}</td><td><div class="row-actions"><button data-recurring-details="${item.id}">${u('details')}</button>${item.status === 'active' ? `<button data-recurring-action="pause" data-recurring-id="${item.id}">${u('pause')}</button>` : ''}${item.status === 'paused' ? `<button data-recurring-action="resume" data-recurring-id="${item.id}">${u('resume')}</button>` : ''}${['active', 'paused'].includes(item.status) ? `<button data-recurring-action="cancel" data-recurring-id="${item.id}">${u('cancel')}</button>` : ''}</div></td></tr>`).join('') : `<tr><td colspan="7" class="empty">${u('noSubscriptions')}</td></tr>`;
  document.querySelectorAll('[data-recurring-details]').forEach((button) => button.addEventListener('click', () => openRecurringDetail(button.dataset.recurringDetails)));
  document.querySelectorAll('[data-recurring-action]').forEach((button) => button.addEventListener('click', async () => {
    if (button.dataset.recurringAction === 'cancel' && !window.confirm(u('cancelSubscriptionConfirm'))) return;
    await post(`/api/dashboard/subscriptions/${button.dataset.recurringId}/${button.dataset.recurringAction}`, {});
    toast(u('subscriptionUpdated'));
    await loadRecurring();
  }));
}

async function openRecurringDetail(id) {
  const { data } = await api(`/api/dashboard/subscriptions/${id}`);
  $('recurringDetailTitle').textContent = data.customerName || data.customerPhone;
  $('recurringDetailSummary').innerHTML = [
    [u('amountLabel'), money(data.amount)], [u('statusLabel'), badge(data.status)],
    [u('periodLabel'), safe(data.billingPeriod)], [u('nextInvoiceLabel'), data.nextPaymentAt ? dateTime(data.nextPaymentAt) : '—'],
    [u('generatedLabel'), String(data.generatedCycles)], [u('successfulLabel'), String(data.successfulCycles)],
  ].map(([label, value]) => `<div><small>${label}</small><strong>${value}</strong></div>`).join('');
  $('recurringRuns').innerHTML = data.runs.length ? data.runs.map((run) => `<div class="list-row"><div><strong>${dateTime(run.scheduled_for)}</strong><small>${run.failure_reason ? safe(run.failure_reason) : safe(run.payment_id || '')}</small></div>${badge(run.payment_status || run.status)}</div>`).join('') : `<p class="empty">${u('noInvoicesGenerated')}</p>`;
  $('recurringDetail').hidden = false;
  $('recurringDetail').scrollIntoView({ behavior: 'smooth' });
}

$('toggleRecurringForm').addEventListener('click', () => {
  $('recurringForm').hidden = !$('recurringForm').hidden;
  if (!$('recurringForm').hidden && !$('recurringFirstAt').value) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    tomorrow.setHours(9, 0, 0, 0);
    const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60_000);
    $('recurringFirstAt').value = local.toISOString().slice(0, 16);
  }
});
$('recurringPeriod').addEventListener('change', setRecurringDayVisibility);
$('recurringFilters').addEventListener('submit', async (event) => { event.preventDefault(); await loadRecurring(); });
$('closeRecurringDetail').addEventListener('click', () => { $('recurringDetail').hidden = true; });
$('recurringForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const needsDay = ['monthly', 'quarterly', 'yearly'].includes($('recurringPeriod').value);
  await post('/api/dashboard/subscriptions', {
    customerName: $('recurringName').value || undefined,
    customerPhone: $('recurringPhone').value,
    amount: Number($('recurringAmount').value),
    billingPeriod: $('recurringPeriod').value,
    billingDay: needsDay ? Number($('recurringDay').value) : undefined,
    billingTime: $('recurringTime').value,
    firstPaymentAt: new Date($('recurringFirstAt').value).toISOString(),
    totalCycles: $('recurringCycles').value ? Number($('recurringCycles').value) : null,
    maxRetryAttempts: Number($('recurringRetries').value),
    retryIntervalHours: Number($('recurringRetryHours').value),
    gracePeriodDays: Number($('recurringGrace').value),
    description: $('recurringDescription').value || undefined,
  });
  event.target.reset();
  $('recurringTime').value = '09:00';
  $('recurringRetries').value = '3';
  $('recurringRetryHours').value = '24';
  $('recurringGrace').value = '3';
  setRecurringDayVisibility();
  $('recurringForm').hidden = true;
  toast(u('subscriptionCreated'));
  await loadRecurring();
});

async function loadRefunds() {
  const params = new URLSearchParams();
  if ($('refundDateFrom').value) params.set('dateFrom', $('refundDateFrom').value);
  if ($('refundDateTo').value) params.set('dateTo', $('refundDateTo').value);
  if ($('refundStatus').value) params.set('status', $('refundStatus').value);
  const { data, summary } = await api(`/api/dashboard/data/refunds?${params}`);
  $('refundCount').textContent = summary.count;
  $('refundTotal').textContent = money(Number(summary.total_minor) / 100);
  $('refundAverage').textContent = money(Number(summary.average_minor) / 100);
  $('refundsBody').innerHTML = data.length ? data.map((refund) => {
    const reason = refund.provider_response?.error || refund.provider_response?.message || '—';
    return `<tr><td>${dateTime(refund.created_at)}</td><td>${safe(refund.external_order_id || refund.payment_id.slice(0, 8))}</td><td>${safe(refund.customer_phone || '—')}</td><td>${money(Number(refund.amount_minor) / 100)}</td><td>${badge(refund.status)}</td><td>${safe(reason)}</td></tr>`;
  }).join('') : `<tr><td colspan="6" class="empty">${u('noRefunds')}</td></tr>`;
}
$('refreshRefunds').addEventListener('click', loadRefunds);
$('refundFilters').addEventListener('submit', (event) => { event.preventDefault(); loadRefunds().catch((error) => toast(error.message)); });

const showPrintableQr = (item) => {
  $('printQrImage').src = item.qrCodeDataUrl;
  $('printQrPrice').textContent = money(item.amount);
  $('printQrCaption').textContent = item.description || u('printCaption');
  $('printQrShortCode').textContent = `${u('shortCode')}: ${item.shortCode}`;
  $('printQrPublicLink').href = item.printUrl || new URL(item.printPath, location.origin);
  $('printQrEmpty').hidden = true;
  $('printQrResult').hidden = false;
};

async function loadPrintableQr() {
  const { data } = await api('/api/dashboard/printable-qr');
  $('printableQrList').innerHTML = data.length ? data.map((item) => `<div class="list-row"><div><strong>${safe(item.description || item.shortCode)}</strong><small>${money(item.amount)} · ${safe(item.shortCode)} · ${item.scanCount} ${u('scans')}</small></div><div class="row-actions">${badge(item.status)}<button data-show-printable="${item.id}">${u('preview')}</button>${item.status === 'active' ? `<a class="button-link" href="${safe(item.printUrl)}" target="_blank" rel="noopener">${u('openPaymentPage')}</a><button data-disable-printable="${item.id}">${u('disable')}</button>` : item.status === 'disabled' ? `<button data-enable-printable="${item.id}">${u('enable')}</button>` : ''}</div></div>`).join('') : `<p class="empty">${u('noPrintableRequests')}</p>`;
  document.querySelectorAll('[data-show-printable]').forEach((button) => button.addEventListener('click', () => showPrintableQr(data.find((item) => item.id === button.dataset.showPrintable))));
  document.querySelectorAll('[data-disable-printable]').forEach((button) => button.addEventListener('click', async () => { await api(`/api/dashboard/printable-qr/${button.dataset.disablePrintable}`, { method: 'DELETE' }); toast(u('printableDisabled')); await loadPrintableQr(); }));
  document.querySelectorAll('[data-enable-printable]').forEach((button) => button.addEventListener('click', async () => { await post(`/api/dashboard/printable-qr/${button.dataset.enablePrintable}/enable`, {}); toast(u('printableEnabled')); await loadPrintableQr(); }));
}

$('printQrForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.submitter; const original = button.textContent; button.disabled = true; button.textContent = u('generating');
  try { const result = await post('/api/dashboard/printable-qr', { amount: Number($('printQrAmount').value), description: $('printQrDescription').value || undefined, externalOrderId: $('printQrOrder').value || undefined, singleUse: $('printQrSingleUse').checked }); showPrintableQr(result.data); event.target.reset(); toast(u('printableCreated')); await loadPrintableQr(); } catch (error) { toast(error.message); } finally { button.disabled = false; button.textContent = original; }
});
$('refreshPrintableQr').addEventListener('click', loadPrintableQr);
$('printQrButton').addEventListener('click', () => window.print());

const kaspiSteps = ['kaspiIntro', 'kaspiChecks', 'kaspiPhoneStep', 'kaspiWarningStep', 'kaspiOtpStep'];
const updateKaspiProgress = () => {
  $('kaspiProgressBar').style.width = `${kaspiStep * 25}%`;
  $('kaspiStepLabel').textContent = kaspiStep ? `${u('step')} ${kaspiStep} ${u('of')} 4` : '';
  $('kaspiBack').hidden = kaspiStep === 0 || kaspiStep === 4;
  if (kaspiStep === 1) { const checked = document.querySelectorAll('[data-kaspi-check]:checked').length; $('kaspiCheckCount').textContent = `${checked} ${u('of')} 3 ${u('checked')}`; }
};
const setKaspiStep = (step) => { kaspiStep = Math.max(0, Math.min(step, 4)); kaspiSteps.forEach((id, index) => { $(id).hidden = index !== kaspiStep; }); updateKaspiProgress(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
$('kaspiStart').addEventListener('click', () => setKaspiStep(1));
$('kaspiBack').addEventListener('click', () => setKaspiStep(kaspiStep - 1));
document.querySelectorAll('[data-kaspi-check]').forEach((checkbox) => checkbox.addEventListener('change', () => { const checked = document.querySelectorAll('[data-kaspi-check]:checked').length; $('kaspiChecksNext').disabled = checked !== 3; updateKaspiProgress(); }));
$('kaspiChecksNext').addEventListener('click', () => setKaspiStep(2));
const normalizedKaspiPhone = () => { const digits = $('kaspiPhone').value.replace(/\D/g, ''); return digits.length === 10 ? `7${digits}` : digits; };
const validateKaspiRole = () => {
  const role = document.querySelector('input[name="kaspiRole"]:checked')?.value;
  const validPhone = /^7\d{10}$/.test(normalizedKaspiPhone());
  const validRole = role === 'cashier';
  $('kaspiRoleError').hidden = !role || validRole;
  $('kaspiRoleCard').classList.toggle('invalid', Boolean(role && !validRole));
  $('kaspiPhoneNext').disabled = !(validPhone && validRole);
};
$('kaspiPhone').addEventListener('input', validateKaspiRole);
document.querySelectorAll('input[name="kaspiRole"]').forEach((radio) => radio.addEventListener('change', validateKaspiRole));
$('kaspiPhoneNext').addEventListener('click', () => setKaspiStep(3));
$('kaspiFinalConfirm').addEventListener('change', () => { $('kaspiSendSms').disabled = !$('kaspiFinalConfirm').checked; });
$('kaspiSendSms').addEventListener('click', async () => {
  const button = $('kaspiSendSms'); button.disabled = true; button.textContent = u('sendingSms');
  try { const initialized = await post('/api/dashboard/kaspi/connection/auth/init', {}); kaspiProcessId = initialized.data.processId; await post('/api/dashboard/kaspi/connection/auth/send-phone', { processId: kaspiProcessId, phoneNumber: normalizedKaspiPhone() }); setKaspiStep(4); $('kaspiOtp').focus(); toast(u('smsSent')); } catch (error) { toast(error.message); button.disabled = false; button.textContent = t('sendSms', 'Send the SMS'); }
});
$('kaspiOtpForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { await post('/api/dashboard/kaspi/connection/auth/verify-otp', { processId: kaspiProcessId, otp: $('kaspiOtp').value }); kaspiProcessId = undefined; event.target.reset(); setKaspiStep(0); toast(u('kaspiConnected')); await Promise.all([loadKaspi(), loadOverview()]); } catch (error) { toast(error.message); }
});
async function loadKaspi() {
  const { data } = await api('/api/dashboard/kaspi/connection');
  $('kaspiStatus').innerHTML = data ? `<div class="status-line"><span><strong>${safe(data.organization_name || 'Kaspi Pay')}</strong><small>${safe(data.cashier_phone_masked || '')}</small></span>${badge(data.state, statusLabel(data.state))}</div>` : `<p class="empty">${u('notConnected')}</p>`;
  const canManage = ['owner', 'admin'].includes(profile.role);
  $('disconnectKaspi').hidden = !data || !canManage;
  $('kaspiWizard').hidden = data?.state === 'active' || !canManage;
  if (!data || data.state !== 'active') setKaspiStep(kaspiStep);
}
$('organizationForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if ($('organizationMode').value === 'live' && !window.confirm(u('enableLiveConfirm'))) return;
  const { data } = await post('/api/dashboard/data/organization', {
    name: $('organizationName').value,
    workMode: $('organizationMode').value,
    mediaConsent: $('organizationConsent').checked,
  }, 'PATCH');
  profile.tenantName = data.name;
  $('tenantLabel').textContent = data.name;
  toast(u('organizationSaved'));
  await loadOverview();
});

async function loadOrganization() {
  const { data } = await api('/api/dashboard/data/organization');
  $('organizationName').value = data.name;
  $('organizationMode').value = data.work_mode;
  $('organizationConsent').checked = data.media_consent;
  $('organizationProviderInfo').innerHTML = data.kaspi_name
    ? `<strong>${safe(data.kaspi_name)}</strong><p>${u('kaspiOrganizationId')}: ${safe(data.kaspi_id || '—')} · ${u('lastRefreshed')}: ${data.last_verified_at ? dateTime(data.last_verified_at) : '—'}</p>`
    : `<p>${u('kaspiOrganizationNotConnected')}</p>`;
}

const loadSettings = async () => Promise.all([loadOrganization(), loadKaspi()]);
$('disconnectKaspi').addEventListener('click', async () => { if (!window.confirm(u('disconnectConfirm'))) return; await api('/api/dashboard/kaspi/connection', { method: 'DELETE' }); setKaspiStep(0); toast(u('kaspiDisconnected')); await loadKaspi(); });

async function loadDevelopers() {
  const [keys, hooks] = await Promise.all([api('/api/dashboard/api-keys'), api('/api/dashboard/webhooks')]);
  const selectedKey = $('deliveryKey').value;
  $('deliveryKey').innerHTML = `<option value="">${u('allApiKeys')}</option>${keys.data.map((key) => `<option value="${key.id}">${safe(key.name)}</option>`).join('')}`;
  $('deliveryKey').value = selectedKey;
  const deliveryParams = new URLSearchParams();
  if ($('deliveryDateFrom').value) deliveryParams.set('dateFrom', $('deliveryDateFrom').value);
  if ($('deliveryDateTo').value) deliveryParams.set('dateTo', $('deliveryDateTo').value);
  if ($('deliveryKey').value) deliveryParams.set('apiKeyId', $('deliveryKey').value);
  if ($('deliveryStatus').value) deliveryParams.set('status', $('deliveryStatus').value);
  const deliveries = await api(`/api/dashboard/webhooks/deliveries/list?${deliveryParams}`);
  $('apiKeysList').innerHTML = keys.data.length ? keys.data.map((key) => `<article class="integration-card ${key.enabled && !key.revoked_at ? '' : 'disabled'}"><div class="integration-card-head"><div><strong>${safe(key.name)}</strong><div class="integration-badges">${badge(key.environment)}${key.is_default ? badge('active', u('defaultKey')) : ''}${key.revoked_at ? badge('revoked') : badge(key.enabled ? 'active' : 'disabled', statusLabel(key.enabled ? 'active' : 'disabled'))}</div></div><div class="row-actions"><button data-edit-key="${key.id}">${u('edit')}</button><button data-toggle-key="${key.id}" data-enabled="${key.enabled}" ${key.revoked_at ? 'disabled' : ''}>${key.enabled ? u('disable') : u('enable')}</button><button data-revoke-key="${key.id}" ${key.revoked_at ? 'disabled' : ''}>${u('delete')}</button></div></div><div class="integration-meta"><span><small>${u('apiKeySingular')}</small><code>${safe(key.key_prefix)}••••••••</code></span><span><small>${u('invoiceCount')}</small><strong>${key.invoice_count}</strong></span><span><small>${u('lastUsed')}</small><strong>${key.last_used_at ? dateTime(key.last_used_at) : '—'}</strong></span></div><div class="webhook-row"><div><small>Webhook</small><strong>${safe(key.webhook_url || u('notConfigured'))}</strong></div><div class="row-actions">${key.webhook_id ? `<button data-test-hook="${key.webhook_id}" ${key.webhook_enabled ? '' : 'disabled'}>${u('test')}</button><button data-rotate-hook="${key.webhook_id}">${u('rotateSecret')}</button>` : ''}<button data-rotate-key="${key.id}" ${key.revoked_at ? 'disabled' : ''}>${u('rotateKey')}</button>${!key.is_default && key.enabled && !key.revoked_at ? `<button data-default-key="${key.id}">${u('makeDefault')}</button>` : ''}</div></div></article>`).join('') : `<p class="empty">${language === 'ru' ? 'API-интеграций пока нет.' : language === 'kk' ? 'API интеграциялары әлі жоқ.' : 'No API integrations yet.'}</p>`;
  const unlinked = hooks.data.filter((hook) => !hook.api_key_id);
  $('unlinkedWebhooks').hidden = unlinked.length === 0;
  $('webhooksList').innerHTML = unlinked.map((hook) => `<div class="list-row"><div><strong>${safe(hook.description || hook.url)}</strong><small>${safe(hook.url)}</small></div><div class="row-actions">${badge(hook.enabled ? 'active' : 'disabled', statusLabel(hook.enabled ? 'active' : 'disabled'))}<button data-test-hook="${hook.id}" ${hook.enabled ? '' : 'disabled'}>${u('test')}</button><button data-rotate-hook="${hook.id}">${u('rotateSecret')}</button><button data-delete-hook="${hook.id}">${u('delete')}</button></div></div>`).join('');
  $('deliveriesList').innerHTML = deliveries.data.length ? deliveries.data.map((delivery) => `<div class="list-row"><div><strong>${safe(delivery.type)}</strong><small>${safe(delivery.api_key_name || u('standaloneWebhook'))} · ${safe(delivery.url)}</small><small>${dateTime(delivery.created_at)} · ${safe(delivery.response_status || delivery.last_error || u('queued'))}${delivery.response_duration_ms ? ` · ${delivery.response_duration_ms} ms` : ''}</small></div><div class="row-actions">${badge(delivery.status)}${['failed', 'dead'].includes(delivery.status) ? `<button data-replay-delivery="${delivery.id}">${u('replay')}</button>` : ''}</div></div>`).join('') : `<p class="empty">${u('noDeliveries')}</p>`;
  document.querySelectorAll('[data-edit-key]').forEach((button) => button.addEventListener('click', async () => { const key = keys.data.find((item) => item.id === button.dataset.editKey); const name = window.prompt(u('integrationNamePrompt'), key.name); if (name === null || !name.trim()) return; const webhookUrl = window.prompt(u('webhookUrlPrompt'), key.webhook_url || ''); if (webhookUrl === null) return; await post(`/api/dashboard/api-keys/${key.id}`, { name: name.trim(), webhookUrl: webhookUrl.trim() || null }, 'PATCH'); toast(u('integrationUpdated')); await loadDevelopers(); }));
  document.querySelectorAll('[data-toggle-key]').forEach((button) => button.addEventListener('click', async () => { await post(`/api/dashboard/api-keys/${button.dataset.toggleKey}`, { enabled: button.dataset.enabled !== 'true' }, 'PATCH'); await loadDevelopers(); }));
  document.querySelectorAll('[data-default-key]').forEach((button) => button.addEventListener('click', async () => { await post(`/api/dashboard/api-keys/${button.dataset.defaultKey}`, { isDefault: true }, 'PATCH'); toast(u('defaultUpdated')); await loadDevelopers(); }));
  document.querySelectorAll('[data-rotate-key]').forEach((button) => button.addEventListener('click', async () => { if (!window.confirm(u('rotateKeyConfirm'))) return; const { data } = await post(`/api/dashboard/api-keys/${button.dataset.rotateKey}/rotate`, {}); $('newWebhookSecret').textContent = `${u('copyNewKey')}: ${data.apiKey}`; $('newWebhookSecret').hidden = false; toast(u('keyRotated')); await loadDevelopers(); }));
  document.querySelectorAll('[data-revoke-key]').forEach((button) => button.addEventListener('click', async () => { if (!window.confirm(u('deleteIntegrationConfirm'))) return; await api(`/api/dashboard/api-keys/${button.dataset.revokeKey}`, { method: 'DELETE' }); toast(u('keyRevoked')); await loadDevelopers(); }));
  document.querySelectorAll('[data-test-hook]').forEach((button) => button.addEventListener('click', async () => { await post(`/api/dashboard/webhooks/${button.dataset.testHook}/test`, {}); toast(u('testQueued')); setTimeout(loadDevelopers, 1000); }));
  document.querySelectorAll('[data-rotate-hook]').forEach((button) => button.addEventListener('click', async () => { const { data } = await post(`/api/dashboard/webhooks/${button.dataset.rotateHook}/rotate-secret`, {}); $('newWebhookSecret').textContent = `${u('copyNow')}: ${data.secret}`; $('newWebhookSecret').hidden = false; toast(u('secretRotated')); }));
  document.querySelectorAll('[data-delete-hook]').forEach((button) => button.addEventListener('click', async () => { await api(`/api/dashboard/webhooks/${button.dataset.deleteHook}`, { method: 'DELETE' }); toast(u('endpointDeleted')); await loadDevelopers(); }));
  document.querySelectorAll('[data-replay-delivery]').forEach((button) => button.addEventListener('click', async () => { await post(`/api/dashboard/webhooks/deliveries/${button.dataset.replayDelivery}/replay`, {}); toast(u('deliveryQueued')); setTimeout(loadDevelopers, 1000); }));
}
$('deliveryFilters').addEventListener('submit', (event) => { event.preventDefault(); loadDevelopers().catch((error) => toast(error.message)); });

const refreshIntegrationLanguage = () => {
  if (!$('webhookHelperPrompt')) return;
  $('webhookHelperPrompt').textContent = u('webhookHelperPrompt');
  const url = $('integrationWebhookUrl').value.trim();
  $('integrationProtectionSummary').textContent = url ? `${u('webhookProtectionAt')} ${url}` : '';
};
const setIntegrationStep = (step) => {
  integrationStep = Math.max(1, Math.min(step, 4));
  document.querySelectorAll('[data-integration-step]').forEach((section) => { section.hidden = Number(section.dataset.integrationStep) !== integrationStep; });
  document.querySelectorAll('[data-integration-marker]').forEach((marker) => {
    const markerStep = Number(marker.dataset.integrationMarker);
    marker.classList.toggle('active', markerStep === integrationStep);
    marker.classList.toggle('complete', markerStep < integrationStep);
    marker.querySelector('b').textContent = markerStep < integrationStep ? '✓' : markerStep;
  });
  const webhookConfigured = Boolean($('integrationWebhookUrl').value.trim());
  $('integrationProtectionReady').hidden = !webhookConfigured;
  $('integrationProtectionSkipped').hidden = webhookConfigured;
  refreshIntegrationLanguage();
};
const closeIntegrationWizard = () => {
  $('integrationWizardBackdrop').hidden = true;
  document.body.classList.remove('modal-open');
  if (integrationStep === 4) {
    $('createdApiKey').textContent = '';
    $('createdWebhookSecret').textContent = '';
  }
};
const openIntegrationWizard = () => {
  $('integrationNameForm').reset();
  $('integrationWebhookForm').reset();
  $('integrationEnvironment').value = organizationWorkMode;
  $('scopeRead').checked = true;
  $('scopeWrite').checked = true;
  $('integrationCreateError').hidden = true;
  $('createdApiKey').textContent = '';
  $('createdWebhookSecret').textContent = '';
  $('integrationWizardBackdrop').hidden = false;
  document.body.classList.add('modal-open');
  setIntegrationStep(1);
  $('integrationKeyName').focus();
};
$('openIntegrationWizard').addEventListener('click', openIntegrationWizard);
document.querySelectorAll('[data-close-integration]').forEach((button) => button.addEventListener('click', closeIntegrationWizard));
$('integrationWizardBackdrop').addEventListener('click', (event) => { if (event.target === $('integrationWizardBackdrop')) closeIntegrationWizard(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('integrationWizardBackdrop').hidden) closeIntegrationWizard(); });
$('integrationNameForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!$('scopeRead').checked && !$('scopeWrite').checked) { toast(language === 'ru' ? 'Выберите хотя бы одно разрешение.' : language === 'kk' ? 'Кемінде бір рұқсатты таңдаңыз.' : 'Select at least one permission.'); return; }
  setIntegrationStep(2);
  $('integrationWebhookUrl').focus();
});
$('integrationWebhookForm').addEventListener('submit', (event) => { event.preventDefault(); setIntegrationStep(3); });
$('skipWebhook').addEventListener('click', () => { $('integrationWebhookUrl').value = ''; setIntegrationStep(3); });
$('backToIntegrationName').addEventListener('click', () => setIntegrationStep(1));
$('backToIntegrationWebhook').addEventListener('click', () => setIntegrationStep(2));
$('copyWebhookPrompt').addEventListener('click', async () => { await navigator.clipboard.writeText(u('webhookHelperPrompt')); toast(u('copied')); });
document.querySelectorAll('[data-copy-secret]').forEach((button) => button.addEventListener('click', async () => { await navigator.clipboard.writeText($(button.dataset.copySecret).textContent); toast(u('copied')); }));
$('createIntegration').addEventListener('click', async () => {
  const button = $('createIntegration');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = u('creatingIntegration');
  $('integrationCreateError').hidden = true;
  try {
    const name = $('integrationKeyName').value.trim();
    const webhookUrl = $('integrationWebhookUrl').value.trim();
    const scopes = [...($('scopeRead').checked ? ['payments:read'] : []), ...($('scopeWrite').checked ? ['payments:write'] : [])];
    const key = await post('/api/dashboard/api-keys', { name, environment: $('integrationEnvironment').value, scopes, webhookUrl: webhookUrl || undefined });
    $('createdApiKey').textContent = key.data.apiKey;
    $('createdWebhookSecretRow').hidden = !key.data.webhookSecret;
    $('createdWebhookSecret').textContent = key.data.webhookSecret || '';
    setIntegrationStep(4);
    loadDevelopers().catch((error) => toast(error.message));
    toast(key.data.webhookSecret ? u('integrationCreatedToast') : u('apiKeyCreated'));
  } catch (error) {
    $('integrationCreateError').textContent = error.message;
    $('integrationCreateError').hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});
$('finishIntegration').addEventListener('click', closeIntegrationWizard);

async function loadTeam() {
  const [{ data }, mfa, access] = await Promise.all([api('/api/dashboard/team'), api('/api/dashboard/auth/mfa'), api('/api/dashboard/access')]);
  $('teamList').innerHTML = data.map((member) => `<div class="list-row"><div><strong>${safe(member.display_name)}</strong><small>${safe(member.email)}</small></div><div class="row-actions">${profile.role === 'owner' && member.role !== 'owner' ? `<select data-member-role="${member.user_id}">${['admin', 'developer', 'operator', 'viewer'].map((role) => `<option ${role === member.role ? 'selected' : ''}>${role}</option>`).join('')}</select>` : badge(member.role, roleLabel(member.role))}${['owner', 'admin'].includes(profile.role) && member.role !== 'owner' && member.user_id !== profile.userId ? `<button data-remove-member="${member.user_id}">${u('delete')}</button>` : ''}</div></div>`).join('');
  $('mfaStatus').innerHTML = `<div class="status-line"><span>${u('authenticator')}</span>${badge(mfa.data.enabled ? 'active' : 'disabled', statusLabel(mfa.data.enabled ? 'active' : 'disabled'))}</div>`;
  $('emailVerificationStatus').innerHTML = `<div class="status-line"><span>${u('emailAddress')}</span>${badge(mfa.data.emailVerified ? 'verified' : 'unverified', statusLabel(mfa.data.emailVerified ? 'verified' : 'unverified'))}</div>`;
  $('sendVerification').hidden = mfa.data.emailVerified; $('setupMfa').hidden = mfa.data.enabled; $('disableMfa').hidden = !mfa.data.enabled; if (mfa.data.enabled) $('mfaSetup').hidden = true;
  document.querySelectorAll('[data-member-role]').forEach((select) => select.addEventListener('change', async () => { await post(`/api/dashboard/team/${select.dataset.memberRole}`, { role: select.value }, 'PATCH'); toast(u('roleUpdated')); await loadTeam(); }));
  document.querySelectorAll('[data-remove-member]').forEach((button) => button.addEventListener('click', async () => { await api(`/api/dashboard/team/${button.dataset.removeMember}`, { method: 'DELETE' }); toast(u('memberRemoved')); await loadTeam(); }));
  $('accessGrantsList').innerHTML = access.data.length ? access.data.map((grant) => {
    const state = grant.revoked_at ? 'revoked' : grant.accepted_at ? 'accepted' : new Date(grant.expires_at) <= new Date() ? 'expired' : 'active';
    return `<div class="list-row"><div><strong>${safe(grant.label)}</strong><small>${safe(grant.email || u('emailOptional'))} · ${safe(roleLabel(grant.role))} · ${safe(grant.code_prefix)}••••</small><small>${grant.accepted_name ? `${safe(grant.accepted_name)} · ` : ''}${dateTime(grant.expires_at)}</small></div><div class="row-actions">${badge(state, u(state))}${!grant.revoked_at && ['owner', 'admin'].includes(profile.role) ? `<button data-revoke-access="${grant.id}">${u('revoke')}</button>` : ''}</div></div>`;
  }).join('') : `<p class="empty">${u('noAccessGrants')}</p>`;
  document.querySelectorAll('[data-revoke-access]').forEach((button) => button.addEventListener('click', async () => { await api(`/api/dashboard/access/${button.dataset.revokeAccess}`, { method: 'DELETE' }); toast(u('accessRevoked')); await loadTeam(); }));
  configurePageMode('team', currentMode);
}
$('sendVerification').addEventListener('click', async () => { const result = await post('/api/dashboard/auth/verification/send', {}); if (result.developmentVerificationUrl) { $('verificationLink').textContent = result.developmentVerificationUrl; $('verificationLink').hidden = false; } toast(result.emailSent ? u('verificationSent') : u('emailNotConfigured')); });
$('inviteForm').addEventListener('submit', async (event) => { event.preventDefault(); const { data } = await post('/api/dashboard/team/invitations', { email: $('inviteEmail').value, role: $('inviteRole').value }); $('inviteToken').textContent = `${data.emailSent ? u('invitationEmailed') : u('invitationLink')}: ${data.invitationUrl}`; $('inviteToken').hidden = false; event.target.reset(); toast(u('invitationCreated')); });
$('accessGrantForm').addEventListener('submit', async (event) => { event.preventDefault(); const { data } = await post('/api/dashboard/access', { label: $('accessGrantLabel').value, email: $('accessGrantEmail').value, role: $('accessGrantRole').value, expiresInDays: Number($('accessGrantExpiry').value) }); $('newAccessCode').textContent = `${u('accessCodeCreated')}: ${data.code}`; $('newAccessCode').hidden = false; event.target.reset(); toast(u('accessCodeCreated')); await loadTeam(); });
$('acceptAccessForm').addEventListener('submit', async (event) => { event.preventDefault(); const { data } = await post('/api/dashboard/access/accept', { code: $('acceptAccessCode').value }); event.target.reset(); toast(`${u('businessConnected')}: ${data.tenant_name}`); await loadTenantChoices(); });
$('setupMfa').addEventListener('click', async () => { const { data } = await post('/api/dashboard/auth/mfa/setup', {}); $('mfaQr').src = data.qrCode; $('mfaSecret').textContent = data.secret; $('mfaSetup').hidden = false; });
$('mfaEnableForm').addEventListener('submit', async (event) => { event.preventDefault(); await post('/api/dashboard/auth/mfa/enable', { code: $('mfaEnableCode').value }); event.target.reset(); toast(u('authenticatorEnabled')); await loadTeam(); });
$('disableMfa').addEventListener('click', async () => { const code = window.prompt(language === 'ru' ? 'Введите текущий шестизначный код.' : language === 'kk' ? 'Ағымдағы алты таңбалы кодты енгізіңіз.' : 'Enter the current six-digit code.'); if (!code) return; await api('/api/dashboard/auth/mfa', { method: 'DELETE', body: JSON.stringify({ code }) }); toast(u('authenticatorDisabled')); await loadTeam(); });

const localized = (value) => value?.[language] || value?.en || '';
const limitLabel = (used, limit) => `${used} / ${limit === null || limit === undefined ? u('unlimited') : limit}`;

async function loadBilling() {
  const { data } = await api('/api/dashboard/billing');
  const current = data.subscription;
  $('currentPlanName').textContent = localized(current.name);
  $('currentPlanDescription').textContent = localized(current.description);
  $('currentPlanPrice').textContent = money(Number(current.price_minor) / 100);
  $('usagePayments').textContent = limitLabel(data.usage.payments, current.limits.paymentsPerMonth);
  $('usageTeam').textContent = limitLabel(data.usage.team_members, current.limits.teamMembers);
  $('usageApiKeys').textContent = limitLabel(data.usage.api_keys, current.limits.apiKeys);
  const pendingCodes = new Set(data.requests.filter((request) => request.status === 'pending').map((request) => request.requested_plan_code));
  const canManage = ['owner', 'admin'].includes(profile.role);
  $('planOptions').innerHTML = data.plans.map((plan) => {
    const isCurrent = plan.code === current.plan_code;
    const isPending = pendingCodes.has(plan.code);
    const label = isCurrent ? u('current') : isPending ? u('requestPending') : u('requestPlan');
    return `<article class="plan-option ${isCurrent ? 'selected' : ''}"><div><h3>${safe(localized(plan.name))}</h3><p>${safe(localized(plan.description))}</p></div><div class="plan-option-price"><strong>${money(Number(plan.price_minor) / 100)}</strong><small>${u('perMonth')}</small></div><ul>${plan.features.map((feature) => `<li>${safe(u(feature))}</li>`).join('')}</ul><button class="${isCurrent ? '' : 'primary'}" data-request-plan="${plan.code}" ${isCurrent || isPending || !canManage ? 'disabled' : ''}>${safe(label)}</button></article>`;
  }).join('');
  $('planRequests').innerHTML = data.requests.length ? data.requests.map((request) => `<div class="list-row"><div><strong>${safe(localized(request.name))}</strong><small>${dateTime(request.created_at)}</small></div><div class="row-actions">${badge(request.status)}${request.status === 'pending' && canManage ? `<button data-cancel-plan-request="${request.id}">${u('cancelRequest')}</button>` : ''}</div></div>`).join('') : `<p class="empty">${u('noPlanRequests')}</p>`;
  $('billingHistory').innerHTML = data.transactions.length ? data.transactions.map((transaction) => `<div class="list-row"><div><strong>${money(Number(transaction.amount_minor) / 100)}</strong><small>${dateTime(transaction.created_at)}</small></div>${badge(transaction.status)}</div>`).join('') : `<p class="empty">${u('noBillingHistory')}</p>`;
  document.querySelectorAll('[data-request-plan]').forEach((button) => button.addEventListener('click', async () => { await post('/api/dashboard/billing/plan-requests', { planCode: button.dataset.requestPlan }); toast(u('planRequested')); await loadBilling(); }));
  document.querySelectorAll('[data-cancel-plan-request]').forEach((button) => button.addEventListener('click', async () => { await api(`/api/dashboard/billing/plan-requests/${button.dataset.cancelPlanRequest}`, { method: 'DELETE' }); toast(u('requestCancelled')); await loadBilling(); }));
}

async function loadPartner() {
  const { data } = await api('/api/dashboard/billing/partner');
  $('partnerRegistrations').textContent = data.summary.registrations;
  $('partnerQualified').textContent = data.summary.qualified;
  $('partnerRewards').textContent = money(Number(data.summary.rewards_minor) / 100);
  $('partnerReferralUrl').textContent = data.referralUrl;
  $('partnerReferrals').innerHTML = data.referrals.length ? data.referrals.map((referral) => `<div class="list-row"><div><strong>${safe(referral.referred_tenant_name)}</strong><small>${dateTime(referral.created_at)}</small></div><div class="row-actions">${badge(referral.status)}${referral.reward_minor ? `<strong>${money(Number(referral.reward_minor) / 100)}</strong>` : ''}</div></div>`).join('') : `<p class="empty">${u('noReferrals')}</p>`;
}
$('copyPartnerLink').addEventListener('click', async () => { await navigator.clipboard.writeText($('partnerReferralUrl').textContent); toast(u('partnerLinkCopied')); });

async function loadAudit() {
  if (!['owner', 'admin'].includes(profile.role)) return;
  const { data } = await api('/api/dashboard/data/audit');
  $('auditBody').innerHTML = data.length ? data.map((entry) => `<tr><td>${dateTime(entry.created_at)}</td><td>${safe(entry.actor)}</td><td>${safe(entry.action)}</td><td>${safe(entry.resource_type || '')} ${safe(entry.resource_id || '')}</td><td>${safe(entry.metadata?.requestId || '')}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">No audited activity yet</td></tr>';
}
$('refreshAudit').addEventListener('click', loadAudit);

const loaders = { overview: loadOverview, payments: loadPayments, recurring: loadRecurring, refunds: loadRefunds, printQr: loadPrintableQr, kaspi: loadSettings, developers: loadDevelopers, team: loadTeam, plan: loadBilling, partners: loadPartner, audit: loadAudit };

if (invitationToken) { registering = true; $('registerFields').hidden = false; $('tenantRegistrationFields').hidden = true; $('toggleAuth').hidden = true; $('forgotPassword').hidden = true; }
if (resetToken) { $('authTitle').textContent = 'Choose a new password'; $('authSubtitle').textContent = 'Use at least 12 characters.'; $('authForm').hidden = true; $('resetForm').hidden = false; $('toggleAuth').hidden = true; $('forgotPassword').hidden = true; }
if (verificationToken) { post('/api/dashboard/auth/verification/confirm', { token: verificationToken }).then(() => { window.history.replaceState({}, '', '/dashboard'); $('authSubtitle').textContent = language === 'ru' ? 'Почта подтверждена.' : language === 'kk' ? 'Электрондық пошта расталды.' : 'Email verified.'; }).catch((error) => { $('authError').textContent = error.message; $('authError').hidden = false; }); }

applyTranslations(language);
updateAuthCopy();
updateKaspiProgress();
setRecurringDayVisibility();
if (!resetToken) {
  api('/api/dashboard/auth/me').then(async ({ data }) => { if (invitationToken) { const accepted = await post('/api/dashboard/auth/accept-invitation', { token: invitationToken }); await post('/api/dashboard/auth/switch-tenant', { tenantId: accepted.data.tenant_id }); window.history.replaceState({}, '', '/dashboard'); const current = await api('/api/dashboard/auth/me'); return showApp(current.data); } return showApp(data); }).catch(showAuth);
}
