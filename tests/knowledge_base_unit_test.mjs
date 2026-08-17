import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = fs.readFileSync(
  path.join(root, 'src/ui/knowledge-base.js'),
  'utf8'
);

const sandbox = {
  globalThis: {
    SIMNET_WB: {}
  },
  window: {}
};
sandbox.window.top = sandbox.window;
sandbox.window.self = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const kb = sandbox.globalThis.SIMNET_WB.knowledge;
if (!kb) throw new Error('knowledge base not exposed');
if (Object.keys(kb.entries).length < 10) {
  throw new Error('too few initial knowledge entries');
}

const technical = kb.resolve({ id: 'billing.open-technical' });
if (technical?.id !== 'billing.technical-data') {
  throw new Error('technical data mapping failed');
}

const tmc = kb.resolve({ id: 'userside.inspect-tmc:AA:BB:172.16.1.50' });
if (tmc?.id !== 'userside.tmc-olt') {
  throw new Error('dynamic TMC step mapping failed');
}

const mac = kb.resolve({ id: 'userside.search-mac' });
if (!mac?.what || !mac?.why || !mac?.action) {
  throw new Error('knowledge entry is incomplete');
}

console.log('knowledge base unit tests passed');
