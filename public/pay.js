const copy = {
  ru: { loading:'Загружаем…', payment:'Оплата', defaultDescription:'Оплата заказа', explanation:'Нажмите кнопку — мы создадим свежий Kaspi QR. Этот напечатанный код можно использовать снова, пока продавец его не отключит.', start:'Создать QR для оплаты', code:'Код', scan:'Отсканируйте QR в Kaspi', open:'Открыть в Kaspi', refresh:'Создать новый QR', expires:'QR действует ещё', seconds:'сек.', error:'Не удалось открыть оплату', retry:'Попробовать ещё раз' },
  kk: { loading:'Жүктелуде…', payment:'Төлем', defaultDescription:'Тапсырысты төлеу', explanation:'Батырманы басыңыз — жаңа Kaspi QR жасаймыз. Бұл басып шығарылған код сатушы өшіргенше қайта қолданылады.', start:'Төлем QR-ын жасау', code:'Код', scan:'Kaspi-де QR-ды сканерлеңіз', open:'Kaspi-де ашу', refresh:'Жаңа QR жасау', expires:'QR жарамдылығы', seconds:'сек.', error:'Төлемді ашу мүмкін болмады', retry:'Қайта көру' },
  en: { loading:'Loading…', payment:'Payment', defaultDescription:'Order payment', explanation:'Press the button to create a fresh Kaspi QR. This printed code can be reused until the merchant disables it.', start:'Create payment QR', code:'Code', scan:'Scan the QR in Kaspi', open:'Open in Kaspi', refresh:'Create a new QR', expires:'QR expires in', seconds:'sec.', error:'Payment could not be opened', retry:'Try again' },
};
const $ = (id) => document.getElementById(id);
let language = localStorage.getItem('kaspi-payment-language') || 'ru';
let request;
let timer;
const reference = new URLSearchParams(location.search).get('code') || location.pathname.split('/').filter(Boolean)[1];
const text = (key) => copy[language][key];
const money = (amount) => new Intl.NumberFormat(language === 'en' ? 'en-KZ' : language === 'kk' ? 'kk-KZ' : 'ru-KZ', { style:'currency', currency:'KZT', maximumFractionDigits:2 }).format(amount);
const show = (id) => ['loading','request','payment','error'].forEach((name) => { $(name).hidden = name !== id; });
const applyLanguage = () => {
  document.documentElement.lang = language;
  $('language').value = language;
  $('explanation').textContent = text('explanation'); $('startPayment').textContent = text('start');
  $('paymentTitle').textContent = text('scan'); $('openKaspi').textContent = text('open'); $('refreshQr').textContent = text('refresh');
  $('errorTitle').textContent = text('error'); $('tryAgain').textContent = text('retry');
  if (request) { $('description').textContent = request.description || text('defaultDescription'); $('shortCode').textContent = `${text('code')}: ${request.shortCode}`; }
};
const showError = (message) => { clearInterval(timer); $('errorMessage').textContent = message; show('error'); };
const load = async () => {
  if (!reference) return showError(text('error'));
  show('loading');
  try {
    const response = await fetch(`/api/public/payment-requests/${encodeURIComponent(reference)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    request = body.data; $('merchant').textContent = request.merchant; $('paymentMerchant').textContent = request.merchant;
    $('description').textContent = request.description || text('defaultDescription'); $('amount').textContent = money(request.amount);
    $('shortCode').textContent = `${text('code')}: ${request.shortCode}`; applyLanguage(); show('request');
  } catch (error) { showError(error.message); }
};
const start = async () => {
  show('loading');
  try {
    const response = await fetch(`/api/public/payment-requests/${encodeURIComponent(reference)}/start`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:'{}' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    $('paymentQr').src = body.data.qrCodeDataUrl; $('paymentAmount').textContent = money(body.data.amount);
    $('openKaspi').href = body.data.paymentUrl; show('payment');
    clearInterval(timer);
    const tick = () => { const seconds = body.data.expiresAt ? Math.max(Math.floor((new Date(body.data.expiresAt) - Date.now()) / 1000), 0) : null; $('countdown').textContent = seconds === null ? '' : `${text('expires')} ${seconds} ${text('seconds')}`; if (seconds === 0) clearInterval(timer); };
    tick(); timer = setInterval(tick, 1000);
  } catch (error) { showError(error.message); }
};
$('language').addEventListener('change', () => { language = $('language').value; localStorage.setItem('kaspi-payment-language', language); applyLanguage(); });
$('startPayment').addEventListener('click', start); $('refreshQr').addEventListener('click', start); $('tryAgain').addEventListener('click', load);
applyLanguage(); load();
