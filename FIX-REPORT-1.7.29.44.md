# SIMNET Workbench v1.7.29.44 — Standalone Semantic Studio

## Goal

Move semantic-tree editing out of the Billing/UserSide overlay and into a separate project/learning application that can be used for long-form design without interfering with operator work.

## Added

### `src/semantic-studio/index.html`
Standalone extension page.

### `src/semantic-studio/studio.css`
Dedicated full-screen visual language: dark/plum workspace, large graph canvas, semantic node kinds, edge selection, animation and reduced-motion handling.

### `src/semantic-studio/studio.js`
Draft editor over the canonical `WB.semanticTree.snapshot()`.

Capabilities:

- contexts/topics;
- node creation/editing/deletion;
- semantic node kinds including decision/gate/boundary/milestone;
- draggable nodes;
- pan/zoom canvas;
- explicit A → B connection mode;
- editable edge endpoints, label, condition and operation binding;
- quick route sketch (`A -> B -> C`);
- free-form idea/dialogue notes;
- undo/redo;
- draft/confirmed separation;
- confirmation diff;
- bounded 30-version local history;
- import/export JSON proposal.

## Hard isolation

Semantic Studio is not a content script and is not injected into Billing/UserSide.

It does not call runtime navigation, Guide, ActionSession, Case mutation or diagnostic APIs. A Studio confirmation only confirms a design proposal inside Studio storage. Runtime adoption remains a separate project change.

The existing runtime Semantic Map remains read-only.

## Entry point

Extension popup now contains **Open Semantic Studio**, which opens `src/semantic-studio/index.html` in a separate extension tab.

## Regression protection

Added `tests/semantic_studio_standalone_unit_test.mjs`, covering:

- standalone isolation;
- canonical-tree reuse;
- no Billing/UserSide mutation APIs;
- separate-tab launcher;
- context/node editing;
- A→B edge editing;
- edge conditions/operation binding;
- draft/confirm boundary;
- bounded history;
- import/export;
- idea notes;
- quick-route sketch;
- pan/zoom/drag;
- reduced-motion;
- runtime semantic graph stays read-only;
- no remote scripts/eval.

Full regression: **310 total · 304 PASS · 0 FAIL · 6 existing browser-DOM SKIP**.
