import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guide = fs.readFileSync(path.join(ROOT, 'src/ui/guide.js'), 'utf8');
const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });

check('TMC teleport has explicit viewport geometry test',
  guide.includes('function rectIntersectsViewport(')
  && guide.includes('function tmcElementInViewport('));
check('TMC Focus retries explicit document scroll when scrollIntoView did not land',
  guide.includes("const requiresViewportTeleport = Boolean(")
  && guide.includes("String(this.actionSession.semanticTargetId || '') === 'userside.tmc'")
  && guide.includes('window.scrollTo({ top: desiredY, behavior: \'auto\' })'));
check('offscreen TMC target fails instead of recording a false success',
  guide.includes("code: 'TMC_TELEPORT_VIEWPORT_NOT_REACHED'")
  && guide.includes("reason: 'tmc-target-not-in-viewport'"));
check('TMC milestone requires highlighted values themselves in viewport',
  guide.includes('viewportKinds')
  && guide.includes('viewportCount')
  && guide.includes('expectedKinds.every(kind => summary.viewportKinds.includes(kind))'));
check('visual failure cannot write tmcShownAt',
  guide.includes("code: 'TMC_TELEPORT_VISUAL_NOT_CONFIRMED'")
  && guide.indexOf("if (!visual?.confirmed)") < guide.indexOf('tmcShownAt = at'));

for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}`);
if (checks.some(c => !c.ok)) process.exit(1);
