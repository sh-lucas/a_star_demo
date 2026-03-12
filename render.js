import { camera, prepareCanvas, finishCanvas } from './camera.js';
import { mapState } from './map.js';

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

  // arestas
  for (const e of mapState.edges) {
    const pa = mapState.points[e.a], pb = mapState.points[e.b];
    if (!pa || !pb) continue;
    const isPath = pathEdges.has([e.a, e.b].sort().join('-'));
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
  for (let i = 0; i < mapState.points.length; i++) {
    const p = mapState.points[i];
    const isSelected = mapState.visual.selected.includes(i);
    const isEditing = mapState.visual.editSelectedIdx === i;
    const isPath = pathSet.has(i);
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

    // Label: icone (se tiver) + ID
    const label = p.icon ? `${p.icon} P${p.id}` : `P${p.id}`;
    ctx.fillStyle = (isHovered || isEditing) ? '#ffcc00' : '#ddd';
    ctx.font = (isHovered || isEditing) ? 'bold 12px monospace' : '11px monospace';
    ctx.fillText(label, p.x + 12, p.y - 8);
  }

  finishCanvas(ctx);
}

export function renderLists() {
  const pl = document.getElementById('point-list');
  const el = document.getElementById('edge-list');
  if (!pl || !el) return;

  pl.innerHTML = mapState.points.length
    ? mapState.points.map(p => {
        const type = p.type || 'path';
        const dot = `<span class="type-dot ${type}"></span>`;
        return `<div class="list-item" 
              onclick="window.removePoint(${p.id})" 
              onmouseenter="window.setHoveredPoint(${p.id})" 
              onmouseleave="window.setHoveredPoint(null)"
              title="Clique para remover">
            ${dot}P${p.id} (${Math.round(p.x)}, ${Math.round(p.y)})
          </div>`;
      }).join('')
    : '<div class="list-empty">nenhum</div>';

  el.innerHTML = mapState.edges.length
    ? mapState.edges.map(e =>
      `<div class="list-item" 
            onclick="window.removeEdge(${e.id})" 
            onmouseenter="window.setHoveredEdge(${e.id})" 
            onmouseleave="window.setHoveredEdge(null)"
            title="Clique para remover">
          P${mapState.points[e.a]?.id ?? '?'} ↔ P${mapState.points[e.b]?.id ?? '?'}
        </div>`).join('')
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

  if (idx === null || idx === undefined || !mapState.points[idx]) {
    panel.classList.remove('visible');
    return;
  }

  panel.classList.add('visible');
  const p = mapState.points[idx];
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
