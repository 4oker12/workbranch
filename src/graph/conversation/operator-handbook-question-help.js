(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.__operatorHandbookQuestionHelpLoaded) return;
  WB.__operatorHandbookQuestionHelpLoaded = true;

  const HOST_ID = 'simnet-graph-studio-host';
  const STYLE_ID = 'simnet-operator-handbook-question-help-style';
  let panel = null;
  let panelClickHandler = null;
  let panelInputHandler = null;
  let unsubscribeStore = null;
  let frame = 0;

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const normalize = value => String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

  function explanation(question) {
    const q = normalize(question);

    if (/в чем именно|что именно происходит|как прояв/.test(q)) {
      return {
        why: 'Переводим расплывчатое «плохо работает» в наблюдаемый симптом. Без этого невозможно понять, что вообще сравнивать дальше.',
        result: 'Видео с загрузкой, задержка в игре, один сайт и полная потеря доступа — это разные направления проверки.',
        simple: 'Не проси терминов: «Что вы прямо сейчас видите на экране — крутится загрузка, не открывается, выбрасывает или просто долго ждёте?»'
      };
    }
    if (/на каком устройстве/.test(q)) {
      return {
        why: 'Локализуем место проявления. Один телефон и весь дом — принципиально разные ситуации.',
        result: 'Если проблема только на одном устройстве, сначала сравниваем его с другим. Если на нескольких — расширяем проверку до Wi‑Fi, роутера или линии.',
        simple: 'Если человек теряется: «Это телефон, телевизор, ноутбук или компьютер?»'
      };
    }
    if (/другом устройстве|еще один телефон|втор(ом|ое) устрой|планшет или ноутбук|телефон в этот же момент/.test(q)) {
      return {
        why: 'Получаем контрольное сравнение в тех же условиях. Это один из самых быстрых способов отделить устройство от общей проблемы.',
        result: 'Второе устройство работает нормально → копаем первое. Повторяет симптом → смотрим общий участок: Wi‑Fi, роутер, доступ.',
        simple: 'Подойдёт любое второе устройство. Не надо ничего настраивать — достаточно открыть обычный сайт или видео.'
      };
    }
    if (/постоянно или временами|как часто|через сколько|само восстанавливается/.test(q)) {
      return {
        why: 'Понимаем характер проблемы: постоянная она или возникает эпизодами.',
        result: 'Краткие повторяющиеся обрывы требуют искать событие во времени; постоянный симптом можно проверять сразу и воспроизводимо.',
        simple: '«Это всё время так или бывают промежутки, когда всё работает нормально?»'
      };
    }
    if (/вечер|времени|когда это чаще/.test(q)) {
      return {
        why: 'Ищем временную закономерность, чтобы потом сопоставить жалобу с нагрузкой, Wi‑Fi-условиями или сетевыми событиями.',
        result: 'Чёткая привязка ко времени усиливает гипотезу, но сама по себе ещё не доказывает причину.',
        simple: '«Утром и днём так же, или заметнее именно вечером?»'
      };
    }
    if (/после перезагрузки|перезапуск/.test(q)) {
      return {
        why: 'Проверяем, меняется ли состояние после сброса временного состояния роутера.',
        result: 'Если после reboot временно лучше — это сильная подсказка в сторону роутера/Wi‑Fi или его состояния, но не готовый диагноз.',
        simple: 'Не надо доказывать человеку «роутер виноват». Скажи: «Это полезная подсказка; проверим ещё один момент, чтобы не гадать.»'
      };
    }
    if (/как называется.*wi|название.*сети|сеть, к которой|ssid|возле которой.*подключено/.test(q)) {
      return {
        why: 'Определяем фактическую Wi‑Fi сеть без разговора о частотах и сложных настройках.',
        result: 'По названию можно понять, к какой сети подключён клиент, и подготовить простое сравнение с другой сетью роутера.',
        simple: '«Откройте Настройки → Wi‑Fi и просто прочитайте название, возле которого написано “Подключено”.» Никаких DNS и командной строки.'
      };
    }
    if (/5g|5ghz|5 ггц|2\.4|2,4/.test(q)) {
      return {
        why: 'Ищем доступную альтернативную Wi‑Fi сеть для простого сравнительного теста.',
        result: 'Разница между двумя сетями одного роутера помогает локализовать именно беспроводные условия.',
        simple: 'Не объясняй частоты. Спроси: «Рядом есть почти такое же название сети, только с 5G в конце?»'
      };
    }
    if (/подойти ближе|рядом с роутером/.test(q)) {
      return {
        why: 'Проверяем влияние расстояния и покрытия Wi‑Fi без специальных приложений и измерений.',
        result: 'Рядом с роутером заметно лучше → усиливается версия покрытия/помех. Без изменений → ищем дальше.',
        simple: 'Для нетехнического абонента это лучше любых Wi‑Fi-анализаторов: просто подойти с телефоном к роутеру и повторить то же действие.'
      };
    }
    if (/wi.?fi или кабел|по wi.?fi или по кабел|подключен.*кабел|устройство подключено/.test(q)) {
      return {
        why: 'Разделяем беспроводной участок и проводное подключение.',
        result: 'Только Wi‑Fi → сначала беспроводная часть. Одинаково по кабелю и Wi‑Fi → подозрение смещается к общему доступу/роутеру/линии.',
        simple: 'Не заставляй искать сетевые параметры: достаточно понять, идёт ли к устройству физический сетевой кабель.'
      };
    }
    if (/если есть устройство по кабелю|по кабелю.*такая же/.test(q)) {
      return {
        why: 'Получаем контрольный тест, который обходит Wi‑Fi.',
        result: 'Кабель нормально, Wi‑Fi плохо → линия сама по себе не главный подозреваемый. Одинаково плохо → проверяем общий участок.',
        simple: 'Предлагай только если это реально просто. Не превращай звонок в монтаж кабеля ради одного теста.'
      };
    }
    if (/vpn|private dns|adguard|прокси|ускорител/.test(q)) {
      return {
        why: 'Исключаем локальный посредник, который может менять маршрут, DNS или доступ только на конкретном устройстве.',
        result: 'После отключения симптом исчез → проблема локальная/программная. Не изменилось → возвращаемся к обычной диагностике.',
        simple: 'Если человек не знает, что это такое, не веди его в DNS, CMD или сложные меню. Просто уточни, не включён ли знакомый VPN/AdGuard; если нет — пропусти.'
      };
    }
    if (/другом приложении|другой браузер|другом браузере|конкретный сервис|любое видео|в одной конкретной|во всех играх|другая игра|сайты и видео/.test(q)) {
      return {
        why: 'Отделяем проблему конкретного приложения/сервиса от самого интернет-доступа.',
        result: 'Один сервис не работает, остальные работают → не объявляем неисправной всю линию. Повторяется в разных сервисах → расширяем проверку.',
        simple: 'Самый простой тест: открыть что-то привычное другое — другой сайт, YouTube или второе приложение.'
      };
    }
    if (/значок wi.?fi|без доступа к интернету|wi.?fi сеть пропала|что именно пропадает/.test(q)) {
      return {
        why: 'Разделяем две разные вещи: устройство потеряло сам Wi‑Fi или Wi‑Fi остался, но пропал внешний интернет.',
        result: 'Исчезает сеть/значок → локальный Wi‑Fi. Сеть остаётся, но доступа нет → проверяем роутер, сессию и линию.',
        simple: '«Название вашей Wi‑Fi сети остаётся на телефоне или вообще исчезает?»'
      };
    }
    if (/модель роутера|какой.*роутер/.test(q)) {
      return {
        why: 'Модель нужна только когда от неё зависит следующая понятная инструкция: сети 2.4/5G, Smart Connect, расположение настроек.',
        result: 'Зная модель, можно дать точную короткую инструкцию вместо гадания по чужому интерфейсу.',
        simple: '«Посмотрите снизу или сзади корпуса наклейку. Нужна только строка Model / Model No.»'
      };
    }

    return {
      why: 'Этот вопрос нужен не ради анкеты, а чтобы получить одно наблюдение, которое меняет следующую проверку.',
      result: 'Смотри не на сам ответ, а на отличие: где работает/не работает, когда, на чём и что меняется после простого действия.',
      simple: 'Если абонент не понимает вопрос — упрости до одного действия или одного сравнения. Не веди нетехнического человека в DNS, CMD и сложные настройки без необходимости.'
    };
  }

  function ensureStyle(shadow) {
    if (!shadow || shadow.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .handbook-question.handbook-question-explained{padding:0;overflow:hidden;transition:border-color .14s ease,box-shadow .14s ease,background .14s ease}
      .handbook-question.handbook-question-explained.is-open{border-color:#E2B6C8;background:#FFFBFD;box-shadow:0 8px 22px rgba(80,35,57,.06)}
      .handbook-question-toggle{width:100%;min-height:52px;display:grid;grid-template-columns:22px minmax(0,1fr) 24px;align-items:center;gap:8px;padding:10px 11px;border:0;background:transparent;color:#312A34;text-align:left;cursor:pointer;font:inherit}
      .handbook-question-toggle:hover{background:#FCF9FB}
      .handbook-question-number{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#FBEAF2;color:#A50046;font-size:8px;font-weight:900}
      .handbook-question-text{font-size:10.5px;line-height:1.45}
      .handbook-question-more{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;color:#9A7285;font-size:16px;line-height:1;transition:transform .14s ease,background .14s ease}
      .handbook-question-toggle:hover .handbook-question-more{background:#FBEAF2;color:#A50046}
      .handbook-question-toggle[aria-expanded="true"] .handbook-question-more{transform:rotate(180deg);background:#FBEAF2;color:#A50046}
      .handbook-question-context{padding:0 13px 13px 41px;border-top:1px solid #F0E7EC}
      .handbook-question-context[hidden]{display:none!important}
      .handbook-context-row{padding-top:9px;color:#625A65;font-size:9.5px;line-height:1.45}
      .handbook-context-row b{display:block;margin-bottom:3px;color:#8D1748;font-size:8px;letter-spacing:.055em;text-transform:uppercase}
      .handbook-context-row.operator-result b{color:#5E5661}
      .handbook-context-row.simple{margin-top:8px;padding:9px 10px;border-radius:12px;background:#FFF4F8;color:#63364A}
      .handbook-context-row.simple b{color:#A50046}
      @media(max-width:1100px){.handbook-question-context{padding-left:38px}.handbook-question-text{font-size:10px}}
    `;
    shadow.appendChild(style);
  }

  function enhanceQuestion(node, index) {
    if (!node || node.dataset.questionHelpReady === '1') return;
    const raw = String(node.textContent || '').replace(/^\s*\d+\s*/, '').trim();
    if (!raw) return;
    const info = explanation(raw);
    node.dataset.questionHelpReady = '1';
    node.classList.add('handbook-question-explained');
    node.innerHTML = `
      <button type="button" class="handbook-question-toggle" data-question-help-toggle aria-expanded="false">
        <span class="handbook-question-number">${index + 1}</span>
        <span class="handbook-question-text">${esc(raw)}</span>
        <span class="handbook-question-more" aria-hidden="true">⌄</span>
      </button>
      <div class="handbook-question-context" data-question-help-context hidden>
        <div class="handbook-context-row"><b>Зачем спрашиваем</b>${esc(info.why)}</div>
        <div class="handbook-context-row operator-result"><b>Что даёт ответ оператору</b>${esc(info.result)}</div>
        <div class="handbook-context-row simple"><b>Если человеку сложно</b>${esc(info.simple)}</div>
      </div>`;
  }

  function enhance() {
    frame = 0;
    const host = document.getElementById(HOST_ID);
    const shadow = host?.shadowRoot;
    const currentPanel = shadow?.querySelector('.module.handbook-mode');
    if (!shadow || !currentPanel) return false;
    ensureStyle(shadow);
    bindPanel(currentPanel);
    [...currentPanel.querySelectorAll('.handbook-question')].forEach(enhanceQuestion);
    return true;
  }

  function schedule() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(enhance);
  }

  function closeAllExcept(activeToggle) {
    if (!panel) return;
    panel.querySelectorAll('[data-question-help-toggle][aria-expanded="true"]').forEach(toggle => {
      if (toggle === activeToggle) return;
      toggle.setAttribute('aria-expanded', 'false');
      const card = toggle.closest('.handbook-question');
      card?.classList.remove('is-open');
      const context = card?.querySelector('[data-question-help-context]');
      if (context) context.hidden = true;
    });
  }

  function onPanelClick(event) {
    const toggle = event.target.closest?.('[data-question-help-toggle]');
    if (toggle) {
      event.preventDefault();
      event.stopPropagation();
      const card = toggle.closest('.handbook-question');
      const context = card?.querySelector('[data-question-help-context]');
      if (!context) return;
      const opening = toggle.getAttribute('aria-expanded') !== 'true';
      closeAllExcept(toggle);
      toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
      card?.classList.toggle('is-open', opening);
      context.hidden = !opening;
      return;
    }
    if (event.target.closest?.('[data-handbook-action]')) schedule();
  }

  function onPanelInput(event) {
    if (event.target?.matches?.('[data-handbook-search]')) schedule();
  }

  function bindPanel(nextPanel) {
    if (panel === nextPanel && panelClickHandler) return;
    unbindPanel();
    panel = nextPanel;
    panelClickHandler = onPanelClick;
    panelInputHandler = onPanelInput;
    panel.addEventListener('click', panelClickHandler, true);
    panel.addEventListener('input', panelInputHandler, true);
  }

  function unbindPanel() {
    if (panel && panelClickHandler) panel.removeEventListener('click', panelClickHandler, true);
    if (panel && panelInputHandler) panel.removeEventListener('input', panelInputHandler, true);
    panel = null;
    panelClickHandler = null;
    panelInputHandler = null;
  }

  function startStoreWatch() {
    if (unsubscribeStore || !WB.bus?.on) return;
    unsubscribeStore = WB.bus.on('store:state', schedule);
  }

  function stopStoreWatch() {
    unsubscribeStore?.();
    unsubscribeStore = null;
  }

  function onModuleOpen(event) {
    if (event?.detail?.module !== 'graph' || event?.detail?.mode === 'studio') return;
    startStoreWatch();
    schedule();
  }

  function onModuleClose(event) {
    if (event?.detail?.module !== 'graph') return;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    stopStoreWatch();
    unbindPanel();
  }

  window.addEventListener('simnet-workbench-module-open', onModuleOpen);
  window.addEventListener('simnet-workbench-module-close', onModuleClose);
  schedule();

  WB.operatorHandbookQuestionHelp = Object.freeze({
    revision: 'operator-handbook-question-help-v1',
    explain: question => ({ ...explanation(question) }),
    enhance,
    stats: () => ({
      bound: Boolean(panelClickHandler),
      storeWatch: Boolean(unsubscribeStore),
      pendingFrame: Boolean(frame)
    })
  });
})();
