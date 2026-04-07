// star.js — A* pathfinding usando DB IDs em vez de índices de array
// Recebe Map<id, point> e Map<id, edge>, retorna array de point DB IDs

function dist(pointsMap, aId, bId) {
  const a = pointsMap.get(aId);
  const b = pointsMap.get(bId);
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function buildAdj(pointsMap, edgesMap) {
  const adj = new Map(); // pointId -> [{ to: pointId, w }]
  for (const pid of pointsMap.keys()) {
    adj.set(pid, []);
  }
  for (const e of edgesMap.values()) {
    const w = dist(pointsMap, e.from_point_id, e.to_point_id);
    if (adj.has(e.from_point_id)) adj.get(e.from_point_id).push({ to: e.to_point_id, w });
    if (adj.has(e.to_point_id)) adj.get(e.to_point_id).push({ to: e.from_point_id, w });
  }
  return adj;
}

export function runAStar(pointsMap, edgesMap, startId, goalId) {
  if (startId === goalId) return [startId];
  if (!pointsMap.has(startId) || !pointsMap.has(goalId)) return [];

  const adj = buildAdj(pointsMap, edgesMap);
  const g = new Map();  // pointId -> cost
  const f = new Map();  // pointId -> estimated total cost
  const prev = new Map(); // pointId -> previous pointId
  const open = new Set();

  g.set(startId, 0);
  f.set(startId, dist(pointsMap, startId, goalId));
  open.add(startId);

  while (open.size > 0) {
    let cur = null;
    for (const node of open) {
      if (cur === null || f.get(node) < f.get(cur)) cur = node;
    }

    if (cur === goalId) {
      const path = [];
      let c = goalId;
      while (c !== undefined) { path.push(c); c = prev.get(c); }
      return path.reverse();
    }

    open.delete(cur);
    const neighbors = adj.get(cur) || [];
    for (const { to, w } of neighbors) {
      const tentG = g.get(cur) + w;
      if (tentG < (g.get(to) ?? Infinity)) {
        g.set(to, tentG);
        f.set(to, tentG + dist(pointsMap, to, goalId));
        prev.set(to, cur);
        open.add(to);
      }
    }
  }

  return []; // Nenhum caminho encontrado
}
