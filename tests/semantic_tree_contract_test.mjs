import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'src/core/semantic-tree.js'), 'utf8');
const ctx = vm.createContext({ console });
ctx.SIMNET_WB = {};
vm.runInContext(source, ctx, { filename: 'semantic-tree.js' });
const tree = ctx.SIMNET_WB.semanticTree;

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
};

check('semantic tree API exists', Boolean(tree?.snapshot && tree?.subgraph && tree?.validate));
const report = tree.validate();
check('canonical semantic model validates', report.valid, report.errors?.join('; ') || 'valid');
check('root is one Case', tree.rootId === 'case', tree.rootId);

const model = tree.snapshot();
const operationIds = Object.keys(model.operations || {});
for (const id of [
  'appeal.route', 'juniper.inspect', 'technical.inspect', 'tmc.inspect', 'tmc.writeback',
  'onu.poll', 'mac.search', 'ethernet.inspect', 'history.replay', 'call.register'
]) {
  check(`operation ${id} is registered`, operationIds.includes(id));
}

const bound = new Set();
for (const node of Object.values(model.nodes || {})) if (node.operationId) bound.add(node.operationId);
for (const edge of model.edges || []) if (edge.operationId) bound.add(edge.operationId);
check('no semantic operation is orphaned', operationIds.every(id => bound.has(id)), operationIds.filter(id => !bound.has(id)).join(','));

const access = tree.subgraph('access');
check('access context contains TMC teleport', Boolean(access.nodes?.['op.tmc.inspect']));
check('access context contains native Save gate', Boolean(access.nodes?.['gate.native-save']));
check('access context contains ONU poll', Boolean(access.nodes?.['op.onu.poll']));
check('access context excludes unrelated call registration', !access.nodes?.['op.call.register']);

const tmcFoundEdge = (model.edges || []).find(edge => edge.from === 'op.tmc.inspect' && edge.to === 'fact.tmc.found');
check('TMC success requires teleport visual proof', /teleport/i.test(tmcFoundEdge?.condition || '') && /highlight/i.test(tmcFoundEdge?.condition || ''), tmcFoundEdge?.condition || '');

const saveEdge = (model.edges || []).find(edge => edge.from === 'gate.native-save' && edge.to === 'fact.writeback.saved');
check('writeback success requires fresh persisted verification', /new document/i.test(saveEdge?.condition || '') && /verif/i.test(saveEdge?.condition || ''), saveEdge?.condition || '');

const rejectEdge = (model.edges || []).find(edge => edge.from === 'fact.writeback.rejected' && edge.to === 'op.tmc.writeback');
check('operator rejection is an explicit retry branch', Boolean(rejectEdge), rejectEdge?.label || '');

check('semantic placement rules are explicit', (tree.placementRules || []).some(rule => /semantic placement/i.test(rule)) && (tree.placementRules || []).some(rule => /новый semantic context/i.test(rule)));

const failed = results.filter(item => !item.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length }, null, 2));
process.exit(failed.length ? 1 : 0);
