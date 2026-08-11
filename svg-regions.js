// svg-regions.js — encontra regiões de loja no SVG de fundo e converte
// coordenadas entre o espaço do editor e o viewBox do SVG.

const STORE_FILL = '#e5e7eb';

function parseNumber(value, fallback = 0) {
  const number = Number.parseFloat(value ?? '');
  return Number.isFinite(number) ? number : fallback;
}

function getSvgMetrics(svg) {
  const viewBox = svg.viewBox?.baseVal;
  const hasViewBox = viewBox && viewBox.width > 0 && viewBox.height > 0;
  const width = parseNumber(svg.getAttribute('width'), hasViewBox ? viewBox.width : 0);
  const height = parseNumber(svg.getAttribute('height'), hasViewBox ? viewBox.height : 0);

  if (width <= 0 || height <= 0) return null;
  return {
    displayWidth: width,
    displayHeight: height,
    minX: hasViewBox ? viewBox.x : 0,
    minY: hasViewBox ? viewBox.y : 0,
    viewBoxWidth: hasViewBox ? viewBox.width : width,
    viewBoxHeight: hasViewBox ? viewBox.height : height,
  };
}

function isStoreShape(node) {
  return (node.getAttribute('fill') ?? '').trim().toLowerCase() === STORE_FILL;
}

function geometryPath(node) {
  const tag = node.tagName.toLowerCase();
  if (tag === 'path') {
    const d = node.getAttribute('d');
    return d ? new Path2D(d) : null;
  }

  if (tag === 'rect') {
    const x = parseNumber(node.getAttribute('x'));
    const y = parseNumber(node.getAttribute('y'));
    const width = parseNumber(node.getAttribute('width'));
    const height = parseNumber(node.getAttribute('height'));
    if (width <= 0 || height <= 0) return null;

    const path = new Path2D();
    path.rect(x, y, width, height);
    return path;
  }

  if (tag === 'circle') {
    const radius = parseNumber(node.getAttribute('r'));
    if (radius <= 0) return null;
    const path = new Path2D();
    path.arc(
      parseNumber(node.getAttribute('cx')),
      parseNumber(node.getAttribute('cy')),
      radius,
      0,
      Math.PI * 2,
    );
    return path;
  }

  return null;
}

function editorToViewBox(point, metrics) {
  return {
    x: point.x * (metrics.viewBoxWidth / metrics.displayWidth) + metrics.minX,
    y: point.y * (metrics.viewBoxHeight / metrics.displayHeight) + metrics.minY,
  };
}

function viewBoxToEditor(point, metrics) {
  return {
    x: (point.x - metrics.minX) * (metrics.displayWidth / metrics.viewBoxWidth),
    y: (point.y - metrics.minY) * (metrics.displayHeight / metrics.viewBoxHeight),
  };
}

/**
 * Finds the store region that contains `point`, expressed in editor/world
 * coordinates. Only the same fill convention used by the totem frontend is
 * considered a store region.
 */
export function findStoreRegionAtPoint(svg, point) {
  const metrics = getSvgMetrics(svg);
  if (!metrics) return null;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  const viewBoxPoint = editorToViewBox(point, metrics);

  for (const node of svg.querySelectorAll('path[d], rect, circle')) {
    if (!isStoreShape(node)) continue;
    try {
      const path = geometryPath(node);
      if (path && context.isPointInPath(path, viewBoxPoint.x, viewBoxPoint.y)) {
        return { node, metrics };
      }
    } catch {
      // Ignore malformed SVG geometry and continue looking for a valid region.
    }
  }
  return null;
}

/** Returns the editor/world coordinates at the center of an SVG region. */
export function getStoreRegionCenter(region) {
  const bounds = region.node.getBBox();
  return viewBoxToEditor(
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    region.metrics,
  );
}

/** Briefly marks the matched region so the editor gives immediate feedback. */
export function flashStoreRegion(region) {
  const node = region.node;
  const originalFill = node.getAttribute('fill');
  node.setAttribute('fill', '#f0a500');
  window.setTimeout(() => {
    if (originalFill === null) node.removeAttribute('fill');
    else node.setAttribute('fill', originalFill);
  }, 650);
}
