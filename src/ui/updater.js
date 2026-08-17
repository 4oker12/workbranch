import {
  parseZip,
  normalizeProjectEntries,
  validateWorkbenchUpdate,
  decodeJson,
  runtimeBackupPath
} from './updater-core.mjs';

const CURRENT = chrome.runtime.getManifest().version;
const DB_NAME = 'simnet_workbench_updater_v1';
const STORE_NAME = 'handles';
const ROOT_KEY = 'workbench-root';
const BACKUP_DIR = '.simnet-wb-backup';
const UPDATE_META_KEY = 'simnet_workbench_local_update_meta_v1';

const versionLine = document.getElementById('versionLine');
const folderState = document.getElementById('folderState');
const folderBadge = document.getElementById('folderBadge');
const bindFolderButton = document.getElementById('bindFolder');
async function reportUpdaterDiagnostic(entry = {}) {
  try {
    await chrome.runtime.sendMessage({
      type: 'DIAGNOSTICS_REPORT',
      payload: {
        entry: {
          severity: 'ERROR',
          operationType: 'LOCAL_UPDATER',
          source: 'updater',
          pageKind: 'extension-updater',
          url: location.href,
          ...entry
        }
      }
    });
  } catch {}
}

const updateButton = document.getElementById('updateButton');
const zipInput = document.getElementById('zipInput');
const reloadTabs = document.getElementById('reloadTabs');
const message = document.getElementById('message');
const progress = document.getElementById('progress');
const progressBar = document.getElementById('progressBar');

let rootHandle = null;
let busy = false;
versionLine.textContent = `Текущая версия: v${CURRENT}`;

function setMessage(text = '', type = '') {
  message.textContent = text;
  message.className = `message${type ? ` ${type}` : ''}`;
}

function setProgress(value, visible = true) {
  progress.hidden = !visible;
  progressBar.style.width = `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
}

function setBusy(next) {
  busy = Boolean(next);
  bindFolderButton.disabled = busy;
  updateButton.disabled = busy || !rootHandle;
  zipInput.disabled = busy;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
  });
}

async function dbGet(key) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('Не удалось прочитать привязку папки'));
    });
  } finally {
    db.close();
  }
}

async function dbSet(key, value) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Не удалось сохранить привязку папки'));
      tx.onabort = () => reject(tx.error || new Error('Сохранение привязки отменено'));
    });
  } finally {
    db.close();
  }
}

async function readFileHandle(root, path) {
  const pieces = path.split('/').filter(Boolean);
  let directory = root;
  for (let index = 0; index < pieces.length - 1; index += 1) {
    directory = await directory.getDirectoryHandle(pieces[index]);
  }
  return directory.getFileHandle(pieces.at(-1));
}

async function readBytes(root, path) {
  const fileHandle = await readFileHandle(root, path);
  const file = await fileHandle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function readRootManifest(root) {
  const bytes = await readBytes(root, 'manifest.json');
  const manifest = decodeJson(bytes, 'manifest.json рабочей папки');
  if (manifest?.name !== 'SIMNET Workbench' || manifest?.manifest_version !== 3) {
    throw new Error('В выбранной папке нет SIMNET Workbench MV3');
  }
  return manifest;
}

async function permissionGranted(handle, request = false) {
  const options = { mode: 'readwrite' };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  if (!request) return false;
  return (await handle.requestPermission(options)) === 'granted';
}

function updateFolderUi(manifest, hasPermission) {
  folderState.textContent = manifest
    ? `${rootHandle.name} · manifest v${manifest.version}${hasPermission ? '' : ' · требуется разрешение на запись'}`
    : 'Папка ещё не привязана';
  folderBadge.textContent = manifest ? (hasPermission ? 'ГОТОВО' : 'ПРИВЯЗАНО') : 'НЕ НАСТРОЕНО';
  folderBadge.className = `state${manifest ? (hasPermission ? ' ok' : ' warn') : ''}`;
  bindFolderButton.textContent = manifest ? 'Сменить рабочую папку' : 'Привязать папку Workbench';
  updateButton.disabled = busy || !rootHandle;
}

async function restoreBoundFolder() {
  if (!('showDirectoryPicker' in window)) {
    folderState.textContent = 'Этот Chrome не даёт web-доступ на запись в папку';
    folderBadge.textContent = 'НЕДОСТУПНО';
    folderBadge.className = 'state warn';
    bindFolderButton.disabled = true;
    setMessage('Нужен Chrome Desktop с File System Access API.', 'error');
    return;
  }
  try {
    rootHandle = await dbGet(ROOT_KEY);
    if (!rootHandle) return updateFolderUi(null, false);
    const manifest = await readRootManifest(rootHandle);
    updateFolderUi(manifest, await permissionGranted(rootHandle, false));
  } catch (error) {
    rootHandle = null;
    updateFolderUi(null, false);
    setMessage(`Старая привязка недоступна: ${error?.message || String(error)}`, 'warn');
  }
}

async function bindFolder() {
  if (busy) return;
  setMessage('');
  try {
    const selected = await window.showDirectoryPicker({ mode: 'readwrite' });
    if (!(await permissionGranted(selected, true))) throw new Error('Нет разрешения на запись');
    const manifest = await readRootManifest(selected);
    rootHandle = selected;
    await dbSet(ROOT_KEY, selected);
    updateFolderUi(manifest, true);
    setMessage(`Папка привязана: ${selected.name} · v${manifest.version}`, 'ok');
  } catch (error) {
    if (error?.name === 'AbortError') return;
    void reportUpdaterDiagnostic({
      code: 'UPDATER_FOLDER_BIND_FAILED', stage: 'BIND_FOLDER', message: error?.message || String(error), stack: error?.stack || ''
    });
    setMessage(error?.message || String(error), 'error');
  }
}

async function getDirectory(root, pieces, create) {
  let directory = root;
  for (const piece of pieces) directory = await directory.getDirectoryHandle(piece, { create });
  return directory;
}

async function writeBytes(root, path, bytes) {
  const pieces = path.split('/').filter(Boolean);
  const directory = await getDirectory(root, pieces.slice(0, -1), true);
  const fileHandle = await directory.getFileHandle(pieces.at(-1), { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(bytes);
  } finally {
    await writable.close();
  }
}

async function tryReadBytes(root, path) {
  try {
    return await readBytes(root, path);
  } catch (error) {
    if (error?.name === 'NotFoundError') return null;
    throw error;
  }
}

function backupStamp(version) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `v${version}-${stamp}`;
}

async function backupRuntimeFiles(root, incoming, currentVersion, onProgress) {
  const backupRoot = await root.getDirectoryHandle(BACKUP_DIR, { create: true });
  const snapshot = await backupRoot.getDirectoryHandle(backupStamp(currentVersion), { create: true });
  const paths = [...incoming.keys()].filter(runtimeBackupPath);
  let copied = 0;
  for (const path of paths) {
    const current = await tryReadBytes(root, path);
    if (current) await writeBytes(snapshot, path, current);
    copied += 1;
    onProgress?.(copied, Math.max(paths.length, 1));
  }
}

async function applyUpdate(file) {
  if (!rootHandle) throw new Error('Сначала привяжи рабочую папку Workbench');
  if (!(await permissionGranted(rootHandle, true))) throw new Error('Нет разрешения на запись в рабочую папку');

  const currentManifest = await readRootManifest(rootHandle);
  setProgress(5);
  setMessage(`Проверяю ${file.name}…`);
  const parsed = await parseZip(await file.arrayBuffer());
  setProgress(22);
  const project = normalizeProjectEntries(parsed);
  const update = validateWorkbenchUpdate(project, currentManifest.version);
  setMessage(`Проверено: v${currentManifest.version} → v${update.targetVersion} · ${update.fileCount} файлов`);

  await backupRuntimeFiles(rootHandle, project, currentManifest.version, (done, total) => {
    setProgress(22 + Math.round((done / total) * 20));
  });

  const entries = [...project.entries()].sort(([left], [right]) => {
    if (left === 'manifest.json') return 1;
    if (right === 'manifest.json') return -1;
    return left.localeCompare(right);
  });
  let written = 0;
  for (const [path, bytes] of entries) {
    await writeBytes(rootHandle, path, bytes);
    written += 1;
    setProgress(42 + Math.round((written / entries.length) * 50));
  }

  const installed = await readRootManifest(rootHandle);
  if (installed.version !== update.targetVersion) {
    throw new Error(`Проверка после записи не прошла: manifest=${installed.version}, ожидалось ${update.targetVersion}`);
  }
  setProgress(96);

  await chrome.storage.local.set({
    [UPDATE_META_KEY]: {
      fromVersion: currentManifest.version,
      toVersion: update.targetVersion,
      requestedAt: Date.now(),
      reloadMatchingTabs: Boolean(reloadTabs.checked)
    }
  });

  setProgress(100);
  setMessage(`v${update.targetVersion} записана. Перезапускаю Workbench…`, 'ok');
  await new Promise(resolve => setTimeout(resolve, 500));
  chrome.runtime.reload();
}

bindFolderButton.addEventListener('click', () => void bindFolder());
updateButton.addEventListener('click', () => {
  if (busy || !rootHandle) return;
  zipInput.value = '';
  zipInput.click();
});
zipInput.addEventListener('change', async () => {
  const [file] = zipInput.files || [];
  if (!file) return;
  setBusy(true);
  try {
    await applyUpdate(file);
  } catch (error) {
    void reportUpdaterDiagnostic({
      code: 'UPDATER_APPLY_FAILED', stage: 'APPLY_UPDATE', message: error?.message || String(error), stack: error?.stack || '',
      details: { fileName: file?.name || '' }
    });
    setProgress(0, false);
    setMessage(error?.message || String(error), 'error');
    setBusy(false);
  }
});

void restoreBoundFolder();
