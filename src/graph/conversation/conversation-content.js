(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.conversationGraphContent) return;

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  const TOPICS = Object.freeze([
    Object.freeze({
      id: 'low_speed',
      label: 'Медленная скорость',
      icon: 'speed',
      complaint: 'Медленная\nскорость',
      subtitle: 'Суть жалобы',
      variants: Object.freeze([
        'Интернет тупит',
        'Очень медленно грузит',
        'Видео зависает',
        'Сайты долго открываются',
        'На ноутбуке тоже медленно',
        'На телефоне не работает',
        'Постоянно крутит загрузку',
        'Wi‑Fi есть, интернета нет'
      ]),
      questions: Object.freeze([
        'Когда заметили, что скорость стала медленной?',
        'На всех устройствах так же или только на одном?',
        'Это постоянно или случается в определённое время?',
        'Какие сервисы тормозят: сайты, видео, игры?',
        'После перезагрузки роутера что-то меняется?'
      ]),
      meaning: Object.freeze([
        'Уточняем контекст и масштаб проблемы.',
        'Отделяем общую проблему от устройства, Wi‑Fi или конкретного сервиса.',
        'Собираем признаки для дальнейшей проверки без преждевременного вывода.'
      ])
    }),
    Object.freeze({
      id: 'no_internet',
      label: 'Нет интернета',
      icon: 'globe-off',
      complaint: 'Нет\nинтернета',
      subtitle: 'Суть жалобы',
      variants: Object.freeze([
        'Вообще ничего не открывается',
        'Wi‑Fi есть, интернета нет',
        'Подключено, но без сети',
        'На телефоне не работает',
        'На ноутбуке тоже нет',
        'Сайты не открываются',
        'После перезагрузки не помогло',
        'Только дома не работает'
      ]),
      questions: Object.freeze([
        'Интернета нет на всех устройствах или только на одном?',
        'Wi‑Fi подключён или устройство вообще не подключается к сети?',
        'Через мобильный интернет те же сайты открываются?',
        'После перезагрузки роутера что-то меняется?',
        'Проблема появилась только сейчас или уже была раньше?'
      ]),
      meaning: Object.freeze([
        'Отделяем общий обрыв от локальной проблемы одного устройства.',
        'Разделяем отсутствие Wi‑Fi-подключения и отсутствие самого интернет-доступа.',
        'Получаем факты, с которыми оператор уже может переходить к технической проверке.'
      ])
    }),
    Object.freeze({
      id: 'unstable',
      label: 'Пропадает',
      icon: 'unstable',
      complaint: 'Интернет\nпропадает',
      subtitle: 'Суть жалобы',
      variants: Object.freeze([
        'То есть, то нет',
        'Каждые несколько минут пропадает',
        'Wi‑Fi отваливается',
        'Видео периодически зависает',
        'После перезагрузки временно лучше',
        'Вечером чаще',
        'На всех устройствах одновременно',
        'Только телефон теряет сеть'
      ]),
      questions: Object.freeze([
        'Когда пропадает — на всех устройствах одновременно или только на одном?',
        'Пропадает именно Wi‑Fi или Wi‑Fi остаётся, но интернет перестаёт работать?',
        'Можно назвать примерное время последнего обрыва?',
        'В этот момент индикаторы на роутере меняются?',
        'Есть закономерность: время суток, нагрузка, расстояние от роутера?'
      ]),
      meaning: Object.freeze([
        'Понимаем, общий это обрыв или локальный симптом.',
        'Отделяем потерю Wi‑Fi от потери доступа в интернет.',
        'Получаем время и повторяемость — полезные признаки для журналов и линии.'
      ])
    }),
    Object.freeze({
      id: 'other',
      label: 'Другое',
      icon: 'more',
      complaint: 'Другая\nжалоба',
      subtitle: 'Сначала формулируем суть',
      variants: Object.freeze([
        'Не открывается один сайт',
        'Не работает только приложение',
        'Игры лагают',
        'Видео не запускается',
        'VPN не подключается',
        'Проблема только по Wi‑Fi',
        'После смены устройства всё нормально',
        'Не могу нормально объяснить'
      ]),
      questions: Object.freeze([
        'Что именно не получается сделать — открыть сайт, приложение, видео или подключиться?',
        'Это происходит на одном устройстве или повторяется на других?',
        'Остальной интернет в этот момент работает?',
        'Через другую сеть или мобильный интернет проблема повторяется?',
        'Когда это началось и что менялось перед появлением проблемы?'
      ]),
      meaning: Object.freeze([
        'Переводим свободное описание абонента в понятную тему обращения.',
        'Понимаем масштаб и границы симптома.',
        'Не подменяем разговор автоматической диагностикой: оператор сам решает, что проверять дальше.'
      ])
    })
  ]);

  const TOPIC_BY_ID = new Map(TOPICS.map(item => [item.id, item]));

  function normalizeTopicId(value) {
    const id = String(value || '').trim();
    return TOPIC_BY_ID.has(id) ? id : 'low_speed';
  }

  function topic(value) {
    return clone(TOPIC_BY_ID.get(normalizeTopicId(value)) || TOPICS[0]);
  }

  function topics() {
    return TOPICS.map(clone);
  }

  // Compatibility surface for modules/tests that still ask the old presentation API.
  function presentNode(node) {
    return node ? clone(node) : null;
  }

  function presentOption(_nodeId, option) {
    return option ? { ...clone(option), tier: 'alternative' } : null;
  }

  function helperCards(_node, typeId = '') {
    const selected = topic(typeId);
    return selected.questions.slice(0, 5).map((text, index) => ({
      id: `question-${index + 1}`,
      title: index === 0 ? 'Что спросить' : `Уточнение ${index + 1}`,
      icon: 'chat',
      text
    }));
  }

  function symptomLabel(type) {
    const id = typeof type === 'string' ? type : type?.id;
    return topic(id).label;
  }

  WB.conversationGraphContent = Object.freeze({
    revision: 'operator-guide-tabs-v2',
    defaultTopicId: 'low_speed',
    topic,
    topics,
    normalizeTopicId,
    presentNode,
    presentOption,
    helperCards,
    symptomLabel,
    skipOption: () => null,
    edgeTier: () => 'alternative'
  });
})();
