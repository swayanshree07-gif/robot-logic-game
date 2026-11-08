// Path planning: BFS distance field, A* routes over poses, and the `scan` sensor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/world.js';
import { distanceField, distAt, planRoute, scanAhead, scanTargets, tilesOf, routeToTarget } from '../src/world/paths.js';
import { solve } from '../src/game/solver.js';
import { runLevel } from '../src/game/run.js';
import { LEVELS } from '../src/game/levels.js';

const lv = (map, win = 'reach', extra = {}) => ({ id: 't', name: 't', map, win, solution: 'wait', ...extra });
const world = (map, win) => new World(lv(map, win));

// Seeded maze generator (recursive backtracker on odd cells), always solvable.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
function maze(cw, ch, seed, { loops = 0 } = {}) {
  const r = rng(seed), W = cw * 2 + 1, H = ch * 2 + 1;
  const g = Array.from({ length: H }, () => Array(W).fill('#'));
  const stack = [[0, 0]], seen = new Set(['0,0']);
  g[1][1] = '.';
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => [x + dx, y + dy, dx, dy])
      .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < cw && ny < ch && !seen.has(`${nx},${ny}`));
    if (!nb.length) { stack.pop(); continue; }
    const [nx, ny, dx, dy] = nb[Math.floor(r() * nb.length)];
    seen.add(`${nx},${ny}`);
    g[y * 2 + 1 + dy][x * 2 + 1 + dx] = '.';
    g[ny * 2 + 1][nx * 2 + 1] = '.';
    stack.push([nx, ny]);
  }
  for (let i = 0; i < loops; i++) { // knock out inner walls to make several routes
    const x = 1 + Math.floor(r() * (W - 2)), y = 1 + Math.floor(r() * (H - 2));
    if ((x + y) % 2 === 1) g[y][x] = '.';
  }
  g[1][1] = '>';
  g[H - 2][W - 2] = 'G';
  return g.map((row) => row.join(''));
}

test('distance field: BFS distances, walls and shut doors block', () => {
  const w = world([
    '#######',
    '#>..#G#',
    '#.#...#',
    '#.....#',
    '#######',
  ]);
  const f = distanceField(w, tilesOf(w, 'goal'));
  assert.equal(distAt(w, f, 5, 1), 0);
  assert.equal(distAt(w, f, 5, 2), 1);
  assert.equal(distAt(w, f, 1, 1), 6);
  assert.equal(distAt(w, f, 4, 1), -1, 'walls are -1');
  assert.equal(distAt(w, f, -1, 0), -1, 'off-grid is -1');
  // a shut door cuts the only route
  const d = world(['#######', '#>.D.G#', '#######']);
  assert.equal(distAt(d, distanceField(d, tilesOf(d, 'goal')), 1, 1), -1);
});

test('A* route is an exact action list and costs turns', () => {
  const map = ['######', '#>...#', '####.#', '#G...#', '######'];
  const w = world(map);
  const r = planRoute(w, w.robot, tilesOf(w, 'goal'));
  assert.deepEqual(r.actions, ['move', 'move', 'move', 'right', 'move', 'move', 'right', 'move', 'move', 'move']);
  assert.equal(r.cost, 10);
  const run = runLevel(r.actions.join('\n'), lv(map));
  assert.equal(run.result, 'win');
  assert.equal(planRoute(world(['#####', '#>#G#', '#####']), { x: 1, y: 1, dir: 1 }, [{ x: 3, y: 1 }]), null);
  assert.deepEqual(planRoute(w, { x: 1, y: 3, dir: 0 }, tilesOf(w, 'goal')).actions, [], 'already there');
});

test('A* agrees with the full-rules BFS solver on 40 seeded mazes', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const map = maze(3 + (seed % 4), 3 + (seed % 3), seed, { loops: seed % 5 });
    const w = world(map);
    const route = planRoute(w, w.robot, tilesOf(w, 'goal'));
    const best = solve(lv(map, 'reach', { tools: { actions: ['move', 'left', 'right'] } }));
    assert.ok(route && best, `seed ${seed} solvable`);
    assert.equal(route.cost, best.steps, `seed ${seed}: A* ${route.cost} vs BFS ${best.steps}`);
    assert.equal(runLevel(route.actions.join('\n'), lv(map)).result, 'win', `seed ${seed} route runs`);
  }
});

test('the scan sensor follows a shortest path through any maze', () => {
  const prog = 'while not goal\n  if scan\n    move\n  else\n    right\n  end\nend';
  for (let seed = 100; seed < 130; seed++) {
    const map = maze(4, 4, seed, { loops: seed % 4 });
    const run = runLevel(prog, lv(map));
    assert.equal(run.result, 'win', `seed ${seed}`);
    const w = world(map);
    assert.equal(run.world.stats.move, distAt(w, distanceField(w, tilesOf(w, 'goal')), 1, 1), `seed ${seed}: moves = BFS distance`);
  }
});

test('scan targets: bin when holding, else parts, else the pad', () => {
  const w = world(['#######', '#>.o.B#', '#..G..#', '#######'], 'deliver');
  assert.deepEqual(scanTargets(w), [{ x: 3, y: 1 }]);
  assert.ok(scanAhead(w), 'facing east toward the part');
  w.act('move'); w.act('move'); w.act('grab');
  assert.deepEqual(scanTargets(w), [{ x: 5, y: 1 }]);
  assert.ok(w.sense('scan'));
  w.act('right');
  assert.ok(!w.sense('scan'), 'south is not toward the bin');
  const g = world(['#####', '#>.G#', '#####']);
  assert.ok(g.sense('scan'));
  g.act('move'); g.act('move');
  assert.ok(!g.sense('scan'), 'false on the target itself');
  assert.deepEqual(routeToTarget(world(['#####', '#>.G#', '#####'])).actions, ['move', 'move']);
});

test('scan stays locked until the Maze Wing (first unlocked at w4-6)', () => {
  const first = LEVELS.findIndex((l) => l.tools?.sensors?.includes('scan'));
  assert.equal(LEVELS[first].id, 'w4-6');
  for (const level of LEVELS.slice(0, first)) assert.ok(!level.tools.sensors.includes('scan'), level.id);
  for (const level of LEVELS) assert.ok(level.tools?.sensors, `${level.id} lists its sensors`);
});

test('planner is fast on a big open floor', () => {
  const rows = ['#'.repeat(42)];
  for (let y = 0; y < 30; y++) rows.push('#' + '.'.repeat(40) + '#');
  rows.push('#'.repeat(42));
  rows[1] = '#>' + '.'.repeat(39) + '#';
  rows[30] = '#' + '.'.repeat(39) + 'G#';
  const w = world(rows);
  const t = Date.now();
  const r = planRoute(w, w.robot, tilesOf(w, 'goal'));
  assert.equal(r.cost, 39 + 29 + 1);
  assert.ok(Date.now() - t < 500);
});
