import { camera, screenToWorld, pan, zoomAt, setZoom, prepareCanvas, finishCanvas, handleResize } from './camera.js';
import { runAStar } from './star.js';
import { exportJSON as doExport, importJSON as doImport, loadSvgToImage, mapState } from './map.js';

const TOOLS = {
  move: {
    label: 'Mover Mapa (🖐️)',
    cursor: 'grab',
    activeCursor: 'grabbing'
  },
  point: {
    label: 'Adicionar Ponto',
    cursor: 'crosshair',
    activeCursor: 'crosshair'
  },
  edge: {
    label: 'Adicionar Aresta (clique em 2 pontos)',
    cursor: 'crosshair',
    activeCursor: 'crosshair'
  },
  path: {
    label: 'Achar Caminho (clique em 2 pontos)',
    cursor: 'crosshair',
    activeCursor: 'crosshair'
  },
  edit: {
    label: 'Editar Ponto (clique/arraste)',
    cursor: 'default',
    activeCursor: 'move'
  }
};

let mode = 'move'; // 'move' | 'point' | 'edge' | 'path'
let prevMode = 'move'; // Para voltar ao modo anterior após soltar Espaço
let selected = [];       // pending indices para edge/path
let pathResult = [];     // índices ordenados do caminho A*
let hoveredPointId = null;
let hoveredEdgeId = null;
let editSelectedIdx = null; // Índice do ponto sendo editado/movido
let draggingPointIdx = null; // Índice do ponto sendo arrastado

// ---- Pan state ----
let spaceDown = false;
let panning = false;
let panStart = null;    // { x, y } em tela

// ---- Canvas ----
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function updateCursor() {
  const tool = TOOLS[mode];
  if (panning) {
    canvas.style.cursor = tool.activeCursor;
  } else {
    canvas.style.cursor = tool.cursor;
  }
}

// Inicializa o canvas e o redimensionamento
handleResize(canvas, draw);

// ---- Teclado (Space) ----
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.repeat) {
    if (mode !== 'move') {
      prevMode = mode;
      setMode('move');
    }
    e.preventDefault();
    spaceDown = true;
    updateCursor();
  }
  
  // Setas para mover ponto (pixel-perfect)
  if (mode === 'edit' && editSelectedIdx !== null) {
    const p = mapState.points[editSelectedIdx];
    if (e.code === 'ArrowUp') p.y -= 1;
    else if (e.code === 'ArrowDown') p.y += 1;
    else if (e.code === 'ArrowLeft') p.x -= 1;
    else if (e.code === 'ArrowRight') p.x += 1;
    e.preventDefault();
    renderLists();
    draw();
  }

  // Tecla Delete ou Backspace para remover ponto selecionado
  if ((e.code === 'Delete' || e.code === 'Backspace') && mode === 'edit' && editSelectedIdx !== null) {
    const p = mapState.points[editSelectedIdx];
    removePoint(p.id);
    editSelectedIdx = null; // Limpa seleção após deletar
    e.preventDefault();
  }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    if (mode === 'move') {
      setMode(prevMode);
    }
    spaceDown = false;
    panning = false;
    panStart = null;
    updateCursor();
  }
});

// ---- Mouse: pan ----
canvas.addEventListener('mousedown', e => {
  if (mode === 'move' || spaceDown) {
    panning = true;
    panStart = { x: e.clientX, y: e.clientY };
    updateCursor();
  } else if (mode === 'edit') {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const idx = nearestPoint(x, y, 15);
    if (idx !== null) {
      draggingPointIdx = idx;
      editSelectedIdx = idx;
      updateCursor();
      draw();
    }
  }
});
canvas.addEventListener('mousemove', e => {
  if (panning && panStart) {
    pan(e.clientX - panStart.x, e.clientY - panStart.y);
    panStart = { x: e.clientX, y: e.clientY };
    draw();
  } else if (draggingPointIdx !== null) {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    mapState.points[draggingPointIdx].x = x;
    mapState.points[draggingPointIdx].y = y;
    renderLists();
    draw();
  }
});
canvas.addEventListener('mouseup', () => {
  panning = false;
  panStart = null;
  draggingPointIdx = null;
  updateCursor();
});

// ---- Mouse: clique de mapa ----
canvas.addEventListener('click', e => {
  if (panning || mode === 'move') return; // ignorar clikes em modo mover ou após-pan

  const { x, y } = screenToWorld(e.clientX, e.clientY);

  if (mode === 'point') {
    addPoint(x, y);
    return;
  }

  const idx = nearestPoint(x, y, 20);

  if (mode === 'edit') {
    editSelectedIdx = idx;
    draw();
    return;
  }

  if (idx === null) return;

  selected.push(idx);
  if (selected.length === 2) {
    const [a, b] = selected;
    selected = [];
    if (mode === 'edge') {
      if (a !== b) addEdge(a, b);
    } else {
      pathResult = runAStar(mapState.points, mapState.edges, a, b);
      if (pathResult.length === 0 && a !== b) {
        alert('Nenhum caminho encontrado entre os dois pontos!');
      }
      draw();
    }
  } else {
    draw();
  }
});

// ---- Modo ----
function setMode(m) {
  mode = m;
  if (m !== 'move') prevMode = m; // Atualiza o último modo "ferramenta"

  selected = [];
  pathResult = [];
  if (m !== 'edit') editSelectedIdx = null;

  // Update Buttons UI
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('btn-' + m);
  if (btn) btn.classList.add('active');

  // Update Status & Cursor
  const config = TOOLS[m];
  document.getElementById('status').textContent = 'Modo: ' + config.label;
  updateCursor();

  draw();
}

// ---- CRUD ----
function addPoint(x, y) {
  mapState.points.push({ id: mapState.nextPId++, x, y });
  renderLists();
  draw();
}

function addEdge(a, b) {
  if (mapState.edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))) return;
  mapState.edges.push({ id: mapState.nextEId++, a, b });
  renderLists();
  draw();
}

function removePoint(pid) {
  const idx = mapState.points.findIndex(p => p.id === pid);
  if (idx === -1) return;
  mapState.points.splice(idx, 1);
  for (let i = mapState.edges.length - 1; i >= 0; i--) {
    const e = mapState.edges[i];
    if (e.a === idx || e.b === idx) {
      mapState.edges.splice(i, 1);
    } else {
      if (e.a > idx) e.a--;
      if (e.b > idx) e.b--;
    }
  }
  pathResult = [];
  selected = [];
  renderLists();
  draw();
}

function removeEdge(eid) {
  const idx = mapState.edges.findIndex(e => e.id === eid);
  if (idx !== -1) mapState.edges.splice(idx, 1);
  pathResult = [];
  renderLists();
  draw();
}

// ---- Export / Import ----

function requestExport() {
  doExport();
}

function requestImport() {
  doImport(() => {
    syncBgUI();
    renderLists();
    draw();
  });
}

// ---- Helpers ----
function nearestPoint(wx, wy, radius) {
  let best = null, bestD = radius;
  for (let i = 0; i < mapState.points.length; i++) {
    const d = Math.hypot(mapState.points[i].x - wx, mapState.points[i].y - wy);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ---- Draw ----
function syncBGLayer() {
  const layer = document.getElementById('bg-layer');
  if (!layer) return;
  
  const hasBg = !!mapState.background.svgContent;
  if (!hasBg) {
    layer.innerHTML = '';
    return;
  }

  // Se o layer estiver vazio mas tivermos conteúdo, injeta o SVG
  if (layer.innerHTML === '' && mapState.background.svgContent) {
    layer.innerHTML = mapState.background.svgContent;
    // Garante que o SVG interno não tenha width/height fixos que quebrem o scale
    const svgEl = layer.querySelector('svg');
    if (svgEl) {
      // Usamos as dimensões originais se possível, ou deixamos que o viewport controle
      // (Geralmente SVGs de mapa já vem com viewBox)
    }
  }

  const zoom = camera.zoom;
  const tx = camera.x + (mapState.background.offsetX * zoom);
  const ty = camera.y + (mapState.background.offsetY * zoom);
  
  layer.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
}

function draw() {
  syncBGLayer();
  prepareCanvas(canvas, ctx);

  // Background SVG agora é renderizado via CSS layer (z-index: 0)
  // O canvas está acima (z-index: 1)


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
    const isHovered = e.id === hoveredEdgeId;

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
    const isSelected = selected.includes(i);
    const isEditing = editSelectedIdx === i;
    const isPath = pathSet.has(i);
    const isHovered = p.id === hoveredPointId;

    ctx.beginPath();
    ctx.arc(p.x, p.y, (isHovered || isEditing) ? 10 : (isSelected ? 8 : 6), 0, Math.PI * 2);

    ctx.fillStyle = isEditing ? '#e94560' : (isHovered ? '#ffcc00' : (isSelected ? '#f0a500' : (isPath ? '#e94560' : '#4fc3f7')));
    ctx.fill();
    ctx.strokeStyle = (isHovered || isEditing) ? '#fff' : '#222';
    ctx.lineWidth = (isHovered || isEditing) ? 2 : 1;
    ctx.stroke();

    ctx.fillStyle = (isHovered || isEditing) ? '#ffcc00' : '#ddd';
    ctx.font = (isHovered || isEditing) ? 'bold 12px monospace' : '11px monospace';
    ctx.fillText(`P${p.id}`, p.x + 12, p.y - 8);
  }

  finishCanvas(ctx);
}

// ---- Listas laterais ----
function renderLists() {
  const pl = document.getElementById('point-list');
  const el = document.getElementById('edge-list');

  pl.innerHTML = mapState.points.length
    ? mapState.points.map(p =>
      `<div class="list-item" 
            onclick="window.removePoint(${p.id})" 
            onmouseenter="window.setHoveredPoint(${p.id})" 
            onmouseleave="window.setHoveredPoint(null)"
            title="Clique para remover">
          P${p.id} (${Math.round(p.x)}, ${Math.round(p.y)})
        </div>`).join('')
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

// ---- Background helpers ----
function syncBgUI() {
  const btn = document.getElementById('bg-btn');
  const bgPanel = document.getElementById('bg-panel');
  const hasBg = !!mapState.background.svgContent;

  btn.classList.toggle('has-bg', hasBg);
  btn.textContent = hasBg ? '🖼️ Background SVG ✔' : '🖼️ Background SVG';

  if (hasBg && bgPanel && !bgPanel.classList.contains('open')) {
    bgPanel.classList.add('open');
  }

  const zoomSlider = document.getElementById('map-zoom');
  if (zoomSlider) {
    zoomSlider.value = camera.zoom;
    document.getElementById('map-zoom-val').textContent = Number(camera.zoom).toFixed(2) + '×';
  }

  document.getElementById('bg-ox').value = Math.round(mapState.background.offsetX);
  document.getElementById('bg-oy').value = Math.round(mapState.background.offsetY);
}

function toggleBgPanel() {
  document.getElementById('bg-panel').classList.toggle('open');
}

function uploadBackground() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.svg,image/svg+xml';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      mapState.background.svgContent = ev.target.result;
      document.getElementById('bg-layer').innerHTML = mapState.background.svgContent;
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
  document.getElementById('bg-layer').innerHTML = '';
  syncBgUI();
  draw();
}

function updateBgParam(param, value) {
  if (param === 'ox') {
    mapState.background.offsetX = parseInt(value) || 0;
  } else if (param === 'oy') {
    mapState.background.offsetY = parseInt(value) || 0;
  }
  draw();
}

function updateMapZoom(value) {
  const cx = canvas.width / 2, cy = canvas.height / 2;
  setZoom(parseFloat(value), cx, cy);
  document.getElementById('map-zoom-val').textContent = camera.zoom.toFixed(2) + '×';
  draw();
}

// Scroll do mouse = zoom centrado no cursor
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  zoomAt(e.clientX, e.clientY, factor);
  // Sincroniza o slider de zoom
  const slider = document.getElementById('map-zoom');
  if (slider) {
    slider.value = camera.zoom;
    document.getElementById('map-zoom-val').textContent = camera.zoom.toFixed(2) + '×';
  }
  draw();
}, { passive: false });

// Expõe no window (necessário pois módulos têm escopo próprio)
window.setMode = setMode;
window.removePoint = removePoint;
window.removeEdge = removeEdge;
window.exportJSON = requestExport;
window.importJSON = requestImport;
window.setHoveredPoint = (id) => { hoveredPointId = id; draw(); };
window.setHoveredEdge = (id) => { hoveredEdgeId = id; draw(); };
window.toggleBgPanel = toggleBgPanel;
window.uploadBackground = uploadBackground;
window.clearBackground = clearBackground;
window.updateBgParam = updateBgParam;
window.updateMapZoom = updateMapZoom;

renderLists();
