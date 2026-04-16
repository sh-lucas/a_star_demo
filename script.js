import { camera, screenToWorld, pan, zoomAt, setZoom, handleResize } from './camera.js';
import { runAStar } from './star.js';
import { mapState, getPointsArray, getEdgesArray, findPointIndexById, getPointById, loadFloorData, loadSvgToImage, snapToGrid, GRID_SIZE } from './map.js';
import { draw, renderLists, syncBgUI, syncPointDetailPanel, syncEstablishmentPanel, notifyCursorUpdate } from './render.js';
import {
  setAuthToken,
  listFloors, getFloor, updateFloor,
  connect, disconnect, isConnected,
  wsAddPoint, wsMovePoint, wsUpdatePoint, wsRemovePoint,
  wsAddEdge, wsRemoveEdge,
  sendMousePosition,
  getEstablishment, upsertEstablishment, upsertEstablishmentBanner, deleteEstablishment as apiDeleteEstablishment,
  upsertPointMapIcon,
  searchPoints,
  on, off,
  remoteCursors,
  API_BASE,
} from './api.js';


const TOOLS = {
  move: { label: 'Mover Mapa (🖐️)', cursor: 'grab', activeCursor: 'grabbing' },
  point: { label: 'Adicionar Ponto', cursor: 'crosshair', activeCursor: 'crosshair' },
  edge: { label: 'Adicionar Aresta (clique em 2 pontos)', cursor: 'crosshair', activeCursor: 'crosshair' },
  path: { label: 'Achar Caminho (clique em 2 pontos)', cursor: 'crosshair', activeCursor: 'crosshair' },
  edit: { label: 'Editar Ponto (clique/arraste)', cursor: 'default', activeCursor: 'move' }
};

let mode = 'move';
let prevMode = 'move';
let draggingPointId = null; // DB ID do ponto sendo arrastado
let spaceDown = false;
let panning = false;
let panStart = null;
let mouseLastWorld = { x: 0, y: 0 };
let mouseOnCanvas = false; // true while the pointer is inside the canvas

const canvas = document.getElementById('canvas');

function updateCursor() {
  const tool = spaceDown ? TOOLS['move'] : TOOLS[mode];
  canvas.style.cursor = (panning || spaceDown) ? tool.activeCursor : tool.cursor;
}

handleResize(canvas, draw);

// ─── Keyboard ───
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  // T → toggle search overlay
  if (e.key === 't' || e.key === 'T') {
    if (searchOverlay.classList.contains('visible')) {
      closeSearch();
    } else {
      openSearch();
    }
    e.preventDefault();
    return;
  }

  if (e.code === 'Space' && !e.repeat) {
    spaceDown = true;
    updateCursor();
    e.preventDefault();
  }
  if (mode === 'edit' && mapState.visual.editSelectedIdx !== null) {
    const pts = getPointsArray();
    const p = pts[mapState.visual.editSelectedIdx];
    if (!p) return;
    if (e.code === 'ArrowUp') { p.y -= GRID_SIZE; wsMovePoint(p.id, p.x, p.y); }
    else if (e.code === 'ArrowDown') { p.y += GRID_SIZE; wsMovePoint(p.id, p.x, p.y); }
    else if (e.code === 'ArrowLeft') { p.x -= GRID_SIZE; wsMovePoint(p.id, p.x, p.y); }
    else if (e.code === 'ArrowRight') { p.x += GRID_SIZE; wsMovePoint(p.id, p.x, p.y); }
    else if (e.code === 'Delete' || e.code === 'Backspace') {
      wsRemovePoint(p.id);
      mapState.visual.editSelectedIdx = null;
      syncPointDetailPanel(null);
    } else return;
    e.preventDefault();
    renderLists();
    draw();
  }
});

window.addEventListener('keyup', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') {
    spaceDown = false; panning = false; panStart = null;
    updateCursor();
  }
});

// ─── Mouse ───
// ─── Global error handling ───
window.onerror = (msg, src, line, col, err) => {
  console.error('[GLOBAL ERROR]', msg, 'at', src, line, col, err);
  return false;
};

window.addEventListener('unhandledrejection', e => {
  console.error('[UNHANDLED REJECTION]', e.reason);
});

canvas.addEventListener('mousedown', e => {
  e.preventDefault();
  e.stopPropagation();
  if (mode === 'move' || spaceDown) {
    panning = true; panStart = { x: e.clientX, y: e.clientY };
    updateCursor();
  } else if (mode === 'edit') {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const idx = nearestPoint(x, y, 15);
    if (idx !== null) {
      draggingPointId = getPointsArray()[idx].id;
      mapState.visual.editSelectedIdx = idx;
      _establishmentDirty = false;
      syncPointDetailPanel(idx);
      loadEstablishmentForPoint(getPointsArray()[idx]);
      updateCursor();
      draw();
    }
  }
  return false;
});

canvas.addEventListener('mousemove', e => {
  if (panning && panStart) {
    pan(e.clientX - panStart.x, e.clientY - panStart.y);
    panStart = { x: e.clientX, y: e.clientY };
    draw();
  } else if (draggingPointId !== null) {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const p = getPointById(draggingPointId);
    if (p) {
      p.x = snapToGrid(x);
      p.y = snapToGrid(y);
      renderLists();
      draw();
    }
  }

  // Track mouse world position and send (throttled to ~6x/s via timestamp).
  const { x, y } = screenToWorld(e.clientX, e.clientY);
  mouseLastWorld = { x, y };
  mouseOnCanvas = true;
  maybeSendMousePosition();
  resetHeartbeatFallback();
});

canvas.addEventListener('mouseenter', () => {
  mouseOnCanvas = true;
});

// When the mouse leaves the canvas, hide this client's cursor for others.
canvas.addEventListener('mouseleave', () => {
  mouseOnCanvas = false;
  if (isConnected()) sendMousePosition(null, null);
});

// mouseup on window (not just canvas) so releasing outside doesn't leave
// panning/dragging stuck if the pointer travels beyond the canvas boundary.
window.addEventListener('mouseup', () => {
  // Commit dragged point position to server
  if (draggingPointId !== null) {
    const p = getPointById(draggingPointId);
    if (p) {
      wsMovePoint(p.id, p.x, p.y);
    }
  }
  panning = false; panStart = null; draggingPointId = null;
  updateCursor();
});

canvas.addEventListener('click', e => {
  console.log('[click]', mode, 'at', e.clientX, e.clientY);
  e.preventDefault();
  e.stopPropagation();
  if (panning || spaceDown || mode === 'move') return false;
  const { x, y } = screenToWorld(e.clientX, e.clientY);
  if (mode === 'point') {
    const sx = snapToGrid(x), sy = snapToGrid(y);
    console.log('[click] calling wsAddPoint', sx, sy);
    wsAddPoint(sx, sy, 'path', null, null);
    return false;
  }

  const idx = nearestPoint(x, y, 20);
  if (mode === 'edit') {
    mapState.visual.editSelectedIdx = idx;
    syncPointDetailPanel(idx);
    if (idx !== null) {
      _establishmentDirty = false;
      loadEstablishmentForPoint(getPointsArray()[idx]);
    }
    draw();
    return false;
  }
  if (idx === null) return false;

  const pts = getPointsArray();
  const pointId = pts[idx].id;
  mapState.visual.selected.push(pointId);

  if (mapState.visual.selected.length === 2) {
    const [a, b] = mapState.visual.selected;
    mapState.visual.selected = [];
    if (mode === 'edge') {
      if (a !== b) wsAddEdge(a, b);
    } else {
      mapState.session.pathResult = runAStar(mapState.points, mapState.edges, a, b);
      if (mapState.session.pathResult.length === 0 && a !== b) alert('Nenhum caminho encontrado!');
      draw();
    }
  } else {
    draw();
  }
  return false;
});

// ─── Mouse position send — dispara direto no mousemove, throttled a ~12x/s ───
let mouseLastSendTime = 0;

function maybeSendMousePosition() {
  if (!isConnected() || !mouseOnCanvas) return;
  const now = performance.now();
  if (now - mouseLastSendTime < 83) return;
  mouseLastSendTime = now;
  sendMousePosition(mouseLastWorld.x, mouseLastWorld.y);
}

// Heartbeat mínimo: garante que a conexão não morra se o mouse parar de mover.
// Não depende de setInterval — usa o próprio loop de animação quando ativo,
// e um único timer de fallback quando a aba fica em background.
let heartbeatFallbackTimer = null;

function resetHeartbeatFallback() {
  if (heartbeatFallbackTimer) clearTimeout(heartbeatFallbackTimer);
  heartbeatFallbackTimer = setTimeout(function tick() {
    if (isConnected()) sendMousePosition(null, null);
    heartbeatFallbackTimer = setTimeout(tick, 2000);
  }, 2000);
}

function startMouseHeartbeat() {
  resetHeartbeatFallback();
}

function stopMouseHeartbeat() {
  if (heartbeatFallbackTimer) {
    clearTimeout(heartbeatFallbackTimer);
    heartbeatFallbackTimer = null;
  }
}

// ─── Search overlay ───
const searchOverlay = document.getElementById('search-overlay');
const searchInput   = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

let searchDebounceTimer = null;

function openSearch() {
  searchOverlay.classList.add('visible');
  searchInput.value = '';
  searchResults.innerHTML = '';
  searchInput.focus();
}

function closeSearch() {
  searchOverlay.classList.remove('visible');
  searchInput.value = '';
  searchResults.innerHTML = '';
}

function centerOnPoint(point) {
  const canvas = document.getElementById('canvas');
  // Pan the camera so the point sits at the center of the canvas.
  camera.x = canvas.width  / 2 - point.x * camera.zoom;
  camera.y = canvas.height / 2 - point.y * camera.zoom;
  closeSearch();
  draw();
}

async function runSearch(q) {
  if (!q.trim()) { searchResults.innerHTML = ''; return; }
  searchResults.innerHTML = '<div id="search-empty">Buscando...</div>';
  try {
    const data = await searchPoints(q, { limit: 30 });
    const items = data?.results ?? [];
    if (!items.length) {
      searchResults.innerHTML = '<div id="search-empty">Nenhum resultado encontrado.</div>';
      return;
    }
    searchResults.innerHTML = items.map(r => {
      const floor = r.floor_id != null ? `Andar ${r.floor_id}` : '';
      return `<div class="search-result-item" data-point-id="${r.point_id}"
                   data-x="${r.x}" data-y="${r.y}">
        <span class="search-result-name">${escapeHtml(r.establishment_name)}</span>
        <span class="search-result-floor">${escapeHtml(floor)}</span>
      </div>`;
    }).join('');

    searchResults.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        centerOnPoint({ x: parseFloat(el.dataset.x), y: parseFloat(el.dataset.y) });
      });
    });
  } catch (err) {
    searchResults.innerHTML = `<div id="search-empty" style="color:#e94560">Erro: ${escapeHtml(err.message)}</div>`;
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => runSearch(searchInput.value), 300);
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); }
  if (e.key === 'Enter') {
    clearTimeout(searchDebounceTimer);
    runSearch(searchInput.value);
  }
});

// Click outside the search box closes it.
searchOverlay.addEventListener('mousedown', e => {
  if (e.target === searchOverlay) closeSearch();
});

// ─── Mode ───
function setMode(m) {
  mode = m;
  if (m !== 'move') prevMode = m;
  mapState.visual.selected = [];
  mapState.session.pathResult = [];
  if (m !== 'edit') {
    mapState.visual.editSelectedIdx = null;
    syncPointDetailPanel(null);
  }

  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('btn-' + m);
  if (btn) btn.classList.add('active');

  updateCursor();
  draw();
}

function nearestPoint(wx, wy, radius) {
  const pts = getPointsArray();
  let best = null, bestD = radius;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - wx, pts[i].y - wy);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ─── Background ───
function uploadBackground() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.svg,image/svg+xml';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const svgData = ev.target.result;

      // Persist to server first; bail out on error so we don't show stale local state.
      if (mapState.floorId == null) {
        console.warn('[uploadBackground] No floor connected — cannot save background');
        return;
      }
      try {
        await updateFloor(mapState.floorId, mapState.floorName, svgData);
      } catch (err) {
        console.error('[uploadBackground] PUT /floors failed:', err.message);
        alert(`Erro ao salvar background: ${err.message}`);
        return;
      }

      // Update local state & UI (the WS broadcast will sync other clients).
      mapState.background.svgContent = svgData;
      const layer = document.getElementById('bg-layer');
      if (layer) layer.innerHTML = svgData;
      syncBgUI();
      draw();
    };
    reader.readAsText(file);
  };
  input.click();
}

function clearBackground() {
  mapState.background.svgContent = null;
  mapState.background.image = null;
  mapState.background.offsetX = 0;
  mapState.background.offsetY = 0;
  const layer = document.getElementById('bg-layer');
  if (layer) layer.innerHTML = '';
  syncBgUI();
  draw();
}

function updateBgParam(param, value) {
  if (param === 'ox') mapState.background.offsetX = parseInt(value) || 0;
  else if (param === 'oy') mapState.background.offsetY = parseInt(value) || 0;
  draw();
}

function updateMapZoom(value) {
  setZoom(parseFloat(value), canvas.width / 2, canvas.height / 2);
  const valText = document.getElementById('map-zoom-val');
  if (valText) valText.textContent = camera.zoom.toFixed(2) + '×';
  draw();
  return false;
}

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
  const slider = document.getElementById('map-zoom');
  if (slider) slider.value = camera.zoom;
  const valText = document.getElementById('map-zoom-val');
  if (valText) valText.textContent = camera.zoom.toFixed(2) + '×';
  draw();
}, { passive: false });

// ─── Window exports ───
window.setMode = setMode;
window.removePoint = (pid) => { wsRemovePoint(pid); };
window.removeEdge = (eid) => { wsRemoveEdge(eid); };
window.setHoveredPoint = (id) => { mapState.visual.hoveredPointId = id; draw(); };
window.setHoveredEdge = (id) => { mapState.visual.hoveredEdgeId = id; draw(); };
window.toggleBgPanel = () => document.getElementById('bg-panel').classList.toggle('open');
window.uploadBackground = uploadBackground;
window.clearBackground = clearBackground;
window.updateBgParam = updateBgParam;
window.updateMapZoom = updateMapZoom;
window.setPointType = (type) => {
  const idx = mapState.visual.editSelectedIdx;
  if (idx === null || idx === undefined) return;
  const pts = getPointsArray();
  const p = pts[idx];
  if (!p) return;
  p.type = type;
  if (type === 'path') { delete p.title; delete p.description; delete p.icon; }
  wsUpdatePoint(p.id, type, p.establishment_id ?? null);
  syncPointDetailPanel(idx);
  loadEstablishmentForPoint(p);
  renderLists();
  draw();
};
window.setPointMeta = (field, value) => {
  const idx = mapState.visual.editSelectedIdx;
  if (idx === null || idx === undefined) return;
  const pts = getPointsArray();
  const p = pts[idx];
  if (!p) return;
  p[field] = value;
  draw();
};

// ─── Point icon (SVG/WebP) upload handler ───

window.onPointIconChange = async (input) => {
  const idx = mapState.visual.editSelectedIdx;
  if (idx === null || idx === undefined) return;
  const pts = getPointsArray();
  const p = pts[idx];
  if (!p) return;

  const file = input.files[0];
  if (!file) return;

  try {
    const updated = await upsertPointMapIcon(p.id, file);
    // Update local state with the values returned by the server
    p.map_icon_type = updated.map_icon_type ?? null;
    p.map_icon_data = updated.map_icon_data ?? null;
    syncPointDetailPanel(idx);
    renderLists();
    draw();
  } catch (err) {
    alert(`Erro ao salvar ícone: ${err.message}`);
  }
};

// ─── Establishment panel handlers ───

// Track a pending icon File selected by the user (not yet saved).
let _pendingBannerFile = null;
// True while the user has unsaved edits in the establishment fields.
// Prevents background reloads (floor:sync) from wiping what they typed.
let _establishmentDirty = false;

window.onEstabBannerChange = (input) => {
  _pendingBannerFile = input.files[0] || null;
  _establishmentDirty = true;
  // Show a local preview immediately.
  if (_pendingBannerFile) {
    const preview = document.getElementById('pd-estab-banner-preview');
    if (preview) {
      preview.src = URL.createObjectURL(_pendingBannerFile);
      preview.classList.add('visible');
    }
  }
};

// Mark establishment fields as dirty when the user types.
window.markEstabDirty = () => { _establishmentDirty = true; };

window.saveEstablishment = async () => {
  const idx = mapState.visual.editSelectedIdx;
  if (idx === null || idx === undefined) return;
  const pts = getPointsArray();
  const p = pts[idx];
  if (!p || p.type !== 'destination') return;

  const nameEl   = document.getElementById('pd-estab-name');
  const descEl   = document.getElementById('pd-estab-desc');
  const hoursEl  = document.getElementById('pd-estab-hours');
  const statusEl = document.getElementById('pd-estab-status');
  const saveBtn  = document.getElementById('pd-estab-save');

  const name = nameEl?.value?.trim() || '';

  if (saveBtn) saveBtn.disabled = true;
  if (statusEl) statusEl.textContent = 'Salvando...';

  try {
    // Upsert text fields (all optional on the backend now).
    let est = await upsertEstablishment(p.id, {
      name,
      description:   descEl?.value?.trim()  || '',
      opening_hours: hoursEl?.value?.trim() || '',
    });

    // Upload banner separately if a new file was selected.
    if (_pendingBannerFile) {
      est = await upsertEstablishmentBanner(p.id, _pendingBannerFile);
    }

    // Update local point state so establishment_id is reflected.
    if (est?.id) p.establishment_id = est.id;
    _pendingBannerFile = null;
    _establishmentDirty = false;
    // Refresh the file input + preview from the saved data.
    syncEstablishmentPanel(est);
    if (statusEl) statusEl.textContent = '✔ Salvo!';
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
  } catch (err) {
    if (statusEl) statusEl.textContent = `❌ ${err.message}`;
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
};

window.deleteEstablishment = async () => {
  const idx = mapState.visual.editSelectedIdx;
  if (idx === null || idx === undefined) return;
  const pts = getPointsArray();
  const p = pts[idx];
  if (!p || p.type !== 'destination') return;

  const statusEl = document.getElementById('pd-estab-status');
  if (statusEl) statusEl.textContent = 'Removendo...';

  try {
    await apiDeleteEstablishment(p.id);
    p.establishment_id = null;
    _pendingIconFile = null;
    _pendingBannerFile = null;
    _establishmentDirty = false;
    syncEstablishmentPanel(null);
    if (statusEl) statusEl.textContent = '✔ Removido';
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
  } catch (err) {
    if (statusEl) statusEl.textContent = `❌ ${err.message}`;
  }
};

/** Load establishment data from server when a destination point is selected. */
async function loadEstablishmentForPoint(p) {
  if (!p || p.type !== 'destination') {
    syncEstablishmentPanel(null);
    _establishmentDirty = false;
    return;
  }

  // If the user already typed something, keep their edits — don't overwrite.
  if (_establishmentDirty) return;

  _pendingBannerFile = null;
  // Optimistically clear while loading.
  syncEstablishmentPanel(null);
  try {
    const est = await getEstablishment(p.id);
    // Guard: user may have started typing while we were fetching — respect that.
    if (!_establishmentDirty) {
      syncEstablishmentPanel(est); // est may be null (no establishment yet)
    }
  } catch (err) {
    console.warn('[establishment] failed to load:', err.message);
  }
}

// ─── Floor selector & connection ───
async function loadFloors() {
  const listEl = document.getElementById('floor-list');
  const overlayStatus = document.getElementById('floor-conn-status');

  overlayStatus.textContent = 'Carregando floors...';
  listEl.innerHTML = '';

  try {
    const floors = await listFloors();
    if (!floors || floors.length === 0) {
      listEl.innerHTML = '<div class="list-empty">Nenhum floor encontrado.</div>';
      overlayStatus.textContent = 'Nenhum floor disponível';
      return;
    }
    listEl.innerHTML = floors.map(f =>
      `<div class="floor-item" onclick="event.preventDefault(); event.stopPropagation(); window.selectFloor(${f.id}); return false;">
        <strong>${f.name}</strong>
        <span class="floor-id">ID: ${f.id}</span>
      </div>`
    ).join('');
    overlayStatus.textContent = `${floors.length} floor(s) disponível(is)`;
  } catch (err) {
    listEl.innerHTML = `<div class="list-empty" style="color:#e94560">Erro: ${err.message}</div>`;
    overlayStatus.textContent = `Erro ao carregar floors`;
  }
}

async function selectFloor(id) {
  const overlay = document.getElementById('login-overlay');
  const overlayStatus = document.getElementById('floor-conn-status');
  const barStatus = document.getElementById('conn-status');

  overlayStatus.textContent = 'Conectando...';

  try {
    const floorData = await getFloor(id);
    loadFloorData(floorData);
    await connect(id);
    startMouseHeartbeat();
    overlay.style.display = 'none';
    syncBgUI();
    renderLists();
    draw();
    if (barStatus) barStatus.textContent = `⚡ Conectado: ${mapState.floorName} (floor #${id})`;
    const dlBtn = document.getElementById('btn-download-map');
    if (dlBtn) dlBtn.disabled = false;
  } catch (err) {
    overlayStatus.textContent = `Erro: ${err.message}`;
    if (barStatus) barStatus.textContent = `Erro: ${err.message}`;
  }
}

window.selectFloor = selectFloor;

// Chamado pelo botão "Conectar" no overlay — lê o token do input e lista os floors
window.connectWithToken = async function() {
  const input = document.getElementById('token-input');
  const token = input ? input.value.trim() : '';
  if (!token) {
    document.getElementById('floor-conn-status').textContent = '⚠️ Cole o token JWT acima';
    return;
  }
  setAuthToken(token);
  await loadFloors();
};

// ─── WebSocket event listeners ───
on('mouse:position', () => {
  notifyCursorUpdate();
  draw(); // garante um frame mesmo quando o cursor é removido (remoteCursors ficou vazio)
});

on('point:added', (payload) => {
  console.log('[point:added] payload=', payload);
  console.trace('[point:added] stack');
  mapState.points.set(payload.id, {
    id: payload.id,
    x: payload.x,
    y: payload.y,
    type: payload.type || 'path',
    establishment_id: payload.establishment_id,
    map_icon_type: payload.map_icon_type ?? null,
    map_icon_data: payload.map_icon_data ?? null,
    floor_id: payload.floor_id
  });
  console.log('[point:added] before renderLists');
  renderLists();
  console.log('[point:added] before draw');
  draw();
  console.log('[point:added] done');
});

on('point:moved', (payload) => {
  const p = mapState.points.get(payload.id);
  if (p) {
    p.x = payload.x;
    p.y = payload.y;
  }
  renderLists();
  draw();
});

on('point:updated', (payload) => {
  const p = mapState.points.get(payload.id);
  if (p) {
    p.type = payload.type;
    p.establishment_id = payload.establishment_id;
    p.map_icon_type = payload.map_icon_type ?? null;
    p.map_icon_data = payload.map_icon_data ?? null;
  }
  renderLists();
  draw();
});

on('point:removed', (payload) => {
  mapState.points.delete(payload.id);
  for (const [eid, e] of mapState.edges) {
    if (e.from_point_id === payload.id || e.to_point_id === payload.id) {
      mapState.edges.delete(eid);
    }
  }
  mapState.session.pathResult = [];
  mapState.visual.selected = [];
  if (mapState.visual.editSelectedIdx !== null) {
    const pts = getPointsArray();
    if (!pts[mapState.visual.editSelectedIdx]) {
      mapState.visual.editSelectedIdx = null;
      syncPointDetailPanel(null);
    }
  }
  renderLists();
  draw();
});

on('edge:added', (payload) => {
  mapState.edges.set(payload.id, {
    id: payload.id,
    from_point_id: payload.from_point_id,
    to_point_id: payload.to_point_id,
    group_id: payload.group_id
  });
  renderLists();
  draw();
});

on('edge:removed', (payload) => {
  mapState.edges.delete(payload.id);
  mapState.session.pathResult = [];
  renderLists();
  draw();
});

on('background:changed', (payload) => {
  if (payload.background_svg) {
    mapState.background.svgContent = payload.background_svg;
    loadSvgToImage(payload.background_svg, img => {
      mapState.background.image = img;
      syncBgUI();
      draw();
    });
  }
});

on('ws:close', () => {
  stopMouseHeartbeat();
  const barStatus = document.getElementById('conn-status');
  if (barStatus) barStatus.textContent = '⚠️ Conexão perdida — tentando reconectar...';
});

on('floor:sync', (floorData) => {
  // Remember which point was selected (by ID, not array index — index may shift after reload).
  const prevSelectedId = mapState.visual.editSelectedIdx !== null
    ? (getPointsArray()[mapState.visual.editSelectedIdx]?.id ?? null)
    : null;

  loadFloorData(floorData);
  startMouseHeartbeat();
  renderLists();
  draw();

  // Restore selection if the point still exists after reload.
  if (prevSelectedId !== null) {
    const pts = getPointsArray();
    const newIdx = pts.findIndex(p => p.id === prevSelectedId);
    if (newIdx !== -1) {
      mapState.visual.editSelectedIdx = newIdx;
      syncPointDetailPanel(newIdx);
      // Don't clobber fields the user may be editing — loadEstablishment
      // only fetches when the panel was NOT already dirty.
      loadEstablishmentForPoint(pts[newIdx]);
    } else {
      mapState.visual.editSelectedIdx = null;
      syncPointDetailPanel(null);
    }
  }

  const barStatus = document.getElementById('conn-status');
  if (barStatus) barStatus.textContent = `⚡ Reconectado: ${mapState.floorName} (floor #${floorData.id})`;
});

// ─── Init ───
// Nada automático — o usuário cola o token e clica em Conectar.

// ─── Download floor map ───
window.downloadFloorMap = async function () {
  const floorId = mapState.floorId;
  if (!floorId) return;

  const btn = document.getElementById('btn-download-map');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/maps/floor/${floorId}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `floor-${floorId}.db`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Erro ao baixar mapa: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
};
