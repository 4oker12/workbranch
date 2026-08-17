import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'src/semantic-studio/index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src/semantic-studio/studio.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'src/semantic-studio/studio.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(ROOT, 'src/ui/popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(ROOT, 'src/ui/popup.js'), 'utf8');
const graph = fs.readFileSync(path.join(ROOT, 'src/graph/graph-studio.js'), 'utf8');
const scripts = manifest.content_scripts?.flatMap(item => item.js || []) || [];

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`);
};

check('Semantic Studio is a standalone extension page', html.includes('SIMNET Semantic Studio') && html.includes('src="studio.js"') && !scripts.includes('src/semantic-studio/studio.js'));
check('standalone page reuses canonical semantic tree read-only source', html.includes('../core/semantic-tree.js') && js.includes('tree.snapshot()'));
check('Studio explicitly cannot mutate Billing/UserSide runtime', html.includes('не меняет текущую диагностику Billing/UserSide') && !js.includes('chrome.tabs.update') && !js.includes('patchWorkflow') && !js.includes('sendMessage'));
check('popup opens Studio in a separate extension tab', popupHtml.includes('semanticStudio') && popupJs.includes("chrome.runtime.getURL('src/semantic-studio/index.html')"));
check('Studio supports new contexts and nodes', js.includes('function addContext()') && js.includes('function addNode()'));
check('Studio supports explicit A to B edge editing', html.includes('A → B') && js.includes('function handleLinkNodeClick') && js.includes('data-edge-field="from"') && js.includes('data-edge-field="to"'));
check('Studio supports edge labels conditions and operation binding', js.includes('data-edge-field="label"') && js.includes('data-edge-field="condition"') && js.includes('data-edge-field="operationId"'));
check('Studio has draft then explicit confirmation boundary', js.includes('state.confirmed') && js.includes('state.draft') && js.includes('showConfirmModal') && js.includes('applyConfirm'));
check('confirmed versions retain bounded history', js.includes('state.history.push') && js.includes('slice(-30)'));
check('Studio supports export and import proposals', js.includes('simnet-semantic-studio-export-v1') && html.includes('Импорт') && js.includes('importModel'));
check('Studio supports freeform idea notes', html.includes('Идея / диалог') && js.includes('function saveIdea()'));
check('Studio supports quick semantic route sketching', html.includes('Техданные -> ТМЦ -> Save -> ONU') && js.includes('function createQuickRoute()'));
check('Studio has pan zoom node dragging and reduced-motion support', js.includes('startPan') && js.includes('setZoom') && js.includes('onNodePointerDown') && css.includes('prefers-reduced-motion'));
const semanticGuardMatch = graph.match(/const semanticActions = new Set\(\[([\s\S]*?)\]\);/);
const semanticGuard = semanticGuardMatch?.[1] || '';
check('runtime semantic graph remains read-only', Boolean(semanticGuard) && !/save|publish|delete|add-node|add-edge/.test(semanticGuard));
check('no remote scripts or unsafe eval in Studio', !/https?:\/\//.test(html) && !js.includes('eval(') && !js.includes('new Function'));

const failed = results.filter(item => !item.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length }, null, 2));
process.exit(failed.length ? 1 : 0);
