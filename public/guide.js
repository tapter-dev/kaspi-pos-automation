const articles = {
  number: {
    en: {
      back: '← Back to dashboard', label: 'Getting started', title: 'Which number works for a Kaspi cashier?',
      intro: 'Use a separate, real phone number that can receive SMS and has only the Cashier role in your Kaspi Pay organization.',
      quick: 'The short answer', quickText: 'A suitable number meets all three conditions below. If Kaspi asks for a password or video verification instead of only an SMS code, use another number.',
      requirements: 'Three requirements',
      cards: [
        ['1', 'A real, active SIM card', 'The phone must be nearby during connection because the confirmation code expires quickly. Virtual phone numbers are not suitable.'],
        ['2', 'No business profile on the number owner', 'A number associated with another Kaspi Pay business may require password or video verification, which this SMS connection cannot complete.'],
        ['3', 'Only the “Cashier” role', 'In Kaspi Pay open Settings → Employees, select the employee, and leave only the Cashier role. Director, Accountant, or Manager roles will prevent connection.'],
      ],
      numbers: 'Do not mix up these three numbers',
      rows: [['Your login email', 'Access to this dashboard'], ['Cashier number', 'The separate Kaspi Pay employee used by the automation'], ['Customer number', 'The buyer who receives a phone invoice']],
      warning: 'After linking, do not sign in to the Kaspi Pay app with the cashier number. A new app login can displace the automation session and stop payment status updates.',
      cta: 'Connect a cashier', disclaimer: 'Independent integration; not affiliated with Kaspi Bank. Use only accounts you are authorized to operate.',
    },
    ru: {
      back: '← Назад в кабинет', label: 'Начало работы', title: 'Какой номер подходит для кассира Kaspi?',
      intro: 'Используйте отдельный реальный номер, который принимает SMS и имеет только роль «Кассир» в вашей организации Kaspi Pay.',
      quick: 'Короткий ответ', quickText: 'Подходящий номер отвечает всем трём условиям ниже. Если Kaspi просит пароль или видеопроверку вместо SMS-кода, возьмите другой номер.',
      requirements: 'Три требования',
      cards: [['1', 'Реальная активная SIM-карта', 'Телефон должен быть рядом при подключении: код подтверждения быстро истекает. Виртуальные номера не подходят.'], ['2', 'У владельца номера нет бизнес-профиля', 'Номер, связанный с другим бизнесом Kaspi Pay, может запросить пароль или видеопроверку, которые нельзя пройти через это SMS-подключение.'], ['3', 'Только роль «Кассир»', 'Откройте Kaspi Pay → Настройки → Сотрудники, выберите сотрудника и оставьте только роль «Кассир». Другие роли помешают подключению.']],
      numbers: 'Не перепутайте три разных контакта', rows: [['Ваша электронная почта', 'Вход в этот кабинет'], ['Номер кассира', 'Отдельный сотрудник Kaspi Pay для автоматизации'], ['Номер покупателя', 'Клиент, которому отправляется счёт']],
      warning: 'После подключения не входите в приложение Kaspi Pay под номером кассира. Новый вход может разорвать сессию автоматизации и остановить обновление платежей.',
      cta: 'Подключить кассира', disclaimer: 'Независимая интеграция, не связанная с Kaspi Bank. Используйте только аккаунты, которыми вы имеете право управлять.',
    },
    kk: {
      back: '← Кабинетке оралу', label: 'Жұмысты бастау', title: 'Kaspi кассиріне қай нөмір жарайды?',
      intro: 'SMS қабылдайтын және Kaspi Pay ұйымыңызда тек «Кассир» рөлі бар жеке нақты нөмірді пайдаланыңыз.',
      quick: 'Қысқаша жауап', quickText: 'Жарамды нөмір төмендегі үш шартқа сай болуы керек. Егер Kaspi SMS кодтың орнына құпиясөз немесе бейне тексеру сұраса, басқа нөмір пайдаланыңыз.',
      requirements: 'Үш талап',
      cards: [['1', 'Нақты, белсенді SIM-карта', 'Растау коды тез аяқталатындықтан, қосу кезінде телефон жаныңызда болуы керек. Виртуалды нөмірлер жарамайды.'], ['2', 'Нөмір иесінде бизнес профилі жоқ', 'Басқа Kaspi Pay бизнесіне байланысты нөмір бұл SMS қосылымы орындай алмайтын құпиясөз немесе бейне тексеруді сұрауы мүмкін.'], ['3', 'Тек «Кассир» рөлі', 'Kaspi Pay → Баптаулар → Қызметкерлер бөлімінде қызметкерді таңдап, тек «Кассир» рөлін қалдырыңыз. Басқа рөлдер қосылуға кедергі жасайды.']],
      numbers: 'Үш түрлі контактіні шатастырмаңыз', rows: [['Электрондық поштаңыз', 'Осы кабинетке кіру'], ['Кассир нөмірі', 'Автоматтандыруға арналған жеке Kaspi Pay қызметкері'], ['Сатып алушы нөмірі', 'Телефон шотын алатын клиент']],
      warning: 'Қосқаннан кейін кассир нөмірімен Kaspi Pay қолданбасына кірмеңіз. Жаңа кіру автоматтандыру сессиясын үзіп, төлем жаңартуларын тоқтатуы мүмкін.',
      cta: 'Кассирді қосу', disclaimer: 'Kaspi Bank-пен байланысы жоқ тәуелсіз интеграция. Тек басқаруға рұқсатыңыз бар аккаунттарды пайдаланыңыз.',
    },
  },
  troubleshooting: {
    en: {
      back: '← Back to dashboard', label: 'Troubleshooting', title: 'Kaspi cashier won’t connect: what to check', intro: 'Match what you see with the checks below. Most connection problems are caused by the employee role, an unsuitable number, or SMS timing.',
      quick: 'Start here', quickText: 'Confirm the SIM is active, the number is listed in Kaspi Pay → Employees, and its only role is Cashier. Keep the phone beside you before starting again.',
      requirements: 'Diagnosis by symptom', cards: [['Password or video verification', 'The number may belong to a business owner or have another role. Use a separate number with only the Cashier role.'], ['Kaspi says the number is not registered', 'Add the number under Kaspi Pay → Settings → Employees, select Cashier, then restart the connection.'], ['The SMS does not arrive', 'Check the SIM signal, wait a few minutes after turning the phone on, and restart the flow. Avoid requesting many codes in a short period.'], ['The code is rejected or expired', 'Codes are short-lived. Keep the phone nearby and enter the newest code immediately. The whole connection flow must finish within about ten minutes.'], ['The connection worked and later stopped', 'Someone may have signed in to Kaspi Pay with the cashier number. Reconnect it and do not use that number to enter the app afterward.']],
      numbers: 'Before retrying', rows: [['Employee', 'Added in the correct organization'], ['Role', 'Cashier only'], ['SIM', 'Active and receiving SMS'], ['Phone', 'Nearby and ready before you start']],
      warning: 'Never send an SMS code to support or another person. Enter it only in your own secured dashboard.', cta: 'Try connection again', disclaimer: 'Independent integration; not affiliated with Kaspi Bank. Never share OTP codes with support.',
    },
    ru: {
      back: '← Назад в кабинет', label: 'Решение проблем', title: 'Кассир Kaspi не подключается: что проверить', intro: 'Сопоставьте свою ошибку с пунктами ниже. Обычно причина — роль сотрудника, неподходящий номер или время действия SMS.',
      quick: 'Начните отсюда', quickText: 'Убедитесь, что SIM активна, номер добавлен в Kaspi Pay → Сотрудники и у него только роль «Кассир». Перед повтором держите телефон рядом.',
      requirements: 'Диагностика по симптомам', cards: [['Kaspi просит пароль или видеопроверку', 'Возможно, номер принадлежит владельцу бизнеса или имеет другую роль. Возьмите отдельный номер только с ролью «Кассир».'], ['Kaspi сообщает, что номер не зарегистрирован', 'Добавьте номер в Kaspi Pay → Настройки → Сотрудники с ролью «Кассир», затем начните подключение заново.'], ['SMS не приходит', 'Проверьте связь и SIM, после включения телефона подождите несколько минут и перезапустите процесс. Не запрашивайте много кодов подряд.'], ['Код отклонён или истёк', 'Код действует недолго. Держите телефон рядом и сразу вводите самый новый код. Весь процесс нужно завершить примерно за десять минут.'], ['Подключение работало, но остановилось', 'Кто-то мог войти в Kaspi Pay под номером кассира. Подключите его заново и больше не входите под этим номером в приложение.']],
      numbers: 'Перед повторной попыткой', rows: [['Сотрудник', 'Добавлен в правильную организацию'], ['Роль', 'Только «Кассир»'], ['SIM', 'Активна и принимает SMS'], ['Телефон', 'Рядом и готов до начала']], warning: 'Никогда не отправляйте SMS-код поддержке или другому человеку. Вводите его только в своём защищённом кабинете.', cta: 'Попробовать снова', disclaimer: 'Независимая интеграция, не связанная с Kaspi Bank. Никому не сообщайте одноразовые коды.',
    },
    kk: {
      back: '← Кабинетке оралу', label: 'Мәселені шешу', title: 'Kaspi кассирі қосылмайды: нені тексеру керек', intro: 'Көрген қатеңізді төмендегі тексерулермен салыстырыңыз. Көбіне себеп — қызметкер рөлі, жарамсыз нөмір немесе SMS уақыты.',
      quick: 'Осыдан бастаңыз', quickText: 'SIM белсенді, нөмір Kaspi Pay → Қызметкерлер бөлімінде және оның жалғыз рөлі «Кассир» екенін тексеріңіз. Қайталар алдында телефонды жаныңызда ұстаңыз.', requirements: 'Белгі бойынша тексеру',
      cards: [['Kaspi құпиясөз немесе бейне тексеру сұрайды', 'Нөмір бизнес иесіне тиесілі немесе басқа рөлге ие болуы мүмкін. Тек «Кассир» рөлі бар жеке нөмірді пайдаланыңыз.'], ['Kaspi нөмір тіркелмеген дейді', 'Нөмірді Kaspi Pay → Баптаулар → Қызметкерлер бөліміне «Кассир» рөлімен қосып, қосылымды қайта бастаңыз.'], ['SMS келмейді', 'SIM байланысын тексеріңіз, телефонды қосқаннан кейін бірнеше минут күтіп, процесті қайта бастаңыз. Қысқа уақытта көп код сұрамаңыз.'], ['Код қабылданбады немесе мерзімі өтті', 'Код қысқа уақыт жарамды. Телефонды жақын ұстап, ең жаңа кодты дереу енгізіңіз. Бүкіл процесті шамамен он минутта аяқтаңыз.'], ['Қосылым жұмыс істеп, кейін тоқтады', 'Біреу кассир нөмірімен Kaspi Pay-ге кірген болуы мүмкін. Қайта қосып, кейін бұл нөмірмен қолданбаға кірмеңіз.']],
      numbers: 'Қайталар алдында', rows: [['Қызметкер', 'Дұрыс ұйымға қосылған'], ['Рөл', 'Тек «Кассир»'], ['SIM', 'Белсенді және SMS қабылдайды'], ['Телефон', 'Бастамас бұрын жаныңызда']], warning: 'SMS кодын қолдау қызметіне немесе басқа адамға жібермеңіз. Оны тек өзіңіздің қорғалған кабинетіңізге енгізіңіз.', cta: 'Қайта қосып көру', disclaimer: 'Kaspi Bank-пен байланысы жоқ тәуелсіз интеграция. Бір реттік кодтарды ешкімге бермеңіз.',
    },
  },
};

const articleKey = location.pathname.includes('troubleshooting') || location.pathname.includes('ne-podklyuchaetsya') ? 'troubleshooting' : 'number';
const selector = document.getElementById('guideLanguage');
const stored = localStorage.getItem('kaspi-language');
selector.value = ['en', 'ru', 'kk'].includes(stored) ? stored : 'en';

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const render = () => {
  const language = selector.value;
  const article = articles[articleKey][language];
  document.documentElement.lang = language;
  document.title = `${article.title} · Kaspi Automation`;
  document.getElementById('guideBack').textContent = article.back;
  document.getElementById('guideDisclaimer').textContent = article.disclaimer;
  document.getElementById('guideContent').innerHTML = `
    <p class="eyebrow">${escapeHtml(article.label)}</p>
    <h1>${escapeHtml(article.title)}</h1>
    <p class="guide-intro">${escapeHtml(article.intro)}</p>
    <section class="guide-summary"><strong>${escapeHtml(article.quick)}</strong><p>${escapeHtml(article.quickText)}</p></section>
    <h2>${escapeHtml(article.requirements)}</h2>
    <div class="article-cards">${article.cards.map(([number, title, text]) => `<article><b>${escapeHtml(number)}</b><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div></article>`).join('')}</div>
    <h2>${escapeHtml(article.numbers)}</h2>
    <div class="article-table">${article.rows.map(([label, text]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(text)}</span></div>`).join('')}</div>
    <aside class="article-warning">⚠ ${escapeHtml(article.warning)}</aside>
    <a class="button-link primary guide-cta" href="/dashboard">${escapeHtml(article.cta)}</a>`;
};
selector.addEventListener('change', () => { localStorage.setItem('kaspi-language', selector.value); render(); });
render();
