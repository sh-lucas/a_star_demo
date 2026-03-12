import { camera } from './camera.js';

export const mapState = {
  points: [],       // { id, x, y } — em coordenadas de MUNDO
  edges: [],        // { id, a, b } — índices em points
  nextPId: 0,
  nextEId: 0,
  background: {
    svgContent: null,
    image: null,    // HTMLImageElement
    offsetX: 0,
    offsetY: 0
  }
};

/** Reseta o estado do mapa */
export function resetMapState() {
  mapState.points = [];
  mapState.edges = [];
  mapState.nextPId = 0;
  mapState.nextEId = 0;
  mapState.background.svgContent = null;
  mapState.background.image = null;
  mapState.background.offsetX = 0;
  mapState.background.offsetY = 0;
}


/** Exporta o estado atual para um arquivo JSON */
export function exportJSON() {
  const data = JSON.stringify(
    {
      points: mapState.points,
      edges: mapState.edges,
      nextPId: mapState.nextPId,
      nextEId: mapState.nextEId,
      camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
      background: mapState.background.svgContent ? {
        svgContent: mapState.background.svgContent,
        offsetX: mapState.background.offsetX,
        offsetY: mapState.background.offsetY
      } : null
    },
    null,
    2
  );
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mapa.json';
  a.click();
  URL.revokeObjectURL(url);
}

/** Importa o estado a partir de um arquivo JSON selecionado pelo usuário */
export function importJSON(onSuccess) {
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

        // Atualiza o estado
        mapState.points = data.points ?? [];
        mapState.edges = data.edges ?? [];
        mapState.nextPId = data.nextPId ?? (mapState.points.reduce((m, p) => Math.max(m, p.id), -1) + 1);
        mapState.nextEId = data.nextEId ?? (mapState.edges.reduce((m, e) => Math.max(m, e.id), -1) + 1);

        // Câmera
        if (data.camera) {
          camera.x = data.camera.x ?? 0;
          camera.y = data.camera.y ?? 0;
          camera.zoom = data.camera.zoom ?? 1;
        }

        // Background
        if (data.background?.svgContent) {
          mapState.background.svgContent = data.background.svgContent;
          mapState.background.offsetX = data.background.offsetX ?? 0;
          mapState.background.offsetY = data.background.offsetY ?? 0;

          loadSvgToImage(mapState.background.svgContent, img => {
            mapState.background.image = img;
            if (onSuccess) onSuccess();
          });
        } else {
          mapState.background.svgContent = null;
          mapState.background.image = null;
          if (onSuccess) onSuccess();
        }
      } catch (err) {
        console.error('Import error:', err);
        alert('Arquivo JSON inválido.');
      }
    };
    reader.readAsText(file);
  };
  input.click();
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
  img.src = url;
}
