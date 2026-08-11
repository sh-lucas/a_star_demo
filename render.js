import { camera, prepareCanvas, finishCanvas, worldToScreen } from './camera.js';
import { mapState, getPointsArray, getEdgesArray, loadMapIconToImage } from './map.js';
import { remoteCursors } from './api.js';
import { API_BASE, EDGE_GROUP_COLORS } from './consts.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Interpolated screen positions for remote cursors.
// conn_id -> { x, y }  (screen space, updated every frame)
const cursorSmoothed = new Map();
const LERP = 0.22;

function getSmoothed(connId, targetX, targetY) {
  const prev = cursorSmoothed.get(connId);
  if (!prev) {
    // First time we see this cursor — snap to position, no lerp.
    cursorSmoothed.set(connId, { x: targetX, y: targetY });
    return { x: targetX, y: targetY };
  }
  const x = prev.x + (targetX - prev.x) * LERP;
  const y = prev.y + (targetY - prev.y) * LERP;
  cursorSmoothed.set(connId, { x, y });
  return { x, y };
}

// between position updates instead of only on the frames draw() is called.
let rafLoopId = null;

function startCursorLoop() {
  if (rafLoopId !== null) return;
  function loop() {
    if (remoteCursors.size === 0) {
      rafLoopId = null;
      return;
    }
    draw();
    rafLoopId = requestAnimationFrame(loop);
  }
  rafLoopId = requestAnimationFrame(loop);
}

export function notifyCursorUpdate() {
  startCursorLoop();
}
export function syncBGLayer() {
  const layer = document.getElementById('bg-layer');
  if (!layer) return;

  const hasBg = !!mapState.background.svgContent;
  if (!hasBg) {
    layer.innerHTML = '';
    return;
  }

  if (layer.innerHTML === '' && mapState.background.svgContent) {
    layer.innerHTML = mapState.background.svgContent;
  }

  const zoom = camera.zoom;
  const tx = camera.x + (mapState.background.offsetX * zoom);
  const ty = camera.y + (mapState.background.offsetY * zoom);

  layer.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
}

export function draw() {
  syncBGLayer();
  prepareCanvas(canvas, ctx);

  const pathResult = mapState.session.pathResult;
  const pathSet = new Set(pathResult);
  const pathEdges = new Set();

  if (pathResult.length > 1) {
    for (let i = 0; i < pathResult.length - 1; i++) {
      pathEdges.add([pathResult[i], pathResult[i + 1]].sort().join('-'));
    }
  }

  // arestas — edges now reference point DB IDs
  for (const e of getEdgesArray()) {
    const pa = mapState.points.get(e.from_point_id);
    const pb = mapState.points.get(e.to_point_id);
    if (!pa || !pb) continue;

    const isPath = pathEdges.has([e.from_point_id, e.to_point_id].sort().join('-'));
    const isHovered = e.id === mapState.visual.hoveredEdgeId;
    const isSelectedForGroup = mapState.visual.selectedEdgeIds.has(e.id);

    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);

    if (isHovered) {
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 4;
    } else if (isSelectedForGroup) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
    } else if (isPath) {
      ctx.strokeStyle = '#e94560';
      ctx.lineWidth = 3;
    } else if (e.group_id != null) {
      ctx.strokeStyle = EDGE_GROUP_COLORS[e.group_id % EDGE_GROUP_COLORS.length];
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1.5;
    }
    ctx.stroke();
  }

  // pontos
  const pts = getPointsArray();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const isSelected = mapState.visual.selected.includes(p.id);
    const isEditing = mapState.visual.editSelectedIdx === i;
    const isPath = pathSet.has(p.id);
    const isHovered = p.id === mapState.visual.hoveredPointId;

    // Cor base por tipo
    const type = p.type || 'path';
    const typeColor = type === 'start' ? '#66bb6a' : type === 'destination' ? '#e94560' : '#4fc3f7';

    // Raio em pixels de tela — tamanho base constante mas cresce suavemente com o zoom (sqrt)
    const baseR = (isHovered || isEditing) ? 10 : (isSelected ? 8 : 6);
    const r = baseR * Math.sqrt(camera.zoom) / camera.zoom;

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);

    ctx.fillStyle = isEditing
      ? typeColor
      : (isHovered ? '#ffcc00' : (isSelected ? '#f0a500' : (isPath ? '#e94560' : typeColor)));
    ctx.fill();

    // Pontos 'path' não têm borda (menos poluição visual)
    if (type !== 'path' || isHovered || isEditing || isSelected) {
      ctx.strokeStyle = (isHovered || isEditing) ? '#fff' : '#222';
      ctx.lineWidth = ((isHovered || isEditing) ? 2 : 1) * Math.sqrt(camera.zoom) / camera.zoom;
      ctx.stroke();
    }

    // Label
    const label = `P${p.id}`;
    ctx.fillStyle = (isHovered || isEditing) ? '#ffcc00' : '#ddd';
    const fontSize = ((isHovered || isEditing) ? 12 : 11) / camera.zoom;
    ctx.font = `${(isHovered || isEditing) ? 'bold ' : ''}${fontSize}px monospace`;
    ctx.fillText(label, p.x + (12 / camera.zoom), p.y - (8 / camera.zoom));
  }

  finishCanvas(ctx);

  // Remote cursors — drawn in screen space (outside the camera transform),
  // with lerp smoothing so the dot glides instead of jumping.
  // Clean up smoothed state for cursors that are no longer present.
  for (const connId of cursorSmoothed.keys()) {
    if (!remoteCursors.has(connId)) cursorSmoothed.delete(connId);
  }

  for (const [connId, cursor] of remoteCursors) {
    const target = worldToScreen(cursor.x, cursor.y);
    const { x, y } = getSmoothed(connId, target.x, target.y);

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 204, 0, 0.7)';
    ctx.fill();
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#ffcc00';
    ctx.font = '10px monospace';
    ctx.fillText(cursor.email || `User ${cursor.userId}`, x + 8, y - 6);
  }
}

export function renderLists() {
  const pl = document.getElementById('point-list');
  const el = document.getElementById('edge-list');
  if (!pl || !el) return;

  const pts = getPointsArray();
  const edges = getEdgesArray();

  pl.innerHTML = pts.length
    ? pts.map((p, i) => {
      const type = p.type || 'path';
      const dot = `<span class="type-dot ${type}"></span>`;
      return `<div class="list-item"
              onclick="event.preventDefault(); event.stopPropagation(); window.removePoint(${p.id}); return false;"
              onmouseenter="window.setHoveredPoint(${p.id})"
              onmouseleave="window.setHoveredPoint(null)"
              title="Clique para remover">
            ${dot}P${p.id} (${Math.round(p.x)}, ${Math.round(p.y)})
          </div>`;
    }).join('')
    : '<div class="list-empty">nenhum</div>';

  el.innerHTML = edges.length
    ? edges.map(e => {
      const fromP = mapState.points.get(e.from_point_id);
      const toP = mapState.points.get(e.to_point_id);
      const fromLabel = fromP ? `P${fromP.id}` : '?';
      const toLabel = toP ? `P${toP.id}` : '?';
      const group = e.group_id != null ? mapState.edgeGroups.get(e.group_id) : null;
      const groupSuffix = group ? ` — ${group.display_name}` : '';
      const isSelected = mapState.visual.selectedEdgeIds.has(e.id);
      return `<div class="list-item${isSelected ? ' selected' : ''}"
              onclick="event.preventDefault(); event.stopPropagation(); window.onEdgeListClick(${e.id}); return false;"
              onmouseenter="window.setHoveredEdge(${e.id})"
              onmouseleave="window.setHoveredEdge(null)"
              title="Clique para remover/selecionar">
            ${fromLabel} ↔ ${toLabel}${groupSuffix}
          </div>`;
    }).join('')
    : '<div class="list-empty">nenhuma</div>';
}

/**
 * Sincroniza o painel de atribuição de grupo de aresta (#edge-group-detail).
 * @param {boolean} visible
 */
export function syncEdgeGroupPanel(visible) {
  const panel = document.getElementById('edge-group-detail');
  if (!panel) return;
  panel.classList.toggle('visible', !!visible);
  if (!visible) return;

  const count = mapState.visual.selectedEdgeIds.size;
  const countEl = document.getElementById('eg-count');
  if (countEl) {
    countEl.textContent = `${count} aresta${count === 1 ? '' : 's'} selecionada${count === 1 ? '' : 's'}`;
  }

  const list = document.getElementById('edge-group-list');
  if (!list) return;

  const groups = Array.from(mapState.edgeGroups.values());
  const editingId = mapState.visual.editingEdgeGroupId;
  const activeId = mapState.visual.activeEdgeGroupId;

  list.innerHTML = groups.length
    ? groups.map(g => {
      if (g.id === editingId) {
        return `<input type="text" value="${g.display_name.replace(/"/g, '&quot;')}"
              autofocus
              onblur="window.commitEdgeGroupRename(${g.id}, this.value); return false;"
              onkeydown="if (event.key === 'Enter') this.blur(); if (event.key === 'Escape') { window.cancelEdgeGroupRename(); }" />`;
      }
      const isActive = g.id === activeId;
      return `<div class="list-item${isActive ? ' selected' : ''}"
              onclick="event.preventDefault(); event.stopPropagation(); window.selectEdgeGroupForEditing(${g.id}); return false;"
              title="Clique para selecionar/renomear">
            🏷️ ${g.display_name}
          </div>`;
    }).join('')
    : '<div class="list-empty">nenhum grupo ainda</div>';
}

export function syncBgUI() {
  const btn = document.getElementById('bg-btn');
  const bgPanel = document.getElementById('bg-panel');
  if (!btn) return;

  const hasBg = !!mapState.background.svgContent;
  btn.classList.toggle('has-bg', hasBg);
  btn.textContent = hasBg ? '🖼️ Background SVG ✔' : '🖼️ Background SVG';

  if (hasBg && bgPanel && !bgPanel.classList.contains('open')) {
    bgPanel.classList.add('open');
  }

  const zoomSlider = document.getElementById('map-zoom');
  if (zoomSlider) {
    zoomSlider.value = camera.zoom;
    const valText = document.getElementById('map-zoom-val');
    if (valText) valText.textContent = Number(camera.zoom).toFixed(2) + '×';
  }

  const oxInput = document.getElementById('bg-ox');
  const oyInput = document.getElementById('bg-oy');
  if (oxInput) oxInput.value = Math.round(mapState.background.offsetX);
  if (oyInput) oyInput.value = Math.round(mapState.background.offsetY);
}

/**
 * Populate the establishment sub-panel with data from the API.
 * Pass null to clear/reset the fields.
 * @param {object|null} est
 */
export function syncEstablishmentPanel(est) {
  const nameEl = document.getElementById('pd-estab-name');
  const descEl = document.getElementById('pd-estab-desc');
  const hoursEl = document.getElementById('pd-estab-hours');
  const catEl = document.getElementById('pd-estab-category');
  const preview = document.getElementById('pd-estab-banner-preview');
  const fileEl = document.getElementById('pd-estab-banner-file');
  const statusEl = document.getElementById('pd-estab-status');

  if (nameEl) nameEl.value = est?.name || '';
  if (descEl) descEl.value = est?.description || '';
  if (hoursEl) hoursEl.value = est?.opening_hours || '';
  if (catEl) catEl.value = est?.category_id || '';

  // Reset pending file selection
  if (fileEl) fileEl.value = '';

  // Show/hide banner preview from banner_url (raw WebP served async by the API)
  if (preview) {
    // Revoke any existing blob URL to prevent memory leak.
    if (preview.src && preview.src.startsWith('blob:')) {
      URL.revokeObjectURL(preview.src);
    }

    if (est?.banner_url) {
      // Use the full API URL so the browser loads the WebP asynchronously.
      preview.src = `${API_BASE}${est.banner_url}`;
      preview.classList.add('visible');
    } else {
      preview.src = '';
      preview.classList.remove('visible');
    }
  }

  if (statusEl) statusEl.textContent = '';
}
export function syncPointDetailPanel(idx) {
  const panel = document.getElementById('point-detail');
  if (!panel) return;

  if (idx === null || idx === undefined) {
    panel.classList.remove('visible');
    return;
  }

  const pts = getPointsArray();
  const p = pts[idx];
  if (!p) {
    panel.classList.remove('visible');
    return;
  }

  panel.classList.add('visible');
  const type = p.type || 'path';

  // Atualiza o header
  const idEl = document.getElementById('pd-point-id');
  if (idEl) idEl.textContent = `P${p.id}`;

  // Atualiza o seletor de tipo
  const typeSelect = document.getElementById('pd-type');
  if (typeSelect) typeSelect.value = type;

  // Atualiza o seletor de passable_by
  const passableBySelect = document.getElementById('pd-passable-by');
  if (passableBySelect) passableBySelect.value = String(p.passable_by ?? 0);

  // Mostra/esconde campos de metadados
  const meta = document.getElementById('pd-meta');
  const hasMeta = type === 'start' || type === 'destination' || type === 'path';
  if (meta) meta.classList.toggle('visible', hasMeta);

  if (hasMeta) {
    const iconFile = document.getElementById('pd-icon-file');
    const iconPreview = document.getElementById('pd-icon-preview');

    if (iconFile) iconFile.value = '';

    // Show icon preview if available
    if (iconPreview) {
      if (p.map_icon_type && p.map_icon_data) {
        const mimeType = p.map_icon_type === 'svg' ? 'image/svg+xml' : 'image/webp';
        iconPreview.innerHTML = '';
        const img = document.createElement('img');
        img.src = `data:${mimeType};base64,${p.map_icon_data}`;
        img.style.width = '32px';
        img.style.height = '32px';
        iconPreview.appendChild(img);
        iconPreview.style.display = 'block';
      } else {
        iconPreview.innerHTML = '';
        iconPreview.style.display = 'none';
      }
    }
  }

  // Mostra/esconde secção de estabelecimento (somente para destination)
  const estabSection = document.getElementById('pd-estab');
  if (estabSection) {
    estabSection.classList.toggle('visible', type === 'destination');
  }
}
