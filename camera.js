// camera.js — Módulo de projeção 2D (pan + zoom)
// O canvas usa ctx.translate + ctx.scale antes de desenhar.
// Toda posição de clique deve ser convertida com screenToWorld().

export const camera = { x: 0, y: 0, zoom: 1 };

/** Converte coordenada de tela → mundo */
export function screenToWorld(sx, sy) {
  return {
    x: (sx - camera.x) / camera.zoom,
    y: (sy - camera.y) / camera.zoom,
  };
}

/** Converte coordenada de mundo → tela */
export function worldToScreen(wx, wy) {
  return {
    x: wx * camera.zoom + camera.x,
    y: wy * camera.zoom + camera.y,
  };
}

/** Aplica a transformação de câmera ao contexto do canvas */
export function applyTransform(ctx) {
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);
}

/** Prepara o canvas para um novo frame */
export function prepareCanvas(canvas, ctx) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  applyTransform(ctx);
}

/** Finaliza o desenho do frame */
export function finishCanvas(ctx) {
  ctx.restore();
}

/** Gerencia o redimensionamento do canvas */
export function handleResize(canvas, onResize) {
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (onResize) onResize();
  };
  window.addEventListener('resize', resize);
  resize();
}

/** Move a câmera por um delta em pixels de tela */
export function pan(dx, dy) {
  camera.x += dx;
  camera.y += dy;
}

/** Zoom centrado em um ponto de tela (sx, sy) */
export function zoomAt(sx, sy, factor) {
  const newZoom = Math.min(12, Math.max(0.04, camera.zoom * factor));
  camera.x = sx - (sx - camera.x) * (newZoom / camera.zoom);
  camera.y = sy - (sy - camera.y) * (newZoom / camera.zoom);
  camera.zoom = newZoom;
}

/** Define o zoom absoluto, mantendo o centro da tela fixo */
export function setZoom(value, cx, cy) {
  const newZoom = Math.min(12, Math.max(0.04, value));
  camera.x = cx - (cx - camera.x) * (newZoom / camera.zoom);
  camera.y = cy - (cy - camera.y) * (newZoom / camera.zoom);
  camera.zoom = newZoom;
}

/** Reseta a câmera para a origem */
export function resetCamera() {
  camera.x = 0;
  camera.y = 0;
  camera.zoom = 1;
}
