/**
 * Billing navigation safety — structural unit checks.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

const billingNav = read('src/core/billing-navigation.js');
const contextEngine = read('src/core/context-engine.js');
const actionLifecycle = read('src/core/action-lifecycle.js');
const guide = read('src/ui/guide.js');
const rail = read('src/ui/rail.js');
const background = read('src/background.js');
const manifest = JSON.parse(read('manifest.json'));

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log('PASS', name);
  } else {
    failed += 1;
    console.error('FAIL', name, detail);
  }
}

check(
  'billing-navigation.js exports WB.billingNavigation',
  billingNav.includes('WB.billingNavigation') && billingNav.includes('function navigate')
);

check(
  'manifest loads billing-navigation before context-engine',
  (() => {
    const js = manifest.content_scripts[0].js;
    const a = js.indexOf('src/core/billing-navigation.js');
    const b = js.indexOf('src/core/context-engine.js');
    return a >= 0 && b > a;
  })()
);

check(
  'gateway defines BILLING_NAVIGATION_PP_MISSING',
  billingNav.includes('BILLING_NAVIGATION_PP_MISSING')
);

check(
  'assertSafeToNavigate blocks routes without pp',
  billingNav.includes('assertSafeToNavigate') && billingNav.includes('CRITICAL')
);

check(
  'guide.js uses safeTechnicalUrl / refuses without pp',
  guide.includes('safeTechnicalUrl') && guide.includes("return ''")
);

check(
  'context-engine has isBillingAuthDom priority',
  contextEngine.includes('isBillingAuthDom') && contextEngine.includes("kind: 'billing_login'")
);

check(
  'billing_login short-circuits fact collection',
  contextEngine.includes("pageInfo.kind === 'billing_login'") && contextEngine.includes('authPage: true')
);

check(
  'isBillingAuthPage detects password',
  billingNav.includes('input[type="password"]') && billingNav.includes('isBillingAuthPage')
);

check(
  'ALLOWED allows DESTINATION_REACHED to COMPLETED',
  /DESTINATION_REACHED:\s*new Set\(\[[^\]]*COMPLETED/.test(actionLifecycle)
);

check(
  'completeDirect exists',
  actionLifecycle.includes('function completeDirect') && actionLifecycle.includes('completeDirect,')
);

check(
  'duplicate click suppression',
  actionLifecycle.includes('ACTION_DUPLICATE_SUPPRESSED') && actionLifecycle.includes('duplicate: true')
);

check(
  'juniper destination is billing_juniper',
  rail.includes("semanticTargetId: 'billing.juniper'") && rail.includes("destinationPageKind: 'billing_juniper'")
);

check(
  'replay completes only after destination verification',
  guide.includes("session.intent === 'DIRECT_REPLAY'")
  && guide.includes('completeDirect(session')
  && rail.includes('Navigation commit is NOT completion')
);

check(
  'openTechnicalDirect uses billingNavigation',
  rail.includes('billingNavigation')
);

check(
  'CTA uses Заполнить техданные',
  rail.includes('Заполнить техданные')
);

check(
  'background refuses tab URL without pp',
  background.includes("searchParams.get('pp')") && background.includes('safeBillingTechnicalTarget')
);

check(
  'manifest version is 1.7.29.50',
  manifest.version === '1.7.29.50',
  manifest.version
);

console.log(JSON.stringify({ passed, failed }, null, 2));
if (failed) process.exit(1);
