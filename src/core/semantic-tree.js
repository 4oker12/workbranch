(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.semanticTree) return;

  const MODEL = Object.freeze({
    schemaVersion: 1,
    revision: 'semantic-tree-2026-08-17-v1',
    rootId: 'case',
    title: 'SIMNET Workbench · смысловая карта',
    purpose: 'Что Workbench пытается выяснить, какая операция реализует следующий смысловой переход и каким evidence он подтверждается.',
    contexts: Object.freeze([
      { id: 'appeal', label: 'Симптом / обращение', summary: 'Что сообщил абонент и какой диагностический путь выбран.' },
      { id: 'session', label: 'Сессия / Juniper', summary: 'Есть ли сейчас доступ/сессия и что известно о BRAS.' },
      { id: 'access', label: 'Доступ / физический путь', summary: 'PON или Ethernet и какой технический источник нужен дальше.' },
      { id: 'location', label: 'Где найден абонент', summary: 'Источники физической привязки: Billing, ТМЦ, MAC, ONU/OLT, Switch.' },
      { id: 'evidence', label: 'Доказательства', summary: 'Что подтверждено, исключено, конфликтует или ещё требует источника.' },
      { id: 'operator', label: 'Операторский контекст', summary: 'Действия вокруг диагностики, которые не должны подменять сетевой evidence.' }
    ]),
    operations: Object.freeze({
      'appeal.route': {
        label: 'Вести маршрут обращения',
        ownerFiles: ['src/ui/appeals-navigator.js', 'src/graph/graph-studio.js'],
        successEvidence: ['case.appeal']
      },
      'juniper.inspect': {
        label: 'Проверить Juniper',
        ownerFiles: ['src/core/juniper-prefetch.js', 'src/ui/guide.js'],
        successEvidence: ['juniper read/parser result']
      },
      'technical.inspect': {
        label: 'Проверить техданные Billing',
        ownerFiles: ['src/adapters/billing-adapter.js', 'src/ui/guide.js'],
        successEvidence: ['billing_technical context + native target']
      },
      'tmc.inspect': {
        label: 'Показать ТМЦ',
        ownerFiles: ['src/core/handoff.js', 'src/ui/guide.js'],
        successEvidence: ['workbench teleport shown + viewport point highlights']
      },
      'tmc.writeback': {
        label: 'Перенести данные ТМЦ в Billing',
        ownerFiles: ['src/ui/rail.js', 'src/background.js'],
        successEvidence: ['tmcExpectedFields applied/matched + native Save verification when changed']
      },
      'onu.poll': {
        label: 'Опросить ONU/OLT',
        ownerFiles: ['src/core/billing-navigation.js', 'src/ui/guide.js', 'src/ui/poll-terminal.js'],
        successEvidence: ['native askolt response + confirmed poll evidence']
      },
      'mac.search': {
        label: 'Найти по MAC',
        ownerFiles: ['src/core/locator-policy.js', 'src/adapters/userside-adapter.js'],
        successEvidence: ['MAC_SEARCH_RESULT']
      },
      'ethernet.inspect': {
        label: 'Проверить Ethernet-путь',
        ownerFiles: ['src/core/locator-policy.js', 'src/ui/guide.js'],
        successEvidence: ['switch/port/FDB/link evidence']
      },
      'history.replay': {
        label: 'Показать уже пройденный источник',
        ownerFiles: ['src/core/evidence-navigator.js', 'src/ui/guide.js'],
        successEvidence: ['orientation only; diagnostic state unchanged']
      },
      'call.register': {
        label: 'Зарегистрировать звонок',
        ownerFiles: ['src/ui/call-registration.js', 'src/pbx/pbx-observer.js'],
        successEvidence: ['explicit call registration confirmation']
      }
    }),
    nodes: Object.freeze({
      case: { id: 'case', contextId: '', kind: 'root', label: 'Абонент / Case', summary: 'Единый контекст диагностируемого абонента. Все смысловые ветки сходятся в одном Case.' },

      'ctx.appeal': { id: 'ctx.appeal', contextId: 'appeal', kind: 'context', label: 'Что сообщил абонент?', summary: 'Симптом определяет маршрут вопросов, но не заменяет сетевые доказательства.' },
      'op.appeal.route': { id: 'op.appeal.route', contextId: 'appeal', kind: 'operation', label: 'Маршрут обращения', summary: 'Вопросы/ответы помогают уточнить симптом и рабочую гипотезу.', operationId: 'appeal.route' },

      'ctx.session': { id: 'ctx.session', contextId: 'session', kind: 'context', label: 'Есть ли сейчас сессия?', summary: 'Juniper даёт быстрый факт online/offline/reset/profile.' },
      'op.juniper.inspect': { id: 'op.juniper.inspect', contextId: 'session', kind: 'operation', label: 'Проверить Juniper', summary: 'Получить и интерпретировать текущую сессию.', operationId: 'juniper.inspect' },
      'fact.session.online': { id: 'fact.session.online', contextId: 'session', kind: 'fact', label: 'Сессия online', summary: 'Есть подтверждённая активная сессия.' },
      'fact.session.offline': { id: 'fact.session.offline', contextId: 'session', kind: 'fact', label: 'Сессии нет', summary: 'Требуется следующий технический источник.' },
      'fact.session.reset': { id: 'fact.session.reset', contextId: 'session', kind: 'fact', label: 'Сброс / смена состояния', summary: 'Причина сброса/профиль становятся evidence, а не самостоятельным диагнозом.' },

      'ctx.access': { id: 'ctx.access', contextId: 'access', kind: 'context', label: 'Как подключён абонент?', summary: 'Определяем PON или Ethernet и выбираем физический диагностический путь.' },
      'decision.connection': { id: 'decision.connection', contextId: 'access', kind: 'decision', label: 'Тип подключения', summary: 'Ветвление PON / Ethernet.' },
      'branch.pon': { id: 'branch.pon', contextId: 'access', kind: 'branch', label: 'PON', summary: 'ONU/OLT, техданные, ТМЦ и живой опрос.' },
      'op.technical.inspect': { id: 'op.technical.inspect', contextId: 'access', kind: 'operation', label: 'Проверить техданные', summary: 'Понять, какие PON-данные уже есть в Billing.', operationId: 'technical.inspect' },
      'decision.technical.ready': { id: 'decision.technical.ready', contextId: 'access', kind: 'decision', label: 'Техданных достаточно?', summary: 'Если данных достаточно — можно готовить живой опрос; если нет — нужен следующий источник.' },
      'op.tmc.inspect': { id: 'op.tmc.inspect', contextId: 'access', kind: 'operation', label: 'Показать ТМЦ', summary: 'Workbench сам телепортирует к реальному TMC-блоку и подсвечивает найденные значения.', operationId: 'tmc.inspect' },
      'fact.tmc.found': { id: 'fact.tmc.found', contextId: 'access', kind: 'fact', label: 'ТМЦ дала данные', summary: 'Используются только реально присутствующие в ТМЦ поля.' },
      'fact.tmc.insufficient': { id: 'fact.tmc.insufficient', contextId: 'access', kind: 'fact', label: 'ТМЦ недостаточно', summary: 'Отсутствующее в ТМЦ не считается ошибкой; выбирается следующий источник.' },
      'op.tmc.writeback': { id: 'op.tmc.writeback', contextId: 'access', kind: 'operation', label: 'Сверить / перенести в Billing', summary: 'Пустое заполняется, совпавшее не меняется, конфликт не перетирается молча.', operationId: 'tmc.writeback' },
      'gate.native-save': { id: 'gate.native-save', contextId: 'access', kind: 'gate', label: 'Штатный Save', summary: 'Если Workbench изменил Technical, маршрут к ONU закрыт до подтверждённого native Save.' },
      'fact.writeback.saved': { id: 'fact.writeback.saved', contextId: 'access', kind: 'fact', label: 'Сохранение подтверждено', summary: 'Новый Billing document подтвердил значения текущей TMC-транзакции.' },
      'fact.writeback.rejected': { id: 'fact.writeback.rejected', contextId: 'access', kind: 'fact', label: 'Сохранение отклонено / draft потерян', summary: 'ТМЦ остаётся пройденной; writeback остаётся незавершённым и может быть повторён.' },
      'fact.writeback.conflict': { id: 'fact.writeback.conflict', contextId: 'access', kind: 'fact', label: 'Конфликт данных', summary: 'Нужен операторский выбор; автоматическая перезапись запрещена.' },
      'op.mac.search': { id: 'op.mac.search', contextId: 'access', kind: 'operation', label: 'MAC fallback', summary: 'Последующий источник, если TMC не дала достаточной физической привязки.', operationId: 'mac.search' },
      'op.onu.poll': { id: 'op.onu.poll', contextId: 'access', kind: 'operation', label: 'Живой опрос ONU/OLT', summary: 'Переход к правильной технологии и ручному native «Запрос OLT».', operationId: 'onu.poll' },
      'fact.poll.confirmed': { id: 'fact.poll.confirmed', contextId: 'access', kind: 'fact', label: 'Опрос подтверждён', summary: 'Оборудование вернуло технический ответ; повторный CTA опроса больше не нужен.' },
      'fact.poll.failed': { id: 'fact.poll.failed', contextId: 'access', kind: 'fact', label: 'Ответ не подтверждён', summary: 'Timeout/wrong technology/no response не превращаются в ложный успех.' },
      'ctx.pon.analysis': { id: 'ctx.pon.analysis', contextId: 'access', kind: 'context', label: 'Что говорит PON?', summary: 'После подтверждённого опроса анализируются физические и сервисные признаки.' },
      'fact.pon.status': { id: 'fact.pon.status', contextId: 'access', kind: 'fact', label: 'Состояние ONU', summary: 'online/offline/config/match/history.' },
      'fact.pon.optics': { id: 'fact.pon.optics', contextId: 'access', kind: 'fact', label: 'Оптические уровни', summary: 'ONU Rx/Tx, OLT Rx, температура, расстояние.' },
      'fact.pon.client-link': { id: 'fact.pon.client-link', contextId: 'access', kind: 'fact', label: 'Клиентский Ethernet-link', summary: 'Link / speed / duplex на ONU.' },
      'fact.pon.learned-mac': { id: 'fact.pon.learned-mac', contextId: 'access', kind: 'fact', label: 'Изученный MAC', summary: 'MAC за ONU и его сопоставление с клиентом.' },
      'fact.pon.service': { id: 'fact.pon.service', contextId: 'access', kind: 'fact', label: 'Service-port / VLAN', summary: 'Сервисная привязка и состояние.' },
      'fact.pon.traffic': { id: 'fact.pon.traffic', contextId: 'access', kind: 'fact', label: 'Трафик', summary: 'Текущий обмен и дополнительные счётчики.' },

      'branch.ethernet': { id: 'branch.ethernet', contextId: 'access', kind: 'branch', label: 'Ethernet', summary: 'Абонент подключён витой парой, путь идёт к switch/port.' },
      'op.ethernet.inspect': { id: 'op.ethernet.inspect', contextId: 'access', kind: 'operation', label: 'Проверить Ethernet-путь', summary: 'Найти switch и последовательно проверить порт, FDB и ошибки.', operationId: 'ethernet.inspect' },
      'fact.eth.switch': { id: 'fact.eth.switch', contextId: 'access', kind: 'fact', label: 'Switch найден', summary: 'Определена точка подключения.' },
      'fact.eth.link': { id: 'fact.eth.link', contextId: 'access', kind: 'fact', label: 'Port / Link', summary: 'Физическое состояние абонентского порта.' },
      'fact.eth.fdb': { id: 'fact.eth.fdb', contextId: 'access', kind: 'fact', label: 'MAC / FDB', summary: 'Какие MAC изучены на порту.' },
      'fact.eth.errors': { id: 'fact.eth.errors', contextId: 'access', kind: 'fact', label: 'Ошибки порта', summary: 'CRC/discards/прочие счётчики.' },
      'fact.eth.uplink': { id: 'fact.eth.uplink', contextId: 'access', kind: 'fact', label: 'Uplink', summary: 'Следующая точка для локализации проблемы выше access-порта.' },

      'ctx.location': { id: 'ctx.location', contextId: 'location', kind: 'context', label: 'Где физически найден абонент?', summary: 'Разные источники дают разную силу физической привязки.' },
      'src.billing': { id: 'src.billing', contextId: 'location', kind: 'source', label: 'Billing', summary: 'Заявленная техническая привязка.' },
      'src.tmc': { id: 'src.tmc', contextId: 'location', kind: 'source', label: 'ТМЦ', summary: 'Склад/оборудование и найденная OLT/ONU identity.' },
      'src.mac': { id: 'src.mac', contextId: 'location', kind: 'source', label: 'MAC history/search', summary: 'Кандидат по истории оборудования.' },
      'src.onu': { id: 'src.onu', contextId: 'location', kind: 'source', label: 'ONU/OLT', summary: 'Текущий прямой ответ оборудования.' },
      'src.switch': { id: 'src.switch', contextId: 'location', kind: 'source', label: 'Switch', summary: 'Ethernet access point и порт.' },

      'ctx.evidence': { id: 'ctx.evidence', contextId: 'evidence', kind: 'context', label: 'Что уже доказано?', summary: 'Факты не равны действиям. Каждое состояние должно иметь evidence.' },
      'state.confirmed': { id: 'state.confirmed', contextId: 'evidence', kind: 'state', label: 'Подтверждено', summary: 'Есть достаточное evidence для данного факта.' },
      'state.excluded': { id: 'state.excluded', contextId: 'evidence', kind: 'state', label: 'Исключено', summary: 'Конкретная гипотеза отвергнута, но соседние гипотезы не запрещены.' },
      'state.conflict': { id: 'state.conflict', contextId: 'evidence', kind: 'state', label: 'Конфликт', summary: 'Источники расходятся; автоматическое решение запрещено.' },
      'state.next-source': { id: 'state.next-source', contextId: 'evidence', kind: 'state', label: 'Нужен следующий источник', summary: 'Текущего evidence недостаточно; semantic policy выбирает следующий шаг.' },

      'ctx.operator': { id: 'ctx.operator', contextId: 'operator', kind: 'context', label: 'Операторский контекст', summary: 'Действия оператора рядом с диагностикой, но не сетевые доказательства.' },
      'op.history.replay': { id: 'op.history.replay', contextId: 'operator', kind: 'operation', label: 'History Replay', summary: 'Повторно показать уже пройденный native target без изменения route/evidence.', operationId: 'history.replay' },
      'op.call.register': { id: 'op.call.register', contextId: 'operator', kind: 'operation', label: 'Регистрация звонка', summary: 'Привязать подтверждённый звонок к текущему Case/абоненту.', operationId: 'call.register' }
    }),
    edges: Object.freeze([
      { from: 'case', to: 'ctx.appeal', label: 'симптом' },
      { from: 'case', to: 'ctx.session', label: 'сессия' },
      { from: 'case', to: 'ctx.access', label: 'доступ' },
      { from: 'case', to: 'ctx.location', label: 'локализация' },
      { from: 'case', to: 'ctx.evidence', label: 'evidence' },
      { from: 'case', to: 'ctx.operator', label: 'оператор' },

      { from: 'ctx.appeal', to: 'op.appeal.route', label: 'уточнить', operationId: 'appeal.route' },

      { from: 'ctx.session', to: 'op.juniper.inspect', label: 'проверить', operationId: 'juniper.inspect' },
      { from: 'op.juniper.inspect', to: 'fact.session.online', label: 'online', condition: 'session present' },
      { from: 'op.juniper.inspect', to: 'fact.session.offline', label: 'offline', condition: 'session absent' },
      { from: 'op.juniper.inspect', to: 'fact.session.reset', label: 'история/причина', condition: 'reset/profile evidence' },

      { from: 'ctx.access', to: 'decision.connection', label: 'классифицировать' },
      { from: 'decision.connection', to: 'branch.pon', label: 'PON', condition: 'connectionFamily=PON' },
      { from: 'decision.connection', to: 'branch.ethernet', label: 'Ethernet', condition: 'connectionFamily=ETHERNET' },

      { from: 'branch.pon', to: 'op.technical.inspect', label: 'сначала', operationId: 'technical.inspect' },
      { from: 'op.technical.inspect', to: 'decision.technical.ready', label: 'результат' },
      { from: 'decision.technical.ready', to: 'op.onu.poll', label: 'данных достаточно', condition: 'poll prerequisites satisfied', operationId: 'onu.poll' },
      { from: 'decision.technical.ready', to: 'op.tmc.inspect', label: 'не хватает данных', condition: 'TMC required', operationId: 'tmc.inspect' },
      { from: 'op.tmc.inspect', to: 'fact.tmc.found', label: 'нашли', condition: 'teleport + point highlights confirmed' },
      { from: 'op.tmc.inspect', to: 'fact.tmc.insufficient', label: 'нет/недостаточно', condition: 'no usable TMC values' },
      { from: 'fact.tmc.found', to: 'op.tmc.writeback', label: 'сверить', operationId: 'tmc.writeback' },
      { from: 'op.tmc.writeback', to: 'gate.native-save', label: 'изменения есть', condition: 'fields applied' },
      { from: 'op.tmc.writeback', to: 'fact.writeback.saved', label: 'ничего менять не надо', condition: 'all expected fields already matched' },
      { from: 'op.tmc.writeback', to: 'fact.writeback.conflict', label: 'конфликт', condition: 'current value differs' },
      { from: 'gate.native-save', to: 'fact.writeback.saved', label: 'Save подтверждён', condition: 'new document verifies expected fields' },
      { from: 'gate.native-save', to: 'fact.writeback.rejected', label: 'отказ/уход', condition: 'operator rejects or draft disappears' },
      { from: 'fact.writeback.rejected', to: 'op.tmc.writeback', label: 'повторить writeback', operationId: 'tmc.writeback' },
      { from: 'fact.writeback.saved', to: 'op.onu.poll', label: 'можно опрашивать', operationId: 'onu.poll' },
      { from: 'fact.tmc.insufficient', to: 'op.mac.search', label: 'fallback', operationId: 'mac.search' },
      { from: 'op.mac.search', to: 'op.onu.poll', label: 'кандидат подтверждён', condition: 'poll candidate available', operationId: 'onu.poll' },
      { from: 'op.onu.poll', to: 'fact.poll.confirmed', label: 'ответ', condition: 'terminal response confirmed' },
      { from: 'op.onu.poll', to: 'fact.poll.failed', label: 'нет подтверждения', condition: 'timeout/wrong tab/no response' },
      { from: 'fact.poll.confirmed', to: 'ctx.pon.analysis', label: 'анализировать' },
      { from: 'ctx.pon.analysis', to: 'fact.pon.status', label: 'ONU' },
      { from: 'ctx.pon.analysis', to: 'fact.pon.optics', label: 'оптика' },
      { from: 'ctx.pon.analysis', to: 'fact.pon.client-link', label: 'LAN' },
      { from: 'ctx.pon.analysis', to: 'fact.pon.learned-mac', label: 'MAC' },
      { from: 'ctx.pon.analysis', to: 'fact.pon.service', label: 'VLAN' },
      { from: 'ctx.pon.analysis', to: 'fact.pon.traffic', label: 'traffic' },

      { from: 'branch.ethernet', to: 'op.ethernet.inspect', label: 'проверить', operationId: 'ethernet.inspect' },
      { from: 'op.ethernet.inspect', to: 'fact.eth.switch', label: 'точка' },
      { from: 'op.ethernet.inspect', to: 'fact.eth.link', label: 'link' },
      { from: 'op.ethernet.inspect', to: 'fact.eth.fdb', label: 'FDB' },
      { from: 'op.ethernet.inspect', to: 'fact.eth.errors', label: 'errors' },
      { from: 'op.ethernet.inspect', to: 'fact.eth.uplink', label: 'выше' },

      { from: 'ctx.location', to: 'src.billing', label: 'заявлено' },
      { from: 'ctx.location', to: 'src.tmc', label: 'склад/OLT' },
      { from: 'ctx.location', to: 'src.mac', label: 'история' },
      { from: 'ctx.location', to: 'src.onu', label: 'прямой poll' },
      { from: 'ctx.location', to: 'src.switch', label: 'Ethernet' },

      { from: 'ctx.evidence', to: 'state.confirmed', label: 'доказано' },
      { from: 'ctx.evidence', to: 'state.excluded', label: 'отвергнуто' },
      { from: 'ctx.evidence', to: 'state.conflict', label: 'расхождение' },
      { from: 'ctx.evidence', to: 'state.next-source', label: 'недостаточно' },

      { from: 'ctx.operator', to: 'op.history.replay', label: 'ориентация', operationId: 'history.replay' },
      { from: 'ctx.operator', to: 'op.call.register', label: 'звонок', operationId: 'call.register' }
    ]),
    placementRules: Object.freeze([
      'Новый функционал не может существовать без semantic placement.',
      'Новая операция должна быть зарегистрирована в operations и привязана минимум к одному узлу/ребру.',
      'Если существующий контекст не подходит — сначала создаётся новый semantic context и связь с Case.',
      'Парсер/evidence не равен прогрессу операции: факт обнаружения и факт выполненного действия хранятся раздельно.',
      'Operation state machine отвечает как выполнить ребро; Semantic Tree отвечает зачем это ребро нужно.',
      'History/Replay не меняет канонический диагностический смысловой прогресс.'
    ])
  });

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function validate(model = MODEL) {
    const errors = [];
    const warnings = [];
    const nodes = model?.nodes || {};
    const edges = Array.isArray(model?.edges) ? model.edges : [];
    const operations = model?.operations || {};
    const contexts = Array.isArray(model?.contexts) ? model.contexts : [];
    const contextIds = new Set(contexts.map(item => String(item?.id || '')).filter(Boolean));

    if (!model?.rootId || !nodes[model.rootId]) errors.push('semantic root is missing');

    for (const [key, node] of Object.entries(nodes)) {
      if (!node?.id || node.id !== key) errors.push(`node id mismatch: ${key}`);
      if (node?.contextId && !contextIds.has(node.contextId)) errors.push(`unknown context ${node.contextId} for ${key}`);
      if (node?.operationId && !operations[node.operationId]) errors.push(`unknown operation ${node.operationId} for ${key}`);
    }

    const boundOperations = new Set();
    const adjacency = new Map();
    for (const edge of edges) {
      if (!nodes[edge?.from]) errors.push(`edge source missing: ${edge?.from}`);
      if (!nodes[edge?.to]) errors.push(`edge target missing: ${edge?.to}`);
      if (edge?.operationId) {
        if (!operations[edge.operationId]) errors.push(`edge operation missing: ${edge.operationId}`);
        else boundOperations.add(edge.operationId);
      }
      if (nodes[edge?.from] && nodes[edge?.to]) {
        if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
        adjacency.get(edge.from).push(edge.to);
      }
    }
    for (const node of Object.values(nodes)) if (node?.operationId) boundOperations.add(node.operationId);
    for (const operationId of Object.keys(operations)) {
      if (!boundOperations.has(operationId)) errors.push(`orphan operation: ${operationId}`);
    }

    if (model?.rootId && nodes[model.rootId]) {
      const reached = new Set([model.rootId]);
      const queue = [model.rootId];
      while (queue.length) {
        const from = queue.shift();
        for (const to of adjacency.get(from) || []) {
          if (reached.has(to)) continue;
          reached.add(to);
          queue.push(to);
        }
      }
      for (const nodeId of Object.keys(nodes)) {
        if (!reached.has(nodeId)) errors.push(`orphan semantic node: ${nodeId}`);
      }
    }

    const ids = contexts.map(item => item.id);
    if (new Set(ids).size !== ids.length) errors.push('duplicate semantic context id');
    if (!contexts.length) warnings.push('semantic contexts are empty');

    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), warnings: Object.freeze(warnings) });
  }

  function snapshot() {
    return clone(MODEL);
  }

  function context(contextId) {
    return clone(MODEL.contexts.find(item => item.id === contextId) || null);
  }

  function node(nodeId) {
    return clone(MODEL.nodes[nodeId] || null);
  }

  function operation(operationId) {
    return clone(MODEL.operations[operationId] || null);
  }

  function subgraph(contextId = '') {
    const nodes = MODEL.nodes;
    if (!contextId) return snapshot();
    const contextRootId = `ctx.${contextId}`;
    if (!nodes[contextRootId]) return { ...snapshot(), nodes: {}, edges: [] };
    const allowed = new Set([MODEL.rootId, contextRootId]);
    const queue = [contextRootId];
    while (queue.length) {
      const from = queue.shift();
      for (const edge of MODEL.edges) {
        if (edge.from !== from || allowed.has(edge.to)) continue;
        const target = nodes[edge.to];
        if (!target || (target.contextId && target.contextId !== contextId)) continue;
        allowed.add(edge.to);
        queue.push(edge.to);
      }
    }
    const filteredNodes = {};
    for (const id of allowed) filteredNodes[id] = clone(nodes[id]);
    return {
      ...snapshot(),
      nodes: filteredNodes,
      edges: MODEL.edges.filter(edge => allowed.has(edge.from) && allowed.has(edge.to)).map(clone)
    };
  }

  const report = validate(MODEL);
  if (!report.valid) {
    void WB.observability?.report?.({
      severity: 'ERROR',
      code: 'SEMANTIC_TREE_INVALID',
      operationType: 'SEMANTIC_TREE',
      source: 'semantic-tree',
      stage: 'INIT',
      message: report.errors.join('; ')
    });
  }

  WB.semanticTree = Object.freeze({
    schemaVersion: MODEL.schemaVersion,
    revision: MODEL.revision,
    rootId: MODEL.rootId,
    placementRules: clone(MODEL.placementRules),
    snapshot,
    subgraph,
    context,
    node,
    operation,
    validate: () => validate(MODEL)
  });
})();
