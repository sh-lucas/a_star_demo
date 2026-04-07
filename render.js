import { camera, prepareCanvas, finishCanvas } from './camera.js';
import { mapState, getPointsArray, getEdgesArray } from './map.js';
import { remoteCursors } from './api.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

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

    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);

    if (isHovered) {
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 4;
    } else {
      ctx.strokeStyle = isPath ? '#e94560' : '#555';
      ctx.lineWidth = isPath ? 3 : 1.5;
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

    ctx.beginPath();
    ctx.arc(p.x, p.y, (isHovered || isEditing) ? 10 : (isSelected ? 8 : 6), 0, Math.PI * 2);

    ctx.fillStyle = isEditing
      ? typeColor
      : (isHovered ? '#ffcc00' : (isSelected ? '#f0a500' : (isPath ? '#e94560' : typeColor)));
    ctx.fill();
    ctx.strokeStyle = (isHovered || isEditing) ? '#fff' : '#222';
    ctx.lineWidth = (isHovered || isEditing) ? 2 : 1;
    ctx.stroke();

    // Label
    const label = `P${p.id}`;
    ctx.fillStyle = (isHovered || isEditing) ? '#ffcc00' : '#ddd';
    ctx.font = (isHovered || isEditing) ? 'bold 12px monospace' : '11px monospace';
    ctx.fillText(label, p.x + 12, p.y - 8);
  }

  // Remote cursors
  for (const [connId, cursor] of remoteCursors) {
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 204, 0, 0.7)';
    ctx.fill();
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Label with email
    ctx.fillStyle = '#ffcc00';
    ctx.font = '10px monospace';
    ctx.fillText(cursor.email || `User ${cursor.userId}`, cursor.x + 8, cursor.y - 6);
  }

  finishCanvas(ctx);
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
        return `<div class="list-item"
              onclick="event.preventDefault(); event.stopPropagation(); window.removeEdge(${e.id}); return false;"
              onmouseenter="window.setHoveredEdge(${e.id})"
              onmouseleave="window.setHoveredEdge(null)"
              title="Clique para remover">
            ${fromLabel} ↔ ${toLabel}
          </div>`;
      }).join('')
    : '<div class="list-empty">nenhuma</div>';
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

/** Mostra/atualiza/oculta o painel de detalhes do ponto selecionado */
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

  // Mostra/esconde campos de metadados
  const meta = document.getElementById('pd-meta');
  const hasMeta = type === 'start' || type === 'destination';
  if (meta) meta.classList.toggle('visible', hasMeta);

  if (hasMeta) {
    const title = document.getElementById('pd-title');
    const desc = document.getElementById('pd-desc');
    const icon = document.getElementById('pd-icon');
    if (title) title.value = p.title || '';
    if (desc) desc.value = p.description || '';
    if (icon) icon.value = p.icon || '';
  }
}
