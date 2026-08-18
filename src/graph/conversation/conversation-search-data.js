(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.operatorGuideSearchData) return;

  const freezeList = items => Object.freeze(items.map(item => Object.freeze(item)));
  const phrase = (text, weight = 1) => Object.freeze({
    text,
    weight,
    source: 'curated',
    approved: true
  });
  const profile = (topicId, symptomId, {
    phrases = [],
    keywords = [],
    concepts = [],
    negativeSignals = []
  } = {}) => Object.freeze({
    topicId,
    symptomId,
    phrases: freezeList(phrases.map(item => typeof item === 'string' ? phrase(item) : phrase(item.text, item.weight))),
    keywords: Object.freeze([...keywords]),
    concepts: Object.freeze([...concepts]),
    negativeSignals: Object.freeze([...negativeSignals])
  });

  const LIMITATIONS = Object.freeze([
    'напрямую нет возможности',
    'напрямую проверить не может',
    'напрямую подключиться не может',
    'абонент не дома',
    'абон не дома',
    'кабеля нет',
    'проверить сейчас не может',
    'другого устройства нет',
    'перезагрузить роутер не может',
    'отправит speedtest в viber',
    'отправит спидтест в вайбер',
    'сможет проверить вечером'
  ]);

  const CONCEPT_LEXICON = Object.freeze({
    slow: Object.freeze([
      'медленно', 'тормозит', 'тупит', 'лагает', 'еле работает', 'еле грузит', 'скорость низкая'
    ]),
    load_slow: Object.freeze([
      'долго грузит', 'долго загружается', 'крутит загрузку', 'очень медленно грузит'
    ]),
    no_access: Object.freeze([
      'нет интернета', 'без интернета', 'без сети', 'не грузит', 'не открывается', 'не открываются', 'ничего не открывается'
    ]),
    wifi: Object.freeze([
      'wifi', 'по wifi', 'беспроводная сеть'
    ]),
    unstable: Object.freeze([
      'пропадает', 'отваливается', 'обрывается', 'обрывает', 'перебои', 'то есть то нет', 'нестабильно'
    ]),
    periodic: Object.freeze([
      'каждые несколько минут', 'каждые пять минут', 'периодически', 'постоянные перебои', 'регулярно', 'снова и снова'
    ]),
    self_recovers: Object.freeze([
      'само появляется', 'сам появляется', 'само восстанавливается', 'сам возвращается', 'потом работает'
    ]),
    all_devices: Object.freeze([
      'на всех устройствах', 'все устройства', 'на всем сразу'
    ]),
    phone: Object.freeze([
      'телефон', 'на телефоне', 'мобила', 'смартфон'
    ]),
    laptop: Object.freeze([
      'ноутбук', 'на ноутбуке', 'компьютер', 'на компьютере'
    ]),
    one_device_ok: Object.freeze([
      'ноут работает нормально', 'ноутбук работает нормально', 'телефон работает нормально', 'другое устройство работает'
    ]),
    video: Object.freeze([
      'youtube', 'ютуб', 'видео'
    ]),
    sites: Object.freeze([
      'сайты', 'сайт', 'браузер'
    ]),
    reboot: Object.freeze([
      'после перезагрузки', 'перезагрузил роутер', 'перезагрузка роутера'
    ]),
    evening: Object.freeze([
      'вечером', 'под вечер', 'вечером чаще'
    ]),
    work_app: Object.freeze([
      'рабочая программа', 'рабочее по', 'рабочие программы', '1с', 'корпоративная программа', 'рабочее приложение'
    ]),
    microfreeze: Object.freeze([
      'микрофризы', 'микрофриз', 'на несколько секунд замирает', 'коротко подвисает'
    ]),
    logout: Object.freeze([
      'выкидывает', 'выбивает', 'вылетает', 'разлогинивает', 'логин заново', 'входить заново', 'теряет авторизацию', 'повторный логин'
    ]),
    internet_ok: Object.freeze([
      'youtube работает нормально', 'ютуб работает нормально', 'сайты работают', 'сайты открываются', 'обычный интернет работает', 'интернет работает нормально'
    ]),
    vpn: Object.freeze([
      'vpn', 'впн'
    ]),
    remote: Object.freeze([
      'удаленка', 'удаленный рабочий стол', 'rdp', 'remote desktop'
    ]),
    app_error: Object.freeze([
      'ошибка в программе', 'код ошибки', 'ошибка сервиса', 'ошибка приложения'
    ]),
    session_break: Object.freeze([
      'сессия обрывается', 'сеанс обрывается', 'резко обрывается', 'соединение обрывается'
    ]),
    one_service: Object.freeze([
      'только одно приложение', 'только один сервис', 'только одна программа'
    ])
  });

  const TOPIC_CONCEPTS = Object.freeze({
    low_speed: Object.freeze(['slow', 'load_slow']),
    no_internet: Object.freeze(['no_access']),
    unstable: Object.freeze(['unstable', 'periodic', 'self_recovers']),
    other: Object.freeze(['work_app', 'microfreeze', 'logout', 'internet_ok', 'vpn', 'remote', 'app_error', 'session_break', 'one_service'])
  });

  const PROFILES = Object.freeze([
    profile('low_speed', 'internet_slow', {
      phrases: [
        'интернет весь день тупит',
        'все работает но очень тормозит',
        'интернет еле шевелится'
      ],
      keywords: ['тупит', 'тормозит', 'медленно', 'лагает'],
      concepts: ['slow'],
      negativeSignals: ['нет интернета вообще', 'полностью пропадает']
    }),
    profile('low_speed', 'very_slow_load', {
      phrases: [
        { text: 'очень медленно работает интернет', weight: 1.08 },
        'страницы и приложения еле загружаются',
        'все очень долго грузится'
      ],
      keywords: ['очень медленно', 'еле грузит', 'долго грузит'],
      concepts: ['slow', 'load_slow'],
      negativeSignals: ['вообще ничего не открывается']
    }),
    profile('low_speed', 'video_freezes', {
      phrases: [
        'видео постоянно зависает при просмотре',
        'ролики тормозят и останавливаются',
        'youtube буферит во время просмотра'
      ],
      keywords: ['видео зависает', 'буферит', 'ютуб тормозит'],
      concepts: ['video', 'slow'],
      negativeSignals: ['youtube работает нормально']
    }),
    profile('low_speed', 'sites_slow', {
      phrases: [
        'сайты открываются очень долго',
        'страницы в браузере медленно грузятся',
        'браузер долго открывает сайты'
      ],
      keywords: ['сайты медленно', 'страницы долго', 'браузер тормозит'],
      concepts: ['sites', 'slow', 'load_slow'],
      negativeSignals: ['сайты открываются нормально']
    }),
    profile('low_speed', 'laptop_slow', {
      phrases: [
        'на ноутбуке интернет тоже тормозит',
        'ноутбук медленно грузит через домашний интернет',
        'компьютер тоже работает медленно в этой сети'
      ],
      keywords: ['ноутбук медленно', 'на ноутбуке тормозит', 'компьютер медленно'],
      concepts: ['laptop', 'slow'],
      negativeSignals: ['ноут работает нормально', 'ноутбук работает нормально']
    }),
    profile('low_speed', 'phone_bad', {
      phrases: [
        'на телефоне интернет работает плохо',
        'телефон по wifi еле грузит',
        'на смартфоне все тормозит'
      ],
      keywords: ['телефон тормозит', 'смартфон медленно', 'мобила тупит'],
      concepts: ['phone', 'slow', 'wifi'],
      negativeSignals: ['телефон работает нормально']
    }),
    profile('low_speed', 'loading_spinner', {
      phrases: [
        'постоянно крутится загрузка и долго не заканчивается',
        'в приложении бесконечно висит загрузка',
        'страница висит на индикаторе загрузки'
      ],
      keywords: ['крутит загрузку', 'бесконечная загрузка', 'висит загрузка'],
      concepts: ['load_slow', 'slow'],
      negativeSignals: []
    }),
    profile('low_speed', 'wifi_no_internet', {
      phrases: [
        'wifi подключен но страницы грузятся очень плохо',
        'по wifi сеть есть но почти ничего не загружается',
        'wifi держится а доступ еле работает'
      ],
      keywords: ['wifi еле грузит', 'wifi плохо работает'],
      concepts: ['wifi', 'slow'],
      negativeSignals: ['пишет без интернета', 'нет интернета']
    }),

    profile('no_internet', 'nothing_opens', {
      phrases: [
        'вообще ничего не открывается ни на одном устройстве',
        'интернет полностью не работает и ничего не грузит',
        'ни сайты ни приложения не открываются'
      ],
      keywords: ['ничего не открывается', 'ничего не грузит', 'интернет не работает'],
      concepts: ['no_access', 'all_devices'],
      negativeSignals: ['сайты открываются', 'youtube работает нормально']
    }),
    profile('no_internet', 'wifi_connected_no_access', {
      phrases: [
        { text: 'wifi есть но пишет без интернета', weight: 1.08 },
        'к wifi подключено но доступа в интернет нет',
        'wifi сеть видна а интернет отсутствует'
      ],
      keywords: ['wifi без интернета', 'wifi есть интернета нет', 'нет доступа в интернет'],
      concepts: ['wifi', 'no_access'],
      negativeSignals: ['по wifi только медленно']
    }),
    profile('no_internet', 'connected_no_network', {
      phrases: [
        'устройство пишет подключено но без сети',
        'статус подключения без доступа к интернету',
        'подключение есть но система показывает нет сети'
      ],
      keywords: ['подключено без сети', 'без доступа', 'нет сети'],
      concepts: ['no_access'],
      negativeSignals: []
    }),
    profile('no_internet', 'phone_no_internet', {
      phrases: [
        { text: 'на телефоне не работает а ноутбук работает нормально', weight: 1.08 },
        'только на телефоне нет интернета через домашний wifi',
        'смартфон подключен к wifi но интернет не работает'
      ],
      keywords: ['на телефоне не работает', 'телефон без интернета', 'смартфон без интернета'],
      concepts: ['phone', 'wifi', 'no_access', 'one_device_ok'],
      negativeSignals: ['на всех устройствах']
    }),
    profile('no_internet', 'laptop_no_internet', {
      phrases: [
        'на ноутбуке тоже полностью нет интернета',
        'ноутбук подключен но ничего не открывает',
        'на компьютере домашний интернет не работает'
      ],
      keywords: ['на ноутбуке нет', 'ноутбук без интернета', 'компьютер без интернета'],
      concepts: ['laptop', 'no_access'],
      negativeSignals: ['ноут работает нормально', 'ноутбук работает нормально']
    }),
    profile('no_internet', 'sites_do_not_open', {
      phrases: [
        'сайты вообще не открываются в браузере',
        'браузер не открывает ни одну страницу',
        'страницы сайтов недоступны хотя подключение есть'
      ],
      keywords: ['сайты не открываются', 'браузер не открывает', 'страницы недоступны'],
      concepts: ['sites', 'no_access'],
      negativeSignals: ['сайты открываются']
    }),
    profile('no_internet', 'reboot_no_help', {
      phrases: [
        'перезагрузили роутер но интернет не появился',
        'после перезапуска роутера ничего не изменилось',
        'роутер перезагрузили а доступа все равно нет'
      ],
      keywords: ['перезагрузка не помогла', 'после перезагрузки нет', 'перезапуск не помог'],
      concepts: ['reboot', 'no_access'],
      negativeSignals: ['после перезагрузки временно лучше']
    }),
    profile('no_internet', 'only_home', {
      phrases: [
        'только на домашнем интернете ничего не работает',
        'через мобильный интернет работает а дома нет',
        'вне дома интернет есть а домашняя сеть без доступа'
      ],
      keywords: ['только дома не работает', 'дома нет интернета', 'мобильный работает дома нет'],
      concepts: ['no_access'],
      negativeSignals: []
    }),

    profile('unstable', 'comes_and_goes', {
      phrases: [
        { text: 'интернет то есть то нет', weight: 1.08 },
        'связь пропадает и потом сама возвращается',
        'интернет периодически исчезает без действий'
      ],
      keywords: ['то есть то нет', 'пропадает и появляется', 'нестабильно'],
      concepts: ['unstable', 'self_recovers'],
      negativeSignals: ['полностью не работает постоянно']
    }),
    profile('unstable', 'every_few_minutes', {
      phrases: [
        { text: 'каждые пять минут отваливается потом само появляется', weight: 1.1 },
        { text: 'постоянные перебои и регулярные обрывы', weight: 1.06 },
        'каждые несколько минут интернет пропадает'
      ],
      keywords: ['каждые пять минут', 'каждые несколько минут', 'постоянные перебои', 'частые обрывы'],
      concepts: ['unstable', 'periodic', 'self_recovers'],
      negativeSignals: []
    }),
    profile('unstable', 'wifi_drops', {
      phrases: [
        'сам wifi постоянно отваливается на устройствах',
        'wifi сеть исчезает и появляется снова',
        'телефон теряет подключение к wifi сети'
      ],
      keywords: ['wifi отваливается', 'wifi пропадает', 'теряет wifi'],
      concepts: ['wifi', 'unstable'],
      negativeSignals: ['wifi есть но интернета нет']
    }),
    profile('unstable', 'video_periodic', {
      phrases: [
        'видео периодически зависает а потом продолжает',
        'youtube время от времени останавливается',
        'ролик подвисает периодами при нормальном интернете'
      ],
      keywords: ['видео периодически', 'youtube зависает', 'ролик подвисает'],
      concepts: ['video', 'unstable', 'periodic'],
      negativeSignals: ['youtube работает нормально']
    }),
    profile('unstable', 'reboot_temporarily_helps', {
      phrases: [
        'после перезагрузки роутера помогает ненадолго',
        'перезапуск роутера временно восстанавливает интернет',
        'после перезагрузки работает немного и снова пропадает'
      ],
      keywords: ['временно лучше', 'помогает ненадолго', 'снова пропадает'],
      concepts: ['reboot', 'unstable', 'self_recovers'],
      negativeSignals: ['перезагрузка не помогла']
    }),
    profile('unstable', 'worse_evening', {
      phrases: [
        'вечером интернет чаще начинает пропадать',
        'под вечер обрывы становятся чаще',
        'каждый вечер связь работает нестабильно'
      ],
      keywords: ['вечером чаще', 'под вечер', 'каждый вечер'],
      concepts: ['evening', 'unstable', 'periodic'],
      negativeSignals: []
    }),
    profile('unstable', 'all_devices_same_time', {
      phrases: [
        'на всех устройствах одновременно происходит обрыв',
        'вся техника одновременно теряет интернет',
        'телефон и ноутбук пропадают из интернета в один момент'
      ],
      keywords: ['все устройства одновременно', 'одновременно на всех', 'везде одновременно'],
      concepts: ['all_devices', 'unstable'],
      negativeSignals: ['только телефон', 'только ноутбук']
    }),
    profile('unstable', 'only_phone_drops', {
      phrases: [
        'только телефон периодически теряет сеть',
        'на смартфоне wifi отваливается а ноутбук работает',
        'один телефон теряет интернет остальные работают'
      ],
      keywords: ['только телефон теряет', 'смартфон отваливается', 'телефон пропадает'],
      concepts: ['phone', 'unstable', 'one_device_ok'],
      negativeSignals: ['на всех устройствах']
    }),

    profile('other', 'microfreezes', {
      phrases: [
        'в рабочей программе короткие микрофризы',
        'приложение на несколько секунд замирает',
        'во время работы бывают краткие подвисания'
      ],
      keywords: ['микрофризы', 'коротко подвисает', 'замирает на секунды'],
      concepts: ['work_app', 'microfreeze'],
      negativeSignals: ['интернет полностью пропадает']
    }),
    profile('other', 'logout_or_crash', {
      phrases: [
        { text: 'рабочая программа постоянно выкидывает', weight: 1.1 },
        'вылетает из рабочего приложения и нужно входить заново',
        'разлогинивает и снова просит авторизоваться',
        'сессия слетает и программа требует повторный логин'
      ],
      keywords: ['выкидывает', 'вылетает', 'разлогинивает', 'логин заново', 'повторный логин'],
      concepts: ['work_app', 'logout', 'session_break'],
      negativeSignals: ['вообще ничего не открывается']
    }),
    profile('other', 'work_software_only', {
      phrases: [
        'проблема только в рабочих программах',
        'обычный интернет есть а рабочее по не работает',
        'затронуты только корпоративные приложения'
      ],
      keywords: ['только рабочее по', 'рабочие программы', 'корпоративные приложения'],
      concepts: ['work_app', 'one_service', 'internet_ok'],
      negativeSignals: ['все приложения не работают']
    }),
    profile('other', 'regular_internet_ok', {
      phrases: [
        'youtube и обычные сайты работают нормально',
        'сайты открываются а рабочий сервис глючит',
        'обычный интернет стабилен во время проблемы'
      ],
      keywords: ['youtube работает', 'сайты работают', 'обычный интернет работает'],
      concepts: ['internet_ok', 'work_app'],
      negativeSignals: ['ничего не открывается', 'нет интернета']
    }),
    profile('other', 'vpn_rdp', {
      phrases: [
        'vpn или rdp соединение постоянно рвется',
        'рабочий доступ через vpn нестабилен',
        'rdp отключается при нормальном интернете'
      ],
      keywords: ['vpn не работает', 'vpn рвется', 'rdp отключается'],
      concepts: ['vpn', 'remote', 'work_app', 'unstable'],
      negativeSignals: []
    }),
    profile('other', 'remote_desktop_hangs', {
      phrases: [
        { text: 'сайты открываются но удаленка подвисает', weight: 1.1 },
        'удаленный рабочий стол зависает при нормальном интернете',
        'rdp сеанс подвисает и потом оживает'
      ],
      keywords: ['удаленка подвисает', 'удаленный стол зависает', 'rdp подвисает'],
      concepts: ['remote', 'work_app', 'microfreeze', 'internet_ok'],
      negativeSignals: ['сайты не открываются']
    }),
    profile('other', 'work_service_errors', {
      phrases: [
        'в рабочем сервисе постоянно появляется ошибка',
        'корпоративная программа показывает код ошибки',
        'рабочее приложение выдает сообщение об ошибке'
      ],
      keywords: ['ошибка рабочего сервиса', 'код ошибки', 'ошибка приложения'],
      concepts: ['work_app', 'app_error'],
      negativeSignals: []
    }),
    profile('other', 'sudden_session_break', {
      phrases: [
        'рабочая сессия работает и резко обрывается',
        'сеанс внезапно прерывается во время работы',
        'соединение с рабочим сервисом резко рвется'
      ],
      keywords: ['резко обрывается', 'сессия обрывается', 'сеанс прерывается'],
      concepts: ['work_app', 'session_break', 'unstable'],
      negativeSignals: []
    })
  ]);

  WB.operatorGuideSearchData = Object.freeze({
    revision: 'operator-guide-local-search-data-v1',
    limitations: LIMITATIONS,
    conceptLexicon: CONCEPT_LEXICON,
    topicConcepts: TOPIC_CONCEPTS,
    profiles: PROFILES
  });
})();