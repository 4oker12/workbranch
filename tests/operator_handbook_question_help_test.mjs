import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const helperPath = 'src/graph/conversation/operator-handbook-question-help.js';
const runtimePath = 'src/graph/conversation/conversation-runtime.js';
const helper = fs.readFileSync(helperPath, 'utf8');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const scripts = manifest.content_scripts?.[0]?.js || [];

const checks = [];
function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
  if (!condition) console.error(`FAIL ${name}`);
  else console.log(`PASS ${name}`);
}

check('question helper is loaded after handbook runtime', scripts.indexOf(helperPath) > scripts.indexOf(runtimePath));
check('question helper loads before conversation mode bridge', scripts.indexOf(helperPath) < scripts.indexOf('src/graph/conversation/conversation-mode-bridge.js'));
check('each question becomes an explicit accordion toggle', helper.includes('data-question-help-toggle') && helper.includes('aria-expanded="false"'));
check('expanded context explains purpose', helper.includes('Зачем спрашиваем'));
check('expanded context explains operator interpretation', helper.includes('Что даёт ответ оператору'));
check('expanded context contains low-tech fallback', helper.includes('Если человеку сложно'));
check('low-tech fallback explicitly avoids unnecessary DNS/CMD', helper.includes('Никаких DNS и командной строки') && helper.includes('не веди его в DNS, CMD'));
check('reboot explanation is evidence not proof', helper.includes('но не готовый диагноз'));
check('device comparison is treated as a control comparison', helper.includes('контрольное сравнение'));
check('only one expanded question is kept visually focused', helper.includes('closeAllExcept'));
check('helper re-applies after handbook actions/input/store renders', helper.includes("[data-handbook-action]") && helper.includes("[data-handbook-search]") && helper.includes("WB.bus.on('store:state', schedule)"));
check('helper tears down panel listeners and store subscription', helper.includes('removeEventListener') && helper.includes('stopStoreWatch') && helper.includes('unbindPanel'));
check('helper has no MutationObserver', !helper.includes('MutationObserver'));
check('helper has no setInterval', !helper.includes('setInterval'));
check('helper does not execute native technical actions', !/askolt|tmc\.writeback|onu\.poll|billingNavigation|chrome\.runtime\.sendMessage/.test(helper));

const failed = checks.filter(item => !item.ok);
if (failed.length) {
  console.error(`\n${failed.length} failed`);
  process.exit(1);
}
console.log(`\n${checks.length} passed`);
