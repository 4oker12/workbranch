import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'src/graph/graph-studio.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const scripts = manifest.content_scripts?.[0]?.js || [];

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
};

check(
  'semantic tree loads before Graph Studio',
  scripts.includes('src/core/semantic-tree.js')
    && scripts.indexOf('src/core/semantic-tree.js') < scripts.indexOf('src/graph/graph-studio.js')
);
check('Graph Studio supports semantic mode', source.includes("requestedMode === 'semantic' ? 'semantic'") && source.includes("state.mode === 'semantic'"));
check('runtime graph exposes semantic map entry', source.includes('data-action="semantic-open"') && source.includes('Смысловая карта'));
check('semantic map renders canonical WB.semanticTree', source.includes('WB.semanticTree?.subgraph?.') && source.includes('WB.semanticTree?.validate?.()'));
check('semantic map supports context filtering', source.includes('data-action="semantic-context"') && source.includes('semanticContextId'));
check('semantic map supports interactive node inspection', source.includes('data-action="semantic-select-node"') && source.includes('semanticInspector('));
check('semantic map exposes operation owners/evidence', source.includes('operation.ownerFiles') && source.includes('operation.successEvidence'));

const semanticGuardMatch = source.match(/const semanticActions = new Set\(\[([\s\S]*?)\]\);/);
const semanticGuard = semanticGuardMatch?.[1] || '';
check('semantic mode is read-only', Boolean(semanticGuard) && !/save|publish|add-type|delete-type|add-question|add-outcome/.test(semanticGuard), semanticGuard.replace(/\s+/g, ' ').trim());
check('semantic map never becomes a third Case progress store', !/patchAppeal\([^)]*semantic/i.test(source) && !/patchWorkflow\([^)]*semantic/i.test(source));

const failed = results.filter(item => !item.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length }, null, 2));
process.exit(failed.length ? 1 : 0);
