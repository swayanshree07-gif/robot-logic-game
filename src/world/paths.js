// Path planning on the factory grid (PLAN Day 16).
//
// Two planners, both pure and independent of the VM:
// - `distanceField(world, targets)`: multi-source BFS from the targets outward.
//   Every open tile gets its fewest-moves distance to the nearest target. This
//   is what the `scan` sensor reads, and what hints use.
// - `planRoute(world, from, targets)`: A* over poses (x, y, facing) where a move
//   and a quarter turn each cost one action, so the result is a real action
//   list Pip can run (`move`/`left`/`right`). The heuristic is the BFS field
//   value, which is admissible (turns only add cost) — so A* is exact.
//
// The grid model: walls and *currently shut* doors block; everything else
// (floor, belts, plates, pads, bins, open doors) is walkable. Belts are not
// simulated here — the full-rules `solve()` in src/game/solver.js covers them.
//
// `scanTargets(world)` decides what Pip is heading for: a bin while holding a
// part, otherwise the nearest loose part if any remain, otherwise a goal pad.

export const DIRS4 = [
  { dx: 0, dy: -1 }, // 0 north
  { dx: 1, dy: 0 },  // 1 east
  { dx: 0, dy: 1 },  // 2 south
  { dx: -1, dy: 0 }, // 3 west
];

/** Tiles of `kind` ('goal' | 'bin') as [{x, y}]. */
export function tilesOf(world, kind) {
  const out = [];
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++)
      if (world.tile(x, y) === kind) out.push({ x, y });
  return out;
}

export function scanTargets(world) {
  if (world.robot.holding > 0) return tilesOf(world, 'bin');
  if (world.items.length) return world.items.map(({ x, y }) => ({ x, y }));
  return tilesOf(world, 'goal');
}

/** Int32Array of distances (index y*width+x), -1 = unreachable or blocked. */
export function distanceField(world, targets) {
  const { width: w, height: h } = world;
  const dist = new Int32Array(w * h).fill(-1);
  const queue = [];
  for (const t of targets) {
    if (world.isBlocked(t.x, t.y)) continue;
    const i = t.y * w + t.x;
    if (dist[i] === 0) continue;
    dist[i] = 0;
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = i % w, y = (i - x) / w;
    for (const d of DIRS4) {
      const nx = x + d.dx, ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || world.isBlocked(nx, ny)) continue;
      const j = ny * w + nx;
      if (dist[j] >= 0) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return dist;
}

export function distAt(world, field, x, y) {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return -1;
  return field[y * world.width + x];
}

/**
 * The `scan` sensor: true when the tile straight ahead is one step closer to
 * the current target (so `if scan: move else: right` follows a shortest path).
 */
export function scanAhead(world, targets = scanTargets(world)) {
  const field = distanceField(world, targets);
  const r = world.robot;
  const here = distAt(world, field, r.x, r.y);
  const d = DIRS4[r.dir];
  const there = distAt(world, field, r.x + d.dx, r.y + d.dy);
  return here > 0 && there >= 0 && there < here;
}

// Small binary min-heap keyed on f, ties broken by insertion order (stable).
class Heap {
  constructor() { this.a = []; this.n = 0; }
  get size() { return this.a.length; }
  less(i, j) { const p = this.a[i], q = this.a[j]; return p.f < q.f || (p.f === q.f && p.seq < q.seq); }
  swap(i, j) { [this.a[i], this.a[j]] = [this.a[j], this.a[i]]; }
  push(node) {
    node.seq = this.n++;
    this.a.push(node);
    for (let i = this.a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p); i = p;
    }
  }
  pop() {
    const top = this.a[0], last = this.a.pop();
    if (this.a.length) {
      this.a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.a.length && this.less(l, m)) m = l;
        if (r < this.a.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
}

/**
 * Fewest-action route from pose `from` ({x, y, dir}) to any target tile.
 * Returns { actions, cost, expanded } or null if no target is reachable.
 */
export function planRoute(world, from, targets) {
  const field = distanceField(world, targets);
  const h0 = distAt(world, field, from.x, from.y);
  if (h0 < 0) return null;
  const w = world.width;
  const key = (x, y, dir) => (y * w + x) * 4 + dir;
  const best = new Map([[key(from.x, from.y, from.dir), 0]]);
  const open = new Heap();
  open.push({ x: from.x, y: from.y, dir: from.dir, g: 0, f: h0, prev: null, a: null });
  let expanded = 0;
  while (open.size) {
    const n = open.pop();
    if (best.get(key(n.x, n.y, n.dir)) < n.g) continue; // stale entry
    expanded++;
    if (distAt(world, field, n.x, n.y) === 0) {
      const actions = [];
      for (let q = n; q.prev; q = q.prev) actions.unshift(q.a);
      return { actions, cost: n.g, expanded };
    }
    const d = DIRS4[n.dir];
    const steps = [
      { a: 'move', x: n.x + d.dx, y: n.y + d.dy, dir: n.dir },
      { a: 'left', x: n.x, y: n.y, dir: (n.dir + 3) % 4 },
      { a: 'right', x: n.x, y: n.y, dir: (n.dir + 1) % 4 },
    ];
    for (const s of steps) {
      const hv = distAt(world, field, s.x, s.y);
      if (hv < 0) continue; // blocked, off-grid or cut off from every target
      const g = n.g + 1, k = key(s.x, s.y, s.dir);
      if (best.has(k) && best.get(k) <= g) continue;
      best.set(k, g);
      open.push({ x: s.x, y: s.y, dir: s.dir, g, f: g + hv, prev: n, a: s.a });
    }
  }
  return null;
}

/** Route from Pip's current pose to the current scan target (hint helper). */
export function routeToTarget(world) {
  return planRoute(world, world.robot, scanTargets(world));
}
