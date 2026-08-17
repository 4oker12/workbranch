import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src/graph/graph-studio.js'), 'utf8');

for (const token of [
  'Graph Studio',
  'Сохранить черновик',
  'Опубликовать',
  'Импорт',
  'Экспорт',
  'condition.fact',
  'condition.operator',
  'condition.value',
  'drawEdges',
  'add-question',
  'add-outcome',
  'delete-node',
  'restore-builtin',
  'col-resize',
  'simnet-workbench-module-open'
]) assert.ok(source.includes(token), `missing Graph Studio contract token: ${token}`);

assert.ok(source.indexOf('saveDraft(state.graph)') < source.indexOf('studio.publish'));
assert.ok(source.includes('Активные обращения сохранят прежний маршрут'));
assert.ok(source.includes("state.zoom = Math.min(1.2"));
assert.ok(source.includes("state.zoom = Math.max(0.6"));

console.log('graph_studio_ui_contract_test: PASS');

