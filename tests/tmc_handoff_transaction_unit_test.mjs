import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const handoff = read('src/core/handoff.js');
const background = read('src/background.js');
const bootstrap = read('src/content/bootstrap.js');
const rail = read('src/ui/rail.js');
const guide = read('src/ui/guide.js');

const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });

check('new TMC handoff carries current ActionSession snapshot',
  handoff.includes('actionSession: actionWorkflowSnapshot(WB.store?.activeCase?.() || null)')
  && handoff.includes('actionSession: actionWorkflowSnapshot(caseData || WB.store?.activeCase?.() || null)'));
check('background persists/sanitizes handoff ActionSession',
  background.includes('function sanitizeHandoffActionSession')
  && background.includes('actionSession: sanitizeHandoffActionSession(payload?.actionSession || null, caseId)')
  && background.includes('actionSession: sanitizeHandoffActionSession(handoff.actionSession || null, handoff.caseId)'));
check('already-open UserSide fast bind receives the same semantic transaction',
  background.includes('HANDOFF_FAST_CASE_BIND')
  && background.includes("purpose: 'userside-tmc-fast-focus'")
  && background.includes('actionSession: sanitizeHandoffActionSession(payload?.actionSession || null, caseId)'));
check('target tab hydrates only userside.tmc session for the same Case',
  handoff.includes("if (String(active.semanticTargetId || '') !== 'userside.tmc') return false;")
  && handoff.includes('hydrateActionWorkflow(claim.caseId, claim.actionSession || null)')
  && handoff.includes('hydrateActionWorkflow(caseId, payload?.actionSession || null)'));
check('first document explicitly resumes after canonical boot scan',
  bootstrap.includes("resumePendingSemanticHandoff?.('post-boot-scan')"));
check('already-open customer scans once then resumes immediately',
  handoff.includes("await WB.runtime.forceScan?.('handoff-fast-case-bind')")
  && handoff.includes("await resumePendingSemanticHandoff('fast-case-bind')"));
check('lost TMC session is reconstructed from the handoff command itself',
  handoff.includes('WB.guide?.resumeTmcHandoff?.(caseData')
  && guide.includes('async function resumeTmcHandoff(')
  && guide.includes('resumeTmcHandoff,'));
check('direct TMC navigation can never be a bare UserSide jump',
  rail.includes('ensureTmcNavigationSession(currentCase')
  && rail.includes('await WB.actionLifecycle.flushPersistence?.();')
  && rail.indexOf('await WB.actionLifecycle.flushPersistence?.();', rail.indexOf('async openTmcSourceDirect()'))
     < rail.indexOf('WB.handoff?.openUsersideForCase?.(currentCase)', rail.indexOf('async openTmcSourceDirect()')));
check('stale same-Case navigation lock is superseded before explicit TMC command',
  rail.includes("WB.actionLifecycle.interrupt?.(current, 'ACTION_SUPERSEDED_BY_OPERATOR', { actualResult: 'userside.tmc' })"));
check('Guide refuses to navigate when semantic ActionSession could not start',
  guide.includes("reason: 'action-session-unavailable'")
  && guide.includes("code: 'GUIDE_NAVIGATION_SESSION_MISSING'"));

for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}`);
if (checks.some(c => !c.ok)) process.exit(1);
