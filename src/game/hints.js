// Hints, in tiers: 1) the level's text hint, 2) "show route" — the tiles Pip
// should visit, drawn as a dotted trail on the board. Pure (no DOM).
//
// The route comes from the breadth-first solver (so it is an optimal plan that
// actually wins, items and all). If the search is cut off (big level), it falls
// back to routeToTarget: the shortest drive to the current scan target only.
// Crews get the text hint only: a joint plan for several robots is slow to find
// and hard to read as one trail.
import { World } from '../world/world.js';
import { floorLevel, levelCrew } from '../world/level.js';
import { routeToTarget } from '../world/paths.js';
import { solveInfo } from './solver.js';

export const HINT_STATES = 40000; // solver cap in the browser (well under a second)

/** Replay `actions` from the floor's start; returns the poses after each action (start first). */
export function traceActions(level, actions) {
  const w = new World(level);
  const trail = [{ x: w.robot.x, y: w.robot.y, dir: w.robot.dir, a: null }];
  for (const a of actions) {
    if (!w.act(a).ok) break;
    trail.push({ x: w.robot.x, y: w.robot.y, dir: w.robot.dir, a });
  }
  return trail;
}

/**
 * Route hint for floor `floor` of `level`.
 * Returns { kind: 'solution' | 'target', trail, actions, steps } or null (crew / nothing reachable).
 */
export function routeHint(level, floor = 0, { maxStates = HINT_STATES } = {}) {
  if (levelCrew(level) > 1) return null;
  const lv = floorLevel(level, floor);
  for (const floorDrops of [false, true]) {
    const info = solveInfo(lv, { maxStates, floorDrops });
    if (info.best) return { kind: 'solution', actions: info.best.actions, steps: info.best.steps, trail: traceActions(lv, info.best.actions) };
    if (info.capped) break; // too big to search: fall back below
  }
  const r = routeToTarget(new World(lv));
  if (!r) return null;
  return { kind: 'target', actions: r.actions, steps: r.cost, trail: traceActions(lv, r.actions) };
}

/** Distinct tiles of a trail, in visiting order (what the board draws). */
export function trailTiles(trail) {
  const seen = new Set(), out = [];
  for (const p of trail) {
    const k = `${p.x},${p.y}`;
    if (!seen.has(k)) { seen.add(k); out.push({ x: p.x, y: p.y }); }
  }
  return out;
}

/** The hint tiers a level offers, for the Hint button. */
export function hintTiers(level) {
  const tiers = [];
  if (level.hint) tiers.push('text');
  if (levelCrew(level) === 1) tiers.push('route');
  return tiers;
}

/** Status text for an opened hint tier. */
export function hintMessage(level, tier, route) {
  if (tier === 'text') return `Hint: ${level.hint}`;
  if (!route) return 'No route hint here.';
  return route.kind === 'solution'
    ? `Route shown: a winning plan in ${route.steps} actions (the dots on the board). Now write a program that drives it.`
    : `Route shown to the next target (${route.steps} actions). The full job was too big to plan here.`;
}

/**
 * Story beats for a level's place in its world ({ world, n } from levelPlace):
 * the world's blurb opens its first level, its outro closes the last one.
 */
export function storyBeats(place) {
  if (!place) return { intro: '', outro: '' };
  const { world, n } = place;
  return {
    intro: n === 1 ? world.blurb || '' : '',
    outro: n === world.levels.length ? world.outro || '' : '',
  };
}
