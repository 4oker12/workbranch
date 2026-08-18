import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const sources = {
  content: read('src/graph/conversation/conversation-content.js'),
  scenario: read('src/graph/conversation/conversation-scenario-work-apps.js'),
  data: read('src/graph/conversation/conversation-search-data.js'),
  engine: read('src/graph/conversation/conversation-search-engine.js')
};
const manifest = JSON.parse(read('manifest.json'));

const WB = {};
const forbidden = label => () => { throw new Error(`search side effect attempted: ${label}`); };
const sandbox = {
  SIMNET_WB: WB, globalThis: null, JSON, Object, Array, String, Number, Set, Map, RegExp, Math, console,
  fetch: forbidden('fetch'),
  chrome: {
    storage: { local: { get: forbidden('chrome.storage.local.get'), set: forbidden('chrome.storage.local.set') } },
    runtime: { sendMessage: forbidden('chrome.runtime.sendMessage') }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(sources.content, sandbox, { filename: 'conversation-content.js' });
vm.runInContext(sources.scenario, sandbox, { filename: 'conversation-scenario-work-apps.js' });
WB.store = new Proxy({}, { get: () => { throw new Error('SearchEngine must not read Case/store'); } });
WB.log = new Proxy({}, { get: () => forbidden('diagnostics') });
vm.runInContext(sources.data, sandbox, { filename: 'conversation-search-data.js' });
vm.runInContext(sources.engine, sandbox, { filename: 'conversation-search-engine.js' });

const api = WB.operatorGuideSearch;
assert.ok(api, 'read-only Operator Guide Search debug API must load');
assert.equal(api.revision, 'operator-guide-local-search-engine-v1');
assert.deepEqual(Array.from(api.providers), ['lexical', 'fuzzy']);

const effectiveTopics = WB.conversationGraphContent.topics();
assert.deepEqual(Array.from(effectiveTopics, topic => topic.id), ['low_speed', 'no_internet', 'unstable', 'other'], 'search must index the final approved Operator Guide topics');
assert.equal(WB.conversationGraphContent.symptom('other', 'logout_or_crash')?.label, 'Вылогинивает / вылетает', 'search must load after the approved work-apps scenario replaces base other');

const validation = api.validate();
const effectiveCloudCount = effectiveTopics.reduce((sum, topic) => sum + topic.variants.length, 0);
assert.equal(validation.valid, true);
assert.equal(validation.profileCount, effectiveCloudCount, 'every effective cloud must have exactly one search profile');
assert.equal(validation.profileCount, 32, 'current Operator Guide has 32 effective clouds');

const result = (query, topicId, symptomId) => api.search(query, { limit: 64, minScore: 0 }).find(item => item.topicId === topicId && item.symptomId === symptomId);
const top = query => api.search(query, { limit: 16, minScore: 0.12 })[0];

{
  const query = 'ютуб работает нормально а рабочая программа выкидывает';
  assert.deepEqual([top(query).topicId, top(query).symptomId], ['other', 'logout_or_crash']);
  assert.ok(top(query).score >= 0.60);
  assert.ok(result(query, 'other', 'work_software_only').score >= 0.43);
  assert.ok(result(query, 'other', 'regular_internet_ok').score >= 0.43);
}
{
  const query = 'абон жалуется постоянные перебои, не грузит, напрямую нет возможности';
  assert.deepEqual([top(query).topicId, top(query).symptomId], ['unstable', 'every_few_minutes']);
  assert.ok(top(query).score >= 0.60);
  assert.ok(result(query, 'no_internet', 'connected_no_network').score < top(query).score);
}
{
  const query = 'дуже повільно працює інтернет на протязі дня на всіх пристроях';
  assert.deepEqual([top(query).topicId, top(query).symptomId], ['low_speed', 'very_slow_load']);
  assert.ok(result(query, 'low_speed', 'internet_slow').score >= 0.43);
}
{
  const query = 'wifi есть но пишет без интернета';
  assert.deepEqual([top(query).topicId, top(query).symptomId], ['no_internet', 'wifi_connected_no_access']);
  assert.ok(result(query, 'no_internet', 'connected_no_network').score >= 0.43);
}
{
  const query = 'каждые пять минут отваливается потом само появляется';
  assert.deepEqual([top(query).topicId, top(query).symptomId], ['unstable', 'every_few_minutes']);
  assert.ok(top(query).score >= 0.60);
}
{
  const query = 'на телефоне не работает а ноут работает нормально';
  const specific = result(query, 'no_internet', 'phone_no_internet');
  const general = result(query, 'no_internet', 'nothing_opens');
  assert.ok(specific.score >= 0.60, 'specific-device candidate must be strong');
  assert.ok(specific.score > general.score, 'specific-device candidate must outrank full outage');
}
{
  const query = 'постоянно вікідует из рабочй програми';
  assert.deepEqual([top(query).topicId, top(query).symptomId], ['other', 'logout_or_crash']);
  assert.ok(top(query).score >= 0.60, 'mixed-language typo must still match strongly');
}
{
  const query = 'напрямую проверить не может';
  assert.equal(api.search(query).length, 0, 'limitation-only text must not create symptom candidates');
}
{
  const query = 'инет то есть то нет';
  assert.deepEqual([top(query).topicId, top(query).symptomId], ['unstable', 'comes_and_goes']);
  assert.ok(top(query).score >= 0.60);
}
{
  const query = 'сайты открываются но удаленка подвисает';
  assert.deepEqual([top(query).topicId, top(query).symptomId], ['other', 'remote_desktop_hangs']);
  const outage = api.search(query, { limit: 64, minScore: 0 }).filter(item => item.topicId === 'no_internet').reduce((max, item) => Math.max(max, item.score), 0);
  assert.ok(outage < 0.34, 'normal browsing must conflict with full-outage candidates');
}

assert.equal(api.normalize('ІНЕТ,   тупит!!!'), 'интернет тупит');
assert.equal(api.normalize('напрямую нет возможности'), '');

for (const profile of WB.operatorGuideSearchData.profiles) {
  const representative = profile.phrases[0]?.text || '';
  const match = result(representative, profile.topicId, profile.symptomId);
  assert.ok(match && match.score > 0, `representative phrase must reach ${profile.topicId}:${profile.symptomId}`);
}

const before = api.indexStats();
for (let index = 0; index < 100; index += 1) api.search(`интернет пропадает ${index % 7}`, { limit: 12 });
assert.deepEqual(api.indexStats(), before, '100 searches must not grow the immutable index');
assert.deepEqual(api.validate(), validation, 'repeated initialization/validation must not duplicate index data');

const explainable = api.search('каждые пять минут отваливается потом само появляется')[0];
assert.ok(explainable.reasons.length >= 2, 'ranked result must expose tuning/debug reasons');
assert.ok(explainable.reasons.some(reason => /^pattern:|^phrase:|^keyword:/.test(reason)));

const scripts = manifest.content_scripts[0].js;
const scenarioIndex = scripts.indexOf('src/graph/conversation/conversation-scenario-work-apps.js');
const dataIndex = scripts.indexOf('src/graph/conversation/conversation-search-data.js');
const engineIndex = scripts.indexOf('src/graph/conversation/conversation-search-engine.js');
const runtimeIndex = scripts.indexOf('src/graph/conversation/conversation-runtime.js');
const controllerIndex = scripts.indexOf('src/graph/conversation/conversation-search-controller.js');
assert.ok(scenarioIndex >= 0 && scenarioIndex < dataIndex && dataIndex < engineIndex && engineIndex < runtimeIndex && runtimeIndex < controllerIndex, 'manifest must establish final content before search index/engine and runtime before search UI controller');

for (const source of [sources.data, sources.engine]) {
  for (const forbiddenToken of ['MutationObserver', 'ResizeObserver', 'setInterval', 'requestAnimationFrame', 'getBoundingClientRect', 'chrome.storage', 'runtime.sendMessage', 'fetch(', 'WB.bus.emit', 'WB.store.', 'WB.log.']) {
    assert.ok(!source.includes(forbiddenToken), `pure SearchEngine/data must not contain ${forbiddenToken}`);
  }
}

console.log('operator_guide_search_unit_test: PASS');
