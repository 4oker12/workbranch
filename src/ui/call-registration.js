(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self) return;

  const HOST_ID = 'simnet-workbench-call-registration-host';
  const USERSIDE_ORIGIN = 'https://userside.simnet.kiev.ua';
  const FORM_PATH = '/message/tab';
  const SAVE_PATH = '/message/save_call';
  const FORM_MESSAGE = 'CALL_REGISTRATION_FORM';
  const SUBMIT_MESSAGE = 'CALL_REGISTRATION_SUBMIT';
  const PBX_QUERY_MESSAGE = 'PBX_RECENT_CALLS_QUERY';
  const PBX_BIND_MESSAGE = 'PBX_CALL_BIND';
  const PBX_FINALIZE_MESSAGE = 'PBX_CALL_SUBMISSION_FINALIZE';

  const valueOf = raw => (
    raw && typeof raw === 'object' && 'value' in raw
      ? raw.value
      : raw
  );

  const esc = value => String(value == null ? '' : value).replace(
    /[&<>"']/g,
    char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]
  );

  const compact = (value, max = 260) => {
    const text = String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };

  function customerIdOf(raw) {
    const text = String(valueOf(raw) ?? '').trim();
    return /^\d{1,12}$/.test(text) ? text : '';
  }

  function usersideFormUrl(customerId) {
    const id = customerIdOf(customerId);
    if (!id) return '';
    const url = new URL(FORM_PATH, USERSIDE_ORIGIN);
    url.searchParams.set('section', 'call');
    url.searchParams.set('customer_id', id);
    return url.href;
  }

  function actionUrlOf(form) {
    try {
      const url = new URL(
        String(form?.getAttribute?.('action') || ''),
        USERSIDE_ORIGIN
      );
      return url.origin === USERSIDE_ORIGIN && url.pathname === SAVE_PATH
        ? url.href
        : '';
    } catch {
      return '';
    }
  }

  function parseNativeCallForm(html, expectedCustomerId = '') {
    if (typeof DOMParser === 'undefined') {
      throw new Error('DOMParser недоступен');
    }

    const documentNode = new DOMParser().parseFromString(
      String(html || ''),
      'text/html'
    );
    const forms = Array.from(
      documentNode.forms || documentNode.querySelectorAll?.('form') || []
    );
    const form = forms.find(candidate => Boolean(actionUrlOf(candidate)));

    if (!form) {
      throw new Error('UserSide не вернул штатную форму регистрации звонка');
    }

    if (String(form.getAttribute?.('method') || 'get').toLowerCase() !== 'post') {
      throw new Error('UserSide вернул форму с неожиданным методом');
    }

    const hiddenFields = Array.from(
      form.querySelectorAll?.('input[type="hidden"][name]') || []
    ).map(input => ({
      name: String(input.getAttribute?.('name') || input.name || ''),
      value: String(input.value ?? input.getAttribute?.('value') ?? '')
    })).filter(field => field.name);

    const hiddenValue = name => hiddenFields.find(field => field.name === name)?.value || '';
    const customerId = customerIdOf(hiddenValue('customer_id'));
    const expected = customerIdOf(expectedCustomerId);
    const csrf = hiddenValue('_csrf');

    if (!customerId || !csrf) {
      throw new Error('В штатной форме UserSide отсутствует customer_id или _csrf');
    }
    if (expected && customerId !== expected) {
      throw new Error(`Форма относится к другому абоненту: ${customerId}`);
    }
    if (!hiddenFields.some(field => field.name === 'additional_fields[]' && field.value === '13')) {
      throw new Error('UserSide не вернул обязательное поле телефона dopf_13');
    }

    const standard = form.querySelector?.('select[name="standart_comment"]');
    const comment = form.querySelector?.('textarea[name="comment"]');
    const phone = form.querySelector?.('input[name="dopf_13"]');
    if (!standard || !comment || !phone) {
      throw new Error('Состав штатной формы UserSide изменился');
    }

    const options = Array.from(
      standard.options || standard.querySelectorAll?.('option') || []
    ).filter(option => !option.disabled).map(option => ({
      value: String(option.value ?? option.getAttribute?.('value') ?? ''),
      label: compact(option.textContent || option.label || ''),
      selected: Boolean(option.selected)
    }));

    if (!options.length) {
      throw new Error('UserSide не вернул варианты типового комментария');
    }

    const nativeSelected = String(
      standard.value
      || options.find(option => option.selected)?.value
      || options[0].value
    );

    return {
      action: actionUrlOf(form),
      method: 'POST',
      customerId,
      csrf,
      hiddenFields,
      options,
      defaults: {
        standardComment: nativeSelected,
        comment: String(comment.value || ''),
        phone: String(phone.value || '')
      },
      phoneRequired: Boolean(phone.required || phone.hasAttribute?.('required')),
      phoneMaxLength: Number(phone.maxLength > 0 ? phone.maxLength : phone.getAttribute?.('maxlength')) || 35
    };
  }

  function serializeNativeCallForm(model, values = {}) {
    if (!model?.customerId || !model?.csrf || !Array.isArray(model.hiddenFields)) {
      throw new Error('Штатная форма ещё не загружена');
    }

    const selected = String(values.standardComment ?? model.defaults?.standardComment ?? '');
    if (!model.options?.some(option => String(option.value) === selected)) {
      throw new Error('Выбран неизвестный типовой комментарий');
    }

    const comment = String(values.comment ?? '');
    const phone = String(values.phone ?? '').trim();
    if (model.phoneRequired && !phone) {
      throw new Error('Укажите телефон');
    }
    if (phone.length > Number(model.phoneMaxLength || 35)) {
      throw new Error(`Телефон длиннее ${Number(model.phoneMaxLength || 35)} символов`);
    }

    const replaced = new Set([
      'customer_id',
      'standart_comment',
      'comment',
      'dopf_13'
    ]);
    const fields = model.hiddenFields
      .filter(field => field?.name && !replaced.has(String(field.name)))
      .map(field => ({
        name: String(field.name),
        value: String(field.value ?? '')
      }));

    fields.push(
      { name: 'customer_id', value: model.customerId },
      { name: 'standart_comment', value: selected },
      { name: 'comment', value: comment },
      { name: 'dopf_13', value: phone }
    );

    return fields;
  }

  function responseDocument(html) {
    if (typeof DOMParser === 'undefined') return null;
    try {
      return new DOMParser().parseFromString(String(html || ''), 'text/html');
    } catch {
      return null;
    }
  }

  function responseMessage(documentNode, html, { error = false, allowBodyMatch = true } = {}) {
    const selector = error
      ? '.error, .error-message, .errorMessage, .alert-danger, .bad_info_text, .validation-error, .help-block.error'
      : '.success, .success-message, .alert-success';
    const node = documentNode?.querySelector?.(selector);
    const selected = compact(node?.textContent || '');
    if (selected) return selected;
    if (!allowBodyMatch) return '';

    const text = compact(documentNode?.body?.textContent || html || '');
    if (!text) return '';
    if (error) {
      const match = text.match(/[^.!?]*(?:ошиб|помил|обязатель|обов'язков|не\s+заполн|некоррект|invalid|csrf)[^.!?]*/i);
      return compact(match?.[0] || '');
    }
    const match = text.match(/[^.!?]*(?:звонок|дзвінок)[^.!?]*(?:зарегистрирован|зареєстрован|сохран[её]н|збережен)[^.!?]*/i);
    return compact(match?.[0] || '');
  }

  function classifySubmissionResult(result = {}, customerId = '') {
    const id = customerIdOf(customerId);
    const html = String(result.data || '');
    const documentNode = responseDocument(html);
    const hasNativeForm = Boolean(
      Array.from(documentNode?.forms || documentNode?.querySelectorAll?.('form') || [])
        .some(form => Boolean(actionUrlOf(form)))
    );
    const errorMessage = responseMessage(documentNode, html, {
      error: true,
      allowBodyMatch: !result.ok || hasNativeForm
    });

    if (!result.ok) {
      return {
        status: 'error',
        message: errorMessage || `UserSide вернул HTTP ${Number(result.status || 0) || 'ошибку'}`
      };
    }

    if (errorMessage || hasNativeForm) {
      return {
        status: 'error',
        message: errorMessage || 'UserSide вернул форму повторно — сохранение не подтверждено'
      };
    }

    let finalUrl = null;
    try {
      finalUrl = new URL(String(result.url || ''), USERSIDE_ORIGIN);
    } catch {}

    const redirectedToCustomer = Boolean(
      result.redirected
      && finalUrl?.origin === USERSIDE_ORIGIN
      && id
      && (
        finalUrl.pathname === `/customer/${id}`
        || finalUrl.searchParams.get('customer_id') === id
        || finalUrl.searchParams.get('id') === id
      )
    );
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const scriptedCustomerRedirect = Boolean(
      id
      && new RegExp(
        `(?:location(?:\\.href)?|location\\.replace\\s*\\()\\s*(?:=\\s*)?["'][^"']*\\/customer\\/${escapedId}(?:[^"']*)["']`,
        'i'
      ).test(html)
    );
    const successMessage = responseMessage(documentNode, html, {
      allowBodyMatch: html.length > 0 && html.length < 20000
    });

    if (redirectedToCustomer || scriptedCustomerRedirect || successMessage) {
      return {
        status: 'success',
        message: successMessage || 'Звонок зарегистрирован'
      };
    }

    return {
      status: 'unknown',
      message: 'UserSide ответил, но сохранение не подтверждено. Проверь запись в карточке абонента.'
    };
  }

  function reliablePhone(caseData = {}) {
    const candidates = [
      caseData?.profile?.phone,
      caseData?.profile?.mobile,
      caseData?.identity?.phone,
      caseData?.contact?.phone
    ];

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object' || !('value' in candidate)) continue;
      const phone = String(candidate.value || '').trim();
      const confidence = Number(candidate.confidence || 0);
      const source = String(candidate.source || '');
      if (
        phone
        && phone.length <= 35
        && confidence >= 0.9
        && /userside|customer|card/i.test(source)
      ) return phone;
    }
    return '';
  }

  async function extensionRequest(type, payload) {
    const observed = WB.observability?.startOperation?.(
      `CALL_MESSAGE_${String(type || 'UNKNOWN')}`,
      { type: String(type || '') },
      { source: 'call-registration', stage: 'SEND_MESSAGE', expected: 'Service Worker success response', timeoutMs: 20000 }
    );
    try {
      const response = await chrome.runtime.sendMessage({ type, payload });
      if (!response?.success) throw new Error(response?.error || 'Service worker не ответил');
      observed?.success?.({ response: 'success' });
      return response.data;
    } catch (error) {
      observed?.error?.(error, {
        code: `CALL_${String(type || 'REQUEST')}_FAILED`,
        stage: 'SEND_MESSAGE',
        details: { type: String(type || '') }
      });
      throw error;
    }
  }

  function recordTelemetry(result = {}) {
    for (const item of Array.isArray(result.telemetry) ? result.telemetry : []) {
      WB.performanceMonitor?.record?.(
        'network',
        String(item?.label || 'call-registration'),
        Number(item?.durationMs || 0),
        { ok: item?.ok !== false, bytes: Number(item?.bytes || 0) }
      );
    }
  }

  function pbxCallLabel(call = {}) {
    const when = [call.date, call.time].filter(Boolean).join(' ');
    const caller = call.callerMasked || 'номер не определён';
    const duration = call.duration || '—';
    const agent = call.agentExtension || compact(call.agent || '', 28) || '—';
    const matchedBy = Array.isArray(call.match?.matchedBy)
      ? call.match.matchedBy.map(value => ({
          contract: 'договор',
          ip: 'IP',
          phone: 'телефон'
        })[value] || value).join('+')
      : '';
    const suffix = matchedBy ? ` · совпал ${matchedBy}` : '';
    return `${when || 'время неизвестно'} · ${caller} · ${duration} · оп. ${agent}${suffix}`;
  }

  class CallRegistration {
    constructor() {
      this.host = null;
      this.shadow = null;
      this.model = null;
      this.caseSnapshot = null;
      this.pbxCalls = [];
      this.pbxBinding = null;
      this.pbxLoadError = '';
      this.binding = false;
      this.generation = 0;
      this.saving = false;
      this.boundKeydown = this.onKeydown.bind(this);
      this.boundModuleOpen = event => {
        if (event?.detail?.module !== 'call' && this.host && !this.saving) this.close();
      };
      window.addEventListener('simnet-workbench-module-open', this.boundModuleOpen);
      this.unsubStore = WB.bus.on('store:state', () => this.guardCurrentCase());
    }

    caseMatchesSnapshot() {
      if (!this.caseSnapshot) return false;
      const current = WB.store.activeCase?.() || null;
      return Boolean(
        current
        && String(current.id || '') === this.caseSnapshot.caseId
        && (
          !this.caseSnapshot.customerId
          || customerIdOf(current.identity?.customerId) === this.caseSnapshot.customerId
        )
      );
    }

    guardCurrentCase() {
      if (!this.host || !this.caseSnapshot || this.caseMatchesSnapshot()) return;
      this.model = null;
      this.saving = false;
      this.renderError('Активный абонент изменился. Закрой форму и открой её заново.');
    }

    mount() {
      this.host?.remove();
      this.host = document.createElement('div');
      this.host.id = HOST_ID;
      this.host.dataset.simnetWbOwned = 'call-registration';
      Object.assign(this.host.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647'
      });
      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.shadow.innerHTML = `${this.styles()}<div class="backdrop" data-action="backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="sw-call-title"><div class="surface"></div></section></div>`;
      this.shadow.addEventListener('click', event => this.onClick(event));
      this.shadow.addEventListener('submit', event => this.onSubmit(event));
      document.addEventListener('keydown', this.boundKeydown, true);
      document.documentElement.appendChild(this.host);
    }

    styles() {
      return `<style>
        :host{all:initial;color-scheme:light;--plum:#A50046;--plum-hover:#870039;--plum-soft:#FFF1F6}
        *{box-sizing:border-box}
        .backdrop{
          width:100%;height:100%;display:grid;place-items:center;
          padding:24px;background:rgba(22,29,41,.34);
          backdrop-filter:blur(2px) saturate(.9);
          font:13px/1.45 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#1D2939;
          animation:fade-in .16s ease both
        }
        .dialog{
          width:min(560px,calc(100vw - 48px));max-height:calc(100vh - 48px);overflow:auto;
          border:1px solid #E4E7EC;border-radius:18px;background:#fff;
          box-shadow:0 28px 80px rgba(16,24,40,.24),0 2px 8px rgba(16,24,40,.08);
          animation:dialog-in .18s ease both
        }
        .head{display:flex;gap:12px;align-items:flex-start;padding:18px 20px 15px;border-bottom:1px solid #EAECF0;background:linear-gradient(180deg,#fff,#FFFCFD)}
        .mark{display:grid;place-items:center;width:38px;height:38px;flex:0 0 38px;border-radius:12px;background:var(--plum);color:#fff;font-size:19px;box-shadow:0 7px 16px rgba(165,0,70,.20)}
        .title{min-width:0;flex:1}.title h2{margin:0;color:#1D2939;font-size:17px;letter-spacing:-.015em}.title p{margin:4px 0 0;color:#667085;font-size:12px}
        .close{width:32px;height:32px;border:0;border-radius:9px;background:transparent;color:#667085;font-size:22px;cursor:pointer}.close:hover{background:#F2F4F7;color:#344054}
        form,.content{display:grid;gap:14px;padding:18px 20px 20px}
        label{display:grid;gap:6px;color:#475467;font-size:12px;font-weight:700}
        select,textarea,input{
          width:100%;border:1px solid #D0D5DD;border-radius:10px;background:#fff;color:#1D2939;
          padding:10px 11px;font:13px/1.4 inherit;outline:none;box-shadow:0 1px 2px rgba(16,24,40,.03)
        }
        select:focus,textarea:focus,input:focus{border-color:#C34C7D;box-shadow:0 0 0 3px rgba(165,0,70,.10)}
        option{background:#fff;color:#1D2939}textarea{min-height:122px;resize:vertical}
        .required{color:#D92D20}.hint{margin:-3px 0 0;color:#98A2B3;font-size:11px;line-height:1.45}
        .status{padding:10px 11px;border:1px solid #E4E7EC;border-radius:10px;background:#F9FAFB;color:#475467}
        .status.error{border-color:#FECDCA;background:#FEF3F2;color:#B42318}.status.warn{border-color:#FEDF89;background:#FFFAEB;color:#B54708}.status.success{border-color:#ABEFC6;background:#ECFDF3;color:#067647;font-weight:750}
        .pbx-card{display:grid;gap:10px;padding:12px;border:1px solid #FEDF89;border-radius:12px;background:#FFFAEB}
        .pbx-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;color:#7A2E0E;font-weight:800}
        .pbx-mode{flex:0 0 auto;border-radius:999px;background:#F79009;color:#fff;padding:3px 7px;font-size:9px;letter-spacing:.04em}
        .pbx-help{color:#8A4B19;font-size:11px;line-height:1.45}
        .pbx-actions{display:flex;gap:8px;flex-wrap:wrap}
        .pbx-actions .action{padding:8px 11px}.pbx-empty{color:#8A4B19;font-size:11px}
        .actions{display:flex;justify-content:flex-end;gap:9px;margin-top:2px}
        button.action{border:1px solid #D0D5DD;border-radius:10px;padding:9px 15px;background:#fff;color:#344054;font:700 12px/1.2 inherit;cursor:pointer;box-shadow:0 1px 2px rgba(16,24,40,.04)}
        button.action:hover{background:#F9FAFB;border-color:#98A2B3}button.action.warning{border-color:#F79009;background:#FFF7E8;color:#9A3412}button.action.warning:hover{border-color:#DC6803;background:#FFFAEB;color:#7A2E0E}button.action.primary{border-color:var(--plum);background:var(--plum);color:#fff;box-shadow:0 5px 14px rgba(165,0,70,.18)}button.action.primary:hover{background:var(--plum-hover)}
        button:disabled{opacity:.55;cursor:wait}.loader{width:22px;height:22px;margin:12px auto;border:2px solid #EAECF0;border-top-color:var(--plum);border-radius:50%;animation:spin .7s linear infinite}
        @keyframes spin{to{transform:rotate(360deg)}}@keyframes fade-in{from{opacity:0}}@keyframes dialog-in{from{opacity:0;transform:translateY(7px) scale(.985)}to{opacity:1;transform:none}}
        @media(max-width:560px){.backdrop{padding:12px}.dialog{width:calc(100vw - 24px);max-height:calc(100vh - 24px)}}
        @media(prefers-reduced-motion:reduce){.backdrop,.dialog{animation:none!important}}
      </style>`;
    }

    header() {
      const label = this.caseSnapshot?.label || `Customer ID ${this.caseSnapshot?.customerId || '—'}`;
      return `<div class="head"><div class="mark">☎</div><div class="title"><h2 id="sw-call-title">Регистрация звонка</h2><p>${esc(label)} · UserSide ID ${esc(this.caseSnapshot?.customerId || '—')}</p></div><button class="close" type="button" data-action="cancel" aria-label="Закрыть">×</button></div>`;
    }

    surface(html) {
      const node = this.shadow?.querySelector('.surface');
      if (node) node.innerHTML = `${this.header()}${html}`;
    }

    renderLoading() {
      this.surface('<div class="content"><div class="status">Получаю актуальную штатную форму UserSide…</div><div class="loader"></div><div class="actions"><button class="action" type="button" data-action="cancel">Отмена</button></div></div>');
    }

    preferredPbxCallKey() {
      const owned = this.pbxCalls.find(call => call.binding?.caseId === this.caseSnapshot?.caseId);
      if (owned) return String(owned.callKey || '');
      const strong = this.pbxCalls.filter(call => (
        call.match?.level === 'strong'
        && (!call.binding?.registrationStatus || call.binding.registrationStatus === 'bound')
        && (!call.binding || call.binding.caseId === this.caseSnapshot?.caseId)
      ));
      return strong.length === 1 ? String(strong[0].callKey || '') : '';
    }

    pbxPanel(selectedCallKey = '') {
      if (!this.pbxCalls.length) {
        const message = this.pbxLoadError
          ? `PBX недоступна: ${this.pbxLoadError}`
          : 'Свежих звонков пока нет. Открой список завершённых разговоров PBX — Workbench считает его без загрузки записей.';
        return `<section class="pbx-card"><div class="pbx-head"><span>Связь с завершённым разговором</span><span class="pbx-mode">БЕЗ POST</span></div><div class="pbx-empty">${esc(message)}</div></section>`;
      }

      const selected = String(selectedCallKey || '');
      const options = this.pbxCalls.map(call => {
        const foreign = call.binding && call.binding.caseId !== this.caseSnapshot?.caseId;
        const boundHere = call.binding?.caseId === this.caseSnapshot?.caseId;
        const matchLevel = String(call.match?.level || 'none');
        const registrationStatus = String(call.binding?.registrationStatus || 'bound');
        const unsafe = matchLevel !== 'strong';
        const locked = boundHere && ['registered', 'submitting', 'review_required'].includes(registrationStatus);
        const suffix = foreign
          ? ' · занят другим Case'
          : registrationStatus === 'registered'
            ? ' · уже зарегистрирован'
            : registrationStatus === 'submitting'
              ? ' · отправляется'
              : registrationStatus === 'review_required'
                ? ' · нужна ручная проверка'
                : matchLevel === 'conflict'
                  ? ' · КОНФЛИКТ договора/IP'
                  : unsafe
                    ? ' · авто-привязка не подтверждена'
                    : boundHere
                      ? call.binding?.mode === 'operator-override'
                        ? ' · принят оператором'
                        : ' · закреплён'
                      : '';
        // Неоднозначный звонок остаётся доступным для выбора: строгий bind его не примет,
        // но оператор может явно принять его под свою ответственность. Чужие/закрытые
        // binding-и по-прежнему недоступны.
        return `<option value="${esc(call.callKey)}" ${call.callKey === selected ? 'selected' : ''} ${(foreign || locked) ? 'disabled' : ''}>${esc(`${pbxCallLabel(call)}${suffix}`)}</option>`;
      }).join('');
      const bindingStatus = this.pbxBinding?.callKey === selected
        ? String(this.pbxBinding.registrationStatus || 'bound')
        : '';
      const bindingMode = this.pbxBinding?.callKey === selected
        ? String(this.pbxBinding.mode || 'dry-run')
        : '';
      const notice = bindingStatus === 'registered'
        ? '<div class="status success">✓ Этот PBX-звонок уже зарегистрирован. Повторная отправка запрещена.</div>'
        : bindingStatus === 'submitting'
          ? '<div class="status warn">Звонок уже отправляется из вкладки, которая начала регистрацию.</div>'
          : bindingStatus === 'review_required'
            ? '<div class="status warn">Результат прошлой отправки неизвестен. Проверь историю UserSide — повтор заблокирован.</div>'
            : bindingStatus === 'bound' && bindingMode === 'operator-override'
              ? '<div class="status warn">⚠ Звонок закреплён вручную под ответственность оператора. Автоматическая связь с абонентом не подтверждена; действие записано в журнал.</div>'
              : bindingStatus === 'bound'
                ? '<div class="status success">✓ Точный договор/IP совпал. Звонок закреплён за этим Case; POST ещё не выполнялся.</div>'
                : '';

      return `<section class="pbx-card"><div class="pbx-head"><span>Связь с завершённым разговором</span><span class="pbx-mode">СТРОГАЯ ПО УМОЛЧАНИЮ</span></div><label>Звонок PBX<select name="pbx_call_key"><option value="">— выбери завершённый звонок —</option>${options}</select></label>${notice}<div class="pbx-actions"><button class="action" type="button" data-action="bind-pbx">Закрепить за Case</button><button class="action warning" type="button" data-action="bind-pbx-override">Принять под ответственность</button><button class="action" type="button" data-action="open-record">Открыть запись</button></div><div class="pbx-help">По умолчанию Workbench принимает только точное совпадение договора/IP. Если автоматическая связь не подтверждена, звонок можно принять только отдельной кнопкой после явного подтверждения оператора. Чужой Case, повторная и параллельная отправка всё равно блокируются.</div></section>`;
    }

    renderForm(values = null, notice = null) {
      if (!this.model) return;
      const current = values || {
        standardComment: this.model.defaults.standardComment,
        comment: this.model.defaults.comment,
        phone: reliablePhone(WB.store.activeCase?.()) || this.model.defaults.phone,
        pbxCallKey: this.pbxBinding?.callKey || this.preferredPbxCallKey()
      };
      const selected = String(current.standardComment ?? '');
      const options = this.model.options.map(option => `<option value="${esc(option.value)}" ${String(option.value) === selected ? 'selected' : ''}>${esc(option.label || '—')}</option>`).join('');
      const status = notice
        ? `<div class="status ${esc(notice.kind || '')}">${esc(notice.message || '')}</div>`
        : '';
      this.surface(`<form data-call-form>${status}${this.pbxPanel(current.pbxCallKey)}<label>Типовой комментарий<select name="standart_comment">${options}</select></label><label>Комментарий<textarea name="comment" placeholder="Кратко зафиксируй обращение">${esc(current.comment || '')}</textarea></label><label>Телефон <span class="required">(!)</span><input name="dopf_13" type="text" maxlength="${Number(this.model.phoneMaxLength || 35)}" value="${esc(current.phone || '')}" required autocomplete="tel"></label><div class="hint">Сохранение выполняет штатный обработчик UserSide. Workbench не хранит CSRF и содержимое формы.</div><div class="actions"><button class="action" type="button" data-action="cancel">Отмена</button><button class="action primary" type="submit">Сохранить</button></div></form>`);
      queueMicrotask(() => this.shadow?.querySelector('[name="standart_comment"]')?.focus());
    }

    renderError(message) {
      this.surface(`<div class="content"><div class="status error">${esc(message || 'Не удалось открыть форму')}</div><div class="actions"><button class="action" type="button" data-action="cancel">Закрыть</button></div></div>`);
    }

    renderResult(result) {
      const kind = result.status === 'success' ? 'success' : result.status === 'unknown' ? 'warn' : 'error';
      const prefix = result.status === 'success' ? '✓ ' : result.status === 'unknown' ? '! ' : '✕ ';
      this.surface(`<div class="content"><div class="status ${kind}">${prefix}${esc(result.message)}</div><div class="actions"><button class="action" type="button" data-action="cancel">Закрыть</button></div></div>`);
    }

    async open(caseData = WB.store.activeCase?.() || null) {
      const customerId = customerIdOf(caseData?.identity?.customerId);
      if (!caseData?.id) {
        return { ok: false, reason: 'case-missing' };
      }

      this.close();
      window.dispatchEvent(new CustomEvent('simnet-workbench-module-open', { detail: { module: 'call' } }));
      const generation = ++this.generation;
      const login = String(valueOf(caseData.identity?.login) || '').trim();
      const contract = String(valueOf(caseData.identity?.contract) || '').trim();
      this.caseSnapshot = {
        caseId: String(caseData.id || ''),
        customerId,
        label: login || (contract ? `Договор ${contract}` : `Customer ID ${customerId}`)
      };
      this.mount();
      this.renderLoading();

      try {
        const result = await extensionRequest(FORM_MESSAGE, {
          caseId: this.caseSnapshot.caseId,
          customerId
        });
        if (generation !== this.generation || !this.host) return { ok: false, reason: 'cancelled' };
        recordTelemetry(result);
        if (!result?.ok) {
          throw new Error(result?.message || `UserSide вернул HTTP ${Number(result?.status || 0) || 'ошибку'}`);
        }
        const resolvedCustomerId = customerIdOf(result.customerId || customerId);
        if (!resolvedCustomerId) throw new Error('UserSide Customer ID не найден');
        this.caseSnapshot.customerId = resolvedCustomerId;
        if (result.resolver && result.resolver !== 'case') {
          WB.performanceMonitor?.count?.('storageWrites');
        }
        WB.store.rememberCustomerId?.(
          this.caseSnapshot.caseId,
          resolvedCustomerId,
          `userside:${result.resolver || 'case'}:call-registration`
        );
        if (!this.caseMatchesSnapshot()) {
          throw new Error('Активный абонент изменился во время загрузки формы');
        }
        this.model = parseNativeCallForm(result.data, resolvedCustomerId);
        // Prefill comment from diagnostic snapshot when operator left it empty.
        try {
          const active = WB.store.activeCase?.() || caseData;
          if (active && WB.appeals?.buildDiagnosticSnapshot && WB.appeals?.formatDiagnosticSummary) {
            const snap = WB.appeals.buildDiagnosticSnapshot(active);
            const summary = String(WB.appeals.formatDiagnosticSummary(snap) || '').trim();
            if (summary && !(this.model.defaults?.comment || '').trim()) {
              this.model.defaults = {
                ...(this.model.defaults || {}),
                comment: summary.slice(0, 900)
              };
            }
          }
        } catch (error) {
          console.warn('[SIMNET Workbench] diagnostic summary prefill skipped', error);
        }
        try {
          const pbx = await extensionRequest(PBX_QUERY_MESSAGE, {
            caseId: this.caseSnapshot.caseId,
            customerId: resolvedCustomerId
          });
          if (generation !== this.generation || !this.host) return { ok: false, reason: 'cancelled' };
          this.pbxCalls = Array.isArray(pbx?.calls) ? pbx.calls : [];
          this.pbxBinding = this.pbxCalls.find(call => (
            call.binding?.caseId === this.caseSnapshot.caseId
            && call.binding?.customerId === resolvedCustomerId
          ))?.binding || null;
        } catch (error) {
          this.pbxCalls = [];
          this.pbxBinding = null;
          this.pbxLoadError = compact(error?.message || String(error), 180);
        }
        this.renderForm();
        return { ok: true, customerId: resolvedCustomerId };
      } catch (error) {
        if (generation === this.generation && this.host) {
          this.renderError(error?.message || String(error));
        }
        return { ok: false, reason: error?.message || String(error) };
      }
    }

    draft() {
      const form = this.shadow?.querySelector('form[data-call-form]');
      return form ? {
        standardComment: String(form.elements?.standart_comment?.value ?? ''),
        comment: String(form.elements?.comment?.value ?? ''),
        phone: String(form.elements?.dopf_13?.value ?? ''),
        pbxCallKey: String(form.elements?.pbx_call_key?.value ?? '')
      } : null;
    }

    selectedPbxCall() {
      const callKey = String(this.draft()?.pbxCallKey || '');
      return this.pbxCalls.find(call => call.callKey === callKey) || null;
    }

    async bindSelectedPbxCall(options = {}) {
      if (this.binding || this.saving || !this.caseMatchesSnapshot()) return;
      const values = this.draft();
      const callKey = String(values?.pbxCallKey || '');
      if (!callKey) {
        this.renderForm(values, { kind: 'warn', message: 'Сначала выбери завершённый звонок PBX.' });
        return;
      }
      const call = this.pbxCalls.find(item => item.callKey === callKey) || null;
      if (!call) {
        this.renderForm(values, { kind: 'error', message: 'Выбранный звонок уже отсутствует в свежем снимке PBX.' });
        return;
      }
      if (call.binding && call.binding.caseId !== this.caseSnapshot?.caseId) {
        this.renderForm(values, { kind: 'error', message: 'Этот звонок уже закреплён за другим Case.' });
        return;
      }
      const registrationStatus = String(call.binding?.registrationStatus || 'bound');
      if (call.binding?.caseId === this.caseSnapshot?.caseId && ['registered', 'submitting', 'review_required'].includes(registrationStatus)) {
        this.renderForm(values, { kind: 'error', message: 'Этот звонок уже закрыт защитным статусом и не может быть перепривязан.' });
        return;
      }

      const requestedOverride = options.operatorOverride === true;
      const matchLevel = String(call.match?.level || 'none');
      let operatorOverride = requestedOverride && matchLevel !== 'strong';
      if (requestedOverride && matchLevel === 'strong') {
        // Не создаём ложный override, если автоматическая корреляция и так строгая.
        operatorOverride = false;
      }

      if (operatorOverride) {
        const conflicts = Array.isArray(call.match?.conflicts) && call.match.conflicts.length
          ? `\nКонфликтующие признаки: ${call.match.conflicts.join(', ')}.`
          : '';
        const caseLabel = this.caseSnapshot?.label || this.caseSnapshot?.caseId || 'текущий Case';
        const confirmed = window.confirm(
          `Автоматическая привязка PBX-звонка к абоненту НЕ подтверждена.${conflicts}\n\n` +
          `Звонок: ${pbxCallLabel(call)}\n` +
          `Абонент: ${caseLabel}\n\n` +
          'Принять этот звонок под ответственность оператора? Действие будет записано в журнал и не станет автоматическим доказательством связи.'
        );
        if (!confirmed) return;
      }

      this.binding = true;
      try {
        const result = await extensionRequest(PBX_BIND_MESSAGE, {
          caseId: this.caseSnapshot.caseId,
          customerId: this.caseSnapshot.customerId,
          callKey,
          mode: operatorOverride ? 'operator-override' : 'dry-run',
          operatorOverride,
          overrideAcknowledged: operatorOverride
        });
        this.pbxBinding = result?.binding || null;
        this.pbxCalls = this.pbxCalls.map(item => (
          item.callKey === callKey ? { ...item, binding: this.pbxBinding } : item
        ));
        this.binding = false;
        this.renderForm(values, requestedOverride && !operatorOverride
          ? { kind: 'success', message: 'У звонка есть точное совпадение договора/IP; он закреплён обычным строгим способом.' }
          : null);
      } catch (error) {
        this.binding = false;
        this.renderForm(values, { kind: 'error', message: error?.message || String(error) });
      }
    }

    openSelectedRecord() {
      const call = this.selectedPbxCall();
      if (!call?.recordUrl) {
        this.renderForm(this.draft(), { kind: 'warn', message: 'Сначала выбери звонок с готовой записью.' });
        return;
      }
      window.open(call.recordUrl, '_blank', 'noopener,noreferrer');
    }

    async onSubmit(event) {
      const form = event.target.closest?.('form[data-call-form]');
      if (!form || this.saving) return;
      event.preventDefault();
      if (!this.model || !this.caseMatchesSnapshot()) {
        this.renderError('Активный абонент изменился. Открой форму заново.');
        return;
      }

      const values = this.draft();
      if (!values?.pbxCallKey) {
        this.renderForm(values, {
          kind: 'error',
          message: 'Сохранение запрещено: сначала выбери и закрепи завершённый PBX-звонок.'
        });
        return;
      }
      if (this.pbxBinding?.callKey !== values.pbxCallKey) {
        this.renderForm(values, {
          kind: 'error',
          message: 'Выбранный PBX-звонок ещё не закреплён за этим Case. Используй строгую привязку или явное «Принять под ответственность».'
        });
        return;
      }
      const bindingStatus = String(this.pbxBinding?.registrationStatus || 'bound');
      if (bindingStatus !== 'bound') {
        const message = bindingStatus === 'registered'
          ? 'Сохранение запрещено: этот PBX-звонок уже зарегистрирован.'
          : bindingStatus === 'submitting'
            ? 'Сохранение запрещено: этот PBX-звонок уже отправляется из другой вкладки.'
            : 'Сохранение запрещено: сначала вручную проверь результат предыдущей отправки в UserSide.';
        this.renderForm(values, { kind: 'error', message });
        return;
      }
      let fields;
      try {
        fields = serializeNativeCallForm(this.model, values);
      } catch (error) {
        this.renderForm(values, { kind: 'error', message: error?.message || String(error) });
        return;
      }

      this.saving = true;
      for (const button of this.shadow.querySelectorAll('button')) button.disabled = true;
      const submitButton = this.shadow.querySelector('button[type="submit"]');
      if (submitButton) submitButton.textContent = 'Сохраняю…';
      const generation = this.generation;

      try {
        const response = await extensionRequest(SUBMIT_MESSAGE, {
          caseId: this.caseSnapshot.caseId,
          customerId: this.caseSnapshot.customerId,
          pbxCallKey: this.pbxBinding.callKey,
          fields
        });
        recordTelemetry(response);
        const result = classifySubmissionResult(response, this.caseSnapshot.customerId);
        if (result.status === 'unknown') {
          void WB.observability?.report?.({
            severity: 'WARNING',
            code: 'CALL_REGISTRATION_UNCONFIRMED',
            operationType: 'CALL_REGISTRATION',
            source: 'call-registration',
            stage: 'VERIFY_SUBMISSION',
            message: result.message || 'Сохранение звонка не подтверждено',
            expected: 'UserSide confirms call registration',
            actual: { status: result.status },
            details: { caseId: this.caseSnapshot?.caseId || '', customerId: this.caseSnapshot?.customerId || '', pbxCallKey: this.pbxBinding?.callKey || '' }
          });
        } else if (result.status === 'error') {
          void WB.observability?.report?.({
            severity: 'ERROR',
            code: 'CALL_REGISTRATION_REJECTED',
            operationType: 'CALL_REGISTRATION',
            source: 'call-registration',
            stage: 'VERIFY_SUBMISSION',
            message: result.message || 'UserSide не подтвердил регистрацию звонка',
            expected: 'UserSide confirms call registration',
            actual: { status: result.status },
            details: { caseId: this.caseSnapshot?.caseId || '', customerId: this.caseSnapshot?.customerId || '', pbxCallKey: this.pbxBinding?.callKey || '' }
          });
        }
        let finalized;
        try {
          if (!response?.pbxSubmission?.submissionId) {
            throw new Error('Фоновый модуль не вернул ключ защищённой отправки');
          }
          finalized = await extensionRequest(PBX_FINALIZE_MESSAGE, {
            ...response.pbxSubmission,
            status: result.status
          });
        } catch (finalizeError) {
          if (generation !== this.generation || !this.host) return;
          this.saving = false;
          this.renderResult({
            status: 'unknown',
            message: `UserSide ответил, но защитный статус не подтверждён: ${finalizeError?.message || String(finalizeError)}. Не повторяй отправку — сначала проверь историю звонков.`
          });
          return;
        }
        if (generation !== this.generation || !this.host) return;
        this.pbxBinding = finalized?.binding || this.pbxBinding;
        this.pbxCalls = this.pbxCalls.map(call => (
          call.callKey === this.pbxBinding?.callKey ? { ...call, binding: this.pbxBinding } : call
        ));
        this.saving = false;
        if (result.status === 'error') {
          this.renderForm(values, { kind: 'error', message: result.message });
          return;
        }

        this.renderResult(result);
        if (result.status === 'success') {
          const selected = this.model.options.find(option => String(option.value) === String(values.standardComment));
          void WB.store.addEvent?.(
            'call_registration',
            'Звонок зарегистрирован в UserSide',
            {
              customerId: this.caseSnapshot.customerId,
              standardComment: selected?.label || '',
              standardCommentValue: selected?.value || '',
              commentLength: values.comment.length,
              mechanism: 'userside-native-form',
              pbxCallKey: this.pbxBinding?.callKey || '',
              pbxRecordId: this.pbxBinding?.recordId || '',
              pbxBindingMode: this.pbxBinding?.mode || 'dry-run',
              operatorOverride: this.pbxBinding?.mode === 'operator-override'
            }
          );
          const successGeneration = this.generation;
          setTimeout(() => {
            if (this.host && successGeneration === this.generation && !this.saving) this.close();
          }, 1100);
        }
      } catch (error) {
        if (generation !== this.generation || !this.host) return;
        this.saving = false;
        this.renderForm(values, { kind: 'error', message: error?.message || String(error) });
      }
    }

    onClick(event) {
      const actionNode = event.target.closest?.('[data-action]');
      const action = actionNode?.dataset.action || '';
      if (action === 'cancel') {
        this.close();
        return;
      }
      if (action === 'bind-pbx') {
        event.preventDefault();
        void this.bindSelectedPbxCall();
        return;
      }
      if (action === 'bind-pbx-override') {
        event.preventDefault();
        void this.bindSelectedPbxCall({ operatorOverride: true });
        return;
      }
      if (action === 'open-record') {
        event.preventDefault();
        this.openSelectedRecord();
        return;
      }
      if (action === 'backdrop' && event.target === actionNode && !this.saving) {
        this.close();
      }
    }

    onKeydown(event) {
      if (event.key === 'Escape' && this.host && !this.saving) {
        event.preventDefault();
        this.close();
      }
    }

    close() {
      const wasOpen = Boolean(this.host || this.caseSnapshot);
      this.generation += 1;
      this.saving = false;
      this.binding = false;
      this.model = null;
      this.caseSnapshot = null;
      this.pbxCalls = [];
      this.pbxBinding = null;
      this.pbxLoadError = '';
      document.removeEventListener('keydown', this.boundKeydown, true);
      this.host?.remove();
      this.host = null;
      this.shadow = null;
      if (wasOpen) {
        window.dispatchEvent(new CustomEvent('simnet-workbench-module-close', { detail: { module: 'call' } }));
      }
    }

    destroy() {
      this.close();
      window.removeEventListener('simnet-workbench-module-open', this.boundModuleOpen);
      this.unsubStore?.();
    }
  }

  globalThis.__SIMNET_WB_CALL_TEST_API__ = Object.freeze({
    customerIdOf,
    usersideFormUrl,
    parseNativeCallForm,
    serializeNativeCallForm,
    classifySubmissionResult,
    reliablePhone,
    pbxCallLabel
  });

  WB.callRegistration = new CallRegistration();
})();
