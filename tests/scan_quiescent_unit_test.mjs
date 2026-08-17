import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src/content/bootstrap.js'), 'utf8');
let observerCallback = null;
const counters = Object.create(null);
class MutationObserver { constructor(cb) { observerCallback = cb; } observe() {} disconnect() {} }
class HTMLInputElement {} class HTMLSelectElement {} class HTMLTextAreaElement {}
const eventListeners = new Map();
const window = { top: null, self: null, addEventListener(t,f){ const a=eventListeners.get(t)||[];a.push(f);eventListeners.set(t,a);} }; window.top=window;window.self=window;
const document = { hidden:false, documentElement:{}, addEventListener(){}, readyState:'complete' };
let applyCount=0;
const fixedContext = { key:'same', identity:{login:'abon1'}, network:{}, pon:{}, profile:{}, meta:{}, quality:{}, system:'userside', pageKind:'userside_customer', entityId:'1' };
const WB = {
  runtime:{booted:false,destroyed:false,documentId:'doc-1',lastContext:{system:'userside',pageKind:'userside_customer'}},
  performanceMonitor:{begin(){return()=>{}},count(n,a=1){counters[n]=(counters[n]||0)+a},mark(){}},
  interactionGuards:{async waitForUiReady(){return true},isWorkbenchMutation(m){return !!m.self},isVolatileCrmMutation(m){return !!m.volatile}},
  actionLifecycle:{current(){return null},isTerminal(){return true}},
  pollTerminal:{scan(){}},
  contextEngine:{detect(){return JSON.parse(JSON.stringify(fixedContext));}},
  store:{state:{},async init(){},async applyContext(){applyCount++;return{}},activeCase(){return {id:'case1',workflow:{ponAcquisition:{}}}},resume(){},destroy(){}},
  handoff:{async init(){}}, operatorTrace:{init(){},destroy(){}}, callRegistration:{destroy(){}}, rail:{mount(){},destroy(){},notifyExtensionContextInvalidated(){}},
  bus:{emit(){}}, juniper:{maybePrefetch:async()=>{}}, log:{info(){},warn(){},error(){},changed(){}}
};
const sandbox={SIMNET_WB:WB,globalThis:null,window,document,location:{hostname:'userside.simnet.kiev.ua',pathname:'/customer/1',href:'https://userside.simnet.kiev.ua/customer/1'},URL,MutationObserver,HTMLInputElement,HTMLSelectElement,HTMLTextAreaElement,console,setTimeout,clearTimeout,queueMicrotask,Date,Math,JSON,Object,Array,String,Number,Boolean,Map,Set,Promise};sandbox.globalThis=sandbox;
vm.createContext(sandbox);vm.runInContext(source,sandbox);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await sleep(20);
const node = text => ({nodeType:1,textContent:text,closest(){return null;}});
observerCallback([{target:node('cosmetic 1')}]); await sleep(180);
observerCallback([{target:node('cosmetic 2')}]); await sleep(180);
assert.equal(WB.runtime.isQuiescent(), true, 'two unchanged scans enter QUIESCENT');
const startedBefore = counters.scansStarted || 0;
observerCallback([{target:node('unrelated footer clock')}]); await sleep(180);
assert.equal(counters.scansStarted || 0, startedBefore, 'irrelevant mutation cannot wake QUIESCENT');
assert.ok((counters.quiescentMutationsSuppressed||0)>=1);
observerCallback([{target:node('Найдено на OLT: Huawei ONU MAC Serial')}]); await sleep(180);
assert.ok((counters.scansStarted||0)>startedBefore, 'meaningful TMC mutation wakes scanner');
observerCallback([{volatile:true,target:node('traffic')}]); await sleep(180);
assert.ok((counters.volatileMutationsSuppressed||0)>=1, 'volatile CRM mutation is counted/suppressed');
console.log('scan_quiescent_unit_test: PASS');
