// map.js — Estado do mapa usando IDs do banco de dados
import { camera } from './camera.js';

export const mapState = {
  // Points keyed by DB id: Map<id, { id, x, y, type, establishment_id, map_icon_svg, floor_id }>
  points: new Map(),
  // Edges keyed by DB id: Map<id, { id, from_point_id, to_point_id, group_id }>
  edges: new Map(),
  background: {
    svgContent: null,
    image: null,    // HTMLImageElement
    offsetX: 0,
    offsetY: 0
  },
  // Visual/Transient state (not persisted)
  visual: {
    hoveredPointId: null,
    hoveredEdgeId: null,
    editSelectedIdx: null,   // array index for editing
    selected: []             // pending point DB IDs for edge/path
  },
  session: {
    pathResult: [] // array of point DB IDs forming the A* path
  },
  floorId: null,
  floorName: null
};

/** Reseta o estado do mapa */
export function resetMapState() {
  mapState.points.clear();
  mapState.edges.clear();
  mapState.background.svgContent = null;
  mapState.background.image = null;
  mapState.background.offsetX = 0;
  mapState.background.offsetY = 0;
  mapState.visual.hoveredPointId = null;
  mapState.visual.hoveredEdgeId = null;
  mapState.visual.editSelectedIdx = null;
  mapState.visual.selected = [];
  mapState.session.pathResult = [];
  mapState.floorId = null;
  mapState.floorName = null;
}

/** Retorna array de pontos (para compatibilidade com código legado) */
export function getPointsArray() {
  return Array.from(mapState.points.values());
}

/** Retorna array de arestas */
export function getEdgesArray() {
  return Array.from(mapState.edges.values());
}

/** Encontra o índice no array de pontos pelo DB ID */
export function findPointIndexById(pointId) {
  const pts = getPointsArray();
  return pts.findIndex(p => p.id === pointId);
}

/** Encontra ponto pelo DB ID */
export function getPointById(pointId) {
  return mapState.points.get(pointId);
}

/** Helper para carregar string SVG em um HTMLImageElement */
export function loadSvgToImage(svgString, callback) {
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    callback(img);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    callback(null);
  };
  img.src = url;
}

/**
 * Carrega os dados de um floor via resposta da API e popula o mapState.
 * Expected floorData: { id, name, background_svg, points: [...], edges: [...] }
 */
export function loadFloorData(floorData) {
  resetMapState();
  mapState.floorId = floorData.id;
  mapState.floorName = floorData.name;

  // Points
  if (floorData.points) {
    for (const p of floorData.points) {
      mapState.points.set(p.id, {
        id: p.id,
        x: p.x,
        y: p.y,
        type: p.type || 'path',
        establishment_id: p.establishment_id,
        map_icon_svg: p.map_icon_svg,
        floor_id: p.floor_id
      });
    }
  }

  // Edges
  if (floorData.edges) {
    for (const e of floorData.edges) {
      mapState.edges.set(e.id, {
        id: e.id,
        from_point_id: e.from_point_id,
        to_point_id: e.to_point_id,
        group_id: e.group_id
      });
    }
  }

  // Background
  if (floorData.background_svg) {
    mapState.background.svgContent = floorData.background_svg;
    loadSvgToImage(mapState.background.svgContent, img => {
      mapState.background.image = img;
    });
  }
}
