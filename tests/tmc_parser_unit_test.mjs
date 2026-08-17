import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
await import(pathToFileURL(path.join(here, '..', 'src', 'core', 'tmc-parser.js')).href);
const parser = globalThis.SIMNET_TMC_PARSER;
assert.ok(parser, 'shared parser exported');

class FakeAnchor {
  constructor(text, href) {
    this.textContent = text;
    this.innerText = text;
    this.href = href;
  }
  getAttribute(name) { return name === 'href' ? this.href : ''; }
}

class FakeBlock {
  constructor(text, anchors = []) {
    this.textContent = text;
    this.innerText = text;
    this.anchors = anchors;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    return selector.includes('/device/') ? this.anchors : [];
  }
  contains(other) { return other === this; }
}

class FakeRoot {
  constructor(blocks) { this.blocks = blocks; }
  querySelectorAll() { return this.blocks; }
}

const huawei = new FakeBlock(
  'Найдено на OLT: Sim36-OLT-Huawei IP: 172.16.1.50 S/N: HWTC12345678 MAC: AA:BB:CC:DD:EE:FF Interface: gpon0/1:16 Расстояние: 1200',
  [new FakeAnchor('Sim36-OLT-Huawei', '/device/555')]
);
let result = parser.parseDocument(new FakeRoot([huawei]), {
  expected: { onuSerial: 'HWTC12345678', onuMac: 'AA:BB:CC:DD:EE:FF' }
});
assert.equal(result.result, 'found');
assert.equal(result.item.oltName, 'Sim36-OLT-Huawei');
assert.equal(result.item.oltIp, '172.16.1.50');
assert.equal(result.item.deviceId, '555');
assert.equal(result.item.serial, 'HWTC12345678');
assert.equal(result.item.mac, 'AA:BB:CC:DD:EE:FF');
assert.equal(result.blockFound, true);
assert.equal(result.deviceLinkFound, true);
assert.equal(result.domTrace.finalStatus, 'FOUND');
assert.equal(result.domTrace.maxLevels, 4);
assert.equal(result.domTrace.levels.length, 1);

const textOnly = new FakeBlock(
  'Знайдено на OLT: BDCOM OLT P3616-2TE IP: 172.16.1.18 Interface: epon0/1:16 MAC: 5C:AA:BB:CC:DD:EE Serial: ABCD12345678',
  []
);
result = parser.parseDocument(new FakeRoot([textOnly]));
assert.equal(result.result, 'found');
assert.match(result.item.oltName, /BDCOM OLT P3616-2TE/i);
assert.equal(result.item.oltIp, '172.16.1.18');
assert.equal(result.deviceLinkFound, false);

const malformed = new FakeBlock('Найдено на OLT: IP отсутствует', []);
result = parser.parseDocument(new FakeRoot([malformed]));
assert.equal(result.result, 'unparsed');
assert.equal(result.blockFound, true);

result = parser.parseDocument(new FakeRoot([]));
assert.equal(result.result, 'missing');
assert.equal(result.blockFound, false);

console.log('tmc_parser_unit_test: OK');
