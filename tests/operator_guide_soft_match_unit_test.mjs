import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const WB = {};
const sandbox = {
  SIMNET_WB: WB,
  globalThis: null,
  JSON, Object, Array, String, Number, Set, Map, RegExp, Math, console
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const relative of [
  'src/graph/conversation/conversation-content.js',
  'src/graph/conversation/conversation-scenario-work-apps.js',
  'src/graph/conversation/conversation-search-data.js',
  'src/graph/conversation/conversation-search-engine.js',
  'src/graph/conversation/conversation-search-soft-match.js'
]) {
  vm.runInContext(read(relative), sandbox, { filename: path.basename(relative) });
}

const api = WB.operatorGuideSearch;
assert.ok(api, 'search API must load');
assert.equal(api.revision, 'operator-guide-local-search-engine-v1-soft-generic');

{
  const result = api.search('что-то интернет сегодня плохой', { limit: 8 });
  assert.ok(result.length > 0, 'generic internet-quality complaint must produce a soft suggestion');
  assert.deepEqual([result[0].topicId, result[0].symptomId], ['low_speed', 'internet_slow']);
  assert.ok(result[0].score >= 0.43, 'soft suggestion must be visible as at least a medium UI candidate');
  assert.ok(Array.from(result[0].reasons).includes('generic-complaint: internet-quality'));
}

{
  const result = api.search('нет интернета вообще ничего не открывается', { limit: 8 });
  assert.notDeepEqual([result[0]?.topicId, result[0]?.symptomId], ['low_speed', 'internet_slow'], 'explicit outage must not be rewritten as a generic slow complaint');
}

{
  const result = api.search('каждые пять минут отваливается потом само появляется', { limit: 8 });
  assert.deepEqual([result[0].topicId, result[0].symptomId], ['unstable', 'every_few_minutes'], 'strong existing matches must remain untouched');
}

console.log('operator_guide_soft_match_unit_test: PASS');
