// Level format v1: validation, normalisation, JSON round-trip, goal text.
// Pure, no DOM. See docs in README ("Level format").
//
// A level is a plain JSON-compatible object:
// {
//   format: 1,                       // optional on input, always 1 on output
//   id: 'w1-3', name: 'Stairwell', brief: 'text shown to the player',
//   map: ['#####', '#>.G#', '#####'], // ASCII rows, legend in world.js
//   win: 'reach' | 'collect' | 'deliver' | {type, count?} | [ ...rules ],
//                                     // an array means every rule must hold at once
//   capacity: 1,                      // parts Pip can carry at once (1..9)
//   tools: { actions: [...], sensors: [...], blocks: [...] }, // optional allow-lists
//   maxSteps: 2000,                   // battery (actions per run)
//   solution: 'move 2',               // known solution, verified by the tests
//   hint: 'optional extra help',
//   par: { steps: 6, size: 1 },       // optional par scores (src/game/score.js)
//   floors: [['#####', ...], ...],    // optional extra test floors (maps), up to MAX_FLOORS:
//                                     // same rules and tools; a run only wins if the
//                                     // program also wins on every test floor
//   // Crews (maps with 2..MAX_CREW robot starts, numbered in reading order):
//   robots: [{ name: 'Pip', tools: {...} }, ...], // optional, one entry per robot;
//                                     // per-robot tools replace the level's tools
//   solutions: ['move', 'wait ready'],// replaces `solution`: one program per robot
// }
// Win rules:
//   reach    Pip stands on a goal pad (G)
//   collect  no parts are left lying on the floor (carried or binned is fine)
//   deliver  parts dropped into bins: all of them, or `count` of them
import { parseMap, winRules } from './world.js';

export { winRules };
import { ACTIONS, SENSORS } from '../lang/parser.js';
import { DEFAULT_MAX_TICKS } from '../lang/vm.js';

export const LEVEL_FORMAT = 1;
export const WIN_TYPES = ['reach', 'collect', 'deliver'];
export const BLOCKS = ['repeat', 'while', 'if', 'def', 'memory', 'signal'];
export const MAX_CAPACITY = 9;
export const MAX_STEPS_LIMIT = 10000;
export const MAX_FLOORS = 5;
export const MAX_CREW = 4;
const KNOWN_KEYS = ['format', 'id', 'name', 'brief', 'map', 'win', 'capacity', 'tools', 'maxSteps', 'solution', 'hint', 'par', 'floors', 'robots', 'solutions'];

/** Crew size of a level (1 for ordinary levels). Throws on bad maps. */
export const levelCrew = (level) => parseMap(level.map, { maxRobots: MAX_CREW }).robots.length;

/** Tools robot `i` may use: its own entry in `level.robots`, else the level's. */
export const robotTools = (level, i) => (level.robots && level.robots[i] && level.robots[i].tools) || level.tools;

/** Display name of robot `i` ("Pip" for one robot, else its name or "Robot N"). */
export function robotName(level, i) {
  const r = level.robots && level.robots[i];
  if (r && r.name) return r.name;
  return level.robots || i ? `Robot ${i + 1}` : 'Pip';
}

/** The known solution as a list of programs (one per robot). */
export const levelSolutions = (level) => (level.solutions ? [...level.solutions] : level.solution !== undefined ? [level.solution] : []);

export class LevelError extends Error {
  constructor(problems, id = '') {
    super(`invalid level${id ? ` '${id}'` : ''}: ${problems.join('; ')}`);
    this.problems = problems;
  }
}

/** Tiles reachable from Pip's start (4-neighbour flood fill over non-walls). */
export function reachableTiles(m) {
  const starts = m.robots || [m.robot];
  const seen = new Set(starts.map((r) => `${r.x},${r.y}`));
  const queue = starts.map((r) => [r.x, r.y]);
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height || seen.has(k)) continue;
      if (m.tiles[ny][nx] === 'wall') continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  return seen;
}

/**
 * Check a level. Returns a list of human-readable problems (empty = valid).
 * @param {object} level
 * @param {{requireSolution?: boolean}} [opt]
 */
export function validateLevel(level, { requireSolution = true } = {}) {
  const p = [];
  if (!level || typeof level !== 'object' || Array.isArray(level)) return ['level must be an object'];
  for (const k of Object.keys(level)) if (!KNOWN_KEYS.includes(k)) p.push(`unknown field '${k}'`);
  if (level.format !== undefined && level.format !== LEVEL_FORMAT) p.push(`unsupported format ${level.format} (expected ${LEVEL_FORMAT})`);
  if (typeof level.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(level.id)) p.push('id must be lowercase letters, digits and dashes');
  if (typeof level.name !== 'string' || !level.name.trim()) p.push('name is required');
  if (level.brief !== undefined && typeof level.brief !== 'string') p.push('brief must be text');
  if (level.hint !== undefined && typeof level.hint !== 'string') p.push('hint must be text');
  if (level.par !== undefined) {
    const par = level.par;
    const posInt = (v) => Number.isInteger(v) && v > 0;
    if (!par || typeof par !== 'object' || Array.isArray(par)) p.push('par must be { steps, size }');
    else {
      for (const k of Object.keys(par)) if (!['steps', 'size'].includes(k)) p.push(`unknown par field '${k}' (use steps, size)`);
      if (par.steps !== undefined && !posInt(par.steps)) p.push('par.steps must be a whole number above 0');
      if (par.size !== undefined && !posInt(par.size)) p.push('par.size must be a whole number above 0');
    }
  }
  if (level.floors !== undefined) {
    if (!Array.isArray(level.floors) || !level.floors.length || level.floors.length > MAX_FLOORS) {
      p.push(`floors must be a list of 1..${MAX_FLOORS} maps`);
    } else {
      level.floors.forEach((f, i) => {
        const sub = validateLevel({ ...level, floors: undefined, solutions: undefined, robots: undefined, solution: undefined, map: f }, { requireSolution: false })
          .filter((q) => !q.startsWith('robots/solutions') && !q.startsWith('solutions'));
        for (const q of sub) p.push(`test floor ${i + 2}: ${q}`);
      });
    }
  }
  let m = null;
  if (!Array.isArray(level.map) || !level.map.every((r) => typeof r === 'string')) p.push('map must be an array of strings');
  else {
    try { m = parseMap(level.map, { maxRobots: MAX_CREW }); } catch (e) { p.push(e.message); }
  }
  const crew = m ? m.robots.length : 0;
  const text = (v) => typeof v === 'string' && v.trim();
  if (crew > 1 || level.solutions !== undefined || level.robots !== undefined) {
    // crew level
    if (m && crew < 2) p.push('robots/solutions are only for maps with 2 or more robot starts');
    if (level.solution !== undefined) p.push("crew levels use 'solutions' (one program per robot), not 'solution'");
    if (level.solutions !== undefined) {
      if (!Array.isArray(level.solutions) || !level.solutions.every((x) => typeof x === 'string')) p.push('solutions must be a list of programs');
      else if (m && level.solutions.length !== crew) p.push(`solutions has ${level.solutions.length} program(s) but the map has ${crew} robots`);
      else if (requireSolution && !level.solutions.some(text)) p.push('solutions are all empty');
    } else if (requireSolution) p.push('solutions is required (one program per robot)');
    if (level.robots !== undefined) {
      if (!Array.isArray(level.robots)) p.push('robots must be a list');
      else {
        if (m && level.robots.length !== crew) p.push(`robots has ${level.robots.length} entr${level.robots.length === 1 ? 'y' : 'ies'} but the map has ${crew} robots`);
        level.robots.forEach((r, i) => {
          if (!r || typeof r !== 'object' || Array.isArray(r)) { p.push(`robots[${i}] must be an object`); return; }
          for (const k of Object.keys(r)) if (!['name', 'tools'].includes(k)) p.push(`robots[${i}] has unknown field '${k}'`);
          if (r.name !== undefined && (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 12)) p.push(`robots[${i}].name must be 1..12 characters`);
          if (r.tools !== undefined) checkTools(r.tools, `robots[${i}].tools`, p);
        });
      }
    }
  } else if (requireSolution && !text(level.solution)) p.push('solution is required');
  if (m && level.floors && Array.isArray(level.floors)) {
    level.floors.forEach((f, i) => {
      try {
        const n = parseMap(f, { maxRobots: MAX_CREW }).robots.length;
        if (n !== crew) p.push(`test floor ${i + 2} has ${n} robot(s), the main map has ${crew}`);
      } catch { /* reported by the floor check above */ }
    });
  }
  if (m && (m.width > 16 || m.height > 12)) p.push(`map is ${m.width}x${m.height}, at most 16x12 fits the screen`);

  const capacity = level.capacity ?? 1;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) p.push(`capacity must be a whole number 1..${MAX_CAPACITY}`);
  const maxSteps = level.maxSteps ?? DEFAULT_MAX_TICKS;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_STEPS_LIMIT) p.push(`maxSteps must be a whole number 1..${MAX_STEPS_LIMIT}`);

  const rules = winRules(level.win);
  if (!rules.length) p.push('win needs at least one rule');
  const seenTypes = new Set();
  for (const r of rules) {
    if (!r || !WIN_TYPES.includes(r.type)) { p.push(`unknown win rule '${r && r.type}' (use ${WIN_TYPES.join(', ')})`); continue; }
    if (seenTypes.has(r.type)) p.push(`win rule '${r.type}' is listed twice`);
    seenTypes.add(r.type);
    if (r.count !== undefined && (r.type !== 'deliver' || !Number.isInteger(r.count) || r.count < 1)) {
      p.push(`'count' is only allowed on deliver, as a whole number >= 1`);
    }
  }

  if (m) {
    const reach = reachableTiles(m);
    const all = (kind) => m.tiles.flatMap((row, y) => row.map((t, x) => (t === kind ? `${x},${y}` : null))).filter(Boolean);
    const goals = all('goal'), bins = all('bin');
    const items = m.items.map((it) => `${it.x},${it.y}`);
    if (seenTypes.has('reach')) {
      if (!goals.length) p.push("win 'reach' needs a goal pad (G) on the map");
      else if (!goals.some((g) => reach.has(g))) p.push('no goal pad can be reached from the start');
    }
    if (seenTypes.has('collect') || seenTypes.has('deliver')) {
      if (!items.length) p.push('collect/deliver levels need at least one part (o)');
      const stuck = items.filter((i) => !reach.has(i));
      if (stuck.length) p.push(`part(s) at ${stuck.join(' ')} can't be reached`);
    }
    if (seenTypes.has('deliver')) {
      if (!bins.length) p.push("win 'deliver' needs a bin (B) on the map");
      else if (!bins.some((b) => reach.has(b))) p.push('no bin can be reached from the start');
      const d = rules.find((r) => r.type === 'deliver');
      if (d && d.count > items.length) p.push(`deliver count ${d.count} is more than the ${items.length} part(s) on the map`);
    }
  }

  if (level.tools !== undefined) checkTools(level.tools, 'tools', p);
  return p;
}

function checkTools(t, where, p) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) { p.push(`${where} must be an object`); return; }
  const lists = { actions: ACTIONS, sensors: SENSORS, blocks: BLOCKS };
  for (const k of Object.keys(t)) {
    if (!lists[k]) { p.push(`unknown ${where} list '${k}' (use actions, sensors, blocks)`); continue; }
    if (!Array.isArray(t[k])) { p.push(`${where}.${k} must be an array`); continue; }
    for (const w of t[k]) if (!lists[k].includes(w)) p.push(`${where}.${k} has unknown entry '${w}'`);
  }
}

const fillTools = (t) => ({
  actions: [...(t?.actions ?? ACTIONS)],
  sensors: [...(t?.sensors ?? SENSORS)],
  blocks: [...(t?.blocks ?? BLOCKS)],
});

/** Validate and return a fully-filled copy (defaults applied). Throws LevelError. */
export function normalizeLevel(level, opt) {
  const problems = validateLevel(level, opt);
  if (problems.length) throw new LevelError(problems, level && level.id);
  const out = {
    format: LEVEL_FORMAT,
    id: level.id,
    name: level.name,
    brief: level.brief ?? '',
    map: [...level.map],
    win: winRules(level.win),
    capacity: level.capacity ?? 1,
    maxSteps: level.maxSteps ?? DEFAULT_MAX_TICKS,
    tools: fillTools(level.tools),
  };
  if (level.solution !== undefined) out.solution = level.solution;
  if (level.solutions !== undefined) out.solutions = [...level.solutions];
  if (level.robots !== undefined) {
    out.robots = level.robots.map((r) => {
      const o = {};
      if (r.name !== undefined) o.name = r.name;
      if (r.tools !== undefined) o.tools = fillTools(r.tools);
      return o;
    });
  }
  if (level.hint !== undefined) out.hint = level.hint;
  if (level.par !== undefined) out.par = level.par;
  if (level.floors !== undefined) out.floors = level.floors.map((f) => [...f]);
  return out;
}

/** Number of floors a level is tested on (the main map is floor 1). */
export const floorCount = (level) => 1 + (level.floors ? level.floors.length : 0);

/** The level as played on floor `i` (0 = main map): same rules, that floor's map. */
export function floorLevel(level, i) {
  if (!i) return level;
  const map = level.floors && level.floors[i - 1];
  if (!map) throw new RangeError(`level '${level.id}' has no floor ${i + 1}`);
  const { floors, ...rest } = level;
  return { ...rest, map };
}

export function levelToJSON(level) {
  return JSON.stringify(normalizeLevel(level, { requireSolution: false }), null, 2);
}

/** Parse JSON text into a normalised level. Throws LevelError for bad JSON or bad levels. */
export function levelFromJSON(text, opt = { requireSolution: false }) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new LevelError([`not valid JSON (${e.message})`]); }
  return normalizeLevel(data, opt);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One line describing what the player must do, e.g. "Deliver all 3 parts to a bin, then reach a goal pad." */
export function describeGoal(level) {
  const m = parseMap(level.map, { maxRobots: MAX_CREW });
  const n = m.items.length;
  const parts = winRules(level.win).map((r) => {
    if (r.type === 'reach') return m.robots.length > 1 ? 'park every robot on a goal pad' : 'reach a goal pad';
    if (r.type === 'collect') return n === 1 ? 'pick up the part' : `pick up all ${n} parts`;
    if (r.count !== undefined && r.count < n) return `deliver ${plural(r.count, 'part')} to a bin`;
    return n === 1 ? 'deliver the part to a bin' : `deliver all ${n} parts to a bin`;
  });
  // Put "reach" last: it reads naturally as "do X, then end on a pad".
  parts.sort((a, b) => (a.startsWith('reach') ? 1 : 0) - (b.startsWith('reach') ? 1 : 0));
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, then ${parts[parts.length - 1]}` : parts[0];
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}
