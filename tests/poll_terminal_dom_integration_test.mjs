import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const jsdomModule = process.env.SIMNET_JSDOM_MODULE;
if (!jsdomModule) {
  throw new Error('SIMNET_JSDOM_MODULE must point to jsdom/lib/api.js');
}

const { JSDOM } = await import(pathToFileURL(jsdomModule).href);
const fixture = fs.readFileSync(
  new URL('./fixtures/bdcom_gpon_flat_poll.html', import.meta.url),
  'utf8'
);
const source = fs.readFileSync(
  new URL('../src/ui/poll-terminal.js', import.meta.url),
  'utf8'
);
const guideSource = fs.readFileSync(
  new URL('../src/ui/guide.js', import.meta.url),
  'utf8'
);

const events = [];
const listeners = new Map();
const dom = new JSDOM(fixture, {
  url: 'https://admin.simnet.kiev.ua/cgi-bin/adm/stat.pl?a=311&id=44664',
  runScripts: 'outside-only'
});

dom.window.SIMNET_WB = {
  runtime: {},
  bus: {
    on(type, handler) {
      const bucket = listeners.get(type) || [];
      bucket.push(handler);
      listeners.set(type, bucket);
      return () => {};
    },
    emit(type, payload) {
      events.push({ type, payload });
      for (const handler of listeners.get(type) || []) handler(payload);
    }
  },
  contextEngine: {
    detectSystem() {
      return 'billing';
    },
    detectPageKind() {
      return {
        kind: 'billing_onu_poll',
        entityId: '44664',
        subview: 'a311'
      };
    }
  },
  store: {
    activeCase() {
      return {
        network: { mac: { value: '02:00:00:00:00:01' } },
        pon: { onuSerial: { value: 'TEST:15A2D643' } }
      };
    }
  }
};

dom.window.eval(source);
const terminal = dom.window.SIMNET_WB.pollTerminal;
assert.ok(terminal, 'poll terminal helper should load in a browser DOM');

const first = terminal.scan(dom.window.document);
assert.equal(first.created, 8, 'flat Billing output should create 8 command blocks');
assert.equal(first.total, 8, 'all 8 command blocks should remain in the DOM');
assert.equal(first.interpreted.length, 8, 'all command blocks should be interpreted');
assert.equal(
  dom.window.document.querySelectorAll('.simnet-wb-poll-command-block').length,
  8,
  'semantic wrappers should be visible in the page DOM'
);
assert.equal(
  dom.window.document.documentElement.dataset.simnetTerminalResultView,
  'true',
  'terminal result view should become active'
);
assert.ok(
  events.some(event => event.type === 'terminal:result-view'),
  'the Guide/terminal handoff event should be emitted'
);
assert.ok(
  events.some(event => event.type === 'terminal:interpreted'),
  'the interpreted terminal event should be emitted'
);

const macBlock = dom.window.document.querySelector('[data-simnet-family="mac_address"]');
const ethBlock = dom.window.document.querySelector('[data-simnet-family="ont_port_state"]');
const lifecycleBlock = [...dom.window.document.querySelectorAll('[data-simnet-family="ont_info"]')]
  .find(block => /basic-info/i.test(block.dataset.simnetCommand || ''));
assert.equal(macBlock?.dataset.simnetVisualPriority, 'decisive');
assert.equal(ethBlock?.dataset.simnetVisualPriority, 'decisive');
assert.match(macBlock?.dataset.simnetCaption || '', /КЛЮЧЕВОЕ 1\/2/);
assert.match(ethBlock?.dataset.simnetCaption || '', /КЛЮЧЕВОЕ 2\/2/);
assert.match(macBlock?.dataset.simnetSummary || '', /MAC ИЗУЧЕН.*СОВПАДАЕТ/i);
assert.equal(ethBlock?.dataset.simnetSummary, 'LINK UP · 1 Гбит/с · Full-Duplex');
assert.equal(macBlock?.dataset.simnetState, 'normal');
assert.equal(ethBlock?.dataset.simnetState, 'normal');
assert.equal(lifecycleBlock?.dataset.simnetVisualPriority, 'history');
assert.match(lifecycleBlock?.dataset.simnetSummary || '', /событий за 7 дней: 1/i);

const terminalStyle = dom.window.document.getElementById('simnet-wb-poll-terminal-style')?.textContent || '';
assert.match(terminalStyle, /data-simnet-visual-priority="decisive"/);
assert.match(terminalStyle, /content:"✓ "/);
assert.match(terminalStyle, /content:"! "/);

const second = terminal.scan(dom.window.document);
assert.equal(second.created, 0, 'a repeated scan should not wrap blocks again');
assert.equal(second.total, 8, 'a repeated scan should preserve the 8 blocks');

dom.window.eval(guideSource);
const stalePollCase = {
  diagnostic: { readyForOnuPoll: true },
  locator: {
    recommendation: {
      action: 'poll_current_binding',
      reason: 'stale recommendation from before the terminal response'
    }
  }
};
const nextPlan = dom.window.SIMNET_WB.guide.plan(stalePollCase);
assert.equal(
  nextPlan.id,
  'result.review-terminal',
  'terminal DOM should override a stale Ask OLT recommendation'
);
assert.equal(nextPlan.kind, 'none', 'no stale highlight action should remain');

console.log('poll_terminal_dom_integration_test: PASS (8/8 + evidence hierarchy)');
