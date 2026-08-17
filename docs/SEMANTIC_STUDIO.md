# SIMNET Semantic Studio

**Status:** standalone project/learning workspace introduced in v1.7.29.44.

## Purpose

Semantic Studio is intentionally separated from Billing/UserSide runtime. It is a full-page extension application for designing the semantic model of Workbench without covering the operator UI or changing the current Case.

The Studio answers a different question from the runtime graph:

- Runtime Graph: what is known about the current subscriber and why.
- Semantic Studio: what concepts, routes, decisions, boundaries and operations should exist in Workbench at all.

## Safety boundary

Semantic Studio never:

- navigates Billing/UserSide;
- changes the active Case;
- starts Guide/ActionSession;
- writes Technical fields;
- starts ONU/OLT polling;
- changes runtime semantic progress.

Its confirmed model remains a project proposal stored in `chrome.storage.local`. Moving a confirmed proposal into the runtime Semantic Tree is a separate code change with regression review.

## Main interaction model

The workspace is one large semantic canvas with three areas:

1. Topics/contexts on the left.
2. Pan/zoom graph in the center.
3. Node/edge inspector on the right.

Supported editing:

- add a semantic context;
- add a node;
- choose node kind (`context`, `concept`, `decision`, `branch`, `operation`, `fact`, `gate`, `boundary`, `milestone`, `question`, `result`);
- drag nodes;
- create an explicit `A → B` edge;
- click an existing edge and change A, B, label, condition or operation binding;
- delete nodes/edges from the draft;
- quick-sketch routes such as `Technical -> TMC -> Save -> ONU`;
- keep free-form idea/dialog notes next to the map;
- undo/redo;
- import/export JSON.

## Draft and confirmation

Editing never immediately replaces the confirmed semantic version.

```
confirmed model
    ↓ edit
working draft
    ↓ review diff
explicit confirmation
    ↓
new confirmed Studio version
```

Before confirmation the UI summarizes changed contexts, nodes and edges. A version note can explain why the semantic model changed.

Confirmed versions are kept in a bounded local history (last 30 versions).

## Future AI-assisted workflow

The current Studio deliberately does not pretend to contain an AI runtime. The `Idea / dialogue` area stores raw design text and can receive text copied from a ChatGPT discussion.

A future AI integration may propose structured edits, but it must preserve the same boundary:

```
idea/dialogue
→ proposed semantic diff
→ visual preview
→ explicit operator confirmation
→ confirmed Studio model
```

AI must never silently mutate the runtime diagnostic tree.

## Launcher

Open the extension popup and select **Open Semantic Studio**. It opens as a separate extension tab.
