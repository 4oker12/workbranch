# FIX REPORT — SIMNET Workbench v1.7.29.27

Recovery release after v1.7.29.26 observability surfaced and amplified several runtime failures.

## Confirmed from operator screenshots
- Store messaging did not complete, leaving LIVE at “Ожидание контекста”. v26 produced synthetic MESSAGE_*_TIMEOUT diagnostics but did not recover the request.
- Audit launcher could execute resize before its host existed (`state.host.style`).
- Graph lazy loader used indirect `eval`, which MV3 CSP rejects.
- `share-modal.js` is not present in the Workbench package and is not modified here.

## Corrections
- Restored StoreClient message semantics to the v25 pattern; report actual sendMessage failures only.
- Background sends failure response immediately; diagnostics persistence is best-effort and cannot block the response channel.
- Added direct-storage emergency diagnostics to the toolbar popup. It works even if the Service Worker is unresponsive and exports both durable diagnostics and the content fallback buffer.
- `More → Ошибки` also falls back to direct storage if diagnostics messaging fails.
- Fixed Audit pre-mount resize null dereference.
- Removed MV3-forbidden Graph fetch+eval loader path; Graph Studio is packaged as a static content script.
- Made console error lines readable in `chrome://extensions → Errors`.

## Limitation
A Service Worker that fails to register at all cannot report its own startup failure into extension-managed storage. Chrome’s `chrome://extensions → Errors` remains the final external source for that class of failure.
