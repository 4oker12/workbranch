(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.conversationGraphContent) return;

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  const SLOW_COPY = Object.freeze({
    'low.scope': {
      title: 'На одном устройстве или на всех?',
      why: 'Сначала поймём масштаб: проблема только у одного устройства или вообще дома.',
      ask: 'Скажите, пожалуйста: плохо работает только на одном устройстве или на всех, где вы пробовали?'
    },
    'low.compare': {
      title: 'Можно быстро проверить на втором устройстве?',
      why: 'Одно короткое сравнение часто сразу показывает: проблема локальная или общая.',
      ask: 'Если рядом есть ещё телефон или ноутбук — там тоже всё медленно?'
    },
    'low.medium.one': {
      title: 'Это устройство подключено по Wi‑Fi или кабелем?',
      why: 'Wi‑Fi и кабель — разные участки. Сначала определим, где именно искать.',
      ask: 'Устройство сейчас подключено к Wi‑Fi или к роутеру проводом?'
    },
    'low.medium.all': {
      title: 'Плохо только по Wi‑Fi или по кабелю тоже?',
      why: 'Если проблема повторяется и по кабелю, домашний Wi‑Fi уже не единственный подозреваемый.',
      ask: 'Если есть устройство с проводом: там тоже медленно или проблема только по Wi‑Fi?'
    },
    'low.medium.identify': {
      title: 'Как понять, чем подключено устройство?',
      why: 'Не требуем от абонента терминов — достаточно увидеть значок Wi‑Fi или сетевой кабель.',
      ask: 'На экране есть значок Wi‑Fi? Или к устройству физически подключён провод от роутера?'
    },
    'low.wifi.band': {
      title: 'К какой Wi‑Fi сети сейчас подключено устройство?',
      why: 'Нужно отличить обычную сеть 2.4 ГГц от 5 ГГц, не превращая разговор в лекцию про частоты.',
      ask: 'В названии сети, к которой вы сейчас подключены, есть “5G” или “5GHz”?'
    },
    'low.wifi5.conditions': {
      title: 'Если подойти ближе к роутеру — становится лучше?',
      why: 'Это простой способ отделить покрытие Wi‑Fi от проблемы самого интернет-канала.',
      ask: 'Если стать с телефоном рядом с роутером и повторить то же действие — работает заметно лучше?'
    },
    'low.wifi.unknown': {
      title: 'Можно сравнить Wi‑Fi рядом с роутером?',
      why: 'Если абонент не знает диапазон, не спорим с терминами — делаем понятное сравнение по месту.',
      ask: 'Подойдите, пожалуйста, поближе к роутеру. Там интернет тоже медленный или становится лучше?',
      level: 'secondary'
    },
    'low.cable.link': {
      title: 'Если абонент справится: проверим подключение по кабелю',
      why: 'Это уже расширенная проверка. Не делаем её обязательной для каждого звонка.',
      ask: 'Если это удобно: можно посмотреть, с какой скоростью компьютер подключился к роутеру по кабелю.',
      level: 'advanced'
    },
    'low.direct': {
      title: 'Если возможно: сделаем один контрольный замер',
      why: 'Контрольный тест нужен только когда человек может нормально его выполнить. Один speedtest — это снимок момента, а не доказательство качества за весь день.',
      ask: 'Если вам удобно, сделаем один короткий тест сейчас, чтобы сравнить условия.',
      level: 'advanced'
    },
    'low.session': {
      title: 'Проверка со стороны оператора: что видно по сессии?',
      why: 'Это уже технический шаг оператора, а не вопрос, который нужно заставлять понимать абонента.',
      ask: 'Абоненту здесь ничего объяснять не нужно — сверяем данные со своей стороны.',
      level: 'operator'
    }
  });

  const OPTION_COPY = Object.freeze({
    'low.scope': {
      all: 'На всех',
      one: 'На одном',
      unknown: 'Не проверяли'
    },
    'low.compare': {
      yes: 'Да, тоже',
      no: 'Нет, там нормально',
      cant: 'Сравнить не получается'
    },
    'low.medium.one': {
      wifi: 'Wi‑Fi',
      cable: 'Кабель',
      unknown: 'Не знает'
    },
    'low.medium.all': {
      both: 'И Wi‑Fi, и кабель',
      wifi: 'Только Wi‑Fi',
      cable: 'Только кабель'
    },
    'low.medium.identify': {
      wifi: 'Есть значок Wi‑Fi',
      cable: 'Подключён кабель',
      still_unknown: 'Не получается понять'
    },
    'low.wifi.band': {
      '24': 'Обычная / 2.4',
      '5': 'Сеть с 5G',
      unknown: 'Не уверен'
    },
    'low.wifi5.conditions': {
      yes: 'Да, становится лучше',
      no: 'Нет, так же',
      unstable: 'То лучше, то хуже'
    },
    'low.wifi.unknown': {
      normal: 'Рядом стало нормально',
      low: 'Рядом тоже медленно',
      cant: 'Проверить не получается'
    }
  });

  const HELPERS = Object.freeze({
    'wifi-bands': {
      id: 'wifi-bands',
      title: '5G / 2.4',
      icon: 'wifi',
      text: 'Не проси человека объяснять частоты. Проще спросить по названию сети: есть ли отдельная сеть с “5G” и к какой он подключён.'
    },
    'smart-connect': {
      id: 'smart-connect',
      title: 'Smart Connect',
      icon: 'branch',
      text: 'Если у роутера одна общая Wi‑Fi сеть, устройство может само переходить между 2.4 и 5 ГГц. Это полезная гипотеза при плавающей скорости.'
    },
    poe: {
      id: 'poe',
      title: 'PoE / «зажигалочка»',
      icon: 'plug',
      text: 'Если нужно найти PoE-инжектор: “небольшая коробочка, примерно как крупная зажигалочка, в неё входят два сетевых провода”.'
    },
    router: {
      id: 'router',
      title: 'Роутер: как найти модель',
      icon: 'router',
      text: 'Попроси посмотреть наклейку снизу или сзади корпуса. Модель полезнее, чем попытка абонента описать настройки словами.'
    },
    'speed-test': {
      id: 'speed-test',
      title: 'Speedtest — только снимок',
      icon: 'speed',
      text: 'Замер во время звонка полезен для сравнения условий, но не доказывает, что происходило час назад или будет происходить позже.'
    }
  });

  const ADVANCED_TARGETS = new Set([
    'low.direct',
    'low.cable.link',
    'low.session'
  ]);

  function presentNode(node, typeId = '') {
    if (!node) return null;
    const copy = typeId === 'low_speed' ? SLOW_COPY[node.id] : null;
    return {
      ...clone(node),
      title: copy?.title || node.title || '',
      why: copy?.why || node.why || node.summary || '',
      ask: copy?.ask || node.why || node.summary || '',
      level: copy?.level || (node.kind === 'outcome' ? 'outcome' : 'primary')
    };
  }

  function presentOption(nodeId, option, typeId = '') {
    if (!option) return null;
    const copy = typeId === 'low_speed' ? OPTION_COPY[nodeId]?.[option.id] : '';
    return {
      ...clone(option),
      label: copy || option.label || '',
      tier: edgeTier(nodeId, option, typeId)
    };
  }

  function edgeTier(nodeId, option, typeId = '') {
    if (!option) return 'alternative';
    const id = String(option.id || '').toLowerCase();
    const next = String(option.next || '');
    if (typeId === 'low_speed' && ADVANCED_TARGETS.has(next)) return 'rare';
    if (/cant|unknown|still_unknown|not.?checked|unsure/.test(id)) return 'alternative';
    return 'alternative';
  }

  function helperCards(node, typeId = '') {
    const current = presentNode(node, typeId);
    const dynamic = {
      id: 'ask-simple',
      title: 'Как спросить проще',
      icon: 'chat',
      text: current?.ask || 'Сначала уточни наблюдаемый симптом простыми словами, без технических терминов.'
    };
    const nodeId = String(node?.id || '');
    const cards = [dynamic];

    if (typeId === 'low_speed') {
      if (/wifi/.test(nodeId)) cards.push(HELPERS['wifi-bands'], HELPERS['smart-connect']);
      if (/direct|speed|session|cable/.test(nodeId)) cards.push(HELPERS['speed-test']);
      cards.push(HELPERS.router, HELPERS.poe);
      if (!cards.some(item => item?.id === 'wifi-bands')) cards.push(HELPERS['wifi-bands']);
      if (!cards.some(item => item?.id === 'smart-connect')) cards.push(HELPERS['smart-connect']);
    } else {
      cards.push(HELPERS['wifi-bands'], HELPERS['smart-connect'], HELPERS.router, HELPERS.poe);
    }

    const unique = [];
    const seen = new Set();
    for (const card of cards) {
      if (!card || seen.has(card.id)) continue;
      seen.add(card.id);
      unique.push(clone(card));
    }
    return unique.slice(0, 5);
  }

  function symptomLabel(type) {
    if (!type) return '';
    return type.id === 'low_speed' ? 'Плохо / медленно работает интернет' : type.label || type.id;
  }

  function skipOption(options = []) {
    return options.find(item => {
      const id = String(item?.id || '').toLowerCase();
      const label = String(item?.label || '').toLowerCase();
      return /cant|unknown|still_unknown|not.?checked|unsure/.test(id)
        || /не знаю|не уверен|не провер|не получается|неясно/.test(label);
    }) || null;
  }

  WB.conversationGraphContent = Object.freeze({
    revision: 'conversation-presentation-v1',
    presentNode,
    presentOption,
    helperCards,
    symptomLabel,
    skipOption,
    edgeTier
  });
})();
