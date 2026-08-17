import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const jsdomModule = process.env.SIMNET_JSDOM_MODULE;
if (!jsdomModule) throw new Error('SIMNET_JSDOM_MODULE must point to jsdom/lib/api.js');
const { JSDOM } = await import(pathToFileURL(jsdomModule).href);

const appealsSource = fs.readFileSync(new URL('../src/ui/appeals-navigator.js', import.meta.url), 'utf8');
const studioSource = fs.readFileSync(new URL('../src/graph/graph-studio.js', import.meta.url), 'utf8');
const dom = new JSDOM('<!doctype html><html><body><main>CRM</main></body></html>', {
  url: 'https://userside.simnet.kiev.ua/customer/42',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});

const storage = {};
const changed = [];
dom.window.chrome = {
  storage: {
    local: {
      async get(keys) {
        const result = {};
        for (const key of keys) if (key in storage) result[key] = structuredClone(storage[key]);
        return result;
      },
      async set(patch) { Object.assign(storage, structuredClone(patch)); }
    },
    onChanged: { addListener(listener) { changed.push(listener); } }
  }
};
dom.window.CSS ||= {};
dom.window.CSS.escape ||= value => String(value).replace(/[^a-zA-Z0-9_-]/g, char => `\\${char}`);
dom.window.confirm = () => true;
dom.window.requestAnimationFrame = callback => dom.window.setTimeout(callback, 0);
dom.window.Element.prototype.getBoundingClientRect = function getRect() {
  const index = Number(this.dataset?.nodeId?.match(/\d+/)?.[0] || 0);
  return { left: 100 + index, top: 100 + index, right: 330 + index, bottom: 180 + index, width: 230, height: 80 };
};

const listeners = new Map();
dom.window.SIMNET_WB = {
  bus: {
    on(type, handler) {
      const bucket = listeners.get(type) || [];
      bucket.push(handler);
      listeners.set(type, bucket);
      return () => {};
    },
    emit(type, payload) {
      for (const handler of listeners.get(type) || []) handler(payload);
    }
  }
};

dom.window.eval(appealsSource);
dom.window.eval(studioSource);
await dom.window.SIMNET_WB.graphStudio.open({ mode: 'studio' });
await new Promise(resolve => dom.window.setTimeout(resolve, 10));

const host = dom.window.document.getElementById('simnet-graph-studio-host');
assert.ok(host?.shadowRoot, 'Graph Studio should mount in an isolated shadow root');
const shadow = host.shadowRoot;
assert.ok(shadow.querySelector('.module.open'));
assert.equal(shadow.querySelectorAll('.type-card').length, 5);
assert.ok(shadow.querySelectorAll('.node-card').length > 10);
assert.ok(shadow.querySelector('.edge-layer'));
assert.ok(shadow.querySelector('[data-type-field="label"]'));
assert.ok(shadow.querySelector('[data-option-field="condition.fact"]'));
assert.equal(shadow.querySelector('[data-action="publish"]').disabled, false);
assert.equal(dom.window.document.body.style.marginRight, '');
assert.ok(shadow.querySelector('.backdrop.open'), 'Graph workspace should use its own backdrop');

const label = shadow.querySelector('[data-type-field="label"]');
label.value = 'Низкая скорость · редакция';
label.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
assert.match(shadow.querySelector('.type-card.active b').textContent, /редакция/);
assert.match(shadow.querySelector('.chip.warn').textContent, /несохранённые/);

shadow.querySelector('[data-action="add-question"]').click();
assert.ok(shadow.querySelector('[data-action="publish"]').disabled, 'question without answers must block publication');
assert.match(shadow.querySelector('.validation').textContent, /Публикация заблокирована/);

dom.window.SIMNET_WB.graphStudio.close();
assert.equal(shadow.querySelector('.module').classList.contains('open'), false);
assert.equal(shadow.querySelector('.launcher'), null, 'floating launcher must not exist');
assert.equal(shadow.querySelector('.backdrop').classList.contains('open'), false);

console.log('graph_studio_dom_integration_test: PASS');

