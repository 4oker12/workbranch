import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
await import(pathToFileURL(path.join(here, '..', 'src', 'core', 'juniper-session-parser.js')).href);
const parser = globalThis.SIMNET_JUNIPER_PARSER;
assert.ok(parser, 'Juniper parser exported');

const online = parser.parseSessionText(`
10.7.31.236 (fc:34:97:0c:21:88)
BRAS - SIM-Juniper (192.168.9.5)
Джерело сесії - Radius2 / subscriber_session
Сесія - 64688
Статус сесії - online / active(2)
USERNAME - fc34.970c.2188
Тип авторизації Radius2 - dhcp
Час старту - 2026-07-09 06:14:47 EEST
Байти прийнято/передано - 121.2gb / 4.7gb
Швидкість прийом/передача за останню секунду - 672bit/s / 672bit/s
Час останньої події - 2026-08-11 09:47:11
Остання подія - CoA-Complete
VENDOR - udhcp dslforum.org
VLAN - 3763:3004
`);
assert.equal(online.subscriberIp, '10.7.31.236');
assert.equal(online.subscriberMac, 'FC:34:97:0C:21:88');
assert.equal(online.brasName, 'SIM-Juniper');
assert.equal(online.brasIp, '192.168.9.5');
assert.equal(online.status, 'online');
assert.equal(online.hasTraffic, true);
assert.equal(online.sessionId, '64688');
assert.equal(online.vlan, '3763:3004');

const stale = parser.parseSessionText(`
10.7.31.236 (fc:34:97:0c:21:88) - сесія є в Radius, але на BRAS не знайдена
BRAS - DEGT-Juniper (192.168.9.3)
Джерело сесії - Radius1 / ip-mac
Сесія - 29609339
Статус сесії - offline / unknown
Час старту - 2026-07-09 06:15:05
Час останньої події - 2026-07-09 06:15:05
Остання подія - Idle-Timeout
VENDOR - udhcp dslforum.org
VLAN - 3763:3004
`);
assert.equal(stale.status, 'offline');
assert.equal(stale.staleRadius, true);
assert.equal(stale.brasName, 'DEGT-Juniper');
assert.match(parser.educationalSummary(stale, 'offline'), /Radius/i);

const noRate = parser.parseRatePair('');
assert.equal(noRate.hasTraffic, null);
console.log('juniper_session_parser_unit_test: PASS');
