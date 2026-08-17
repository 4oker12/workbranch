import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const code = fs.readFileSync(new URL('../src/core/tmc-parser.js', import.meta.url), 'utf8');
const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const p = sandbox.globalThis.SIMNET_TMC_PARSER;

const fakeBlock = {
  innerText: 'Найдено на OLT: Huawei MA5800-X7 (172.16.1.10) IP: 172.16.1.10 Interface: GPON 0/6/11:50 Расстояние до OLT: 4193 ONU Rx (dBm): -23.37 S/N: FGXP15A2CB5FMAC:B4:64:15:A2:CB:5E',
  textContent: '',
  querySelectorAll(sel) {
    if (!sel.includes('/device/')) return [];
    return [{ innerText: 'Huawei MA5800-X7 (172.16.1.10)', textContent: '', getAttribute(){ return '/device/123'; } }];
  }
};
const item = p.parseBlock(fakeBlock);
assert.equal(item.serial, 'FGXP15A2CB5F');
assert.equal(item.serialKey, 'FGXP15A2CB5F');
assert.equal(item.mac, 'B4:64:15:A2:CB:5E');
assert.equal(item.oltIp, '172.16.1.10');
console.log('collapsed-label TMC parser OK');
