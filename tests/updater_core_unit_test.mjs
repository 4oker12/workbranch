import assert from 'node:assert/strict';
import {
  compareVersions,
  normalizeZipPath,
  parseZip,
  normalizeProjectEntries,
  validateWorkbenchUpdate,
  runtimeBackupPath
} from '../src/ui/updater-core.mjs';

const enc = new TextEncoder();

function pushU16(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushU32(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function storedZip(entries) {
  const output = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = enc.encode(name);
    const data = content instanceof Uint8Array ? content : enc.encode(String(content));
    const local = [];
    pushU32(local, 0x04034b50);
    pushU16(local, 20);
    pushU16(local, 0x0800);
    pushU16(local, 0);
    pushU16(local, 0); pushU16(local, 0);
    pushU32(local, 0);
    pushU32(local, data.length);
    pushU32(local, data.length);
    pushU16(local, nameBytes.length);
    pushU16(local, 0);
    local.push(...nameBytes, ...data);
    output.push(...local);

    const c = [];
    pushU32(c, 0x02014b50);
    pushU16(c, 20); pushU16(c, 20);
    pushU16(c, 0x0800); pushU16(c, 0);
    pushU16(c, 0); pushU16(c, 0);
    pushU32(c, 0);
    pushU32(c, data.length); pushU32(c, data.length);
    pushU16(c, nameBytes.length); pushU16(c, 0); pushU16(c, 0);
    pushU16(c, 0); pushU16(c, 0); pushU32(c, 0);
    pushU32(c, offset);
    c.push(...nameBytes);
    central.push(...c);
    offset += local.length;
  }
  const centralOffset = output.length;
  output.push(...central);
  const eocd = [];
  pushU32(eocd, 0x06054b50);
  pushU16(eocd, 0); pushU16(eocd, 0);
  pushU16(eocd, entries.length); pushU16(eocd, entries.length);
  pushU32(eocd, central.length); pushU32(eocd, centralOffset);
  pushU16(eocd, 0);
  output.push(...eocd);
  return Uint8Array.from(output).buffer;
}

assert.equal(compareVersions('1.7.29.23', '1.7.29.22'), 1);
assert.equal(compareVersions('1.7.29.22', '1.7.29.22'), 0);
assert.equal(compareVersions('1.7.29.21', '1.7.29.22'), -1);
assert.equal(normalizeZipPath('src\\ui\\rail.js'), 'src/ui/rail.js');
assert.throws(() => normalizeZipPath('../manifest.json'), /Небезопасный путь/);
assert.throws(() => normalizeZipPath('C:/manifest.json'), /Абсолютный путь/);
assert.equal(runtimeBackupPath('src/ui/rail.js'), true);
assert.equal(runtimeBackupPath('tests/x.mjs'), false);

const projectFiles = [
  ['bundle/manifest.json', JSON.stringify({ manifest_version: 3, name: 'SIMNET Workbench', version: '1.7.29.24' })],
  ['bundle/src/background.js', 'export {};'],
  ['bundle/src/content/namespace.js', 'void 0;'],
  ['bundle/src/ui/rail.js', 'void 0;'],
  ['bundle/src/ui/popup.html', '<!doctype html>'],
  ['bundle/src/ui/updater.html', '<!doctype html>'],
  ['bundle/src/ui/updater.js', 'void 0;'],
  ['bundle/src/ui/updater-core.mjs', 'export {};'],
  ['bundle/assets/icon16.png', new Uint8Array([1, 2, 3])]
];
const parsed = await parseZip(storedZip(projectFiles));
const normalized = normalizeProjectEntries(parsed);
assert.ok(normalized.has('manifest.json'));
assert.ok(normalized.has('src/ui/updater.js'));
const validated = validateWorkbenchUpdate(normalized, '1.7.29.23');
assert.equal(validated.targetVersion, '1.7.29.24');
assert.equal(validated.fileCount, projectFiles.length);
assert.throws(() => validateWorkbenchUpdate(normalized, '1.7.29.24'), /уже установлена/);
assert.throws(() => validateWorkbenchUpdate(normalized, '1.7.29.25'), /Откат заблокирован/);

const traversal = storedZip([
  ['manifest.json', JSON.stringify({ manifest_version: 3, name: 'SIMNET Workbench', version: '1.7.29.24' })],
  ['../evil.js', 'x']
]);
await assert.rejects(() => parseZip(traversal), /Небезопасный путь/);


const gitArchive = await parseZip(storedZip([
  ['manifest.json', JSON.stringify({ manifest_version: 3, name: 'SIMNET Workbench', version: '1.7.29.24' })],
  ['.git/config', 'x']
]));
assert.throws(() => normalizeProjectEntries(gitArchive), /не должен содержать \.git/);

console.log('updater core unit: OK');
