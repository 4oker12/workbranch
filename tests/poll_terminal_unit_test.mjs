import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

globalThis.SIMNET_WB = {};
vm.runInThisContext(
  fs.readFileSync(
    new URL('../src/ui/poll-terminal.js', import.meta.url),
    'utf8'
  )
);

const terminal = globalThis.SIMNET_WB.pollTerminal;
assert.ok(terminal, 'poll terminal helper should load');

const ontInfo = terminal.analyzeCommandBlockText(
  'display ont info by-sn XPON-50120733 F/S/P : 0/1/10 ONT-ID : 19 Run state : online Config state : normal Match state : match ONT distance(m) : 4082 SN : 58504F4E50120733 (XPON-50120733) Last down cause : dying-gasp Last up time : 2026-08-09 17:01:15+03:00 Last down time : 2026-08-09 16:38:58+03:00 ONT actual NNI type : 2.5G/1.25G',
  'display ont info by-sn XPON-50120733'
);
assert.equal(ontInfo.family, 'ont_info');
assert.equal(ontInfo.importance, 'critical');
assert.equal(ontInfo.facts.runState, 'online');
assert.equal(ontInfo.facts.matchState, 'match');
assert.equal(ontInfo.facts.distanceM, 4082);
assert.equal(ontInfo.facts.onuSerial, 'XPON50120733');

const originalDateNow = Date.now;
Date.now = () => Date.parse('2026-08-13T12:53:00Z');
const offlineInfo = terminal.analyzeCommandBlockText(
  'display ont info 0/1 11 5\nRun state : offline\nLast down cause : ONT LOSi alarm',
  'display ont info 0/1 11 5'
);
const offlineHistory = terminal.analyzeCommandBlockText(
  'display ont register-info 11 5\nIndex : 1\nUpTime : 2026-05-26 14:37:36+03:00 DST\nDownTime : 2026-08-12 10:53:00+03:00 DST\nDownCause : ONT LOSi alarm\nTotal : 1',
  'display ont register-info 11 5'
);
const offlineInterpretation = terminal.interpretAnalyses([offlineInfo, offlineHistory]);
Date.now = originalDateNow;
const interpretedHistory = offlineInterpretation.find(item => item.family === 'history');
assert.equal(
  terminal.parseDateish('2026-08-12 10:53:00+03:00 DST'),
  Date.parse('2026-08-12T10:53:00+03:00'),
  'Huawei timezone offset must be preserved'
);
assert.equal(interpretedHistory.facts.events7d, 1, 'seven days is an event window, not an offline duration');
assert.equal(interpretedHistory.facts.currentOfflineDuration, '1 д 5 ч');
assert.match(interpretedHistory.displaySummary, /OFFLINE 1 д 5 ч/);
assert.match(interpretedHistory.displaySummary, /событий за 7 дней: 1/);
assert.doesNotMatch(interpretedHistory.displaySummary, /7 дней:\s*×/);
assert.equal(
  terminal.appendSummaryUnique('OFFLINE 135 д 3 ч · с 02.04 16:13', 'OFFLINE 135 д 3 ч · с 02.04 16:13'),
  'OFFLINE 135 д 3 ч · с 02.04 16:13',
  'LIVE history summary must not duplicate identical offline fragments'
);

const port = terminal.analyzeCommandBlockText(
  'display ont port state 10 19 eth-port all 19 1 GE 1000 full up noloop',
  'display ont port state 10 19 eth-port all'
);
assert.equal(port.family, 'ont_port_state');
assert.equal(port.importance, 'critical');
assert.equal(port.facts.speedMbps, 1000);
assert.equal(port.facts.duplex, 'full');
assert.equal(port.facts.linkState, 'up');

const mac = terminal.analyzeCommandBlockText(
  'display mac-address port 0/1/10 ont 19 214 - gpon d40d-ab26-4deb dynamic 0 /1 /10 19 1 3866 Total: 1',
  'display mac-address port 0/1/10 ont 19'
);
assert.equal(mac.family, 'mac_address');
assert.equal(mac.importance, 'critical');
assert.equal(mac.facts.subscriberMac, 'D4:0D:AB:26:4D:EB');

const service = terminal.analyzeCommandBlockText(
  'display service-port port 0/1/10 ont 19 214 3866 QinQ gpon 0/1 /10 19 1 vlan 3000 - - up Total : 1',
  'display service-port port 0/1/10 ont 19'
);
assert.equal(service.family, 'service_port');
assert.equal(service.importance, 'medium');
assert.equal(service.facts.vlan, 3866);
assert.equal(service.facts.state, 'up');

const traffic = terminal.analyzeCommandBlockText(
  'display ont traffic 10 19 Traffic Information Up traffic (kbps) : 4 Down traffic (kbps) : 2',
  'display ont traffic 10 19'
);
assert.equal(traffic.family, 'ont_traffic');
assert.equal(traffic.importance, 'high');
assert.equal(traffic.facts.upKbps, 4);
assert.equal(traffic.facts.downKbps, 2);

const stats = terminal.analyzeCommandBlockText(
  'display statistics ont-eth 10 19 ont-port 1 Received frames : 4025107 Received FCS error frames : 0 Received alignment error frames : 0 Sent frames : 9106686 Sent excessive collision frames : 0',
  'display statistics ont-eth 10 19 ont-port 1'
);
assert.equal(stats.family, 'eth_statistics');
assert.equal(stats.importance, 'medium');
assert.equal(stats.facts.receivedFrames, 4025107);
assert.equal(stats.facts.sentFrames, 9106686);
assert.equal(stats.facts.rxFcsErrors, 0);

console.log('poll_terminal_unit_test: PASS');

assert.equal(terminal.adapterFromAction('310'), 'bdcom-epon');
assert.equal(terminal.adapterFromAction('311'), 'bdcom-gpon');
assert.equal(terminal.adapterFromAction('312'), 'gcom');
assert.equal(terminal.adapterFromAction('313'), 'huawei');

const gcomMac = terminal.analyzeCommandBlockText(
  'show ont mac-address-table 64:EE:B7:1F:22:2A\nMAC-Address VID ONT-ID SN ID/GEM\n64:ee:b7:1f:22:2a 343 0/4/2 XPON-0c8aaa68 1/280\nTotal entries: 1.',
  'show ont mac-address-table 64:EE:B7:1F:22:2A',
  { adapter: 'gcom' }
);
assert.equal(gcomMac.adapter, 'gcom');
assert.equal(gcomMac.family, 'mac_address');
assert.equal(gcomMac.facts.subscriberMac, '64:EE:B7:1F:22:2A');
assert.equal(gcomMac.facts.vlan, 343);

const gcomOptical = terminal.analyzeCommandBlockText(
  'show ont optical-info 0/4/2\nRX Optical Power(dBm) : -14.080 (OLT TX: 7.616)\nTX Optical Power(dBm) : 2.558 (OLT RX: -18.697)\nTemperature(C) : 32.68',
  'show ont optical-info 0/4/2',
  { adapter: 'gcom' }
);
assert.equal(gcomOptical.family, 'optical');
assert.equal(gcomOptical.importance, 'medium');
assert.equal(gcomOptical.facts.onuRxDbm, -14.08);
assert.equal(gcomOptical.facts.oltRxDbm, -18.697);

const gcomPort = terminal.analyzeCommandBlockText(
  'show ont port-status 0/4/2 port 1\nPort status is Enable, 100BaseT full duplex',
  'show ont port-status 0/4/2 port 1',
  { adapter: 'gcom' }
);
assert.equal(gcomPort.family, 'ont_port_state');
assert.equal(gcomPort.facts.linkState, 'up');
assert.equal(gcomPort.facts.speedMbps, 100);
assert.equal(gcomPort.facts.duplex, 'full');

const bdcomGponMac = terminal.analyzeCommandBlockText(
  'show mac address-table interface GPON0/11:1\nMac Address Table (Total 1)\n341 088a.f17f.ff11 DYNAMIC gpon0/11:1-1',
  'show mac address-table interface GPON0/11:1',
  { adapter: 'bdcom-gpon' }
);
assert.equal(bdcomGponMac.family, 'mac_address');
assert.equal(bdcomGponMac.facts.subscriberMac, '08:8A:F1:7F:FF:11');

const bdcomGponState = terminal.analyzeCommandBlockText(
  'show gpon active-onu interface GPON0/11 1\nInterface GPON0/11 has bound 1 active ONUs:\nGPON0/11:1 FGXP:15A2E80B N/A 2026-07-20 20:05:00 0005d:12:28:57 635.3',
  'show gpon active-onu interface GPON0/11 1',
  { adapter: 'bdcom-gpon' }
);
assert.equal(bdcomGponState.family, 'ont_info');
assert.equal(bdcomGponState.facts.runState, 'online');
assert.equal(bdcomGponState.facts.onuSerial, 'FGXP15A2E80B');
assert.equal(bdcomGponState.facts.distanceM, 635.3);

const bdcomGponOptical = terminal.analyzeCommandBlockText(
  'show gpon int GPON0/11:1 onu optical-transceiver-diagnosis\ninterface Temperature(degree) Voltage(V) Current(mA) RxPower(dBm) TxPower(dBm)\ngpon0/11:1 36.5 3.4 12.1 -23.3 2.6',
  'show gpon int GPON0/11:1 onu optical-transceiver-diagnosis',
  { adapter: 'bdcom-gpon' }
);
assert.equal(bdcomGponOptical.family, 'optical');
assert.equal(bdcomGponOptical.facts.onuRxDbm, -23.3);
assert.equal(bdcomGponOptical.facts.onuTxDbm, 2.6);

const bdcomEponMac = terminal.analyzeCommandBlockText(
  'show mac address-table interface EPON0/4:8 | exclude c025.2f4f.4dad\nMac Address Table (Total 1)\n1 1cef.03aa.6949 DYNAMIC epon0/4:8',
  'show mac address-table interface EPON0/4:8 | exclude c025.2f4f.4dad',
  { adapter: 'bdcom-epon' }
);
assert.equal(bdcomEponMac.family, 'mac_address');
assert.deepEqual(bdcomEponMac.facts.macs, ['1C:EF:03:AA:69:49']);

const bdcomEponState = terminal.analyzeCommandBlockText(
  'show epon active-onu interface EPON0/4 8\nInterface EPON0/4 has bound 1 active ONUs:\nEPON0/4:8 1cef.03aa.6948 auto-configured ctc-oam-oper 3454 2130 2026-07-15 14:06:12 2026-07-15 13:45:34 wire-down 10 .19:33:23',
  'show epon active-onu interface EPON0/4 8',
  { adapter: 'bdcom-epon' }
);
assert.equal(bdcomEponState.family, 'ont_info');
assert.equal(bdcomEponState.facts.runState, 'online');
assert.equal(bdcomEponState.facts.lastDownCause, 'wire-down');

const bdcomEponOptical = terminal.analyzeCommandBlockText(
  'show epon int EPON0/4:8 onu ctc opt\noperating temperature(degree): 31\ntransmitted power(DBm): 2.6\nreceived power(DBm): -19.7',
  'show epon int EPON0/4:8 onu ctc opt',
  { adapter: 'bdcom-epon' }
);
assert.equal(bdcomEponOptical.family, 'optical');
assert.equal(bdcomEponOptical.facts.onuRxDbm, -19.7);
assert.equal(bdcomEponOptical.facts.onuTxDbm, 2.6);

const bdcomLink = terminal.analyzeCommandBlockText(
  'show epon int EPON0/4:8 onu port 1 state\nHardware state is Link-Up',
  'show epon int EPON0/4:8 onu port 1 state',
  { adapter: 'bdcom-epon' }
);
assert.equal(bdcomLink.family, 'ont_port_state');
assert.equal(bdcomLink.facts.linkState, 'up');

const missingMacAnalysis = terminal.interpretAnalyses([
  terminal.analyzeCommandBlockText(
    'show ont mac-address-table D4:0D:AB:26:4D:EB\nTotal entries: 0.',
    'show ont mac-address-table D4:0D:AB:26:4D:EB',
    { adapter: 'gcom' }
  ),
  terminal.analyzeCommandBlockText(
    'show ont port-status 0/4/2 port 1\nPort status is Enable, 100BaseT full duplex',
    'show ont port-status 0/4/2 port 1',
    { adapter: 'gcom' }
  )
], { subscriberMac: 'D4:0D:AB:26:4D:EB' });
assert.equal(missingMacAnalysis[0].state, 'attention');
assert.equal(missingMacAnalysis[1].state, 'attention');
assert.match(missingMacAnalysis[0].diagnosticNote, /Ethernet UP/i);
assert.equal(missingMacAnalysis[0].displaySummary, 'MAC НЕ ИЗУЧЕН');

const learnedMacWithoutExpected = terminal.interpretAnalyses([
  terminal.analyzeCommandBlockText(
    'show ont mac-address-table 0/4/2\n64:ee:b7:1f:22:2a 343 0/4/2 XPON-0c8aaa68 1/280\nTotal entries: 1.',
    'show ont mac-address-table 0/4/2',
    { adapter: 'gcom' }
  )
]);
assert.equal(learnedMacWithoutExpected[0].state, 'normal');
assert.match(learnedMacWithoutExpected[0].displaySummary, /MAC ИЗУЧЕН/i);

const readableLink = terminal.interpretAnalyses([port])[0];
assert.equal(readableLink.displaySummary, 'LINK UP · 1 Гбит/с · Full-Duplex');

const mismatchAnalysis = terminal.interpretAnalyses([
  terminal.analyzeCommandBlockText(
    'show ont mac-address-table D4:0D:AB:26:4D:EB\nMAC-Address VID ONT-ID SN ID/GEM\n64:ee:b7:1f:22:2a 343 0/4/2 XPON-0c8aaa68 1/280\nTotal entries: 1.',
    'show ont mac-address-table D4:0D:AB:26:4D:EB',
    { adapter: 'gcom' }
  )
], { subscriberMac: 'D4:0D:AB:26:4D:EB' });
assert.equal(mismatchAnalysis[0].state, 'attention');
assert.equal(mismatchAnalysis[0].relation, 'conflict');
assert.match(mismatchAnalysis[0].diagnosticNote, /ожидался D4:0D:AB:26:4D:EB/i);

console.log('poll_terminal_multi_adapter_test: PASS');


const huaweiHistory = terminal.analyzeCommandBlockText(
  'display ont register-info 9 10\nIndex : 4\nDownTime : 2026-08-10 11:59:30+03:00 DST\nDownCause : ONT reset\nIndex : 2\nDownTime : 2026-02-09 03:50:15+02:00\nDownCause : ONT dying-gasp\nTotal : 2',
  'display ont register-info 9 10',
  { adapter: 'huawei' }
);
assert.equal(huaweiHistory.family, 'history');
assert.equal(huaweiHistory.facts.resetCount, 1);
assert.equal(huaweiHistory.facts.powerCount, 1);
assert.equal(huaweiHistory.facts.opticalCount, 0);

const gcomOverview = terminal.analyzeCommandBlockText(
  'show ont optical-info interface gpon 0/3\nONT Voltage Rx-power(OLT-tx) Tx-power(OLT-rx) Bias\n0/3/21 3.32 -19.102(7.729) 2.712(-25.376) 12.240\nTotal entries: 20.',
  'show ont optical-info interface gpon 0/3',
  { adapter: 'gcom' }
);
assert.equal(gcomOverview.family, 'optical_overview');
assert.equal(gcomOverview.importance, 'reference');
assert.equal(gcomOverview.facts.entryCount, 20);

// Keep history-window assertions time-stable. The old fixed 2026-08-08
// fixture naturally aged out of the parser's seven-day attention window.
const recentStamp = offsetHours => {
  const date = new Date(Date.now() - offsetHours * 3600000);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
};

const gcomHistory = terminal.analyzeCommandBlockText(
  `show ont-logging buffer 0/3/21\n${recentStamp(2)} OLT: offline, reason: LOS.\n${recentStamp(12)} OLT: offline, reason: POWER_OFF.\n${recentStamp(48)} OLT: offline, reason: POWER_OFF.`,
  'show ont-logging buffer 0/3/21',
  { adapter: 'gcom' }
);
assert.equal(gcomHistory.family, 'history');
assert.equal(gcomHistory.facts.opticalCount, 1);
assert.equal(gcomHistory.facts.powerCount, 2);
assert.equal(terminal.interpretAnalyses([gcomHistory])[0].state, 'attention');

const frequentRecentHistory = terminal.analyzeCommandBlockText(
  `show ont-logging buffer 0/3/21\n${recentStamp(2)} OLT: offline, reason: POWER_OFF.\n${recentStamp(12)} OLT: offline, reason: POWER_OFF.\n${recentStamp(48)} OLT: offline, reason: ONT_RESET.`,
  'show ont-logging buffer 0/3/21',
  { adapter: 'gcom' }
);
const frequentRecentInterpretation = terminal.interpretAnalyses([frequentRecentHistory])[0];
assert.equal(frequentRecentHistory.facts.events7d, 3);
assert.equal(frequentRecentInterpretation.state, 'attention');
assert.match(frequentRecentInterpretation.diagnosticNote, /Частые отключения\/перезапуски/i);

const gcomOfflineInterpretation = terminal.interpretAnalyses([
  terminal.analyzeCommandBlockText(
    'show ont brief sn string-hex FGXP-00906e11\nONT SN Device-type Up/Down-time Status W/S\n0/2/15 FGXP-00906e11 - 0d0h0m offline working',
    'show ont brief sn string-hex FGXP-00906e11',
    { adapter: 'gcom' }
  ),
  terminal.analyzeCommandBlockText(
    'show ont mac-address-table 0/2/15\n24:4b:fe:22:ec:11 343 0/2/15 FGXP-00906e11 1/592\nTotal entries: 1.',
    'show ont mac-address-table 0/2/15',
    { adapter: 'gcom' }
  ),
  terminal.analyzeCommandBlockText(
    'show ont optical-info 0/2/15\nError: The required ONT is offline.',
    'show ont optical-info 0/2/15',
    { adapter: 'gcom' }
  ),
  terminal.analyzeCommandBlockText(
    'show ont port-status 0/2/15 port 1\nError: The required ONT is offline.',
    'show ont port-status 0/2/15 port 1',
    { adapter: 'gcom' }
  )
], { subscriberMac: '24:4B:FE:22:EC:11' });
assert.equal(gcomOfflineInterpretation[0].state, 'attention');
assert.equal(gcomOfflineInterpretation[1].state, 'neutral');
assert.equal(gcomOfflineInterpretation[1].relation, 'context');
assert.match(gcomOfflineInterpretation[1].diagnosticNote, /не подтверждение текущего Ethernet-ли?нка|не подтверждение текущего Ethernet-линка/i);
assert.equal(gcomOfflineInterpretation[2].state, 'neutral');
assert.equal(gcomOfflineInterpretation[2].relation, 'dependent');
assert.equal(gcomOfflineInterpretation[3].state, 'neutral');
assert.equal(gcomOfflineInterpretation[3].relation, 'dependent');

const bdcomGponPortReal = terminal.analyzeCommandBlockText(
  'show gpon int GPON0/8:29 onu port 1 state\nGPON0/8:29 uni-port 1 up\n10/100/1000 BASE-T(1Gbps Full-Duplex)',
  'show gpon int GPON0/8:29 onu port 1 state',
  { adapter: 'bdcom-gpon' }
);
assert.equal(bdcomGponPortReal.facts.linkState, 'up');
assert.equal(bdcomGponPortReal.facts.speedMbps, 1000);
assert.equal(bdcomGponPortReal.facts.duplex, 'full');

const bdcomGponOffline = terminal.analyzeCommandBlockText(
  'show gpon active-onu interface GPON0/8 29\n',
  'show gpon active-onu interface GPON0/8 29',
  { adapter: 'bdcom-gpon' }
);
assert.equal(bdcomGponOffline.family, 'ont_info');
assert.equal(bdcomGponOffline.facts.runState, 'offline');
assert.equal(bdcomGponOffline.facts.inferredFrom, 'active-onu-empty');

const huaweiOfflineDistance = terminal.analyzeCommandBlockText(
  'display ont info by-sn FGXP-0090D519\nRun state : offline\nConfig state : initial\nMatch state : initial\nONT last distance(m) : 4608\nSN : 464758500090D519 (FGXP-0090D519)\nLast down cause : reset',
  'display ont info by-sn FGXP-0090D519',
  { adapter: 'huawei' }
);
assert.equal(huaweiOfflineDistance.facts.runState, 'offline');
assert.equal(huaweiOfflineDistance.facts.distanceM, 4608);

console.log('poll_terminal_real_state_matrix_test: PASS');

// v1.7.17: command blocks with CLI errors are not ONU responses.
const wrongGponError = terminal.analyzeCommandBlockText(
  'show gpon active-onu interface GPON0/1 2\n% Invalid input detected at marker.\nError: no such ONU',
  'show gpon active-onu interface GPON0/1 2',
  { adapter: 'bdcom-gpon' }
);
assert.equal(
  terminal.hasSuccessfulAnalysis(wrongGponError, 'show gpon active-onu interface GPON0/1 2\n% Invalid input detected at marker.\nError: no such ONU'),
  false,
  'wrong-tab CLI errors must not finish Guide'
);

const offlineReply = terminal.analyzeCommandBlockText(
  'display statistics ont-eth 10 19 ont-port 1\nError: The required ONT is offline',
  'display statistics ont-eth 10 19 ont-port 1',
  { adapter: 'huawei' }
);
assert.equal(
  terminal.hasSuccessfulAnalysis(offlineReply, 'display statistics ont-eth 10 19 ont-port 1\nError: The required ONT is offline'),
  true,
  'explicit target-ONT offline reply is still a valid ONU response'
);

assert.equal(
  terminal.hasSuccessfulAnalysis(bdcomEponState, 'show epon active-onu interface EPON0/4 8\nInterface EPON0/4 has bound 1 active ONUs:\nEPON0/4:8 1cef.03aa.6948 auto-configured ctc-oam-oper 3454 2130 2026-07-15 14:06:12 2026-07-15 13:45:34 wire-down 10 .19:33:23'),
  true,
  'real EPON ONU output must remain successful'
);
