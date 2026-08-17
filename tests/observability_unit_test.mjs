import assert from 'node:assert/strict';
import {
  applyDiagnosticEntries,
  clearDiagnosticsState,
  diagnosticsBytes,
  DIAGNOSTICS_MAX_BYTES,
  DIAGNOSTICS_MAX_ENTRIES,
  markDiagnosticsRead,
  normalizeDiagnosticEntry,
  sanitizeDiagnosticDetails
} from '../src/shared/diagnostics-core.mjs';

let state = clearDiagnosticsState();
state = applyDiagnosticEntries(state, Array.from({ length: 10000 }, () => ({
  severity: 'ERROR',
  code: 'STORE_GET_STATE_CHANNEL_CLOSED',
  operationType: 'MESSAGE_STORE_GET_STATE',
  source: 'store-client',
  message: 'A listener indicated an asynchronous response but the message channel closed'
})));
assert.equal(state.entries.length, 1, '10k identical errors must dedupe into one record');
assert.equal(state.entries[0].count, 10000, 'dedupe counter must preserve repetition count');
assert.equal(state.unreadCount, 1, 'badge counts unique unread problems, not duplicate spam');

state = markDiagnosticsRead(state);
assert.equal(state.unreadCount, 0);
assert.equal(state.entries[0].unread, false);
state = applyDiagnosticEntries(state, [{
  severity: 'ERROR',
  code: 'STORE_GET_STATE_CHANNEL_CLOSED',
  operationType: 'MESSAGE_STORE_GET_STATE',
  source: 'store-client',
  message: 'A listener indicated an asynchronous response but the message channel closed'
}]);
assert.equal(state.entries[0].unread, true, 'a repeated problem after review must become unread again');
assert.equal(state.entries[0].count, 10001);

const unique = Array.from({ length: 600 }, (_, index) => ({
  severity: index % 3 ? 'WARNING' : 'ERROR',
  code: `UNIQUE_${index}`,
  operationType: 'LOAD_TEST',
  source: 'unit',
  message: `failure ${index} ${'x'.repeat(1800)}`,
  stack: `Error: ${index}\n${'at frame\n'.repeat(1200)}`,
  details: { index, payload: 'y'.repeat(20000) }
}));
state = applyDiagnosticEntries(clearDiagnosticsState(), unique);
assert.ok(state.entries.length <= DIAGNOSTICS_MAX_ENTRIES, 'ring buffer must stay bounded');
assert.ok(diagnosticsBytes(state) <= DIAGNOSTICS_MAX_BYTES, 'diagnostic storage must stay under byte budget');
assert.ok(state.entries.every(entry => String(entry.stack || '').length <= 4200), 'stacks must be truncated');

const redacted = normalizeDiagnosticEntry({
  severity: 'ERROR',
  code: 'REDACTION_TEST',
  message: 'failed',
  url: 'https://admin.simnet.kiev.ua/cgi-bin/adm/adm.pl?pp=SECRET123&a=user&token=ABC',
  details: {
    password: 'hunter2',
    _csrf: 'secret-csrf',
    nested: { authorization: 'Bearer secret', harmless: 'ok' },
    href: 'https://userside.simnet.kiev.ua/x?session=secret&id=42'
  }
});
assert.ok(!redacted.url.includes('SECRET123'));
assert.ok(!redacted.url.includes('token=ABC'));
assert.equal(redacted.details.password, '[redacted]');
assert.equal(redacted.details._csrf, '[redacted]');
assert.equal(redacted.details.nested.authorization, '[redacted]');
assert.equal(redacted.details.nested.harmless, 'ok');
assert.ok(!String(redacted.details.href).includes('session=secret'));

const circular = { ok: true };
circular.self = circular;
const safeCircular = sanitizeDiagnosticDetails(circular);
assert.equal(safeCircular.self, '[circular]');

const debugOnly = applyDiagnosticEntries(clearDiagnosticsState(), [{
  severity: 'DEBUG', code: 'DEBUG_NOISE', message: 'not persistent'
}]);
assert.equal(debugOnly.entries.length, 0, 'DEBUG must not persist by default');

const malformed = normalizeDiagnosticEntry({
  severity: '???',
  code: { odd: true },
  message: { strange: true },
  details: { huge: 'z'.repeat(1000000) }
});
assert.equal(malformed.severity, 'ERROR');
assert.ok(JSON.stringify(malformed.details).length < 12000, 'malformed detail payload must be clipped');

state = clearDiagnosticsState();
assert.equal(state.entries.length, 0);
assert.equal(state.unreadCount, 0);

console.log('observability_unit_test: PASS');
