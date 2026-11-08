// Breadth-first search over world states: the fewest actions that win a level.
// Used by the tests to prove step budgets ("battery") are fair and tight, and
// for level-editor verification. Grid-only route planning (A*, the `scan`
// sensor) lives in src/world/paths.js.
//
// The search runs the real World rules (no separate model to drift), cloning
// the world for each branch. `wait` matters once belts or doors move things (a still world just repeats a seen state).
// By default `drop` is only tried on a bin: putting a part back on the floor
// only matters for puzzles built around it, and it multiplies the state space
// (pass { floorDrops: true } to allow it).
import { World } from '../world/world.js';

const TRY = ['move', 'left', 'right', 'grab', 'drop', 'wait'];

function cloneWorld(w) {
  const c = Object.create(World.prototype);
  Object.assign(c, w);
  c.robots = w.robots.map((r) => ({ ...r }));
  c.robot = c.robots[w.robots.indexOf(w.robot)];
  c.items = w.items.map((it) => ({ ...it }));
  c.doors = w.doors.map((d) => ({ ...d }));
  c.stats = { ...w.stats };
  c.log = []; // the solver doesn't need events
  return c;
}

/**
 * Shortest winning action sequence for `level`.
 * Returns { steps, actions } or null if no win exists within `maxStates`
 * explored states. Actions restricted to level.tools.actions when given.
 */
export function solve(level, { maxStates = 200000, floorDrops = false } = {}) {
  const allowed = TRY.filter((a) => !level.tools?.actions || level.tools.actions.includes(a));
  const start = new World(level);
  if (start.isWon()) return { steps: 0, actions: [] };
  const seen = new Set([start.stateKey()]);
  let frontier = [{ w: start, path: null }];
  while (frontier.length) {
    const next = [];
    for (const { w, path } of frontier) {
      for (const a of allowed) {
        if (a === 'drop' && !floorDrops && w.tile(w.robot.x, w.robot.y) !== 'bin') continue;
        const c = cloneWorld(w);
        if (!c.act(a).ok) continue;
        const k = c.stateKey();
        if (seen.has(k)) continue;
        seen.add(k);
        const p = { a, prev: path };
        if (c.isWon()) {
          const actions = [];
          for (let q = p; q; q = q.prev) actions.unshift(q.a);
          return { steps: actions.length, actions };
        }
        if (seen.size > maxStates) return null;
        next.push({ w: c, path: p });
      }
    }
    frontier = next;
  }
  return null;
}

/** Compress an action list into Cog text using `move N` for runs of moves. */
export function actionsToCog(actions) {
  const out = [];
  for (let i = 0; i < actions.length;) {
    let j = i;
    while (j < actions.length && actions[j] === actions[i]) j++;
    const n = j - i;
    if (actions[i] === 'move' && n > 1) out.push(`move ${n}`);
    else for (let k = 0; k < n; k++) out.push(actions[i]);
    i = j;
  }
  return out.join('\n');
}
