// camera.js — Módulo de projeção 2D (pan simples)
// O canvas usa ctx.translate(camera.x, camera.y) antes de desenhar.
// Toda posição de clique deve ser convertida com screenToWorld().

export const camera = { x: 0, y: 0 };

/** Converte coordenada de tela → mundo */
export function screenToWorld(sx, sy) {
  return { x: sx - camera.x, y: sy - camera.y };
}

/** Aplica a transformação de câmera ao contexto do canvas */
export function applyTransform(ctx) {
  ctx.translate(camera.x, camera.y);
}

/** Move a câmera por um delta em pixels de tela */
export function pan(dx, dy) {
  camera.x += dx;
  camera.y += dy;
}

/** Reseta a câmera para a origem */
export function resetCamera() {
  camera.x = 0;
  camera.y = 0;
}
