
// ---- A* ----
function dist(points, a, b) {
  return Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
}

function buildAdj(points, edges) {
  const adj = Array.from({ length: points.length }, () => []);
  for (const e of edges) {
    const w = dist(points, e.a, e.b);
    adj[e.a].push({ to: e.b, w });
    adj[e.b].push({ to: e.a, w });
  }
  return adj;
}

export function runAStar(points, edges, start, goal) {
  if (start === goal) return [start];
  
  const adj = buildAdj(points, edges);
  const n = points.length;
  const g = new Array(n).fill(Infinity);
  const f = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const open = new Set();

  g[start] = 0;
  f[start] = dist(points, start, goal);
  open.add(start);

  while (open.size > 0) {
    let cur = null;
    for (const node of open) if (cur === null || f[node] < f[cur]) cur = node;

    if (cur === goal) {
      const path = [];
      let c = goal;
      while (c !== -1) { path.push(c); c = prev[c]; }
      return path.reverse();
    }
    open.delete(cur);
    for (const { to, w } of adj[cur]) {
      const tentG = g[cur] + w;
      if (tentG < g[to]) {
        g[to] = tentG;
        f[to] = tentG + dist(points, to, goal);
        prev[to] = cur;
        open.add(to);
      }
    }
  }

  return []; // Nenhum caminho encontrado
}