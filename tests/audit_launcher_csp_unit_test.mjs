import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const source = fs.readFileSync(path.join(root, 'src/audit/launcher.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const contentScripts = manifest.content_scripts[0].js;

assert.ok(contentScripts.includes('src/audit/launcher.js'), 'Audit launcher must be a normal MV3 content script');
assert.ok(!contentScripts.includes('src/audit/audit-loader.js'), 'CSP-unsafe runtime loader must not be used');
assert.equal(fs.existsSync(path.join(root, 'src/audit/audit-loader.js')), false, 'parallel legacy Audit loader must be removed');
assert.doesNotMatch(source, /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(\s*["'`]/, 'Audit execution path must not evaluate JS strings');

class FakeElement {
  constructor(tag, document) {
    this.tagName = String(tag || '').toUpperCase();
    this.ownerDocument = document;
    this.style = {};
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.isConnected = false;
    this.id = '';
    this.title = '';
    this.innerHTML = '';
    if (this.tagName === 'IFRAME') {
      this.contentWindow = { postMessage() {} };
    }
  }
  append(...nodes) {
    for (const node of nodes) {
      if (!node) continue;
      this.children.push(node);
      node.parentElement = this;
      node.isConnected = true;
      this.ownerDocument.register(node);
    }
  }
  appendChild(node) { this.append(node); return node; }
  addEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  querySelector(selector) {
    if (selector === 'svg') return { style: { cssText: '' } };
    if (selector === 'iframe') return this.find(node => node.tagName === 'IFRAME');
    return null;
  }
  querySelectorAll(selector) {
    if (selector === 'iframe') return this.findAll(node => node.tagName === 'IFRAME');
    if (selector === 'a[href]') return [];
    return [];
  }
  find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested = child.find?.(predicate);
      if (nested) return nested;
    }
    return null;
  }
  findAll(predicate, out = []) {
    for (const child of this.children) {
      if (predicate(child)) out.push(child);
      child.findAll?.(predicate, out);
    }
    return out;
  }
  setPointerCapture() {}
  releasePointerCapture() {}
}

class FakeDocument {
  constructor() {
    this.ids = new Map();
    this.body = new FakeElement('body', this);
    this.documentElement = new FakeElement('html', this);
    this.body.isConnected = true;
    this.documentElement.isConnected = true;
    this.documentElement.append(this.body);
    this.title = 'Billing list';
  }
  createElement(tag) { return new FakeElement(tag, this); }
  getElementById(id) { return this.ids.get(id) || null; }
  register(node) {
    if (node?.id) this.ids.set(node.id, node);
    for (const child of node?.children || []) this.register(child);
  }
}

const document = new FakeDocument();
const windowListeners = new Map();
const window = {
  top: null,
  self: null,
  innerWidth: 1400,
  addEventListener(type, fn) {
    const list = windowListeners.get(type) || [];
    list.push(fn);
    windowListeners.set(type, list);
  },
  dispatchEvent(event) {
    for (const fn of windowListeners.get(event.type) || []) fn(event);
    return true;
  }
};
window.top = window;
window.self = window;

class CustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}

const WB = { version: 'test', runtime: { lastContext: null } };
const sandbox = {
  SIMNET_WB: WB,
  globalThis: null,
  window,
  document,
  location: {
    href: 'https://admin.simnet.kiev.ua/adm.pl?a=listuser&start=1',
    hostname: 'admin.simnet.kiev.ua'
  },
  chrome: { runtime: { getURL: p => `chrome-extension://unit/${p}` } },
  CustomEvent,
  URL,
  console,
  setTimeout: fn => { fn(); return 1; },
  clearTimeout() {},
  Math,
  Date,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Map,
  Set,
  Promise
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

assert.equal(WB.__auditLauncherLoaded, true, 'launcher must initialize once');
assert.equal(typeof WB.auditLauncher.open, 'function');
assert.ok(document.getElementById('simnet-data-audit-launcher'), 'Billing list keeps the Audit launcher surface');
assert.ok(document.getElementById('simnet-data-audit-host'), 'host shell exists');
assert.equal(document.documentElement.querySelectorAll('iframe').length, 0, 'heavy audit workspace must not load before operator opens it');

WB.auditLauncher.open();
assert.equal(document.documentElement.querySelectorAll('iframe').length, 1, 'first open creates exactly one Audit iframe');
WB.auditLauncher.open();
WB.auditLauncher.open();
assert.equal(document.documentElement.querySelectorAll('iframe').length, 1, 'repeated opens must reuse the same Audit iframe');
assert.equal(WB.auditLauncher.state.open, true);
WB.auditLauncher.close();
assert.equal(WB.auditLauncher.state.open, false);
assert.equal(document.documentElement.querySelectorAll('iframe').length, 1, 'close keeps initialized workspace for safe reopen');

console.log('audit_launcher_csp_unit_test: PASS');
