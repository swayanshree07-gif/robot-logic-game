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
import { MAX_CREW, robotTools } from '../world/level.js';

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
export function solve(level, opt = {}) {
  return solveInfo(level, opt).best;
}

/** solve() plus { capped, states }: capped = search stopped at maxStates (unknown, not impossible). */
export function solveInfo(level, { maxStates = 200000, floorDrops = false } = {}) {
  const allowed = TRY.filter((a) => !level.tools?.actions || level.tools.actions.includes(a));
  const start = new World(level);
  if (start.isWon()) return { best: { steps: 0, actions: [] }, capped: false, states: 1 };
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
          return { best: { steps: actions.length, actions }, capped: false, states: seen.size };
        }
        if (seen.size > maxStates) return { best: null, capped: true, states: seen.size };
        next.push({ w: c, path: p });
      }
    }
    frontier = next;
  }
  return { best: null, capped: false, states: seen.size };
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

/**
 * Joint-state BFS for crews: the fewest rounds in which the robots can win.
 * Each round every robot, in robot order, either does one of its allowed
 * actions or stands still ('idle': its program ended or it waits for a
 * signal), then the factory ticks once (same order as CrewRunner). Signals
 * are left out: the solver coordinates the robots perfectly, so its optimum
 * is a lower bound for any real crew program. Bumps and crashes end a run,
 * so those branches are dropped. Returns { steps, plans } (plans[i] = robot
 * i's actions per round, 'idle' included) or null if no win is found within
 * `maxStates` states (a null is "unknown", not "impossible", when capped:
 * check `.capped` on the returned info via solveCrewInfo).
 */
export function solveCrew(level, opt = {}) {
  return solveCrewInfo(level, opt).best;
}

export function solveCrewInfo(level, { maxStates = 300000, floorDrops = false } = {}) {
  const start = new World(level, { maxRobots: MAX_CREW });
  start.deferTicks = true;
  const n = start.robots.length;
  const allowed = start.robots.map((_, i) => {
    const t = robotTools(level, i);
    return ['idle', ...TRY.filter((a) => a !== 'wait' && (!t?.actions || t.actions.includes(a)))];
  });
  if (start.isWon()) return { best: { steps: 0, plans: start.robots.map(() => []) }, capped: false, states: 1 };
  const seen = new Set([start.stateKey()]);
  let frontier = [{ w: start, path: null }];
  while (frontier.length) {
    const next = [];
    for (const { w, path } of frontier) {
      // expand robot by robot so a failed action prunes early
      let partial = [{ w, picks: [] }];
      for (let i = 0; i < n; i++) {
        const out = [];
        for (const { w: pw, picks } of partial) {
          for (const a of allowed[i]) {
            if (a === 'drop' && !floorDrops && pw.tile(pw.robots[i].x, pw.robots[i].y) !== 'bin') continue;
            const c = cloneWorld(pw);
            c.select(i);
            if (a !== 'idle' && !c.act(a).ok) continue;
            out.push({ w: c, picks: [...picks, a] });
          }
        }
        partial = out;
      }
      for (const { w: c, picks } of partial) {
        c.select(0);
        c.endTick();
        const k = c.stateKey();
        if (seen.has(k)) continue;
        seen.add(k);
        const p = { picks, prev: path };
        if (c.isWon()) {
          const rounds = [];
          for (let q = p; q; q = q.prev) rounds.unshift(q.picks);
          return { best: { steps: rounds.length, plans: start.robots.map((_, i) => rounds.map((r) => r[i])) }, capped: false, states: seen.size };
        }
        if (seen.size > maxStates) return { best: null, capped: true, states: seen.size };
        next.push({ w: c, path: p });
      }
    }
    frontier = next;
  }
  return { best: null, capped: false, states: seen.size };
}

/** Turn a crew plan (per-robot action lists with 'idle') into Cog programs. */
export function plansToCog(plans) {
  return plans.map((acts) => {
    let end = acts.length;
    while (end && acts[end - 1] === 'idle') end--;
    return actionsToCog(acts.slice(0, end).map((a) => (a === 'idle' ? 'wait' : a)));
  });
}
