(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB) return;

  const phase = (id, label) => ({ id, label });
  const option = (id, label, next, hint) => ({ id, label, next, hint });
  const question = (id, phaseId, title, why, options) => ({
    id,
    kind: 'question',
    phase: phaseId,
    title,
    why,
    options
  });
  const outcome = (id, title, summary, nextAction, focus = 'access') => ({
    id,
    kind: 'outcome',
    phase: 'result',
    title,
    summary,
    nextAction,
    focus
  });

  const COMMON_PHASES = [
    phase('symptom', 'Симптом'),
    phase('scope', 'Масштаб'),
    phase('channel', 'Канал'),
    phase('check', 'Проверка'),
    phase('result', 'Гипотеза')
  ];

  const BUILTIN_TYPES = [
    {
      id: 'low_speed',
      label: 'Низкая скорость',
      short: 'Медленно загружается или тест ниже ожидаемого',
      first: 'low.scope',
      phases: COMMON_PHASES,
      nodes: {
        'low.scope': question(
          'low.scope',
          'scope',
          'На скольких устройствах скорость низкая?',
          'Так отделяем общую проблему доступа от одного телефона, ноутбука или приложения.',
          [
            option('all', 'На всех', 'low.medium.all', 'Проверим общий канал и линию'),
            option('one', 'На одном', 'low.medium.one', 'Сначала сузим до устройства или Wi‑Fi'),
            option('unknown', 'Не проверяли', 'low.compare', 'Сравним хотя бы два устройства')
          ]
        ),
        'low.compare': question(
          'low.compare',
          'scope',
          'На втором устройстве тоже медленно?',
          'Один сравнительный тест часто сразу разделяет сеть и проблему конкретного устройства.',
          [
            option('yes', 'Да, тоже', 'low.medium.all', 'Проблема может быть общей'),
            option('no', 'Нет, нормально', 'low.medium.one', 'Сосредоточимся на первом устройстве'),
            option('cant', 'Проверить нельзя', 'low.medium.one', 'Продолжим осторожно без сравнения')
          ]
        ),
        'low.medium.one': question(
          'low.medium.one',
          'channel',
          'Как подключено проблемное устройство?',
          'Кабель и Wi‑Fi проходят разные участки. Проверять их одной веткой нельзя.',
          [
            option('wifi', 'По Wi‑Fi', 'low.wifi.band', 'Проверим диапазон и условия сигнала'),
            option('cable', 'По кабелю', 'low.cable.link', 'Проверим согласованную скорость Ethernet'),
            option('unknown', 'Неясно', 'low.medium.identify', 'Сначала определим способ подключения')
          ]
        ),
        'low.medium.all': question(
          'low.medium.all',
          'channel',
          'Где именно повторяется низкая скорость?',
          'Если медленно и по кабелю, и по Wi‑Fi, причина вероятнее находится до домашней беспроводной сети.',
          [
            option('both', 'Кабель и Wi‑Fi', 'low.direct', 'Перейдём к общему каналу'),
            option('wifi', 'Только Wi‑Fi', 'low.wifi.band', 'Сузим ветку до радиоусловий'),
            option('cable', 'Только кабель', 'low.cable.link', 'Проверим Ethernet-линк')
          ]
        ),
        'low.medium.identify': question(
          'low.medium.identify',
          'channel',
          'Есть значок Wi‑Fi или подключён сетевой кабель?',
          'Это простой способ понять, какой участок сейчас измеряет абонент.',
          [
            option('wifi', 'Значок Wi‑Fi', 'low.wifi.band', 'Идём в Wi‑Fi-ветку'),
            option('cable', 'Подключён кабель', 'low.cable.link', 'Идём в Ethernet-ветку'),
            option('still_unknown', 'Не получается понять', 'low.device.outcome', 'Фиксируем ограничение проверки')
          ]
        ),
        'low.wifi.band': question(
          'low.wifi.band',
          'check',
          'В каком диапазоне выполняется тест?',
          '2,4 ГГц лучше проходит через стены, но обычно сильнее занят. 5 ГГц быстрее рядом с роутером, но хуже проходит препятствия.',
          [
            option('24', '2,4 ГГц', 'low.wifi24.outcome', 'Проверим ограничения и помехи 2,4 ГГц'),
            option('5', '5 ГГц', 'low.wifi5.conditions', 'Проверим расстояние и сигнал'),
            option('unknown', 'Не знает', 'low.wifi.unknown', 'Нужен сравнительный тест рядом с роутером')
          ]
        ),
        'low.wifi5.conditions': question(
          'low.wifi5.conditions',
          'check',
          'Рядом с роутером скорость становится нормальной?',
          'Так проверяем, связана ли скорость с покрытием, а не с внешним каналом провайдера.',
          [
            option('yes', 'Да', 'low.coverage.outcome', 'Вероятна проблема покрытия'),
            option('no', 'Нет', 'low.direct', 'Нужно сравнить с кабелем и сессией'),
            option('unstable', 'То лучше, то хуже', 'low.interference.outcome', 'Вероятны помехи или загрузка эфира')
          ]
        ),
        'low.wifi.unknown': question(
          'low.wifi.unknown',
          'check',
          'Можно сделать тест рядом с роутером на 5 ГГц?',
          'Такой тест не доказывает качество линии, но даёт чистую точку сравнения для Wi‑Fi.',
          [
            option('normal', 'Да, стало нормально', 'low.coverage.outcome', 'Проблема ближе к покрытию Wi‑Fi'),
            option('low', 'Да, всё равно низко', 'low.direct', 'Проверим общий канал'),
            option('cant', 'Нет возможности', 'low.wifi_limited.outcome', 'Фиксируем неполную Wi‑Fi-проверку')
          ]
        ),
        'low.cable.link': question(
          'low.cable.link',
          'check',
          'Какая скорость Ethernet-линка?',
          'Линк 100 Мбит/с физически ограничивает тест примерно этим уровнем, даже если тариф выше.',
          [
            option('100', '100 Мбит/с', 'low.cable100.outcome', 'Проверим кабель, порт и сетевую карту'),
            option('1000', '1 Гбит/с', 'low.direct', 'Физический предел 100 Мбит/с исключён'),
            option('unknown', 'Не проверяли', 'low.cable_unknown.outcome', 'Сначала нужно увидеть скорость линка')
          ]
        ),
        'low.direct': question(
          'low.direct',
          'check',
          'Есть корректный тест напрямую, без фоновых загрузок?',
          'Один тест по Wi‑Fi или во время загрузок не позволяет честно оценить канал доступа.',
          [
            option('low', 'Да, скорость низкая', 'low.session', 'Сверим сессию, трафик и линию'),
            option('normal', 'Да, скорость нормальная', 'low.conditions.outcome', 'Ищем различие в устройстве или условиях теста'),
            option('no', 'Нет такого теста', 'low.direct_needed.outcome', 'Сначала нужен воспроизводимый замер')
          ]
        ),
        'low.session': question(
          'low.session',
          'check',
          'Что видно в Juniper во время проблемы?',
          'Juniper показывает интернет-сессию и обмен данными, но сам по себе не измеряет качество Wi‑Fi или оптики.',
          [
            option('online_traffic', 'Online, трафик есть', 'low.access.outcome', 'Проверим линию, порт и ограничение тарифа'),
            option('online_no_traffic', 'Online, трафика нет', 'low.local_path.outcome', 'Сверим устройство, роутер и тест'),
            option('offline', 'Сессии нет', 'low.session_problem.outcome', 'Это уже не чистая ветка низкой скорости')
          ]
        ),
        'low.wifi24.outcome': outcome(
          'low.wifi24.outcome',
          'Вероятное ограничение 2,4 ГГц',
          'Низкая скорость пока локализована в Wi‑Fi 2,4 ГГц. Это ещё не подтверждает проблему линии провайдера.',
          'Сравнить 5 ГГц рядом с роутером и, если возможно, тест по кабелю.',
          'wifi'
        ),
        'low.coverage.outcome': outcome(
          'low.coverage.outcome',
          'Вероятна проблема покрытия Wi‑Fi',
          'Рядом с роутером результат нормальный, а на расстоянии ухудшается. Причина ближе к сигналу, стенам или размещению роутера.',
          'Зафиксировать место проверки, уровень сигнала и предложить проверку расположения/покрытия.',
          'wifi'
        ),
        'low.interference.outcome': outcome(
          'low.interference.outcome',
          'Вероятны помехи или загрузка Wi‑Fi',
          'Плавающий результат при нормальной близости к роутеру чаще требует проверки эфира и фоновой нагрузки.',
          'Сравнить разные устройства и кабельный тест в тот же момент.',
          'wifi'
        ),
        'low.device.outcome': outcome(
          'low.device.outcome',
          'Способ подключения не подтверждён',
          'Пока нельзя определить, измеряется Wi‑Fi или кабельный участок.',
          'Уточнить подключение устройства до технического вывода.',
          'device'
        ),
        'low.wifi_limited.outcome': outcome(
          'low.wifi_limited.outcome',
          'Wi‑Fi-проверка ограничена',
          'Нет сравнения рядом с роутером или в другом диапазоне, поэтому причина ещё не локализована.',
          'Продолжить техническую диагностику и запросить сравнительный тест при возможности.',
          'wifi'
        ),
        'low.cable100.outcome': outcome(
          'low.cable100.outcome',
          'Ethernet согласован на 100 Мбит/с',
          'Это физический предел текущего линка. Причина может быть в кабеле, разъёме, порте или сетевой карте.',
          'Проверить состояние и ошибки порта, кабель, коннекторы и поддержку Gigabit на устройстве.',
          'ethernet'
        ),
        'low.cable_unknown.outcome': outcome(
          'low.cable_unknown.outcome',
          'Нужно проверить скорость линка',
          'Без negotiated speed нельзя отличить ограничение 100 Мбит/с от проблемы выше по сети.',
          'Посмотреть скорость Ethernet на устройстве или на порту коммутатора.',
          'ethernet'
        ),
        'low.direct_needed.outcome': outcome(
          'low.direct_needed.outcome',
          'Нужен контрольный замер',
          'Текущие измерения не отделяют канал от Wi‑Fi, фоновых загрузок и ограничений устройства.',
          'Сделать один воспроизводимый тест по кабелю или 5 ГГц рядом с роутером без фоновой нагрузки.',
          'test'
        ),
        'low.conditions.outcome': outcome(
          'low.conditions.outcome',
          'Канал в контрольном тесте нормальный',
          'Проблема проявляется не во всех условиях. Вероятнее конкретное устройство, Wi‑Fi, сервер теста или фоновая нагрузка.',
          'Сравнить условия плохого и нормального замера: устройство, диапазон, расстояние, сервер и время.',
          'device'
        ),
        'low.access.outcome': outcome(
          'low.access.outcome',
          'Нужна проверка канала доступа',
          'Сессия активна и трафик доходит, но корректный контрольный тест остаётся низким.',
          'В LIVE пройти PON-опрос либо Ethernet-порт, сверить тариф/ограничения и ошибки линии.',
          'access'
        ),
        'low.local_path.outcome': outcome(
          'low.local_path.outcome',
          'Трафик теста не подтверждён',
          'Сессия есть, но в момент наблюдения обмена не видно. Возможно, тест не запущен или трафик не дошёл от устройства.',
          'Повторить тест и одновременно сверить трафик, роутер и подключение устройства.',
          'device'
        ),
        'low.session_problem.outcome': outcome(
          'low.session_problem.outcome',
          'Перейти в ветку «Нет интернета»',
          'При отсутствии сессии первична доступность интернета, а не измерение скорости.',
          'Выбрать обращение «Интернета нет» и продолжить проверку сессии и линии.',
          'session'
        )
      }
    },
    {
      id: 'no_internet',
      label: 'Интернета нет',
      short: 'Страницы не открываются на одном или всех устройствах',
      first: 'none.scope',
      phases: COMMON_PHASES,
      nodes: {
        'none.scope': question('none.scope', 'scope', 'Интернета нет на всех устройствах?', 'Так отделяем общий обрыв от одного устройства.', [
          option('all', 'На всех', 'none.link', 'Проверим сессию и доступ'),
          option('one', 'На одном', 'none.device', 'Проверим локальное устройство'),
          option('unknown', 'Не проверяли', 'none.compare', 'Нужен простой сравнительный тест')
        ]),
        'none.compare': question('none.compare', 'scope', 'На втором устройстве интернет работает?', 'Сравнение показывает, является ли проблема общей.', [
          option('yes', 'Да', 'none.device', 'Проблема ближе к первому устройству'),
          option('no', 'Нет', 'none.link', 'Проверим общий доступ'),
          option('cant', 'Проверить нельзя', 'none.link', 'Продолжим по общей ветке')
        ]),
        'none.device': question('none.device', 'channel', 'Устройство подключено к Wi‑Fi/кабелю, но сайты не открываются?', 'Наличие локального подключения не подтверждает интернет-сессию.', [
          option('connected', 'Да, подключено', 'none.device.outcome', 'Проверим IP/DNS и устройство'),
          option('not_connected', 'Нет подключения', 'none.local_link.outcome', 'Сначала восстановим локальный линк'),
          option('unknown', 'Неясно', 'none.device.outcome', 'Нужна проверка сетевых параметров')
        ]),
        'none.link': question('none.link', 'check', 'Есть активная сессия Juniper?', 'Сессия подтверждает уровень интернет-доступа, но не состояние Wi‑Fi.', [
          option('online', 'Online', 'none.online.outcome', 'Проверим DNS, роутер и устройства'),
          option('offline', 'Offline / нет', 'none.offline.outcome', 'Проверим линию и авторизацию'),
          option('unknown', 'Не проверяли', 'none.check_session.outcome', 'Первый технический шаг — Juniper')
        ]),
        'none.device.outcome': outcome('none.device.outcome', 'Проблема локализована до одного устройства', 'Другие устройства не подтверждают общий обрыв.', 'Проверить IP, шлюз, DNS, браузер и подключение конкретного устройства.', 'device'),
        'none.local_link.outcome': outcome('none.local_link.outcome', 'Нет локального подключения', 'До проверки интернета нужно восстановить Wi‑Fi-ассоциацию или Ethernet-линк.', 'Проверить сеть Wi‑Fi, пароль, кабель и состояние LAN-порта.', 'local'),
        'none.online.outcome': outcome('none.online.outcome', 'Интернет-сессия активна', 'Общий L3-доступ виден, поэтому дальше проверяются DNS, роутер и клиентские устройства.', 'Проверить IP/шлюз/DNS и доступ по IP отдельно от доменных имён.', 'session'),
        'none.offline.outcome': outcome('none.offline.outcome', 'Сессия отсутствует', 'Нужно определить, доходит ли линия и почему не поднимается авторизация.', 'В LIVE пройти PON-опрос либо Ethernet-порт, затем проверить авторизацию.', 'access'),
        'none.check_session.outcome': outcome('none.check_session.outcome', 'Нужно проверить сессию', 'Без Juniper пока нельзя разделить линию, авторизацию и локальную сеть.', 'Открыть LIVE и начать с Juniper (NEW).', 'session')
      }
    },
    {
      id: 'unstable',
      label: 'Обрывы / нестабильно',
      short: 'Соединение периодически пропадает или скачет',
      first: 'unstable.scope',
      phases: COMMON_PHASES,
      nodes: {
        'unstable.scope': question('unstable.scope', 'scope', 'Обрывы одновременно на всех устройствах?', 'Одновременность — главный признак общей линии или роутера.', [
          option('all', 'Да, одновременно', 'unstable.medium', 'Проверим общий участок'),
          option('one', 'Только на одном', 'unstable.one.outcome', 'Проверим устройство и Wi‑Fi'),
          option('unknown', 'Неясно', 'unstable.observe.outcome', 'Нужно зафиксировать момент и устройства')
        ]),
        'unstable.medium': question('unstable.medium', 'channel', 'По кабелю обрыв тоже повторяется?', 'Кабельный тест отделяет радиоэфир от линии доступа.', [
          option('yes', 'Да', 'unstable.access.outcome', 'Проверим линию и события'),
          option('no', 'Нет, только Wi‑Fi', 'unstable.wifi.outcome', 'Сузили до беспроводной сети'),
          option('cant', 'Не проверяли', 'unstable.compare.outcome', 'Нужна параллельная проверка')
        ]),
        'unstable.one.outcome': outcome('unstable.one.outcome', 'Проблема одного устройства', 'Общий обрыв пока не подтверждён.', 'Проверить сигнал, драйвер/адаптер, энергосбережение и фоновые приложения.', 'device'),
        'unstable.observe.outcome': outcome('unstable.observe.outcome', 'Нужно зафиксировать общий момент', 'Без времени и сравнения устройств нельзя связать обрыв с линией.', 'При следующем обрыве проверить два устройства и записать точное время.', 'observe'),
        'unstable.access.outcome': outcome('unstable.access.outcome', 'Вероятен общий участок доступа', 'Обрыв повторяется и по кабелю, поэтому Wi‑Fi не является единственным объяснением.', 'Сверить Juniper last event, историю ONU/порта и ошибки линии в LIVE.', 'access'),
        'unstable.wifi.outcome': outcome('unstable.wifi.outcome', 'Нестабильность локализована в Wi‑Fi', 'Кабель остаётся стабильным в тот же момент.', 'Проверить диапазон, сигнал, канал, размещение и перегрузку роутера.', 'wifi'),
        'unstable.compare.outcome': outcome('unstable.compare.outcome', 'Нужен кабельный контроль', 'Пока нельзя разделить Wi‑Fi и линию провайдера.', 'При возможности сравнить кабель и Wi‑Fi в один момент, затем продолжить LIVE.', 'test')
      }
    },
    {
      id: 'wifi',
      label: 'Проблема Wi‑Fi',
      short: 'Слабый сигнал, сеть не видна или не подключается',
      first: 'wifi.symptom',
      phases: COMMON_PHASES,
      nodes: {
        'wifi.symptom': question('wifi.symptom', 'symptom', 'Что именно происходит с Wi‑Fi?', '«Не видит сеть», «не подключается» и «подключён без интернета» — разные точки отказа.', [
          option('not_seen', 'Сеть не видна', 'wifi.not_seen.outcome', 'Проверим радио и диапазон'),
          option('cant_join', 'Не подключается', 'wifi.join.outcome', 'Проверим пароль и устройство'),
          option('no_internet', 'Подключён, но без интернета', 'wifi.no_internet.outcome', 'Проверим IP и внешний доступ')
        ]),
        'wifi.not_seen.outcome': outcome('wifi.not_seen.outcome', 'Устройство не видит SSID', 'Проблема находится до получения IP-адреса.', 'Проверить включение Wi‑Fi, диапазон, совместимость устройства, расстояние и перезапуск радио без сброса настроек.', 'wifi'),
        'wifi.join.outcome': outcome('wifi.join.outcome', 'Ошибка подключения к Wi‑Fi', 'SSID виден, но ассоциация не завершается.', 'Проверить пароль, забыть сеть на устройстве, лимиты клиентов и настройки защиты.', 'wifi'),
        'wifi.no_internet.outcome': outcome('wifi.no_internet.outcome', 'Wi‑Fi подключён, внешний доступ не подтверждён', 'Сам значок Wi‑Fi показывает только локальную связь с роутером.', 'Перейти в обращение «Интернета нет» и проверить Juniper, IP, шлюз и DNS.', 'session')
      }
    },
    {
      id: 'sites',
      label: 'Не открываются сайты',
      short: 'Интернет частично работает, но страницы или сервисы недоступны',
      first: 'sites.scope',
      phases: COMMON_PHASES,
      nodes: {
        'sites.scope': question('sites.scope', 'scope', 'Не открывается один сайт или многие?', 'Один ресурс может быть недоступен независимо от сети абонента.', [
          option('one', 'Один сайт/сервис', 'sites.one.outcome', 'Проверим сам ресурс и маршрут'),
          option('many', 'Многие сайты', 'sites.ip_test', 'Проверим DNS отдельно от IP-доступа'),
          option('all', 'Вообще ничего', 'sites.none.outcome', 'Это ближе к отсутствию интернета')
        ]),
        'sites.ip_test': question('sites.ip_test', 'check', 'Доступ по IP есть, а имена не разрешаются?', 'Так отделяем передачу IP-пакетов от DNS — службы перевода имён в адреса.', [
          option('yes', 'Да', 'sites.dns.outcome', 'Вероятна DNS-проблема'),
          option('no', 'Нет и по IP', 'sites.access.outcome', 'Проверим общий доступ'),
          option('unknown', 'Не проверяли', 'sites.test.outcome', 'Нужны ping/nslookup или эквивалентный тест')
        ]),
        'sites.one.outcome': outcome('sites.one.outcome', 'Проблема одного ресурса', 'Общий доступ в интернет пока работает.', 'Проверить доступность ресурса с другой сети, его статус, маршрут и ограничения браузера.', 'resource'),
        'sites.none.outcome': outcome('sites.none.outcome', 'Перейти в ветку «Интернета нет»', 'Симптом шире отдельных сайтов.', 'Выбрать обращение «Интернета нет» и проверить сессию/линию.', 'session'),
        'sites.dns.outcome': outcome('sites.dns.outcome', 'Вероятна проблема DNS', 'IP-доступ есть, а преобразование доменных имён не работает.', 'Сверить DNS на устройстве/роутере, выполнить nslookup к текущему и контрольному DNS.', 'dns'),
        'sites.access.outcome': outcome('sites.access.outcome', 'Проблема не ограничена DNS', 'Нет доступа и по IP, поэтому сначала проверяется общая связность.', 'Перейти в LIVE и проверить Juniper, линию, шлюз и маршрутизацию.', 'access'),
        'sites.test.outcome': outcome('sites.test.outcome', 'Нужно разделить DNS и IP', 'Без отдельного теста нельзя понять, ломается имя сайта или сама передача данных.', 'Проверить доступ по IP и выполнить nslookup, затем выбрать соответствующую ветку.', 'dns')
      }
    }
  ];

  const GRAPH_STORAGE_KEY = 'simnet_appeals_graph_studio_v1';
  const BUILTIN_REVISION = 'builtin-1';
  const MAX_GRAPH_HISTORY = 8;
  const CONDITION_FACTS = Object.freeze({
    connectionFamily: 'Тип подключения',
    juniperStatus: 'Статус Juniper',
    accessSpeedMbps: 'Скорость линка',
    diagnosticStage: 'Этап LIVE-диагностики'
  });
  const CONDITION_OPERATORS = new Set(['equals', 'not_equals', 'exists', 'not_exists']);
  const nowIso = () => new Date().toISOString();

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const compact = (value, max = 500) => String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  const validId = value => /^[a-z][a-z0-9_.-]{1,79}$/.test(String(value || ''));
  const validAnswerId = value => /^[a-z0-9][a-z0-9_.-]{0,79}$/.test(String(value || ''));

  function normalizeCondition(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const fact = Object.hasOwn(CONDITION_FACTS, source.fact) ? String(source.fact) : '';
    const operator = CONDITION_OPERATORS.has(String(source.operator || ''))
      ? String(source.operator)
      : 'equals';
    if (!fact) return null;
    return {
      fact,
      operator,
      value: ['exists', 'not_exists'].includes(operator) ? '' : compact(source.value, 120)
    };
  }

  function normalizeGraph(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const normalizedTypes = (Array.isArray(source.types) ? source.types : [])
      .slice(0, 20)
      .map((rawType, typeIndex) => {
        const item = rawType && typeof rawType === 'object' ? rawType : {};
        const id = compact(item.id || `appeal_${typeIndex + 1}`, 80).toLowerCase();
        const phases = (Array.isArray(item.phases) && item.phases.length ? item.phases : COMMON_PHASES)
          .slice(0, 12)
          .map((rawPhase, phaseIndex) => ({
            id: compact(rawPhase?.id || `phase_${phaseIndex + 1}`, 80),
            label: compact(rawPhase?.label || `Этап ${phaseIndex + 1}`, 100)
          }));
        const nodes = {};
        for (const [rawNodeId, rawNode] of Object.entries(item.nodes || {}).slice(0, 120)) {
          const nodeId = compact(rawNode?.id || rawNodeId, 80);
          const sourceNode = rawNode && typeof rawNode === 'object' ? rawNode : {};
          if (sourceNode.kind === 'outcome') {
            nodes[nodeId] = {
              id: nodeId,
              kind: 'outcome',
              phase: compact(sourceNode.phase || 'result', 80),
              title: compact(sourceNode.title || 'Рабочая гипотеза', 240),
              summary: compact(sourceNode.summary, 800),
              nextAction: compact(sourceNode.nextAction, 800),
              focus: compact(sourceNode.focus || 'access', 80)
            };
            continue;
          }
          nodes[nodeId] = {
            id: nodeId,
            kind: 'question',
            phase: compact(sourceNode.phase || phases[0]?.id || 'symptom', 80),
            title: compact(sourceNode.title || 'Уточняющий вопрос', 240),
            why: compact(sourceNode.why, 800),
            options: (Array.isArray(sourceNode.options) ? sourceNode.options : [])
              .slice(0, 6)
              .map((rawOption, optionIndex) => ({
                id: compact(rawOption?.id || `answer_${optionIndex + 1}`, 80),
                label: compact(rawOption?.label || `Ответ ${optionIndex + 1}`, 160),
                next: compact(rawOption?.next, 80),
                hint: compact(rawOption?.hint, 300),
                condition: normalizeCondition(rawOption?.condition)
              }))
          };
        }
        return {
          id,
          label: compact(item.label || `Обращение ${typeIndex + 1}`, 160),
          short: compact(item.short, 360),
          first: compact(item.first, 80),
          phases,
          nodes
        };
      });
    return {
      schemaVersion: 1,
      revision: compact(source.revision || BUILTIN_REVISION, 80),
      name: compact(source.name || 'Граф обращений', 160),
      updatedAt: compact(source.updatedAt || nowIso(), 48),
      publishedAt: compact(source.publishedAt, 48),
      types: normalizedTypes
    };
  }

  function validateGraph(raw) {
    const graph = normalizeGraph(raw);
    const errors = [];
    const warnings = [];
    if (!graph.types.length) errors.push('Добавь хотя бы один тип обращения.');
    const typeIds = new Set();
    let nodeCount = 0;
    let edgeCount = 0;

    for (const appealType of graph.types) {
      if (!validId(appealType.id)) errors.push(`Некорректный ID типа: ${appealType.id || 'пусто'}.`);
      if (typeIds.has(appealType.id)) errors.push(`Повторяется ID типа: ${appealType.id}.`);
      typeIds.add(appealType.id);
      const nodeIds = Object.keys(appealType.nodes || {});
      nodeCount += nodeIds.length;
      if (!nodeIds.length) errors.push(`${appealType.label}: нет узлов.`);
      if (!appealType.nodes?.[appealType.first]) errors.push(`${appealType.label}: стартовый узел не найден.`);

      const phaseIds = new Set(appealType.phases.map(item => item.id));
      for (const nodeId of nodeIds) {
        const current = appealType.nodes[nodeId];
        if (!validId(nodeId)) errors.push(`${appealType.label}: некорректный ID узла ${nodeId}.`);
        if (!phaseIds.has(current.phase)) warnings.push(`${nodeId}: этап ${current.phase} не описан в шкале прогресса.`);
        if (current.kind === 'outcome') {
          if (!current.nextAction) warnings.push(`${nodeId}: не заполнен следующий шаг оператора.`);
          continue;
        }
        if (!current.options.length) errors.push(`${nodeId}: вопрос не имеет ответов.`);
        const optionIds = new Set();
        for (const answer of current.options) {
          edgeCount += 1;
          if (!validAnswerId(answer.id)) errors.push(`${nodeId}: некорректный ID ответа ${answer.id}.`);
          if (optionIds.has(answer.id)) errors.push(`${nodeId}: повторяется ответ ${answer.id}.`);
          optionIds.add(answer.id);
          if (!appealType.nodes[answer.next]) {
            errors.push(`${nodeId} → ${answer.label}: целевой узел ${answer.next || 'не выбран'} не найден.`);
          }
          if (answer.condition && !Object.hasOwn(CONDITION_FACTS, answer.condition.fact)) {
            errors.push(`${nodeId} → ${answer.label}: неизвестное условие.`);
          }
        }
      }
      const reachable = new Set();
      const visiting = new Set();
      let hasOutcome = false;
      const walk = nodeId => {
        if (visiting.has(nodeId)) {
          errors.push(`${appealType.label}: обнаружен цикл возле ${nodeId}.`);
          return;
        }
        if (reachable.has(nodeId) || !appealType.nodes[nodeId]) return;
        visiting.add(nodeId);
        reachable.add(nodeId);
        const current = appealType.nodes[nodeId];
        if (current.kind === 'outcome') {
          hasOutcome = true;
        } else {
          for (const answer of current.options) {
            if (appealType.nodes[answer.next]) walk(answer.next);
          }
        }
        visiting.delete(nodeId);
      };
      if (appealType.first) walk(appealType.first);
      if (!hasOutcome) errors.push(`${appealType.label}: из старта нельзя дойти до результата.`);
      for (const nodeId of nodeIds) {
        if (!reachable.has(nodeId)) warnings.push(`${appealType.label}: узел ${nodeId} недостижим из старта.`);
      }
    }
    return {
      valid: errors.length === 0,
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
      stats: { types: graph.types.length, nodes: nodeCount, edges: edgeCount },
      graph
    };
  }

  const builtinGraph = normalizeGraph({
    revision: BUILTIN_REVISION,
    name: 'Стандартный граф обращений',
    updatedAt: nowIso(),
    publishedAt: nowIso(),
    types: BUILTIN_TYPES
  });
  let runtimeGraph = builtinGraph;
  let studioBundle = {
    schemaVersion: 1,
    draft: clone(builtinGraph),
    published: clone(builtinGraph),
    history: [clone(builtinGraph)],
    updatedAt: nowIso()
  };
  const graphVersions = new Map([[runtimeGraph.revision, runtimeGraph]]);

  function graphForRevision(revision = '') {
    return graphVersions.get(String(revision || '')) || runtimeGraph;
  }

  function rebuildVersions(bundle) {
    graphVersions.clear();
    graphVersions.set(builtinGraph.revision, builtinGraph);
    for (const candidate of [bundle?.published, ...(Array.isArray(bundle?.history) ? bundle.history : [])]) {
      const checked = validateGraph(candidate);
      if (checked.valid && checked.graph.revision) graphVersions.set(checked.graph.revision, checked.graph);
    }
  }

  function applyBundle(rawBundle, reason = 'storage') {
    const source = rawBundle && typeof rawBundle === 'object' ? rawBundle : {};
    const checked = validateGraph(source.published || builtinGraph);
    const published = checked.valid ? checked.graph : clone(builtinGraph);
    const draftCheck = validateGraph(source.draft || published);
    studioBundle = {
      schemaVersion: 1,
      draft: draftCheck.graph,
      published,
      history: (Array.isArray(source.history) ? source.history : [published]).slice(-MAX_GRAPH_HISTORY),
      updatedAt: compact(source.updatedAt || nowIso(), 48)
    };
    runtimeGraph = published;
    rebuildVersions(studioBundle);
    WB.bus?.emit?.('appeals:graph-changed', { revision: published.revision, reason });
    return studioBundle;
  }

  async function readBundle() {
    if (!globalThis.chrome?.storage?.local) return studioBundle;
    const stored = await chrome.storage.local.get([GRAPH_STORAGE_KEY]);
    return applyBundle(stored?.[GRAPH_STORAGE_KEY], 'load');
  }

  async function writeBundle(nextBundle, reason = 'draft') {
    const applied = applyBundle(nextBundle, reason);
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.set({ [GRAPH_STORAGE_KEY]: clone(applied) });
    }
    return clone(applied);
  }

  function currentType(typeId, revision = '') {
    return graphForRevision(revision).types.find(item => item.id === String(typeId || '')) || null;
  }

  function type(typeId, revision = '') {
    return currentType(typeId, revision);
  }

  function embeddedType(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const checked = validateGraph({
      revision: compact(raw.graphRevision || BUILTIN_REVISION, 80),
      types: [raw.graphType]
    });
    const candidate = checked.valid ? checked.graph.types[0] : null;
    return candidate?.id === String(raw.typeId || '') ? candidate : null;
  }

  function typeForState(state) {
    return embeddedType(state) || type(state?.typeId, state?.graphRevision);
  }

  function node(state) {
    const appealType = typeForState(state);
    return appealType?.nodes?.[state?.nodeId] || null;
  }

  function empty() {
    return {
      schemaVersion: 1,
      graphRevision: runtimeGraph.revision,
      graphType: null,
      typeId: '',
      nodeId: '',
      outcomeId: '',
      status: 'empty',
      history: [],
      startedAt: '',
      updatedAt: ''
    };
  }

  function normalize(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const graph = graphForRevision(source.graphRevision);
    const appealType = embeddedType(source)
      || graph.types.find(item => item.id === String(source.typeId || ''))
      || null;
    if (!appealType) return empty();
    const history = (Array.isArray(source.history) ? source.history : [])
      .filter(item => item && appealType.nodes?.[item.nodeId])
      .slice(-24)
      .map(item => ({
        nodeId: String(item.nodeId || ''),
        answerId: String(item.answerId || ''),
        question: String(item.question || '').slice(0, 240),
        answer: String(item.answer || '').slice(0, 160),
        next: String(item.next || ''),
        source: String(item.source || 'operator').slice(0, 40),
        at: String(item.at || '')
      }));
    const nodeId = appealType.nodes?.[source.nodeId]
      ? String(source.nodeId)
      : appealType.first;
    const current = appealType.nodes[nodeId];
    return {
      schemaVersion: 1,
      graphRevision: compact(source.graphRevision || graph.revision, 80),
      graphType: clone(appealType),
      typeId: appealType.id,
      nodeId,
      outcomeId: current?.kind === 'outcome' ? nodeId : '',
      status: current?.kind === 'outcome' ? 'complete' : 'active',
      history,
      startedAt: String(source.startedAt || nowIso()),
      updatedAt: String(source.updatedAt || nowIso()),
      completedAt: current?.kind === 'outcome'
        ? String(source.completedAt || source.updatedAt || nowIso())
        : ''
    };
  }

  function select(typeId) {
    const appealType = type(typeId, runtimeGraph.revision);
    if (!appealType) return empty();
    const at = nowIso();
    return normalize({
      typeId: appealType.id,
      graphRevision: runtimeGraph.revision,
      graphType: clone(appealType),
      nodeId: appealType.first,
      history: [],
      startedAt: at,
      updatedAt: at
    });
  }

  function factForCondition(condition, caseData = {}) {
    const value = fact => fact && typeof fact === 'object' && 'value' in fact ? fact.value : fact;
    const facts = {
      connectionFamily: value(caseData?.network?.connectionFamily) || caseData?.diagnostic?.family || '',
      juniperStatus: caseData?.juniper?.details?.status || '',
      accessSpeedMbps: value(caseData?.network?.accessSpeedMbps) || '',
      diagnosticStage: caseData?.diagnostic?.stage || ''
    };
    return facts[condition?.fact] ?? '';
  }

  function conditionMatches(condition, caseData = {}) {
    if (!condition) return true;
    const actual = String(factForCondition(condition, caseData) ?? '').trim().toLowerCase();
    const expected = String(condition.value ?? '').trim().toLowerCase();
    if (condition.operator === 'exists') return Boolean(actual);
    if (condition.operator === 'not_exists') return !actual;
    if (condition.operator === 'not_equals') return actual !== expected;
    return actual === expected;
  }

  function availableOptions(raw, caseData = {}) {
    const state = normalize(raw);
    const current = node(state);
    if (!current || current.kind !== 'question') return [];
    return current.options.filter(item => conditionMatches(item.condition, caseData));
  }

  function answer(raw, answerId, caseData = {}, meta = {}) {
    const state = normalize(raw);
    const current = node(state);
    if (!current || current.kind !== 'question') return state;
    const selected = availableOptions(state, caseData)
      .find(item => item.id === String(answerId || ''));
    if (!selected) return state;
    const at = nowIso();
    return normalize({
      ...state,
      nodeId: selected.next,
      history: [
        ...state.history,
        {
          nodeId: current.id,
          answerId: selected.id,
          question: current.title,
          answer: selected.label,
          next: selected.next,
          source: compact(meta.source || 'operator', 40) || 'operator',
          at
        }
      ],
      updatedAt: at,
      completedAt: ''
    });
  }

  function back(raw) {
    const state = normalize(raw);
    const history = state.history.slice();
    const previous = history.pop();
    if (!previous) return state;
    return normalize({
      ...state,
      nodeId: previous.nodeId,
      outcomeId: '',
      status: 'active',
      history,
      updatedAt: nowIso(),
      completedAt: ''
    });
  }

  function phaseStates(raw) {
    const state = normalize(raw);
    const appealType = typeForState(state);
    if (!appealType) return [];
    const current = node(state);
    const visited = new Set(state.history.map(item => appealType.nodes?.[item.nodeId]?.phase).filter(Boolean));
    const currentIndex = Math.max(0, appealType.phases.findIndex(item => item.id === current?.phase));
    return appealType.phases.map((item, index) => ({
      ...item,
      state: current?.kind === 'outcome' && index <= currentIndex
        ? 'done'
        : item.id === current?.phase
          ? 'current'
          : visited.has(item.id) || index < currentIndex
            ? 'done'
            : 'todo'
    }));
  }

  function caseSummary(caseData = {}) {
    const value = fact => fact && typeof fact === 'object' && 'value' in fact ? fact.value : fact;
    const juniper = caseData?.juniper?.details || {};
    const diagnostic = caseData?.diagnostic || {};
    const family = value(caseData?.network?.connectionFamily) || diagnostic.family || '';
    const accessSpeed = value(caseData?.network?.accessSpeedMbps) || '';
    const items = [
      family ? { label: 'Подключение', value: String(family).toUpperCase() } : null,
      juniper.status ? { label: 'Сессия', value: String(juniper.status) } : null,
      accessSpeed ? { label: 'Линк', value: `${accessSpeed} Мбит/с` } : null,
      diagnostic.stage ? { label: 'Диагностика', value: String(diagnostic.stage) } : null
    ].filter(Boolean);
    return items.slice(0, 4);
  }

  /**
   * Derived prerequisite coverage from Case evidence — not subscriber answers.
   * status: confirmed | missing | stale | conflicting
   */
  function compactCaseConflicts(caseData = {}) {
    const raw = Array.isArray(caseData?.conflicts) ? caseData.conflicts : [];
    return raw.slice(0, 12).map(item => ({
      field: String(item.field || '').slice(0, 80),
      oldValue: String(item.oldValue ?? '').slice(0, 80),
      newValue: String(item.newValue ?? '').slice(0, 80),
      oldSource: String(item.oldSource || '').slice(0, 40),
      newSource: String(item.newSource || '').slice(0, 40),
      accepted: Boolean(item.accepted)
    }));
  }

  function contextCoverage(caseData = {}) {
    const value = fact => fact && typeof fact === 'object' && 'value' in fact ? fact.value : fact;
    const hasIdentity = Boolean(
      value(caseData?.identity?.login)
      || value(caseData?.identity?.contract)
      || value(caseData?.identity?.billingId)
    );
    const technicalVisited = Boolean(caseData?.diagnostic?.technicalVisited);
    const billingComplete = Boolean(caseData?.diagnostic?.billingTechnicalComplete);
    const writebackVerified = Boolean(caseData?.workflow?.ponAcquisition?.technicalWritebackVerified);
    const hasOlt = Boolean(
      value(caseData?.pon?.oltName)
      || value(caseData?.pon?.oltIp)
      || value(caseData?.pon?.tmcOltName)
    );
    const hasOnu = Boolean(
      value(caseData?.pon?.onuMac)
      || value(caseData?.pon?.onuSerial)
      || value(caseData?.pon?.tmcOnuMac)
      || value(caseData?.pon?.tmcOnuSerial)
    );
    const usersideVisited = Boolean(caseData?.diagnostic?.usersideVisited);
    const tmcFound = Boolean(
      value(caseData?.pon?.tmcOltName)
      || value(caseData?.pon?.tmcOnuMac)
      || value(caseData?.pon?.tmcOnuSerial)
    );
    const live = caseData?.live?.oltSnapshot || {};
    const liveConfirmed = String(live.status || '') === 'confirmed'
      || String(caseData?.locator?.termination?.status || '') === 'confirmed';
    const pollConflict = String(caseData?.locator?.termination?.status || '').toLowerCase() === 'conflict'
      || String(live.outcome || '').toLowerCase() === 'conflict';
    // Identity-related Case conflicts only — not every fact-merge noise.
    const identityConflictFields = compactCaseConflicts(caseData).filter(item => (
      /onu|olt|serial|mac|pon\./i.test(item.field)
    ));
    const hasIdentityConflict = identityConflictFields.length > 0 || pollConflict;
    const juniperStatus = String(
      caseData?.juniper?.details?.status
      || caseData?.locator?.sourceStatus?.juniper?.result
      || ''
    ).toLowerCase();
    const hasWanIp = Boolean(value(caseData?.network?.ip) || caseData?.juniper?.details?.subscriberIp);

    const chip = (id, label, status, detail = '') => ({ id, label, status, detail });
    // Billing ✓ only when technical data is complete (or writeback verified) — not mere visit.
    const billingStatus = !hasIdentity
      ? 'missing'
      : (hasIdentityConflict && identityConflictFields.some(item => /billing|olt|serial|mac/i.test(item.field))
        ? 'conflicting'
        : (billingComplete || writebackVerified
          ? 'confirmed'
          : (technicalVisited ? 'stale' : 'missing')));
    const usersideStatus = tmcFound
      ? (hasIdentityConflict ? 'conflicting' : 'confirmed')
      : (usersideVisited ? 'stale' : 'missing');
    const onuStatus = pollConflict || hasIdentityConflict
      ? 'conflicting'
      : (liveConfirmed
        ? 'confirmed'
        : ((hasOlt && hasOnu) ? 'stale' : 'missing'));

    const items = [
      chip(
        'billing',
        'Billing',
        billingStatus,
        !hasIdentity
          ? 'нет identity'
          : (billingComplete || writebackVerified
            ? 'технические данные подтверждены'
            : (technicalVisited ? 'Technical открывали, данные не подтверждены' : 'абонент опознан'))
      ),
      chip(
        'userside',
        'UserSide',
        usersideStatus,
        tmcFound ? 'ТМЦ найдена' : (usersideVisited ? 'карточка открывалась' : 'не проверяли')
      ),
      chip(
        'onu_olt',
        'ONU/OLT',
        onuStatus,
        pollConflict
          ? 'конфликт identity при опросе'
          : (hasIdentityConflict
            ? `расхождение: ${identityConflictFields.map(item => item.field).slice(0, 3).join(', ')}`
            : (liveConfirmed
              ? `LIVE ${live.onuStatus || 'confirmed'}`
              : (hasOlt && hasOnu ? 'привязка без LIVE-подтверждения' : 'недостаточно данных')))
      ),
      chip(
        'freshness',
        'Данные',
        liveConfirmed ? 'confirmed' : (billingComplete ? 'stale' : 'missing'),
        liveConfirmed ? 'актуальны (LIVE)' : (billingComplete ? 'billing complete, LIVE нет' : 'неполные')
      ),
      chip(
        'session',
        'Сессия',
        juniperStatus === 'online' || juniperStatus === 'available'
          ? 'confirmed'
          : (juniperStatus ? 'stale' : 'missing'),
        juniperStatus || 'нет данных Juniper'
      ),
      chip(
        'wan_ip',
        'WAN IP',
        hasWanIp ? 'confirmed' : 'missing',
        hasWanIp ? String(value(caseData?.network?.ip) || caseData?.juniper?.details?.subscriberIp || '') : 'отсутствует'
      )
    ];
    return {
      items,
      confirmed: items.filter(item => item.status === 'confirmed'),
      missing: items.filter(item => item.status === 'missing'),
      stale: items.filter(item => item.status === 'stale'),
      conflicting: items.filter(item => item.status === 'conflicting'),
      conflicts: identityConflictFields
    };
  }

  /**
   * Pure view-model for Runtime Graph. Deterministic; no DOM / no Case writes.
   */
  function resolveRuntimeGraph({ appeal, appealType, caseData } = {}) {
    const state = normalize(appeal);
    const type = appealType || typeForState(state);
    const coverage = contextCoverage(caseData || {});
    if (!type || state.status === 'empty' || !state.typeId) {
      return {
        status: 'empty',
        root: null,
        currentNode: null,
        traversedNodes: [],
        availableOptions: [],
        inactiveOptions: [],
        selectedEdges: [],
        contextCoverage: coverage,
        evidence: coverage.items,
        outcome: null,
        types: (runtimeGraph.types || []).map(item => ({ id: item.id, label: item.label, short: item.short }))
      };
    }
    const current = type.nodes?.[state.nodeId] || null;
    const traversed = (state.history || []).map(item => ({
      nodeId: item.nodeId,
      answerId: item.answerId,
      question: item.question,
      answer: item.answer,
      next: item.next,
      at: item.at,
      source: item.source || 'operator'
    }));
    const traversedIds = new Set(traversed.map(item => item.nodeId));
    if (current?.id) traversedIds.add(current.id);
    const options = availableOptions(state, caseData);
    const allOptions = current?.kind === 'question' ? (current.options || []) : [];
    const availableIds = new Set(options.map(item => item.id));
    const selectedEdges = traversed
      .filter(item => item.nodeId && item.next)
      .map(item => ({ from: item.nodeId, to: item.next, answerId: item.answerId }));
    return {
      status: state.status,
      root: {
        typeId: type.id,
        label: type.label,
        short: type.short,
        graphRevision: state.graphRevision
      },
      currentNode: current,
      traversedNodes: [...traversedIds],
      history: traversed,
      availableOptions: options,
      inactiveOptions: allOptions.filter(item => !availableIds.has(item.id)),
      selectedEdges,
      contextCoverage: coverage,
      evidence: coverage.items,
      outcome: current?.kind === 'outcome' ? current : null,
      types: []
    };
  }

  function buildDiagnosticSnapshot(caseData = {}) {
    const appeal = normalize(caseData?.appeal);
    const type = typeForState(appeal);
    const coverage = contextCoverage(caseData);
    const value = fact => fact && typeof fact === 'object' && 'value' in fact ? fact.value : fact;
    const path = (appeal.history || []).map(item => ({
      nodeId: item.nodeId,
      question: item.question,
      answer: item.answer,
      answerId: item.answerId,
      source: item.source || 'operator',
      at: item.at
    }));
    const live = caseData?.live?.oltSnapshot || {};
    const evidence = [];
    if (String(live.status || '') === 'confirmed' || live.onuStatus) {
      evidence.push({
        kind: 'onu-status',
        source: 'live.oltSnapshot',
        observedAt: live.capturedAt || live.updatedAt || '',
        value: live.onuStatus || live.status || ''
      });
    }
    if (value(caseData?.network?.ip)) {
      evidence.push({
        kind: 'wan-ip',
        source: 'network.ip',
        observedAt: '',
        value: String(value(caseData.network.ip))
      });
    }
    const current = type?.nodes?.[appeal.nodeId] || null;
    return {
      caseId: caseData?.id || '',
      subscriber: {
        login: value(caseData?.identity?.login) || '',
        contract: value(caseData?.identity?.contract) || ''
      },
      symptom: type?.label || '',
      typeId: appeal.typeId || '',
      graphRevision: appeal.graphRevision || '',
      status: appeal.status || 'empty',
      currentNode: appeal.nodeId || '',
      startedAt: appeal.startedAt || '',
      updatedAt: appeal.updatedAt || '',
      path,
      evidence,
      confirmed: coverage.confirmed.map(item => ({ id: item.id, label: item.label, detail: item.detail })),
      excluded: coverage.conflicting.map(item => ({ id: item.id, label: item.label, detail: item.detail })),
      unresolved: [...coverage.missing, ...coverage.stale].map(item => ({
        id: item.id,
        label: item.label,
        status: item.status,
        detail: item.detail
      })),
      conflicts: coverage.conflicts?.length
        ? coverage.conflicts
        : compactCaseConflicts(caseData),
      outcome: current?.kind === 'outcome'
        ? { id: current.id, title: current.title, summary: current.summary, focus: current.focus }
        : null,
      localization: current?.kind === 'outcome' ? (current.focus || '') : ''
    };
  }

  function formatDiagnosticSummary(snapshot = {}) {
    const parts = [];
    if (snapshot.symptom) {
      const lastAnswer = snapshot.path?.length
        ? snapshot.path[snapshot.path.length - 1]?.answer
        : '';
      parts.push(
        lastAnswer
          ? `Абонент сообщает: «${snapshot.symptom}» (${lastAnswer}).`
          : `Абонент сообщает: «${snapshot.symptom}».`
      );
    }
    const confirmedLabels = (snapshot.confirmed || []).map(item => item.label);
    if (confirmedLabels.length) {
      parts.push(`Контекст подтверждён: ${confirmedLabels.join(', ')}.`);
    }
    const onu = (snapshot.evidence || []).find(item => item.kind === 'onu-status');
    if (onu?.value) {
      parts.push(`ONU: ${onu.value}.`);
    }
    const unresolved = (snapshot.unresolved || []).map(item => item.label);
    if (unresolved.length) {
      parts.push(`Не подтверждено: ${unresolved.join(', ')}.`);
    }
    if (snapshot.outcome?.title) {
      parts.push(`Итог: ${snapshot.outcome.title}.`);
      if (snapshot.outcome.summary) parts.push(snapshot.outcome.summary);
    } else if (snapshot.path?.length) {
      parts.push('Диагностика частичная — outcome ещё не достигнут.');
    }
    return parts.join(' ').trim();
  }

  const ready = readBundle().catch(error => {
    console.warn('[SIMNET Workbench] Appeals graph load failed', error);
    return studioBundle;
  });
  if (globalThis.chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[GRAPH_STORAGE_KEY]) return;
      applyBundle(changes[GRAPH_STORAGE_KEY].newValue, 'external-change');
    });
  }

  const studio = Object.freeze({
    storageKey: GRAPH_STORAGE_KEY,
    conditionFacts: CONDITION_FACTS,
    conditionOperators: [...CONDITION_OPERATORS],
    ready,
    validate: validateGraph,
    builtin() { return clone(builtinGraph); },
    current() { return clone(runtimeGraph); },
    bundle() { return clone(studioBundle); },
    async saveDraft(rawGraph) {
      const checked = validateGraph(rawGraph);
      const next = {
        ...studioBundle,
        draft: checked.graph,
        updatedAt: nowIso()
      };
      const bundle = await writeBundle(next, 'draft-save');
      return { ...checked, bundle };
    },
    async publish(rawGraph) {
      const checked = validateGraph(rawGraph);
      if (!checked.valid) return { ...checked, published: false, bundle: clone(studioBundle) };
      const at = nowIso();
      const published = normalizeGraph({
        ...checked.graph,
        revision: `graph_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        updatedAt: at,
        publishedAt: at
      });
      const history = [...(studioBundle.history || []), clone(published)].slice(-MAX_GRAPH_HISTORY);
      const bundle = await writeBundle({
        schemaVersion: 1,
        draft: clone(published),
        published,
        history,
        updatedAt: at
      }, 'publish');
      return { ...checked, graph: published, published: true, bundle };
    },
    async resetDraft() {
      return writeBundle({
        ...studioBundle,
        draft: clone(studioBundle.published),
        updatedAt: nowIso()
      }, 'draft-reset');
    },
    async restoreBuiltin() {
      return this.publish(clone(builtinGraph));
    }
  });

  WB.appeals = Object.freeze({
    get types() {
      return runtimeGraph.types.map(item => ({ id: item.id, label: item.label, short: item.short }));
    },
    type,
    typeForState,
    node,
    empty,
    normalize,
    select,
    answer,
    availableOptions,
    conditionMatches,
    back,
    phaseStates,
    caseSummary,
    contextCoverage,
    resolveRuntimeGraph,
    buildDiagnosticSnapshot,
    formatDiagnosticSummary,
    graphRevision() { return runtimeGraph.revision; },
    graphSnapshot() { return clone(runtimeGraph); },
    studio
  });
})();
