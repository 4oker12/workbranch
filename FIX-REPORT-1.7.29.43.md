# SIMNET Workbench v1.7.29.43 — Canonical Semantic Tree + Interactive Map

## Goal

Freeze the Workbench meaning model before adding more features. UI actions, parsers, state machines and evidence must no longer grow as unrelated local rules.

## New canonical layer

Added `src/core/semantic-tree.js`.

It is a **static project meaning model**, not another runtime progress store.

It defines:

- one root: `Абонент / Case`;
- semantic contexts;
- semantic nodes and directed relations;
- registered top-level operations;
- success evidence for each operation;
- current implementation owner files;
- semantic placement rules for future features.

## Current semantic contexts

1. Symptom / appeal.
2. Session / Juniper.
3. Access / physical path.
4. Physical subscriber location.
5. Evidence state.
6. Operator context.

The PON branch explicitly models the current verified route:

```text
Technical
→ enough?
  ├─ yes → ONU poll
  └─ no → TMC teleport
           ├─ TMC fields found → dynamic writeback
           │                    ├─ already matched → continue
           │                    ├─ conflict → operator decision
           │                    └─ changed → native Save gate
           │                                  ├─ saved → ONU poll
           │                                  └─ reject/leave → retry writeback
           └─ insufficient → MAC fallback
```

A confirmed ONU poll branches to PON interpretation: ONU state, optics, customer Ethernet link, learned MAC, service-port/VLAN and traffic.

Ethernet is a separate branch: switch → port/link → FDB/MAC → errors → uplink.

## Semantic placement contract

Any new Workbench function must do one of two things:

1. attach to an existing semantic node/edge; or
2. explicitly introduce a new semantic context connected to the Case root.

`WB.semanticTree.validate()` rejects:

- orphan semantic nodes;
- orphan operations;
- unknown contexts;
- missing edge endpoints;
- operation references that do not exist.

This is intentionally different from operation state-machine validation.

## Three-layer model

```text
SEMANTIC TREE
what/why
   ↓
OPERATION STATE MACHINE
how
   ↓
EVIDENCE
proof
   ↓
SEMANTIC TREE
what next
```

Parser observations never become semantic operator progress by themselves.

## Interactive graph

Graph Studio now supports a third **read-only** mode: `semantic`.

Entry: `Диагностический граф → Смысловая карта`.

The view provides:

- all contexts or one context at a time;
- interactive semantic nodes/edges;
- node inspector;
- edge conditions;
- bound Operation ID;
- success evidence;
- implementation owner files;
- semantic placement rules.

It cannot save/publish/edit the Appeal graph and cannot patch Case/Appeal/Workflow state.

The existing Runtime Diagnostic Graph and Studio topology remain separate and unchanged.

## Documentation

Added `docs/SEMANTIC_TREE.md` and linked the new layer from `docs/ARCHITECTURE.md`.

## Regression

- Full suite: **309 total · 303 PASS · 0 FAIL · 6 existing browser-DOM SKIP**.
- Production JS/MJS syntax: **42/42 PASS**.
- `setInterval` in `src`: **0**.
- Added `semantic_tree_contract_test.mjs`.
- Added `semantic_graph_ui_contract_test.mjs`.
