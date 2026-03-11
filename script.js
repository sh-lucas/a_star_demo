import { camera, screenToWorld, applyTransform, pan } from './camera.js';
import { runAStar } from './star.js';

// ---- State ----
const points = [];   // { id, x, y }  — em coordenadas de MUNDO
const edges = [];   // { id, a, b }  — índices em points
let nextPId = 0;
let nextEId = 0;

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
  }
};

let mode = 'move'; // 'move' | 'point' | 'edge' | 'path'
let prevMode = 'move'; // Para voltar ao modo anterior após soltar Espaço
let selected = [];       // pending indices para edge/path
let pathResult = [];     // índices ordenados do caminho A*
let hoveredPointId = null; 
let hoveredEdgeId = null;

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

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  draw();
}
window.addEventListener('resize', resize);
resize();

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
  }
});
canvas.addEventListener('mousemove', e => {
  if (!panning || !panStart) return;
  pan(e.clientX - panStart.x, e.clientY - panStart.y);
  panStart = { x: e.clientX, y: e.clientY };
  draw();
});
canvas.addEventListener('mouseup', () => {
  if (panning) {
    panning = false;
    panStart = null;
    updateCursor();
  }
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
  if (idx === null) return;

  selected.push(idx);
  if (selected.length === 2) {
    const [a, b] = selected;
    selected = [];
    if (mode === 'edge') {
      if (a !== b) addEdge(a, b);
    } else {
      pathResult = runAStar(points, edges, a, b);
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
  points.push({ id: nextPId++, x, y });
  renderLists();
  draw();
}

function addEdge(a, b) {
  if (edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))) return;
  edges.push({ id: nextEId++, a, b });
  renderLists();
  draw();
}

function removePoint(pid) {
  const idx = points.findIndex(p => p.id === pid);
  if (idx === -1) return;
  points.splice(idx, 1);
  for (let i = edges.length - 1; i >= 0; i--) {
    const e = edges[i];
    if (e.a === idx || e.b === idx) {
      edges.splice(i, 1);
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
  const idx = edges.findIndex(e => e.id === eid);
  if (idx !== -1) edges.splice(idx, 1);
  pathResult = [];
  renderLists();
  draw();
}

// ---- Export / Import ----
function exportJSON() {
  const data = JSON.stringify({ points, edges, nextPId, nextEId }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mapa.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        points.length = 0;
        edges.length = 0;
        points.push(...(data.points ?? []));
        edges.push(...(data.edges ?? []));
        nextPId = data.nextPId ?? (points.reduce((m, p) => Math.max(m, p.id), -1) + 1);
        nextEId = data.nextEId ?? (edges.reduce((m, e) => Math.max(m, e.id), -1) + 1);
        pathResult = [];
        selected = [];
        renderLists();
        draw();
      } catch {
        alert('Arquivo JSON inválido.');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ---- Helpers ----
function nearestPoint(wx, wy, radius) {
  let best = null, bestD = radius;
  for (let i = 0; i < points.length; i++) {
    const d = Math.hypot(points[i].x - wx, points[i].y - wy);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ---- Draw ----
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  applyTransform(ctx); // ← câmera via módulo

  const pathSet = new Set(pathResult);
  const pathEdges = new Set();
  if (pathResult.length > 1) {
    for (let i = 0; i < pathResult.length - 1; i++) {
      pathEdges.add([pathResult[i], pathResult[i + 1]].sort().join('-'));
    }
  }

  // arestas
  for (const e of edges) {
    const pa = points[e.a], pb = points[e.b];
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
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const isSelected = selected.includes(i);
    const isPath = pathSet.has(i);
    const isHovered = p.id === hoveredPointId;

    ctx.beginPath();
    ctx.arc(p.x, p.y, isHovered ? 10 : (isSelected ? 8 : 6), 0, Math.PI * 2);
    
    ctx.fillStyle = isHovered ? '#ffcc00' : (isPath ? '#e94560' : (isSelected ? '#f0a500' : '#4fc3f7'));
    ctx.fill();
    ctx.strokeStyle = isHovered ? '#fff' : '#222';
    ctx.lineWidth = isHovered ? 2 : 1;
    ctx.stroke();
    
    ctx.fillStyle = isHovered ? '#ffcc00' : '#ddd';
    ctx.font = isHovered ? 'bold 12px monospace' : '11px monospace';
    ctx.fillText(`P${p.id}`, p.x + 12, p.y - 8);
  }

  ctx.restore();
}

// ---- Listas laterais ----
function renderLists() {
  const pl = document.getElementById('point-list');
  const el = document.getElementById('edge-list');

  pl.innerHTML = points.length
    ? points.map(p =>
      `<div class="list-item" 
            onclick="window.removePoint(${p.id})" 
            onmouseenter="window.setHoveredPoint(${p.id})" 
            onmouseleave="window.setHoveredPoint(null)"
            title="Clique para remover">
          P${p.id} (${Math.round(p.x)}, ${Math.round(p.y)})
        </div>`).join('')
    : '<div class="list-empty">nenhum</div>';

  el.innerHTML = edges.length
    ? edges.map(e =>
      `<div class="list-item" 
            onclick="window.removeEdge(${e.id})" 
            onmouseenter="window.setHoveredEdge(${e.id})" 
            onmouseleave="window.setHoveredEdge(null)"
            title="Clique para remover">
          P${points[e.a]?.id ?? '?'} ↔ P${points[e.b]?.id ?? '?'}
        </div>`).join('')
    : '<div class="list-empty">nenhuma</div>';
}

// Expõe no window (necessário pois módulos têm escopo próprio)
window.setMode = setMode;
window.removePoint = removePoint;
window.removeEdge = removeEdge;
window.exportJSON = exportJSON;
window.importJSON = importJSON;
window.setHoveredPoint = (id) => { hoveredPointId = id; draw(); };
window.setHoveredEdge = (id) => { hoveredEdgeId = id; draw(); };

renderLists();
