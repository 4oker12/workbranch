(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  const base = WB?.graphStudio;
  const runtime = WB?.conversationGraphRuntime;
  const content = WB?.conversationGraphContent;
  if (!WB || !base || typeof base.open !== 'function' || !runtime || !content || WB.__operatorGuideAccordionLoaded) return;

  WB.__operatorGuideAccordionLoaded = true;

  const HOST_ID = 'simnet-graph-studio-host';
  const STYLE_ID = 'simnet-operator-guide-accordion-v1';

  const state = {
    panel: null,
    shadow: null,
    clickHandler: null,
    unsubscribeStore: null,
    contextKey: ''
  };

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  function icon(name) {
    const paths = {
      question: '<circle cx="12" cy="12" r="8"/><path d="M9.7 9.3a2.6 2.6 0 1 1 3.6 2.4c-.9.4-1.3 1-1.3 2"/><path d="M12 17h.01"/>',
      action: '<path d="m14.7 6.3 3-3 3 3-3 3"/><path d="M17.7 3.3 12 9"/><path d="M13 6.5A6.5 6.5 0 1 0 17.5 11"/>',
      device: '<rect x="5" y="4" width="14" height="11" rx="2"/><path d="M9 20h6M12 15v5"/>',
      scope: '<circle cx="12" cy="8" r="3"/><path d="M5.5 20c.7-4 2.8-6 6.5-6s5.8 2 6.5 6"/>',
      time: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
      service: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4a13 13 0 0 1 0 16M12 4a13 13 0 0 0 0 16"/>',
      restart: '<path d="M19 7V3l-2 2a8 8 0 1 0 2.3 9"/><path d="M19 3h-4"/>',
      wifi: '<path d="M4 9c4.7-4 11.3-4 16 0M7 12.5c3-2.6 7-2.6 10 0M10 16c1.2-1 2.8-1 4 0"/><circle cx="12" cy="19" r=".8"/>',
      cable: '<path d="M7 4v5M17 4v5M5 9h14v4a7 7 0 0 1-14 0V9Z"/><path d="M12 20v2"/>',
      app: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
      shield: '<path d="M12 3 5 6v5c0 4.5 2.5 7.5 7 10 4.5-2.5 7-5.5 7-10V6l-7-3Z"/>',
      chevron: '<path d="m8 10 4 4 4-4"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.question}</svg>`;
  }

  const ACTIONS = Object.freeze({
    low_speed: Object.freeze([
      Object.freeze({
        id: 'restart-equipment', icon: 'restart', title: 'Перезагрузить оборудование', recommended: true,
        steps: Object.freeze([
          Object.freeze({ text: 'Уточнить, есть ли отдельная ONU/ONT и роутер.', why: 'Чтобы перезапустить оборудование в правильной последовательности.' }),
          Object.freeze({ text: 'Отключить роутер от питания.', why: 'Полное обесточивание сбрасывает зависшее текущее состояние устройства.' }),
          Object.freeze({ text: 'Если используется отдельная ONU/ONT — отключить её от питания.', why: 'Перезапускаем не только домашнюю Wi‑Fi часть, но и оптический терминал.' }),
          Object.freeze({ text: 'Подождать 20–30 секунд.', why: 'Оборудование должно полностью обесточиться.' }),
          Object.freeze({ text: 'Сначала включить ONU/ONT и дождаться нормальной индикации PON/LOS.', why: 'Роутер должен стартовать уже через поднявшийся оптический канал.' }),
          Object.freeze({ text: 'После этого включить роутер и повторить проверку.', why: 'Сравниваем симптом до и после чистого перезапуска.' })
        ])
      }),
      Object.freeze({
        id: 'wired-test', icon: 'cable', title: 'Проверить скорость по кабелю',
        steps: Object.freeze([
          Object.freeze({ text: 'Подключить компьютер или ноутбук Ethernet-кабелем к роутеру.', why: 'Так исключаем качество радиоканала Wi‑Fi.' }),
          Object.freeze({ text: 'На время проверки отключить Wi‑Fi на этом устройстве.', why: 'Компьютер не должен случайно продолжать тест через беспроводную сеть.' }),
          Object.freeze({ text: 'Закрыть VPN, загрузки, торренты и другой активный трафик.', why: 'Фоновая нагрузка искажает результат.' }),
          Object.freeze({ text: 'Повторить тест и сравнить с результатом по Wi‑Fi.', why: 'Нормальный результат по кабелю переводит внимание на локальную Wi‑Fi часть.' })
        ])
      }),
      Object.freeze({
        id: 'wifi-check', icon: 'wifi', title: 'Проверить Wi‑Fi',
        steps: Object.freeze([
          Object.freeze({ text: 'Проверить работу рядом с роутером.', why: 'Сильное улучшение рядом с роутером указывает на покрытие или помехи.' }),
          Object.freeze({ text: 'Сравнить результат на другом устройстве.', why: 'Так отделяем проблему конкретного телефона/ноутбука.' }),
          Object.freeze({ text: 'Если доступны 2.4 и 5 ГГц — сравнить обе сети.', why: 'Диапазоны отличаются дальностью, помехами и реальной скоростью.' })
        ])
      }),
      Object.freeze({
        id: 'other-device', icon: 'device', title: 'Проверить на другом устройстве',
        steps: Object.freeze([
          Object.freeze({ text: 'Открыть тот же сайт, видео или тест на другом устройстве в этой сети.', why: 'Одинаковый симптом на нескольких устройствах повышает вероятность общей проблемы.' }),
          Object.freeze({ text: 'Если проблема только на одном устройстве — зафиксировать это.', why: 'Дальше не нужно трактовать локальный сбой как проблему всей линии.' })
        ])
      }),
      Object.freeze({
        id: 'service-check', icon: 'service', title: 'Проверить конкретный сайт или сервис',
        steps: Object.freeze([
          Object.freeze({ text: 'Сравнить несколько разных сайтов или приложений.', why: 'Один проблемный ресурс ещё не означает плохую скорость всего доступа.' }),
          Object.freeze({ text: 'При возможности сравнить тот же ресурс через мобильный интернет.', why: 'Это помогает отделить домашнюю сеть от проблемы самого внешнего сервиса.' })
        ])
      })
    ]),
    no_internet: Object.freeze([
      Object.freeze({
        id: 'restart-equipment', icon: 'restart', title: 'Перезагрузить оборудование', recommended: true,
        steps: Object.freeze([
          Object.freeze({ text: 'Отключить роутер от питания.', why: 'Исключаем зависшее состояние маршрутизации или DHCP на домашнем оборудовании.' }),
          Object.freeze({ text: 'Если есть ONU/ONT — также отключить её и подождать 20–30 секунд.', why: 'Полностью перезапускаем цепочку доступа.' }),
          Object.freeze({ text: 'Сначала включить ONU/ONT, затем роутер.', why: 'Роутер стартует уже после восстановления канала до провайдера.' })
        ])
      }),
      Object.freeze({
        id: 'indicators', icon: 'device', title: 'Проверить индикаторы оборудования',
        steps: Object.freeze([
          Object.freeze({ text: 'Уточнить состояние PON/LOS на ONU/ONT.', why: 'Красный LOS или отсутствие PON сразу меняет направление дальнейшей проверки.' }),
          Object.freeze({ text: 'Проверить, горит ли WAN/Internet на роутере.', why: 'Помогает понять, видит ли роутер внешний линк.' })
        ])
      }),
      Object.freeze({ id: 'wired-test', icon: 'cable', title: 'Проверить по кабелю', steps: Object.freeze([
        Object.freeze({ text: 'Подключить компьютер кабелем к роутеру и отключить Wi‑Fi.', why: 'Исключаем отдельную проблему беспроводной сети.' }),
        Object.freeze({ text: 'Проверить несколько сайтов.', why: 'Подтверждаем именно отсутствие доступа, а не один недоступный ресурс.' })
      ]) }),
      Object.freeze({ id: 'other-device', icon: 'device', title: 'Проверить другое устройство', steps: Object.freeze([
        Object.freeze({ text: 'Проверить интернет на втором устройстве в той же сети.', why: 'Так отделяем общий обрыв от локальной проблемы одного клиента.' })
      ]) })
    ]),
    unstable: Object.freeze([
      Object.freeze({ id: 'restart-equipment', icon: 'restart', title: 'Перезагрузить оборудование', recommended: true, steps: Object.freeze([
        Object.freeze({ text: 'Перезапустить ONU/ONT и роутер в последовательности ONU → роутер.', why: 'Сбрасываем накопившееся состояние обоих устройств.' }),
        Object.freeze({ text: 'После запуска наблюдать, повторится ли обрыв.', why: 'Важно отличить единичный зависший сеанс от повторяемого симптома.' })
      ]) }),
      Object.freeze({ id: 'wired-test', icon: 'cable', title: 'Сравнить Wi‑Fi и кабель', steps: Object.freeze([
        Object.freeze({ text: 'На время проверки подключить устройство кабелем.', why: 'Если по кабелю стабильно, ищем причину в Wi‑Fi.' }),
        Object.freeze({ text: 'Зафиксировать, пропадает ли связь одновременно на других устройствах.', why: 'Одновременный обрыв указывает на более общий уровень проблемы.' })
      ]) }),
      Object.freeze({ id: 'time-pattern', icon: 'time', title: 'Зафиксировать периодичность', steps: Object.freeze([
        Object.freeze({ text: 'Уточнить примерное время и частоту обрывов.', why: 'Повторяемый интервал полезнее общей формулировки «иногда пропадает».' }),
        Object.freeze({ text: 'Уточнить, восстанавливается ли интернет сам.', why: 'Самовосстановление и необходимость перезагрузки — разные признаки.' })
      ]) })
    ]),
    other: Object.freeze([
      Object.freeze({ id: 'general-internet', icon: 'service', title: 'Сравнить с обычным интернетом', recommended: true, steps: Object.freeze([
        Object.freeze({ text: 'Проверить сайты, YouTube или мессенджер в момент проблемы.', why: 'Если обычный интернет работает, не относим жалобу к полному отсутствию доступа.' }),
        Object.freeze({ text: 'Проверить, страдает одна рабочая программа или несколько.', why: 'Это отделяет конкретный сервис от общего качества соединения.' })
      ]) }),
      Object.freeze({ id: 'vpn-remote', icon: 'shield', title: 'Проверить VPN / RDP / удалённый доступ', steps: Object.freeze([
        Object.freeze({ text: 'Уточнить, используется ли VPN, RDP или корпоративный туннель.', why: 'Рабочий сервис может зависеть от отдельного маршрута или удалённого сервера.' }),
        Object.freeze({ text: 'Сравнить работу без VPN, если это допустимо.', why: 'Так локализуем проблему до туннеля или после него.' })
      ]) }),
      Object.freeze({ id: 'wired-test', icon: 'cable', title: 'Проверить по кабелю', steps: Object.freeze([
        Object.freeze({ text: 'Подключить рабочее устройство кабелем и повторить проблемное действие.', why: 'Исключаем краткие Wi‑Fi потери, которые особенно заметны в рабочих сессиях.' })
      ]) }),
      Object.freeze({ id: 'restart-equipment', icon: 'restart', title: 'Перезагрузить оборудование', steps: Object.freeze([
        Object.freeze({ text: 'Перезапустить ONU/ONT и роутер, затем повторить вход в рабочую программу.', why: 'Исключаем зависшее локальное состояние перед более глубокой проверкой.' })
      ]) })
    ])
  });

  function questionIcon(text) {
    const value = String(text || '').toLowerCase();
    if (/устрой|телефон|ноутбук|компьютер/.test(value)) return 'scope';
    if (/время|постоян|период|когда|часто/.test(value)) return 'time';
    if (/wi.?fi|вай|кабел/.test(value)) return 'wifi';
    if (/vpn|rdp|dns|удален|удалён/.test(value)) return 'shield';
    if (/сайт|видео|игр|прилож|сервис|youtube/.test(value)) return 'service';
    if (/перезагруз/.test(value)) return 'restart';
    return 'question';
  }

  function questionExplanation(text) {
    const value = String(text || '').toLowerCase();
    if (/устрой|телефон|ноутбук|компьютер/.test(value)) return 'Помогает понять масштаб: проблема общая для подключения или относится к конкретному устройству.';
    if (/время|постоян|период|когда|часто/.test(value)) return 'Показывает повторяемость симптома и помогает отделить постоянную проблему от периодической.';
    if (/wi.?fi|вай|кабел/.test(value)) return 'Помогает отделить качество Wi‑Fi от проводного доступа и самой линии провайдера.';
    if (/vpn|rdp|dns|удален|удалён/.test(value)) return 'Проверяет, не связан ли симптом с отдельным туннелем, настройкой или внешним рабочим сервисом.';
    if (/мобильн/.test(value)) return 'Сравнение с другой сетью помогает отделить домашнее подключение от проблемы конкретного ресурса или устройства.';
    if (/сайт|видео|игр|прилож|сервис|youtube/.test(value)) return 'Уточняет границы жалобы: страдает весь доступ или один конкретный тип трафика/сервис.';
    if (/перезагруз/.test(value)) return 'Изменение после перезапуска показывает, могло ли текущее состояние домашнего оборудования влиять на симптом.';
    if (/индикатор|pon|los|роутер/.test(value)) return 'Даёт простой наблюдаемый признак состояния оборудования без запуска сложной диагностики.';
    return 'Уточнение сужает жалобу до проверяемого признака и помогает выбрать следующий практический шаг.';
  }

  function actionsFor(topicId) {
    return ACTIONS[topicId] || ACTIONS.low_speed;
  }

  function styles() {
    return `<style id="${STYLE_ID}">
      .guide-root.theme-low-speed{--accent:#A50046!important;--accent-dark:#74113F!important;--accent-soft:#FFF2F7!important;--accent-line:rgba(165,0,70,.44)!important}
      .guide-root .guide-board:before{border-color:color-mix(in srgb,var(--accent) 62%,transparent)!important;opacity:1!important}
      .guide-root .guide-cloud{border:1.5px solid color-mix(in srgb,var(--accent) 55%,#D7DCE3)!important;background:#fff!important;color:#172033!important;box-shadow:0 11px 26px rgba(42,27,36,.11)!important}
      .guide-root .guide-cloud:before,.guide-root .guide-cloud:after{border-color:color-mix(in srgb,var(--accent) 48%,#D7DCE3)!important;background:#fff!important}
      .guide-root .guide-cloud:hover{border:2px solid var(--accent)!important;background:#FFF8FB!important;box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 10%,transparent),0 17px 34px color-mix(in srgb,var(--accent) 25%,transparent)!important}
      .guide-root .guide-cloud:hover:before,.guide-root .guide-cloud:hover:after{border-color:var(--accent)!important;background:#FFF8FB!important}
      .guide-root .guide-cloud.active{border:2px solid var(--accent)!important;background:#FFF1F7!important;color:var(--accent-dark)!important;box-shadow:0 0 0 5px color-mix(in srgb,var(--accent) 12%,transparent),0 18px 38px color-mix(in srgb,var(--accent) 30%,transparent)!important}
      .guide-root .guide-cloud.active:before,.guide-root .guide-cloud.active:after{border-color:var(--accent)!important;background:#FFF1F7!important}
      .guide-root .guide-cloud.search-match-high:not(.active){border:2px solid #E00067!important;background:#FFF6FA!important;outline:3px solid rgba(224,0,103,.19)!important;outline-offset:4px!important;box-shadow:0 0 0 5px rgba(224,0,103,.10),0 20px 38px rgba(165,0,70,.29)!important}
      .guide-root .guide-cloud.search-match-high:not(.active):before,.guide-root .guide-cloud.search-match-high:not(.active):after{border-color:#E00067!important;background:#FFF6FA!important}
      .guide-root .guide-cloud.search-match-medium:not(.active){border:2px solid color-mix(in srgb,var(--accent) 78%,#D7DCE3)!important;background:#FFFAFC!important;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 8%,transparent),0 15px 30px color-mix(in srgb,var(--accent) 20%,transparent)!important}
      .guide-root .guide-cloud.search-match-low:not(.active){border-color:color-mix(in srgb,var(--accent) 64%,#D7DCE3)!important;box-shadow:0 13px 26px color-mix(in srgb,var(--accent) 14%,transparent)!important}
      .guide-root .guide-tab.active{background:linear-gradient(180deg,#AA0D50 0%,#8D0B43 100%)!important;border-color:#8D0B43!important;box-shadow:0 9px 22px rgba(141,11,67,.24)!important}
      .guide-root .guide-core{background:radial-gradient(circle at 35% 22%,#B32061 0%,#9D0D4C 48%,#75113F 100%)!important;box-shadow:0 22px 48px rgba(116,17,63,.31)!important}

      .guide-side.guide-ux-side{padding:20px 18px 22px!important;background:#FFF!important}
      .guide-ux-section+.guide-ux-section{margin-top:20px;padding-top:18px;border-top:1px solid #E9E2E6}
      .guide-ux-heading{display:flex;align-items:center;gap:11px;margin:0 0 12px;color:#74113F}
      .guide-ux-heading-icon{width:34px;height:34px;display:grid;place-items:center;color:#A50046;flex:0 0 auto}
      .guide-ux-heading-icon svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
      .guide-ux-heading-copy{min-width:0}.guide-ux-heading-copy b{display:block;font-size:16px;font-weight:850;line-height:1.15;letter-spacing:-.01em}.guide-ux-heading-copy small{display:block;margin-top:3px;color:#667085;font-size:11px;font-weight:550;line-height:1.25}
      .guide-ux-list{display:grid;gap:9px}
      .guide-ux-item{border:1px solid #DED6DC;border-radius:12px;background:#FFF;box-shadow:0 3px 9px rgba(38,27,34,.05);overflow:hidden;transition:border-color .14s ease,box-shadow .14s ease,background .14s ease}
      .guide-ux-item:hover{border-color:color-mix(in srgb,var(--accent) 52%,#DED6DC);box-shadow:0 7px 18px color-mix(in srgb,var(--accent) 10%,transparent)}
      .guide-ux-item[data-expanded="true"]{border-color:color-mix(in srgb,var(--accent) 68%,#DED6DC);background:#FFFBFD;box-shadow:0 8px 22px color-mix(in srgb,var(--accent) 13%,transparent)}
      .guide-ux-toggle{appearance:none;width:100%;min-height:58px;border:0;background:transparent;padding:10px 11px;display:grid;grid-template-columns:34px minmax(0,1fr) 22px;gap:10px;align-items:center;text-align:left;color:#172033;cursor:pointer}
      .guide-ux-card-icon{width:34px;height:34px;display:grid;place-items:center;color:#A50046}
      .guide-ux-card-icon svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
      .guide-ux-label{font-size:13px;font-weight:650;line-height:1.35;color:#18233A}.guide-ux-action .guide-ux-label{font-weight:760;color:#6F173F}
      .guide-ux-chevron{width:22px;height:22px;display:grid;place-items:center;color:#667085;transition:transform .14s ease}.guide-ux-chevron svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .guide-ux-toggle[aria-expanded="true"] .guide-ux-chevron{transform:rotate(180deg)}
      .guide-ux-panel{padding:0 13px 13px 55px;color:#475467;font-size:12px;line-height:1.48}.guide-ux-panel[hidden]{display:none!important}
      .guide-ux-panel-inner{padding:11px 12px;border:1px solid #F0DDE6;border-radius:10px;background:#FFF5F9}
      .guide-ux-panel-title{display:flex;align-items:center;gap:7px;margin-bottom:6px;color:#8F174F;font-size:11px;font-weight:850}.guide-ux-panel-title svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .guide-ux-recommended{display:inline-flex;align-items:center;margin-left:8px;padding:3px 7px;border-radius:999px;background:#E9F8EF;color:#207A43;font-size:9px;font-weight:800;line-height:1;vertical-align:middle}
      .guide-ux-steps{display:grid;gap:10px}.guide-ux-step{display:grid;grid-template-columns:24px 1fr;gap:9px;align-items:start}.guide-ux-step-number{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#FBE7F0;color:#92154C;font-size:10px;font-weight:900}.guide-ux-step-copy{min-width:0}.guide-ux-step-copy b{display:block;color:#253047;font-size:11.5px;font-weight:720;line-height:1.38}.guide-ux-step-copy small{display:block;margin-top:3px;color:#667085;font-size:10.5px;line-height:1.38}.guide-ux-step-copy small strong{color:#7C2149;font-weight:800}

      @media(max-height:860px){
        .guide-side.guide-ux-side{padding:15px 16px 17px!important}.guide-ux-section+.guide-ux-section{margin-top:14px;padding-top:13px}.guide-ux-heading{margin-bottom:9px}.guide-ux-heading-icon{width:30px;height:30px}.guide-ux-heading-icon svg{width:20px;height:20px}.guide-ux-heading-copy b{font-size:14px}.guide-ux-heading-copy small{font-size:10px}.guide-ux-list{gap:7px}.guide-ux-toggle{min-height:50px;padding:8px 9px;grid-template-columns:30px minmax(0,1fr) 20px;gap:8px}.guide-ux-card-icon{width:30px;height:30px}.guide-ux-card-icon svg{width:19px;height:19px}.guide-ux-label{font-size:11.5px}.guide-ux-panel{padding:0 10px 10px 47px;font-size:11px}.guide-ux-panel-inner{padding:9px 10px}.guide-ux-step{grid-template-columns:21px 1fr;gap:7px}.guide-ux-step-number{width:21px;height:21px;font-size:9px}.guide-ux-step-copy b{font-size:10.5px}.guide-ux-step-copy small{font-size:9.8px}
      }
      @media(prefers-reduced-motion:reduce){.guide-ux-item,.guide-ux-chevron{transition:none}}
    </style>`;
  }

  function ensureStyle() {
    if (!state.shadow || state.shadow.getElementById?.(STYLE_ID)) return;
    const template = document.createElement('template');
    template.innerHTML = styles();
    state.shadow.appendChild(template.content.cloneNode(true));
  }

  function setExpanded(item, expanded) {
    const toggle = item?.querySelector?.('[data-guide-ux-toggle]');
    const panel = item?.querySelector?.('[data-guide-ux-panel]');
    if (!toggle || !panel) return;
    item.dataset.expanded = expanded ? 'true' : 'false';
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    panel.hidden = !expanded;
  }

  function closeGroup(group, except = null) {
    state.panel?.querySelectorAll?.(`[data-guide-ux-item][data-guide-ux-group="${group}"]`).forEach(item => {
      if (item !== except) setExpanded(item, false);
    });
  }

  function renderQuestion(text, index) {
    const panelId = `guide-question-panel-${index}`;
    return `<article class="guide-ux-item guide-ux-question" data-guide-ux-item data-guide-ux-group="question" data-expanded="false">
      <button type="button" class="guide-ux-toggle" data-guide-ux-toggle data-guide-ux-group="question" aria-expanded="false" aria-controls="${panelId}">
        <span class="guide-ux-card-icon">${icon(questionIcon(text))}</span>
        <span class="guide-ux-label">${esc(text)}</span>
        <span class="guide-ux-chevron">${icon('chevron')}</span>
      </button>
      <div class="guide-ux-panel" id="${panelId}" data-guide-ux-panel hidden>
        <div class="guide-ux-panel-inner"><div class="guide-ux-panel-title">${icon('question')}<span>Зачем спрашиваем</span></div>${esc(questionExplanation(text))}</div>
      </div>
    </article>`;
  }

  function renderAction(action, index) {
    const panelId = `guide-action-panel-${index}`;
    const steps = Array.isArray(action?.steps) ? action.steps : [];
    return `<article class="guide-ux-item guide-ux-action" data-guide-ux-item data-guide-ux-group="action" data-expanded="false">
      <button type="button" class="guide-ux-toggle" data-guide-ux-toggle data-guide-ux-group="action" aria-expanded="false" aria-controls="${panelId}">
        <span class="guide-ux-card-icon">${icon(action?.icon || 'action')}</span>
        <span class="guide-ux-label">${esc(action?.title || 'Проверка')}${action?.recommended ? '<span class="guide-ux-recommended">Рекомендуем</span>' : ''}</span>
        <span class="guide-ux-chevron">${icon('chevron')}</span>
      </button>
      <div class="guide-ux-panel" id="${panelId}" data-guide-ux-panel hidden>
        <div class="guide-ux-panel-inner">
          <div class="guide-ux-panel-title">${icon('action')}<span>Последовательность</span></div>
          <div class="guide-ux-steps">${steps.map((step, stepIndex) => `<div class="guide-ux-step"><span class="guide-ux-step-number">${stepIndex + 1}</span><span class="guide-ux-step-copy"><b>${esc(step?.text || '')}</b>${step?.why ? `<small><strong>Зачем:</strong> ${esc(step.why)}</small>` : ''}</span></div>`).join('')}</div>
        </div>
      </div>
    </article>`;
  }

  function enhanceSide({ force = false } = {}) {
    if (!runtime.isActive?.() || !state.panel?.isConnected) return false;
    const side = state.panel.querySelector?.('.guide-side');
    if (!side) return false;

    const topicId = String(runtime.activeTopic?.() || content.defaultTopicId || 'low_speed');
    const symptomId = String(runtime.activeSymptom?.() || '');
    const topic = content.topic?.(topicId);
    const symptom = symptomId ? content.symptom?.(topicId, symptomId) : null;
    if (!topic) return false;

    const key = `${topicId}:${symptomId}`;
    if (!force && side.dataset.guideUxContextKey === key) return true;

    const questions = Array.isArray(symptom?.questions) ? symptom.questions : (Array.isArray(topic?.questions) ? topic.questions : []);
    const actions = actionsFor(topicId);

    side.classList.add('guide-ux-side');
    side.dataset.guideUxContextKey = key;
    side.innerHTML = `
      <section class="guide-ux-section" aria-label="Что спросить">
        <div class="guide-ux-heading"><span class="guide-ux-heading-icon">${icon('question')}</span><span class="guide-ux-heading-copy"><b>Что спросить</b><small>Вопросы для уточнения</small></span></div>
        <div class="guide-ux-list">${questions.map(renderQuestion).join('')}</div>
      </section>
      <section class="guide-ux-section" aria-label="Что сделать">
        <div class="guide-ux-heading"><span class="guide-ux-heading-icon">${icon('action')}</span><span class="guide-ux-heading-copy"><b>Что сделать</b><small>Проверки и действия</small></span></div>
        <div class="guide-ux-list">${actions.map(renderAction).join('')}</div>
      </section>`;
    state.contextKey = key;
    return true;
  }

  function onPanelClick(event) {
    const toggle = event.target?.closest?.('[data-guide-ux-toggle]');
    if (toggle && state.panel?.contains?.(toggle)) {
      event.preventDefault();
      event.stopPropagation();
      const item = toggle.closest('[data-guide-ux-item]');
      const group = String(toggle.dataset.guideUxGroup || '');
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      closeGroup(group, item);
      setExpanded(item, !expanded);
      return;
    }

    queueMicrotask(() => {
      if (runtime.isActive?.()) enhanceSide();
    });
  }

  function onStoreState() {
    if (!runtime.isActive?.()) return;
    queueMicrotask(() => enhanceSide());
  }

  function detachPanel() {
    state.unsubscribeStore?.();
    state.unsubscribeStore = null;
    if (state.panel && state.clickHandler) state.panel.removeEventListener('click', state.clickHandler, true);
    state.clickHandler = null;
    state.panel = null;
    state.shadow = null;
    state.contextKey = '';
  }

  function attachPanel({ force = false } = {}) {
    const host = document.getElementById(HOST_ID);
    const shadow = host?.shadowRoot || null;
    const panel = shadow?.querySelector?.('.module') || null;
    if (!shadow || !panel || !runtime.isActive?.()) return false;

    if (state.panel && state.panel !== panel) detachPanel();
    state.shadow = shadow;
    state.panel = panel;
    ensureStyle();

    if (!state.clickHandler) {
      state.clickHandler = onPanelClick;
      panel.addEventListener('click', state.clickHandler, true);
    }
    if (!state.unsubscribeStore && WB.bus?.on) state.unsubscribeStore = WB.bus.on('store:state', onStoreState);

    return enhanceSide({ force });
  }

  async function openWithAccordion(options = {}) {
    const result = await base.open(options);
    if (runtime.isActive?.()) attachPanel({ force: true });
    return result;
  }

  window.addEventListener('simnet-workbench-module-close', event => {
    if (event?.detail?.module === 'graph') detachPanel();
  });

  window.addEventListener('simnet-workbench-module-open', event => {
    if (event?.detail?.module !== 'graph' || event?.detail?.mode !== 'runtime') return;
    queueMicrotask(() => queueMicrotask(() => attachPanel()));
  });

  WB.graphStudio = Object.freeze({ ...base, open: openWithAccordion });
  WB.operatorGuideAccordion = Object.freeze({
    revision: 'operator-guide-accordion-visual-v1',
    ensure: () => attachPanel({ force: true }),
    stats: () => ({
      attached: Boolean(state.panel),
      contextKey: state.contextKey,
      hasClickListener: Boolean(state.clickHandler),
      hasStoreSubscription: Boolean(state.unsubscribeStore)
    })
  });
})();
