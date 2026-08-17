import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const jsdomModule = process.env.SIMNET_JSDOM_MODULE;
if (!jsdomModule) throw new Error('SIMNET_JSDOM_MODULE must point to jsdom/lib/api.js');
const { JSDOM } = await import(pathToFileURL(jsdomModule).href);

const source = fs.readFileSync(new URL('../src/ui/call-registration.js', import.meta.url), 'utf8');
const nativeForm = `<!doctype html><html><body>
  <form method="post" action="/message/save_call">
    <input type="hidden" name="_csrf" value="fresh-csrf">
    <input type="hidden" name="customer_id" value="191">
    <input type="hidden" name="add_field_sub_category_id" value="5">
    <input type="hidden" name="additional_fields[]" value="13">
    <select name="standart_comment">
      <option value="0" selected></option>
      <option value="20">Аварія</option>
      <option value="18">Прочее</option>
      <option value="16">Регистрация МАС адреса</option>
      <option value="19">Тех. питання</option>
      <option value="17">Фінансове питання</option>
    </select>
    <textarea name="comment"></textarea>
    <input name="dopf_13" maxlength="35" required>
    <input id="submit_but_id" type="submit" value="Сохранить">
  </form>
</body></html>`;

const dom = new JSDOM('<!doctype html><html><body><main>CRM</main></body></html>', {
  url: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?a=user&id=19',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});

const fact = value => ({ value, confidence: 0.99, source: 'userside:customer-card' });
const activeCase = {
  id: 'login:kundanika',
  identity: {
    login: fact('kundanika'),
    contract: fact('1910')
  },
  profile: {}
};
const journal = [];
const busListeners = new Map();
const sent = [];
dom.window.SIMNET_WB = {
  bus: {
    on(type, handler) {
      const bucket = busListeners.get(type) || [];
      bucket.push(handler);
      busListeners.set(type, bucket);
      return () => {};
    }
  },
  store: {
    activeCase() { return activeCase; },
    rememberCustomerId(caseId, customerId, source) {
      assert.equal(caseId, activeCase.id);
      activeCase.identity.customerId = { value: customerId, confidence: 0.99, source };
      return true;
    },
    async addEvent(type, message, details) {
      journal.push({ type, message, details });
    }
  }
};
dom.window.chrome = {
  runtime: {
    async sendMessage(message) {
      sent.push(structuredClone(message));
      if (message.type === 'CALL_REGISTRATION_FORM') {
        return {
          success: true,
          data: {
            ok: true,
            status: 200,
            url: 'https://userside.simnet.kiev.ua/message/tab?section=call&customer_id=191',
            redirected: false,
            data: nativeForm,
            customerId: '191',
            resolver: 'gotouser',
            telemetry: [{ label: 'call-form', durationMs: 23, bytes: nativeForm.length, ok: true }]
          }
        };
      }
      if (message.type === 'PBX_RECENT_CALLS_QUERY') {
        return {
          success: true,
          data: {
            caseId: activeCase.id,
            customerId: '191',
            calls: [{
              callKey: 'pbx:1786725676.187490',
              recordId: '1786725676.187490',
              recordUrl: 'https://pbx.simnet.kiev.ua/fop2/getrec.php?id=1786725676.187490',
              date: '2026-08-14',
              time: '19:41:16',
              callerMasked: '044***67',
              duration: '00:00:36',
              agentExtension: '6047',
              match: { level: 'strong', matchedBy: ['contract'], confidence: 1 },
              binding: null
            }]
          }
        };
      }
      if (message.type === 'PBX_CALL_BIND') {
        return {
          success: true,
          data: {
            accepted: true,
            binding: {
              callKey: message.payload.callKey,
              recordId: '1786725676.187490',
              caseId: activeCase.id,
              customerId: '191',
              mode: 'dry-run',
              registrationStatus: 'bound'
            }
          }
        };
      }
      if (message.type === 'CALL_REGISTRATION_SUBMIT') {
        return {
          success: true,
          data: {
            ok: true,
            status: 200,
            url: 'https://userside.simnet.kiev.ua/customer/191',
            redirected: true,
            data: '<!doctype html><html><body>Карточка абонента</body></html>',
            pbxSubmission: {
              submissionId: 'submission-test-1',
              callKey: message.payload.pbxCallKey,
              caseId: activeCase.id,
              customerId: '191'
            }
          }
        };
      }
      if (message.type === 'PBX_CALL_SUBMISSION_FINALIZE') {
        return {
          success: true,
          data: {
            resultStatus: message.payload.status,
            binding: {
              callKey: message.payload.callKey,
              recordId: '1786725676.187490',
              caseId: activeCase.id,
              customerId: '191',
              mode: 'dry-run',
              registrationStatus: 'registered'
            }
          }
        };
      }
      throw new Error(`Unexpected message ${message.type}`);
    }
  }
};

dom.window.eval(source);
const api = dom.window.__SIMNET_WB_CALL_TEST_API__;
assert.ok(api, 'call registration test API should be exposed');

const parsed = api.parseNativeCallForm(nativeForm, '191');
assert.equal(parsed.customerId, '191');
assert.equal(parsed.csrf, 'fresh-csrf');
assert.deepEqual(
  Array.from(parsed.options, option => option.value),
  ['0', '20', '18', '16', '19', '17']
);
assert.ok(parsed.hiddenFields.some(field => field.name === 'additional_fields[]' && field.value === '13'));

const serialized = api.serializeNativeCallForm(parsed, {
  standardComment: '19',
  comment: 'Нет интернета после перезагрузки',
  phone: '0441234567'
});
assert.ok(serialized.some(field => field.name === '_csrf' && field.value === 'fresh-csrf'));
assert.ok(serialized.some(field => field.name === 'standart_comment' && field.value === '19'));
assert.ok(serialized.some(field => field.name === 'dopf_13' && field.value === '0441234567'));
assert.throws(
  () => api.parseNativeCallForm(nativeForm, '192'),
  /другому абоненту/
);

assert.equal(
  api.classifySubmissionResult({
    ok: true,
    status: 200,
    url: 'https://userside.simnet.kiev.ua/customer/191',
    redirected: true,
    data: '<html><body>Карточка</body></html>'
  }, '191').status,
  'success'
);
assert.equal(
  api.classifySubmissionResult({
    ok: true,
    status: 200,
    url: 'https://userside.simnet.kiev.ua/message/save_call',
    redirected: false,
    data: nativeForm
  }, '191').status,
  'error',
  'a returned native form is not a successful save'
);
assert.equal(
  api.classifySubmissionResult({
    ok: true,
    status: 200,
    url: 'https://userside.simnet.kiev.ua/message/save_call',
    redirected: false,
    data: '<html><body>Ответ обработан</body></html>'
  }, '191').status,
  'unknown',
  'plain HTTP 200 is never promoted to success'
);

assert.equal(await dom.window.SIMNET_WB.callRegistration.open(activeCase).then(result => result.ok), true);
assert.equal(sent[0].payload.caseId, activeCase.id);
assert.equal(sent[0].payload.customerId, '');
assert.equal(sent[1].type, 'PBX_RECENT_CALLS_QUERY');
const host = dom.window.document.getElementById('simnet-workbench-call-registration-host');
assert.ok(host?.shadowRoot, 'modal should be isolated in a shadow root');
const shadow = host.shadowRoot;
assert.equal(shadow.querySelector('[name="standart_comment"]').options.length, 6);
assert.equal(shadow.querySelector('[name="pbx_call_key"]').value, 'pbx:1786725676.187490');
shadow.querySelector('[data-action="bind-pbx"]').click();
await new Promise(resolve => dom.window.setTimeout(resolve, 20));
assert.equal(sent[2].type, 'PBX_CALL_BIND');
assert.equal(sent[2].payload.caseId, activeCase.id);
assert.match(shadow.querySelector('.pbx-card .status.success').textContent, /ничего не отправило в UserSide/);
shadow.querySelector('[name="standart_comment"]').value = '19';
shadow.querySelector('[name="comment"]').value = 'Проверка связи';
shadow.querySelector('[name="dopf_13"]').value = '0441234567';
shadow.querySelector('form[data-call-form]').dispatchEvent(new dom.window.Event('submit', {
  bubbles: true,
  cancelable: true
}));
await new Promise(resolve => dom.window.setTimeout(resolve, 20));

assert.match(shadow.querySelector('.status.success').textContent, /Звонок зарегистрирован/);
assert.equal(sent[3].type, 'CALL_REGISTRATION_SUBMIT');
assert.equal(sent[3].payload.caseId, activeCase.id);
assert.equal(sent[3].payload.customerId, '191');
assert.equal(sent[3].payload.pbxCallKey, 'pbx:1786725676.187490');
assert.ok(sent[3].payload.fields.some(field => field.name === '_csrf' && field.value === 'fresh-csrf'));
assert.equal(sent[4].type, 'PBX_CALL_SUBMISSION_FINALIZE');
assert.equal(sent[4].payload.submissionId, 'submission-test-1');
assert.equal(sent[4].payload.status, 'success');
assert.equal(journal.length, 1);
assert.equal(journal[0].type, 'call_registration');
assert.equal(journal[0].details.standardCommentValue, '19');
assert.equal(journal[0].details.pbxRecordId, '1786725676.187490');
assert.equal('phone' in journal[0].details, false);
assert.equal('comment' in journal[0].details, false);

dom.window.SIMNET_WB.callRegistration.destroy();
assert.equal(dom.window.document.getElementById('simnet-workbench-call-registration-host'), null);

console.log('call_registration_dom_integration_test: PASS');
