import { camera, screenToWorld, pan, zoomAt, setZoom, handleResize } from './camera.js';
import { runAStar } from './star.js';
import { exportJSON as doExport, importJSON as doImport, mapState } from './map.js';
import { draw, renderLists, syncBgUI, syncPointDetailPanel } from './render.js';

const TOOLS = {
  move: { label: 'Mover Mapa (🖐️)', cursor: 'grab', activeCursor: 'grabbing' },
  point: { label: 'Adicionar Ponto', cursor: 'crosshair', activeCursor: 'crosshair' },
  edge: { label: 'Adicionar Aresta (clique em 2 pontos)', cursor: 'crosshair', activeCursor: 'crosshair' },
  path: { label: 'Achar Caminho (clique em 2 pontos)', cursor: 'crosshair', activeCursor: 'crosshair' },
  edit: { label: 'Editar Ponto (clique/arraste)', cursor: 'default', activeCursor: 'move' }
};

let mode = 'move';
let prevMode = 'move';
let draggingPointIdx = null; // Índice do ponto sendo arrastado
let spaceDown = false;
let panning = false;
let panStart = null;

const canvas = document.getElementById('canvas');

function updateCursor() {
  const tool = spaceDown ? TOOLS['move'] : TOOLS[mode];
  canvas.style.cursor = (panning || spaceDown) ? tool.activeCursor : tool.cursor;
}

handleResize(canvas, draw);

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.code === 'Space' && !e.repeat) {
    spaceDown = true;
    updateCursor();
    e.preventDefault();
  }
  if (mode === 'edit' && mapState.visual.editSelectedIdx !== null) {
    const p = mapState.points[mapState.visual.editSelectedIdx];
    if (e.code === 'ArrowUp') p.y -= 1;
    else if (e.code === 'ArrowDown') p.y += 1;
    else if (e.code === 'ArrowLeft') p.x -= 1;
    else if (e.code === 'ArrowRight') p.x += 1;
    else if (e.code === 'Delete' || e.code === 'Backspace') {
      removePoint(p.id);
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

canvas.addEventListener('mousedown', e => {
  if (mode === 'move' || spaceDown) {
    panning = true; panStart = { x: e.clientX, y: e.clientY };
    updateCursor();
  } else if (mode === 'edit') {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const idx = nearestPoint(x, y, 15);
    if (idx !== null) {
      draggingPointIdx = idx;
      mapState.visual.editSelectedIdx = idx;
      syncPointDetailPanel(idx);
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
  panning = false; panStart = null; draggingPointIdx = null;
  updateCursor();
});

canvas.addEventListener('click', e => {
  if (panning || spaceDown || mode === 'move') return;
  const { x, y } = screenToWorld(e.clientX, e.clientY);
  if (mode === 'point') { addPoint(x, y); return; }

  const idx = nearestPoint(x, y, 20);
  if (mode === 'edit') {
    mapState.visual.editSelectedIdx = idx;
    syncPointDetailPanel(idx);
    draw();
    return;
  }
  if (idx === null) return;

  mapState.visual.selected.push(idx);
  if (mapState.visual.selected.length === 2) {
    const [a, b] = mapState.visual.selected;
    mapState.visual.selected = [];
    if (mode === 'edge') {
      if (a !== b) addEdge(a, b);
    } else {
      mapState.session.pathResult = runAStar(mapState.points, mapState.edges, a, b);
      if (mapState.session.pathResult.length === 0 && a !== b) alert('Nenhum caminho encontrado!');
      draw();
    }
  } else {
    draw();
  }
});

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

function addPoint(x, y) {
  mapState.points.push({ id: mapState.nextPId++, x, y, type: 'path' });
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
    if (e.a === idx || e.b === idx) mapState.edges.splice(i, 1);
    else {
      if (e.a > idx) e.a--;
      if (e.b > idx) e.b--;
    }
  }
  mapState.session.pathResult = [];
  mapState.visual.selected = [];
  renderLists();
  draw();
}

function removeEdge(eid) {
  const idx = mapState.edges.findIndex(e => e.id === eid);
  if (idx !== -1) mapState.edges.splice(idx, 1);
  mapState.session.pathResult = [];
  renderLists();
  draw();
}

function nearestPoint(wx, wy, radius) {
  let best = null, bestD = radius;
  for (let i = 0; i < mapState.points.length; i++) {
    const d = Math.hypot(mapState.points[i].x - wx, mapState.points[i].y - wy);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
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
      const layer = document.getElementById('bg-layer');
      if (layer) layer.innerHTML = mapState.background.svgContent;
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

window.setMode = setMode;
window.removePoint = removePoint;
window.removeEdge = removeEdge;
window.exportJSON = () => doExport();
window.importJSON = () => doImport(() => { syncBgUI(); renderLists(); draw(); });
window.setHoveredPoint = (id) => { mapState.visual.hoveredPointId = id; draw(); };
window.setHoveredEdge = (id) => { mapState.visual.hoveredEdgeId = id; draw(); };
window.toggleBgPanel = () => document.getElementById('bg-panel').classList.toggle('open');
window.uploadBackground = uploadBackground;
window.clearBackground = clearBackground;
window.updateBgParam = updateBgParam;
window.updateMapZoom = updateMapZoom;
window.setPointType = (type) => {
  const idx = mapState.visual.editSelectedIdx;
  if (idx === null || !mapState.points[idx]) return;
  const p = mapState.points[idx];
  p.type = type;
  // Limpa metadados se voltou para 'path'
  if (type === 'path') { delete p.title; delete p.description; delete p.icon; }
  syncPointDetailPanel(idx);
  renderLists();
  draw();
};
window.setPointMeta = (field, value) => {
  const idx = mapState.visual.editSelectedIdx;
  if (idx === null || !mapState.points[idx]) return;
  mapState.points[idx][field] = value;
  draw(); // re-renderiza o ícone no canvas
};

renderLists();
draw();
