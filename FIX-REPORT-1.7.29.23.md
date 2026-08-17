# SIMNET Workbench v1.7.29.23 — local updater report

## Goal
Make routine unpacked-extension updates possible from a visible Workbench button instead of manual delete/copy + chrome://extensions reload on every build.

## Implementation
- Popup entry: `Обновить Workbench`.
- Dedicated local extension page: `src/ui/updater.html`.
- One-time File System Access directory binding, persisted as `FileSystemDirectoryHandle` in IndexedDB.
- ZIP parser uses browser `DecompressionStream('deflate-raw')`; no remote library/code.
- Strict pre-write validation and forward-only version gate.
- Runtime backup + manifest-last commit.
- `chrome.runtime.reload()` applies the modified unpacked source.
- Optional matching-tab reload is explicit and defaults OFF.

## Safety boundaries
No diagnostic/Case/PON/PBX route logic changed. No broad permission was added. Updater never silently reloads operator tabs unless the checkbox was selected.

## Regression
248 checks: 242 PASS / 0 FAIL / 6 SKIP. The six SKIP are the existing DOM/jsdom fixtures unavailable in this environment.
