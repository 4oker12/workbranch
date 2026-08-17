const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const RESERVED_PREFIX = '.simnet-wb-backup/';

function u16(view, offset) {
  return view.getUint16(offset, true);
}

function u32(view, offset) {
  return view.getUint32(offset, true);
}

function decodeName(bytes, utf8) {
  try {
    return new TextDecoder(utf8 ? 'utf-8' : 'windows-1252', { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

export function compareVersions(left, right) {
  const a = String(left || '').split('.').map(part => Number(part));
  const b = String(right || '').split('.').map(part => Number(part));
  const length = Math.max(a.length, b.length, 4);
  for (let index = 0; index < length; index += 1) {
    const av = Number.isFinite(a[index]) ? a[index] : 0;
    const bv = Number.isFinite(b[index]) ? b[index] : 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

export function normalizeZipPath(input) {
  const raw = String(input || '').replace(/\\/g, '/');
  if (!raw || raw.includes('\0')) throw new Error('Пустой или повреждённый путь в ZIP');
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) {
    throw new Error(`Абсолютный путь запрещён: ${raw}`);
  }
  const pieces = raw.split('/').filter(Boolean);
  if (pieces.some(part => part === '.' || part === '..')) {
    throw new Error(`Небезопасный путь в ZIP: ${raw}`);
  }
  return pieces.join('/');
}

function findEocd(view) {
  const min = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= min; offset -= 1) {
    if (u32(view, offset) === ZIP_EOCD) return offset;
  }
  throw new Error('ZIP: не найден конец центрального каталога');
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Этот Chrome не поддерживает встроенную распаковку deflate');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function parseZip(arrayBuffer) {
  const buffer = arrayBuffer instanceof ArrayBuffer
    ? arrayBuffer
    : arrayBuffer.buffer.slice(arrayBuffer.byteOffset, arrayBuffer.byteOffset + arrayBuffer.byteLength);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEocd(view);
  const disk = u16(view, eocd + 4);
  const centralDisk = u16(view, eocd + 6);
  const entriesOnDisk = u16(view, eocd + 8);
  const entryCount = u16(view, eocd + 10);
  const centralSize = u32(view, eocd + 12);
  const centralOffset = u32(view, eocd + 16);

  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error('Многотомные ZIP-архивы не поддерживаются');
  }
  if (entryCount > MAX_FILES) throw new Error(`ZIP содержит слишком много файлов: ${entryCount}`);
  if (centralOffset + centralSize > buffer.byteLength) throw new Error('ZIP: центральный каталог повреждён');

  const files = new Map();
  let cursor = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.byteLength || u32(view, cursor) !== ZIP_CENTRAL) {
      throw new Error(`ZIP: повреждена запись центрального каталога #${index + 1}`);
    }
    const flags = u16(view, cursor + 8);
    const method = u16(view, cursor + 10);
    const compressedSize = u32(view, cursor + 20);
    const uncompressedSize = u32(view, cursor + 24);
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const externalAttrs = u32(view, cursor + 38);
    const localOffset = u32(view, cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.byteLength) throw new Error('ZIP: повреждено имя файла');
    const decoded = decodeName(bytes.subarray(nameStart, nameEnd), Boolean(flags & 0x0800));
    cursor = nameEnd + extraLength + commentLength;

    const isDirectory = decoded.endsWith('/');
    const path = normalizeZipPath(decoded);
    if (!path || isDirectory) continue;
    if (flags & 0x0001) throw new Error(`Зашифрованный файл в ZIP не поддерживается: ${path}`);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('ZIP64 не поддерживается');
    }
    const unixMode = (externalAttrs >>> 16) & 0xffff;
    if ((unixMode & 0xf000) === 0xa000) throw new Error(`Символические ссылки запрещены: ${path}`);
    if (uncompressedSize > MAX_FILE_BYTES) throw new Error(`Слишком большой файл в обновлении: ${path}`);
    totalBytes += uncompressedSize;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Обновление слишком большое');
    if (files.has(path)) throw new Error(`Дублирующийся путь в ZIP: ${path}`);

    if (localOffset + 30 > buffer.byteLength || u32(view, localOffset) !== ZIP_LOCAL) {
      throw new Error(`ZIP: повреждён local header: ${path}`);
    }
    const localNameLength = u16(view, localOffset + 26);
    const localExtraLength = u16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.byteLength) throw new Error(`ZIP: обрезанные данные: ${path}`);
    const compressed = bytes.slice(dataStart, dataEnd);

    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = await inflateRaw(compressed);
    else throw new Error(`ZIP compression method ${method} не поддерживается: ${path}`);

    if (data.byteLength !== uncompressedSize) {
      throw new Error(`ZIP: размер после распаковки не совпал: ${path}`);
    }
    files.set(path, data);
  }
  return files;
}

function ignoredArchivePath(path) {
  return path.startsWith('__MACOSX/') || path.endsWith('/.DS_Store') || path === '.DS_Store';
}

export function normalizeProjectEntries(files) {
  const paths = [...files.keys()].filter(path => !ignoredArchivePath(path));
  const manifests = paths.filter(path => path === 'manifest.json' || path.endsWith('/manifest.json'));
  if (manifests.length !== 1) {
    throw new Error(`В архиве должен быть ровно один manifest.json; найдено: ${manifests.length}`);
  }
  const manifestPath = manifests[0];
  const prefix = manifestPath.slice(0, manifestPath.length - 'manifest.json'.length);
  const normalized = new Map();
  for (const [path, data] of files.entries()) {
    if (ignoredArchivePath(path)) continue;
    if (prefix && !path.startsWith(prefix)) {
      throw new Error(`Файл вне корня Workbench: ${path}`);
    }
    const relative = normalizeZipPath(prefix ? path.slice(prefix.length) : path);
    if (!relative) continue;
    if (relative === '.simnet-wb-backup' || relative.startsWith(RESERVED_PREFIX)) {
      throw new Error('Архив не должен содержать служебные backup-файлы updater-а');
    }
    if (relative === '.git' || relative.startsWith('.git/')) {
      throw new Error('Архив обновления не должен содержать .git');
    }
    if (normalized.has(relative)) throw new Error(`Повтор пути после нормализации: ${relative}`);
    normalized.set(relative, data);
  }
  return normalized;
}

export function decodeJson(bytes, label = 'JSON') {
  try {
    return JSON.parse(new TextDecoder('utf-8').decode(bytes));
  } catch (error) {
    throw new Error(`${label}: ${error?.message || String(error)}`);
  }
}

export function validateWorkbenchUpdate(files, currentVersion) {
  const manifestBytes = files.get('manifest.json');
  if (!manifestBytes) throw new Error('В обновлении отсутствует manifest.json');
  const manifest = decodeJson(manifestBytes, 'manifest.json');
  if (manifest.manifest_version !== 3 || manifest.name !== 'SIMNET Workbench') {
    throw new Error('Это не архив SIMNET Workbench MV3');
  }
  const targetVersion = String(manifest.version || '');
  if (!/^\d+(?:\.\d+){1,3}$/.test(targetVersion)) throw new Error(`Некорректная версия: ${targetVersion}`);
  const cmp = compareVersions(targetVersion, currentVersion);
  if (cmp === 0) throw new Error(`Версия ${targetVersion} уже установлена`);
  if (cmp < 0) throw new Error(`Откат заблокирован: ${targetVersion} < ${currentVersion}`);

  const required = [
    'src/background.js',
    'src/content/namespace.js',
    'src/ui/rail.js',
    'src/ui/popup.html',
    'src/ui/updater.html',
    'src/ui/updater.js',
    'src/ui/updater-core.mjs',
    'assets/icon16.png'
  ];
  const missing = required.filter(path => !files.has(path));
  if (missing.length) throw new Error(`Архив неполный: нет ${missing.join(', ')}`);

  return { manifest, targetVersion, fileCount: files.size };
}

export function runtimeBackupPath(path) {
  return path === 'manifest.json' || path.startsWith('src/') || path.startsWith('assets/');
}
