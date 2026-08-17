import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const jsdomModule = process.env.SIMNET_JSDOM_MODULE;
if (!jsdomModule) throw new Error('SIMNET_JSDOM_MODULE must point to jsdom/lib/api.js');
const { JSDOM } = await import(pathToFileURL(jsdomModule).href);

const dom = new JSDOM(`<!doctype html><html><head><title>UserSide</title></head><body>
  <form id="task"><label for="note">Примечание</label><textarea id="note" name="comment"></textarea></form>
</body></html>`, {
  url: 'https://userside.simnet.kiev.ua/customer/45618#',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});

const stored = [];
dom.window.SIMNET_WB = {
  runtime: { lastContext: { system: 'userside', pageKind: 'userside_customer', entityId: '45618' } },
  store: {
    localCaseId: 'login:abon380822',
    activeCase() { return { id: 'login:abon380822', workflow: { operatorTrace: { enabled: false } } }; },
    async addEvent(type, message, details) { stored.push({ type, message, details }); }
  }
};

dom.window.eval(fs.readFileSync(new URL('../src/core/operator-trace.js', import.meta.url), 'utf8'));
dom.window.SIMNET_WB.operatorTrace.init();
assert.equal(dom.window.SIMNET_WB.operatorTrace.isEnabled(), false, 'detailed operator trace must be opt-in and OFF by default');

const textarea = dom.window.document.getElementById('note');
const secret = 'не пользовалась июль — приватное примечание клиента';
textarea.value = secret;
textarea.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
await new Promise(resolve => dom.window.setTimeout(resolve, 0));
assert.equal(stored.length, 0, 'click/hover/scroll/change journal stays silent before explicit activation');

dom.window.SIMNET_WB.operatorTrace.setEnabled(true);
assert.equal(dom.window.SIMNET_WB.operatorTrace.isEnabled(), true, 'operator can explicitly activate detailed tracing for the current Case');
textarea.value = secret;
for (let i = 1; i <= secret.length; i += 1) {
  textarea.value = secret.slice(0, i);
  textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  textarea.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
await new Promise(resolve => dom.window.setTimeout(resolve, 0));
assert.equal(stored.filter(item => item.type === 'operator_change').length, 0, 'typing/change noise must not write Case');

textarea.value = secret;
textarea.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
await new Promise(resolve => dom.window.setTimeout(resolve, 0));
const changes = stored.filter(item => item.type === 'operator_change');
assert.equal(changes.length, 1, 'free text is summarized once when editing finishes');
assert.match(changes[0].details.value, /^\[текст: \d+ симв\.\]$/);
assert.doesNotMatch(JSON.stringify(changes[0]), /приватное примечание|не пользовалась/i);

textarea.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
await new Promise(resolve => dom.window.setTimeout(resolve, 0));
assert.equal(stored.filter(item => item.type === 'operator_change').length, 1, 'unchanged blur is deduplicated');

dom.window.SIMNET_WB.operatorTrace.destroy();
console.log('operator_trace_privacy_dom_test: PASS');
