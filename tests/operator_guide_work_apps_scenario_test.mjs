import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const contentPath = path.join(root, 'src/graph/conversation/conversation-content.js');
const scenarioPath = path.join(root, 'src/graph/conversation/conversation-scenario-work-apps.js');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const scenarioSource = fs.readFileSync(scenarioPath, 'utf8');

globalThis.SIMNET_WB = {};
await import(`${pathToFileURL(contentPath).href}?base=${Date.now()}`);
await import(`${pathToFileURL(scenarioPath).href}?scenario=${Date.now()}`);

const content = globalThis.SIMNET_WB.conversationGraphContent;
assert.ok(content, 'conversation content API should exist');
assert.equal(content.revision, 'operator-guide-approved-work-apps-v1');

const topic = content.topic('other');
assert.equal(topic.label, 'Другое');
assert.equal(topic.complaint, 'Рабочие программы /\nвылогинивает');
assert.equal(topic.subtitle, 'Суть обращения');
assert.equal(topic.presentation.sideTitle, 'Что оператор должен понять');
assert.equal(topic.presentation.layoutClass, 'layout-scatter');
assert.equal(topic.variants.length, 8, 'approved cloud graph should contain eight concrete novice entry points');

assert.deepEqual(topic.variants.map(item => item.label), [
  'Микрофризы',
  'Вылогинивает / вылетает',
  'Только рабочее ПО',
  'YouTube и сайты ок',
  'VPN / RDP',
  'Подвисает удалёнка',
  'Ошибки в рабочих сервисах',
  'Работает и резко обрывается'
]);

const selected = content.symptom('other', 'logout_or_crash');
assert.ok(selected, 'logout/crash cloud must open a concrete question scenario');
assert.equal(selected.questions.length, 8);
assert.match(selected.questions[0], /YouTube, сайты и обычный интернет работают нормально/);
assert.match(selected.questions[3], /VPN, удалённый рабочий стол, RDP/);
assert.match(selected.questions[5], /мобильную точку доступа/);
assert.match(selected.questions[7], /у коллег тоже/);
assert.ok(selected.meaning.length >= 4);

const regularInternet = content.symptom('other', 'regular_internet_ok');
assert.match(regularInternet.meaning[0], /«интернета нет вообще»/);

const topics = content.topics();
assert.equal(topics.filter(item => item.id === 'other').length, 1);
assert.equal(topics.find(item => item.id === 'other').complaint, topic.complaint);

const scripts = manifest.content_scripts[0].js;
const baseIndex = scripts.indexOf('src/graph/conversation/conversation-content.js');
const scenarioIndex = scripts.indexOf('src/graph/conversation/conversation-scenario-work-apps.js');
const runtimeIndex = scripts.indexOf('src/graph/conversation/conversation-runtime.js');
assert.ok(baseIndex >= 0 && baseIndex < scenarioIndex && scenarioIndex < runtimeIndex,
  'approved scenario must decorate content before the operator-guide runtime captures it');

for (const forbidden of [
  'MutationObserver',
  'ResizeObserver',
  'setInterval',
  'requestAnimationFrame',
  'getBoundingClientRect'
]) {
  assert.ok(!scenarioSource.includes(forbidden), `approved guide scenario must remain event/static-data driven: ${forbidden}`);
}

for (const forbiddenAction of [
  'TMC_RESULT',
  'POLL_RESULT',
  'JUNIPER_SESSION',
  'location.assign',
  'chrome.tabs'
]) {
  assert.ok(!scenarioSource.includes(forbiddenAction), `conversation scenario must not start technical actions: ${forbiddenAction}`);
}

console.log('operator_guide_work_apps_scenario_test: PASS');
