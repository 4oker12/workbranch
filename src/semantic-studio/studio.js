(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  const tree = WB?.semanticTree;
  if (!tree) throw new Error('Semantic Tree unavailable');

  const STORAGE_KEY = 'simnet_workbench_semantic_studio_v1';
  const SCHEMA_VERSION = 1;
  const NODE_WIDTH = 244;
  const NODE_HEIGHT = 108;
  const WORLD_WIDTH = 6000;
  const WORLD_HEIGHT = 4000;
  const kinds = ['context','concept','decision','branch','operation','fact','gate','boundary','milestone','question','result'];

  const $ = selector => document.querySelector(selector);
  const els = {
    contextList: $('#contextList'), canvasViewport: $('#canvasViewport'), canvasWorld: $('#canvasWorld'), edgeLayer: $('#edgeLayer'), nodeLayer: $('#nodeLayer'),
    canvasTitle: $('#canvasTitle'), canvasMeta: $('#canvasMeta'), zoomLabel: $('#zoomLabel'), linkHint: $('#linkHint'), inspectorTitle: $('#inspectorTitle'), inspectorBody: $('#inspectorBody'), diffSummary: $('#diffSummary'),
    saveStatus: $('#saveStatus'), quickRouteInput: $('#quickRouteInput'), ideaInput: $('#ideaInput'), ideaList: $('#ideaList'), confirmModal: $('#confirmModal'), confirmSummary: $('#confirmSummary'), versionNote: $('#versionNote'), toast: $('#toast')
  };

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const nowIso = () => new Date().toISOString();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const slug = value => String(value || '').toLowerCase().trim().replace(/[^a-zа-яё0-9]+/giu,'-').replace(/^-+|-+$/g,'').slice(0,40) || 'node';
  const unique = prefix => `${prefix}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2,7)}`;

  function normalizedCanonical() {
    const model = tree.snapshot();
    model.edges = (model.edges || []).map((edge, index) => ({ id: edge.id || `edge.canonical.${index}.${slug(edge.from)}.${slug(edge.to)}`, ...edge }));
    model.layout = model.layout || {};
    model.notes = [];
    return model;
  }

  const state = {
    base: normalizedCanonical(),
    confirmed: null,
    draft: null,
    history: [],
    selectedContextId: '',
    selectedNodeId: 'case',
    selectedEdgeId: '',
    linkMode: false,
    linkSourceId: '',
    transform: { x: 70, y: 70, zoom: 1 },
    undo: [], redo: [], dirty: false,
    draggingNode: null,
    panning: null,
    saveTimer: 0,
  };

  function model() { return state.draft; }
  function nodeById(id) { return model()?.nodes?.[id] || null; }
  function edgeById(id) { return (model()?.edges || []).find(edge => edge.id === id) || null; }
  function contextById(id) { return (model()?.contexts || []).find(ctx => ctx.id === id) || null; }

  async function load() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const data = stored?.[STORAGE_KEY];
    if (data?.schemaVersion === SCHEMA_VERSION && data?.confirmed && data?.draft) {
      state.confirmed = data.confirmed;
      state.draft = data.draft;
      state.history = Array.isArray(data.history) ? data.history.slice(-30) : [];
      state.selectedContextId = data.ui?.selectedContextId || '';
      state.transform = { ...state.transform, ...(data.ui?.transform || {}) };
    } else {
      state.confirmed = clone(state.base);
      state.draft = clone(state.base);
    }
    normalizeModel(state.confirmed);
    normalizeModel(state.draft);
    state.dirty = diffModels(state.confirmed, state.draft).total > 0;
    renderAll();
    fitView(false);
    setSaveStatus('Черновик сохранён');
  }

  function normalizeModel(target) {
    target.contexts = Array.isArray(target.contexts) ? target.contexts : [];
    target.nodes = target.nodes && typeof target.nodes === 'object' ? target.nodes : {};
    target.edges = Array.isArray(target.edges) ? target.edges.map((edge, index) => ({ id: edge.id || `edge.import.${index}.${slug(edge.from)}.${slug(edge.to)}`, ...edge })) : [];
    target.layout = target.layout && typeof target.layout === 'object' ? target.layout : {};
    target.notes = Array.isArray(target.notes) ? target.notes : [];
  }

  function pushUndo() {
    state.undo.push(clone(state.draft));
    if (state.undo.length > 60) state.undo.shift();
    state.redo.length = 0;
  }

  function commitMutation(mutator, { rerender = true } = {}) {
    pushUndo();
    mutator(state.draft);
    normalizeModel(state.draft);
    state.dirty = diffModels(state.confirmed, state.draft).total > 0;
    persistSoon();
    if (rerender) renderAll();
  }

  function undo() {
    const previous = state.undo.pop();
    if (!previous) return;
    state.redo.push(clone(state.draft));
    state.draft = previous;
    state.dirty = diffModels(state.confirmed, state.draft).total > 0;
    persistSoon(); renderAll();
  }
  function redo() {
    const next = state.redo.pop();
    if (!next) return;
    state.undo.push(clone(state.draft));
    state.draft = next;
    state.dirty = diffModels(state.confirmed, state.draft).total > 0;
    persistSoon(); renderAll();
  }

  function setSaveStatus(text) { els.saveStatus.textContent = text; }
  function persistSoon() {
    setSaveStatus('Сохраняю черновик…');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => persist().catch(() => setSaveStatus('Ошибка сохранения')), 180);
  }
  async function persist() {
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        schemaVersion: SCHEMA_VERSION,
        baseRevision: tree.revision,
        confirmed: state.confirmed,
        draft: state.draft,
        history: state.history.slice(-30),
        ui: { selectedContextId: state.selectedContextId, transform: state.transform },
        updatedAt: nowIso()
      }
    });
    setSaveStatus(state.dirty ? 'Черновик сохранён · есть изменения' : 'Версия подтверждена');
  }

  function diffModels(a, b) {
    const diffCollection = (aa, bb) => {
      const keys = new Set([...Object.keys(aa || {}), ...Object.keys(bb || {})]);
      let added = 0, removed = 0, changed = 0;
      for (const key of keys) {
        if (!(key in (aa || {}))) added++;
        else if (!(key in (bb || {}))) removed++;
        else if (JSON.stringify(aa[key]) !== JSON.stringify(bb[key])) changed++;
      }
      return { added, removed, changed, total: added + removed + changed };
    };
    const contextsToMap = list => Object.fromEntries((list || []).map(ctx => [ctx.id, ctx]));
    const edgesToMap = list => Object.fromEntries((list || []).map(edge => [edge.id, edge]));
    const contexts = diffCollection(contextsToMap(a?.contexts), contextsToMap(b?.contexts));
    const nodes = diffCollection(a?.nodes, b?.nodes);
    const edges = diffCollection(edgesToMap(a?.edges), edgesToMap(b?.edges));
    const notes = JSON.stringify(a?.notes || []) === JSON.stringify(b?.notes || []) ? {added:0,removed:0,changed:0,total:0} : {added:0,removed:0,changed:1,total:1};
    return { contexts, nodes, edges, notes, total: contexts.total + nodes.total + edges.total + notes.total };
  }

  function contextNodes(contextId) {
    const all = Object.values(model().nodes || {});
    if (!contextId) return all;
    return all.filter(node => node.id === model().rootId || node.contextId === contextId || node.id === `ctx.${contextId}`);
  }

  function visibleModel() {
    const nodes = Object.fromEntries(contextNodes(state.selectedContextId).map(node => [node.id, node]));
    const ids = new Set(Object.keys(nodes));
    const edges = (model().edges || []).filter(edge => ids.has(edge.from) && ids.has(edge.to));
    return { nodes, edges };
  }

  function computeLayout() {
    const visible = visibleModel();
    const layout = model().layout || {};
    const ids = Object.keys(visible.nodes);
    const incoming = new Map(ids.map(id => [id, 0]));
    const outgoing = new Map(ids.map(id => [id, []]));
    for (const edge of visible.edges) {
      incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
      outgoing.get(edge.from)?.push(edge.to);
    }
    const root = visible.nodes[model().rootId] ? model().rootId : ids.find(id => (incoming.get(id) || 0) === 0) || ids[0];
    const depth = new Map(root ? [[root,0]] : []);
    const queue = root ? [root] : [];
    while (queue.length) {
      const id = queue.shift();
      const nextDepth = (depth.get(id) || 0) + 1;
      for (const to of outgoing.get(id) || []) {
        if (!depth.has(to) || nextDepth < depth.get(to)) { depth.set(to,nextDepth); queue.push(to); }
      }
    }
    let orphanDepth = Math.max(0, ...depth.values()) + 1;
    for (const id of ids) if (!depth.has(id)) depth.set(id, orphanDepth);
    const levels = new Map();
    for (const id of ids) {
      const d = depth.get(id) || 0;
      if (!levels.has(d)) levels.set(d, []);
      levels.get(d).push(id);
    }
    const result = {};
    for (const [d, levelIds] of [...levels.entries()].sort((a,b)=>a[0]-b[0])) {
      levelIds.sort((a,b) => String(visible.nodes[a]?.label || a).localeCompare(String(visible.nodes[b]?.label || b), 'ru'));
      levelIds.forEach((id, index) => {
        const saved = layout[id];
        result[id] = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
          ? { x: saved.x, y: saved.y }
          : { x: 150 + d * 340, y: 150 + index * 150 + (d % 2 ? 34 : 0) };
      });
    }
    return result;
  }

  function renderAll() {
    renderContexts();
    renderCanvas();
    renderInspector();
    renderDiff();
    renderIdeas();
    updateTransform();
  }

  function renderContexts() {
    const counts = new Map();
    for (const node of Object.values(model().nodes || {})) if (node.contextId) counts.set(node.contextId, (counts.get(node.contextId) || 0) + 1);
    const allCount = Object.keys(model().nodes || {}).length;
    els.contextList.innerHTML = `
      <button class="context-item ${!state.selectedContextId ? 'active' : ''}" data-context-id="">
        <span class="context-count">${allCount}</span><b>Вся карта</b><small>Все смысловые темы и связи.</small>
      </button>` +
      (model().contexts || []).map(ctx => `
        <button class="context-item ${state.selectedContextId === ctx.id ? 'active' : ''}" data-context-id="${esc(ctx.id)}">
          <span class="context-count">${counts.get(ctx.id) || 0}</span><b>${esc(ctx.label)}</b><small>${esc(ctx.summary || 'Без описания')}</small>
        </button>`).join('');
  }

  function renderCanvas() {
    const visible = visibleModel();
    const positions = computeLayout();
    const currentContext = contextById(state.selectedContextId);
    els.canvasTitle.textContent = currentContext?.label || 'Вся смысловая карта';
    els.canvasMeta.textContent = `${Object.keys(visible.nodes).length} узлов · ${visible.edges.length} связей`;
    els.nodeLayer.innerHTML = Object.values(visible.nodes).map(node => {
      const p = positions[node.id] || {x:100,y:100};
      const selected = node.id === state.selectedNodeId && !state.selectedEdgeId;
      const linkSource = node.id === state.linkSourceId;
      return `<button type="button" class="semantic-node ${esc(node.kind || 'concept')} ${selected ? 'selected' : ''} ${linkSource ? 'link-source' : ''}" data-node-id="${esc(node.id)}" style="left:${p.x}px;top:${p.y}px">
        <div class="node-top"><span class="node-dot"></span><span class="node-kind">${esc(node.kind || 'concept')}</span><span class="node-id">${esc(node.id)}</span></div>
        <h3>${esc(node.label || node.id)}</h3><p>${esc(node.summary || '')}</p>
      </button>`;
    }).join('');

    const defs = `<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" class="edge-arrow"/></marker><marker id="arrowSelected" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" class="edge-arrow selected"/></marker></defs>`;
    els.edgeLayer.innerHTML = defs + visible.edges.map(edge => edgeSvg(edge, positions)).join('');
    bindCanvasItems();
  }

  function edgeSvg(edge, positions) {
    const a = positions[edge.from], b = positions[edge.to];
    if (!a || !b) return '';
    const x1 = a.x + NODE_WIDTH, y1 = a.y + NODE_HEIGHT / 2;
    const x2 = b.x, y2 = b.y + NODE_HEIGHT / 2;
    const dx = Math.max(70, Math.abs(x2 - x1) * .46);
    const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    const selected = edge.id === state.selectedEdgeId;
    const labelX = (x1 + x2) / 2, labelY = (y1 + y2) / 2 - 7;
    return `<g data-edge-id="${esc(edge.id)}"><path class="edge-visible ${selected ? 'selected' : ''}" d="${path}" marker-end="url(#${selected ? 'arrowSelected' : 'arrow'})"></path><path class="edge-hit" d="${path}" data-edge-hit="${esc(edge.id)}"></path><text class="edge-label ${selected ? 'selected' : ''}" x="${labelX}" y="${labelY}" text-anchor="middle">${esc(edge.label || '→')}</text></g>`;
  }

  function bindCanvasItems() {
    els.nodeLayer.querySelectorAll('[data-node-id]').forEach(nodeEl => {
      nodeEl.addEventListener('pointerdown', event => onNodePointerDown(event, nodeEl.dataset.nodeId));
      nodeEl.addEventListener('click', event => {
        event.stopPropagation();
        const id = nodeEl.dataset.nodeId;
        if (state.linkMode) return handleLinkNodeClick(id);
        state.selectedNodeId = id; state.selectedEdgeId = ''; renderAll();
      });
    });
    els.edgeLayer.querySelectorAll('[data-edge-hit]').forEach(path => path.addEventListener('click', event => {
      event.stopPropagation();
      state.selectedEdgeId = path.dataset.edgeHit; state.selectedNodeId = ''; state.linkMode = false; state.linkSourceId = ''; renderAll();
    }));
  }

  function renderInspector() {
    if (state.selectedEdgeId) return renderEdgeInspector(edgeById(state.selectedEdgeId));
    if (state.selectedNodeId) return renderNodeInspector(nodeById(state.selectedNodeId));
    els.inspectorTitle.textContent = 'Выбери узел или стрелку';
    els.inspectorBody.innerHTML = '<div class="empty-state">Кликни по узлу или стрелке. Здесь можно менять смысл, тип, условия и направление связи.</div>';
  }

  function renderNodeInspector(node) {
    if (!node) { state.selectedNodeId = ''; return renderInspector(); }
    els.inspectorTitle.textContent = node.label || node.id;
    const contextOptions = ['<option value="">Без контекста</option>', ...(model().contexts || []).map(ctx => `<option value="${esc(ctx.id)}" ${node.contextId === ctx.id ? 'selected' : ''}>${esc(ctx.label)}</option>`)].join('');
    els.inspectorBody.innerHTML = `
      <div class="inspector-meta"><div class="meta-chip"><span>ID</span><b>${esc(node.id)}</b></div><div class="meta-chip"><span>Источник</span><b>${node.id.startsWith('custom.') ? 'пользовательский' : 'канонический'}</b></div></div>
      <div class="field"><label>Название</label><input data-node-field="label" value="${esc(node.label || '')}"></div>
      <div class="field"><label>Смысл / описание</label><textarea data-node-field="summary">${esc(node.summary || '')}</textarea></div>
      <div class="field-row">
        <div class="field"><label>Тип</label><select data-node-field="kind">${kinds.map(kind => `<option value="${kind}" ${node.kind === kind ? 'selected' : ''}>${kind}</option>`).join('')}</select></div>
        <div class="field"><label>Тема</label><select data-node-field="contextId">${contextOptions}</select></div>
      </div>
      <div class="field"><label>Operation ID</label><input data-node-field="operationId" value="${esc(node.operationId || '')}" placeholder="например tmc.inspect"></div>
      <div class="danger-row"><button class="btn ghost" id="centerNodeBtn" type="button">К узлу</button>${node.id !== model().rootId ? '<button class="btn ghost danger" id="deleteNodeBtn" type="button">Удалить из черновика</button>' : ''}</div>`;
    els.inspectorBody.querySelectorAll('[data-node-field]').forEach(input => input.addEventListener('change', () => {
      const field = input.dataset.nodeField; const value = input.value;
      commitMutation(draft => {
        if (!draft.nodes[node.id]) return;
        draft.nodes[node.id][field] = value;
        if (draft.nodes[node.id].kind === 'context' && draft.nodes[node.id].contextId && ['label','summary'].includes(field)) {
          const ctx = draft.contexts.find(item => item.id === draft.nodes[node.id].contextId);
          if (ctx) ctx[field] = value;
        }
      });
    }));
    $('#centerNodeBtn')?.addEventListener('click', () => centerNode(node.id));
    $('#deleteNodeBtn')?.addEventListener('click', () => deleteNode(node.id));
  }

  function renderEdgeInspector(edge) {
    if (!edge) { state.selectedEdgeId = ''; return renderInspector(); }
    els.inspectorTitle.textContent = `${nodeById(edge.from)?.label || edge.from} → ${nodeById(edge.to)?.label || edge.to}`;
    const nodeOptions = Object.values(model().nodes || {}).map(node => `<option value="${esc(node.id)}">${esc(node.label || node.id)}</option>`).join('');
    els.inspectorBody.innerHTML = `
      <div class="inspector-meta"><div class="meta-chip"><span>Связь</span><b>${esc(edge.id)}</b></div><div class="meta-chip"><span>Режим</span><b>A → B</b></div></div>
      <div class="field-row">
        <div class="field"><label>Точка A</label><select data-edge-field="from">${nodeOptions}</select></div>
        <div class="field"><label>Точка B</label><select data-edge-field="to">${nodeOptions}</select></div>
      </div>
      <div class="field"><label>Подпись стрелки</label><input data-edge-field="label" value="${esc(edge.label || '')}" placeholder="например если нет данных"></div>
      <div class="field"><label>Условие</label><textarea data-edge-field="condition" placeholder="Когда этот переход разрешён / что произошло">${esc(edge.condition || '')}</textarea></div>
      <div class="field"><label>Operation ID</label><input data-edge-field="operationId" value="${esc(edge.operationId || '')}" placeholder="необязательно"></div>
      <div class="danger-row"><button class="btn ghost danger" id="deleteEdgeBtn" type="button">Удалить стрелку</button></div>`;
    const fromSel = els.inspectorBody.querySelector('[data-edge-field="from"]'); const toSel = els.inspectorBody.querySelector('[data-edge-field="to"]');
    fromSel.value = edge.from; toSel.value = edge.to;
    els.inspectorBody.querySelectorAll('[data-edge-field]').forEach(input => input.addEventListener('change', () => {
      const field = input.dataset.edgeField; const value = input.value;
      commitMutation(draft => { const target = draft.edges.find(item => item.id === edge.id); if (target) target[field] = value; });
    }));
    $('#deleteEdgeBtn')?.addEventListener('click', () => deleteEdge(edge.id));
  }

  function renderDiff() {
    const diff = diffModels(state.confirmed, state.draft);
    if (!diff.total) { els.diffSummary.innerHTML = '<div class="diff-clean">Нет неподтверждённых изменений.</div>'; return; }
    const row = (label, item) => `<div class="diff-row changed"><span>${label}</span><b>+${item.added} · ~${item.changed} · −${item.removed}</b></div>`;
    els.diffSummary.innerHTML = row('Контексты', diff.contexts) + row('Узлы', diff.nodes) + row('Связи', diff.edges) + (diff.notes.total ? row('Заметки', diff.notes) : '');
  }

  function renderIdeas() {
    const notes = (model().notes || []).slice().reverse().slice(0,8);
    els.ideaList.innerHTML = notes.map(note => `<div class="idea-card"><time>${esc(new Date(note.at).toLocaleString('ru-RU'))}</time><p>${esc(note.text)}</p><button type="button" data-note-delete="${esc(note.id)}">удалить</button></div>`).join('');
    els.ideaList.querySelectorAll('[data-note-delete]').forEach(btn => btn.addEventListener('click', () => commitMutation(draft => { draft.notes = draft.notes.filter(note => note.id !== btn.dataset.noteDelete); })));
  }

  function addContext() {
    const id = `custom.context.${unique('ctx').split('.').slice(1).join('.')}`;
    const nodeId = `custom.context-node.${id.split('.').slice(-2).join('.')}`;
    commitMutation(draft => {
      draft.contexts.push({ id, label:'Новая тема', summary:'Новый смысловой контекст.' });
      draft.nodes[nodeId] = { id:nodeId, contextId:id, kind:'context', label:'Новая тема', summary:'Опиши, какую область смысла она отвечает.' };
      draft.edges.push({ id:unique('edge.custom'), from:draft.rootId, to:nodeId, label:'контекст' });
      draft.layout[nodeId] = { x: 480, y: 260 };
    });
    state.selectedContextId = id; state.selectedNodeId = nodeId; state.selectedEdgeId=''; renderAll();
  }

  function addNode() {
    const contextId = state.selectedContextId || nodeById(state.selectedNodeId)?.contextId || '';
    const id = unique('custom.node');
    const parentId = nodeById(state.selectedNodeId)?.id || model().rootId;
    const parentPos = computeLayout()[parentId] || {x:180,y:180};
    commitMutation(draft => {
      draft.nodes[id] = { id, contextId, kind:'concept', label:'Новый смысловой узел', summary:'Опиши, что этот узел означает и зачем он нужен.' };
      draft.edges.push({ id:unique('edge.custom'), from:parentId, to:id, label:'дальше' });
      draft.layout[id] = { x: parentPos.x + 330, y: parentPos.y + 145 };
    });
    state.selectedNodeId = id; state.selectedEdgeId=''; renderAll(); centerNode(id);
  }

  function deleteNode(id) {
    if (id === model().rootId) return;
    commitMutation(draft => {
      delete draft.nodes[id]; delete draft.layout[id]; draft.edges = draft.edges.filter(edge => edge.from !== id && edge.to !== id);
    });
    state.selectedNodeId='';
  }
  function deleteEdge(id) { commitMutation(draft => { draft.edges = draft.edges.filter(edge => edge.id !== id); }); state.selectedEdgeId=''; }

  function toggleLinkMode() {
    state.linkMode = !state.linkMode; state.linkSourceId='';
    $('#linkModeBtn').classList.toggle('active', state.linkMode);
    els.linkHint.classList.toggle('hidden', !state.linkMode);
    els.linkHint.textContent = state.linkMode ? 'Выбери точку A' : '';
    renderCanvas();
  }

  function handleLinkNodeClick(id) {
    if (!state.linkSourceId) {
      state.linkSourceId = id; els.linkHint.textContent = `A: ${nodeById(id)?.label || id} · теперь выбери B`; renderCanvas(); return;
    }
    if (state.linkSourceId === id) { showToast('Точка B должна отличаться от A'); return; }
    const edgeId = unique('edge.custom'); const from = state.linkSourceId;
    commitMutation(draft => draft.edges.push({ id:edgeId, from, to:id, label:'следует' }));
    state.linkMode=false; state.linkSourceId=''; state.selectedEdgeId=edgeId; state.selectedNodeId=''; $('#linkModeBtn').classList.remove('active'); els.linkHint.classList.add('hidden'); renderAll();
  }

  function createQuickRoute() {
    const labels = els.quickRouteInput.value.split(/\s*(?:->|→)\s*/).map(v=>v.trim()).filter(Boolean);
    if (labels.length < 2) return showToast('Нужны минимум две точки: A -> B');
    const contextId = state.selectedContextId || '';
    const start = computeLayout()[state.selectedNodeId] || {x:180,y:200};
    let firstId='';
    commitMutation(draft => {
      let previous = state.selectedNodeId && draft.nodes[state.selectedNodeId] ? state.selectedNodeId : draft.rootId;
      labels.forEach((label,index) => {
        const id = unique('custom.route'); if (!firstId) firstId=id;
        draft.nodes[id] = { id, contextId, kind:index === labels.length-1 ? 'milestone' : 'concept', label, summary:'Черновой узел быстрого маршрута.' };
        draft.layout[id] = { x:start.x + 330*(index+1), y:start.y + (index%2)*125 };
        draft.edges.push({ id:unique('edge.custom'), from:previous, to:id, label:'→' }); previous=id;
      });
    });
    els.quickRouteInput.value=''; state.selectedNodeId=firstId; renderAll(); showToast(`Создан маршрут из ${labels.length} точек`);
  }

  function saveIdea() {
    const text = els.ideaInput.value.trim(); if (!text) return;
    commitMutation(draft => draft.notes.push({ id:unique('note'), at:nowIso(), text }));
    els.ideaInput.value=''; showToast('Заметка сохранена в черновике');
  }

  function onNodePointerDown(event, id) {
    if (event.button !== 0 || state.linkMode) return;
    event.stopPropagation();
    const pos = computeLayout()[id] || {x:0,y:0};
    state.draggingNode = { id, startX:event.clientX, startY:event.clientY, x:pos.x, y:pos.y, moved:false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (state.draggingNode) {
      const d = state.draggingNode; const dx=(event.clientX-d.startX)/state.transform.zoom, dy=(event.clientY-d.startY)/state.transform.zoom;
      if (Math.abs(dx)+Math.abs(dy)>2) d.moved=true;
      model().layout[d.id] = { x:Math.max(20,d.x+dx), y:Math.max(20,d.y+dy) };
      renderCanvas(); return;
    }
    if (state.panning) {
      state.transform.x = state.panning.x + (event.clientX-state.panning.startX);
      state.transform.y = state.panning.y + (event.clientY-state.panning.startY);
      updateTransform();
    }
  }

  function onPointerUp() {
    if (state.draggingNode?.moved) { state.dirty = diffModels(state.confirmed,state.draft).total>0; persistSoon(); renderDiff(); }
    state.draggingNode=null; state.panning=null; els.canvasViewport.classList.remove('panning');
  }

  function startPan(event) {
    if (event.target.closest('.semantic-node') || event.target.closest('[data-edge-hit]')) return;
    state.panning = { startX:event.clientX, startY:event.clientY, x:state.transform.x, y:state.transform.y }; els.canvasViewport.classList.add('panning');
  }

  function updateTransform() {
    els.canvasWorld.style.transform = `translate(${state.transform.x}px,${state.transform.y}px) scale(${state.transform.zoom})`;
    els.zoomLabel.textContent = `${Math.round(state.transform.zoom*100)}%`;
  }

  function setZoom(next, pivot = null) {
    const old = state.transform.zoom; const zoom=Math.max(.35,Math.min(1.65,next)); if (zoom===old) return;
    const rect=els.canvasViewport.getBoundingClientRect(); const px=pivot?.x ?? rect.width/2, py=pivot?.y ?? rect.height/2;
    const worldX=(px-state.transform.x)/old, worldY=(py-state.transform.y)/old;
    state.transform.zoom=zoom; state.transform.x=px-worldX*zoom; state.transform.y=py-worldY*zoom; updateTransform(); persistSoon();
  }

  function fitView(animate = true) {
    const positions=computeLayout(); const ids=Object.keys(positions); if (!ids.length) return;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    ids.forEach(id=>{const p=positions[id]; minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x+NODE_WIDTH);maxY=Math.max(maxY,p.y+NODE_HEIGHT)});
    const rect=els.canvasViewport.getBoundingClientRect(); const pad=80; const zoom=Math.max(.4,Math.min(1.15,Math.min((rect.width-pad*2)/(maxX-minX),(rect.height-pad*2)/(maxY-minY))));
    state.transform.zoom=zoom; state.transform.x=rect.width/2-((minX+maxX)/2)*zoom; state.transform.y=rect.height/2-((minY+maxY)/2)*zoom; updateTransform(); if (animate) persistSoon();
  }

  function centerNode(id) {
    const p=computeLayout()[id]; if (!p) return; const rect=els.canvasViewport.getBoundingClientRect(); state.transform.x=rect.width/2-(p.x+NODE_WIDTH/2)*state.transform.zoom; state.transform.y=rect.height/2-(p.y+NODE_HEIGHT/2)*state.transform.zoom; updateTransform();
  }

  function showConfirmModal() {
    const diff=diffModels(state.confirmed,state.draft); if (!diff.total) return showToast('Нет изменений для подтверждения');
    els.confirmSummary.innerHTML = [
      ['Узлы',diff.nodes.total],['Связи',diff.edges.total],['Темы',diff.contexts.total]
    ].map(([label,value])=>`<div class="confirm-stat"><b>${value}</b><span>${label}</span></div>`).join('');
    els.confirmModal.classList.remove('hidden'); els.versionNote.focus();
  }
  function closeConfirmModal() { els.confirmModal.classList.add('hidden'); }
  async function applyConfirm() {
    const note=els.versionNote.value.trim(); state.history.push({ at:nowIso(), note, model:clone(state.confirmed) }); state.confirmed=clone(state.draft); state.dirty=false; state.undo.length=0; state.redo.length=0; els.versionNote.value=''; await persist(); closeConfirmModal(); renderDiff(); showToast('Смысловая версия подтверждена');
  }

  async function exportModel() {
    const payload={ schema:'simnet-semantic-studio-export-v1', exportedAt:nowIso(), workbenchVersion:chrome.runtime.getManifest().version, baseRevision:tree.revision, confirmed:state.confirmed, draft:state.draft, history:state.history.map(item=>({at:item.at,note:item.note})) };
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`simnet-semantic-studio-${new Date().toISOString().replace(/[:.]/g,'-')}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),800);
  }

  async function importModel(file) {
    const text=await file.text(); const payload=JSON.parse(text); const incoming=payload?.draft || payload?.confirmed || payload;
    if (!incoming?.nodes || !incoming?.edges) throw new Error('В файле нет semantic model');
    pushUndo(); state.draft=clone(incoming); normalizeModel(state.draft); state.dirty=true; await persist(); renderAll(); fitView(); showToast('Карта импортирована как черновик');
  }

  function showToast(text) { els.toast.textContent=text; els.toast.classList.remove('hidden'); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>els.toast.classList.add('hidden'),2200); }

  function bindControls() {
    $('#addContextBtn').addEventListener('click',addContext); $('#addNodeBtn').addEventListener('click',addNode); $('#linkModeBtn').addEventListener('click',toggleLinkMode); $('#quickRouteBtn').addEventListener('click',createQuickRoute); $('#saveIdeaBtn').addEventListener('click',saveIdea);
    $('#undoBtn').addEventListener('click',undo); $('#redoBtn').addEventListener('click',redo); $('#fitBtn').addEventListener('click',()=>fitView()); $('#zoomInBtn').addEventListener('click',()=>setZoom(state.transform.zoom+.1)); $('#zoomOutBtn').addEventListener('click',()=>setZoom(state.transform.zoom-.1));
    $('#confirmBtn').addEventListener('click',showConfirmModal); $('#confirmApplyBtn').addEventListener('click',applyConfirm); $('#exportBtn').addEventListener('click',exportModel);
    $('#importInput').addEventListener('change', async event=>{ const file=event.target.files?.[0]; if (!file) return; try{await importModel(file)}catch(error){showToast(`Импорт: ${error.message}`)} event.target.value=''; });
    els.contextList.addEventListener('click',event=>{const btn=event.target.closest('[data-context-id]');if(!btn)return;state.selectedContextId=btn.dataset.contextId||'';state.selectedNodeId=state.selectedContextId?Object.values(model().nodes).find(node=>node.contextId===state.selectedContextId&&node.kind==='context')?.id||'':'case';state.selectedEdgeId='';renderAll();fitView();persistSoon();});
    els.canvasViewport.addEventListener('pointerdown',startPan); window.addEventListener('pointermove',onPointerMove); window.addEventListener('pointerup',onPointerUp);
    els.canvasViewport.addEventListener('wheel',event=>{event.preventDefault();const rect=els.canvasViewport.getBoundingClientRect();setZoom(state.transform.zoom*(event.deltaY<0?1.08:.92),{x:event.clientX-rect.left,y:event.clientY-rect.top});},{passive:false});
    els.canvasViewport.addEventListener('dblclick',event=>{if(event.target===els.canvasViewport||event.target.classList.contains('canvas-grid'))addNode();});
    els.confirmModal.querySelectorAll('[data-close-modal]').forEach(el=>el.addEventListener('click',closeConfirmModal));
    window.addEventListener('keydown',event=>{ if ((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo()} if(event.key==='Escape'){state.linkMode=false;state.linkSourceId='';$('#linkModeBtn').classList.remove('active');els.linkHint.classList.add('hidden');closeConfirmModal();renderCanvas()} });
  }

  bindControls();
  load().catch(error => { console.error('[Semantic Studio]',error); setSaveStatus(`Ошибка: ${error.message}`); });
})();
