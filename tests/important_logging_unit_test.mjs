import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const originalWindow = globalThis.window;
const originalWorkbench = globalThis.SIMNET_WB;
const originalInfo = console.info;
const originalWarn = console.warn;
const originalError = console.error;
const entries = [];

try {
  globalThis.window = globalThis;
  globalThis.window.top = globalThis.window;
  globalThis.window.self = globalThis.window;
  delete globalThis.SIMNET_WB;

  console.info = (...args) => entries.push({ level: 'info', args });
  console.warn = (...args) => entries.push({ level: 'warn', args });
  console.error = (...args) => entries.push({ level: 'error', args });

  vm.runInThisContext(
    fs.readFileSync(
      new URL('../src/content/namespace.js', import.meta.url),
      'utf8'
    )
  );

  const log = globalThis.SIMNET_WB.log;
  assert.ok(log, 'important logger should be exposed');
  log.info('GUIDE', 'Подсказка показана', { stepId: 'billing.ask-olt' });
  log.warn('TERMINAL', 'Блок не создан', { blocks: 0 });
  assert.equal(log.changed('locator', 'poll', 'LOCATOR', 'Следующий шаг'), true);
  assert.equal(log.changed('locator', 'poll', 'LOCATOR', 'Следующий шаг'), false);
  assert.equal(log.changed('locator', 'tmc', 'LOCATOR', 'Следующий шаг'), true);

  assert.ok(
    entries.some(entry => String(entry.args[0]).startsWith('[SIMNET WB][GUIDE]')),
    'Guide events should have a filterable prefix'
  );
  assert.ok(
    entries.some(entry => String(entry.args[0]).startsWith('[SIMNET WB][TERMINAL]')),
    'Terminal warnings should have a filterable prefix'
  );
  assert.equal(
    entries.filter(entry => String(entry.args[0]).includes('[LOCATOR]')).length,
    2,
    'unchanged Locator state should not spam DevTools'
  );
} finally {
  console.info = originalInfo;
  console.warn = originalWarn;
  console.error = originalError;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalWorkbench === undefined) delete globalThis.SIMNET_WB;
  else globalThis.SIMNET_WB = originalWorkbench;
}

console.log('important_logging_unit_test: PASS');
