// Level editor model: a pure reducer over a draft level, with undo/redo.
// No DOM. The editor UI (Day 23) dispatches actions and renders `state.level`.
//
// state = {
//   level,    // draft level (level format v1, see src/world/level.js); may be invalid
//   floor,    // map being edited: 0 = main map, i = test floor i (level.floors[i-1])
//   solved,   // true only after markSolved; any edit to the level clears it
//   past, future, // undo/redo stacks of { level, floor } snapshots
// }
//
// Actions ({ type, ... }):
//   paint {x, y, tile}       tile is one map char: # . G B o r y b N E S W _ D
//                            (painting over a robot start removes that robot)
//   robot {x, y, dir}        place a robot start (dir 0..3 = N E S W) or turn one
//   moveRobot {from, to}     move a start; on the main map it keeps name/tools/program
//   resize {width, height}   grow (new cells are floor) or crop every map of the level
//   meta {id?, name?, brief?, hint?}
//   win {rules}              list of {type, count?}
//   capacity {value}  maxSteps {value}  par {value: {steps?, size?} | null}
//   tools {robot, tools}     robot = null for the level, else crew index; tools null = all
//   robotName {robot, name}
//   solution {robot, source} known program for one robot (robot 0 on solo levels)
//   addFloor                 copy of the edited map becomes a new test floor (selected)
//   removeFloor {index}      index >= 1
//   selectFloor {index}      0..floors; part of undo history but does not clear `solved`
//   markSolved               the current draft was won in test-play (Day 23)
//   undo  redo
// Robots are numbered in reading order (as in parseMap). After a main-map edit the
// per-robot fields (`robots`, `solutions`/`solution`) follow each start by position.

import { MAX_CREW, MAX_FLOORS, validateLevel } from '../world/level.js';

export const TILE_CHARS = ['#', '.', 'G', 'B', 'o', 'r', 'y', 'b', 'N', 'E', 'S', 'W', '_', 'D'];
export const ROBOT_CHARS = ['^', '>', 'v', '<'];
export const MIN_SIZE = 3;
export const MAX_W = 16;
export const MAX_H = 12;
export const HISTORY_LIMIT = 100;

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** A fresh 7x5 room with Pip and a goal pad. */
export function blankLevel(id = 'custom-1') {
  return {
    id,
    name: 'New floor',
    brief: '',
    map: ['#######', '#.....#', '#>...G#', '#.....#', '#######'],
    win: [{ type: 'reach' }],
    solution: '',
  };
}

export function createEditor(level = blankLevel()) {
  const lv = clone(level);
  delete lv.format;
  return { level: lv, floor: 0, solved: false, past: [], future: [] };
}

/** Map rows currently being edited. */
export const editedMap = (state) => (state.floor === 0 ? state.level.map : state.level.floors[state.floor - 1]);

/** Robot starts of a map, in reading order: [{x, y, dir}]. */
export function robotsOf(rows) {
  const out = [];
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const dir = ROBOT_CHARS.indexOf(ch);
    if (dir >= 0) out.push({ x, y, dir });
  }));
  return out;
}

const setCell = (rows, x, y, ch) => rows.map((r, j) => (j === y ? r.slice(0, x) + ch + r.slice(x + 1) : r));
const inside = (rows, x, y) => Number.isInteger(x) && Number.isInteger(y) && y >= 0 && y < rows.length && x >= 0 && x < rows[0].length;

/**
 * Re-link per-robot fields after the main map changed. `moved` maps an old
 * "x,y" key to the new one (for moveRobot); unmatched new robots get blanks.
 */
function syncCrew(level, oldRows, moved = {}) {
  const before = robotsOf(oldRows).map((r) => moved[`${r.x},${r.y}`] || `${r.x},${r.y}`);
  const after = robotsOf(level.map);
  const n = after.length;
  if (!n) return level; // invalid map; validation reports it, fields are kept
  const oldSols = level.solutions ?? (level.solution !== undefined ? [level.solution] : []);
  const oldMeta = level.robots ?? [];
  const pick = (r) => before.indexOf(`${r.x},${r.y}`);
  const sols = after.map((r) => (pick(r) >= 0 ? oldSols[pick(r)] ?? '' : ''));
  const meta = after.map((r) => (pick(r) >= 0 ? oldMeta[pick(r)] ?? {} : {}));
  const out = { ...level };
  delete out.solution; delete out.solutions; delete out.robots;
  if (n === 1) out.solution = sols[0];
  else {
    out.solutions = sols;
    if (level.robots || meta.some((m) => Object.keys(m).length)) out.robots = meta;
  }
  return out;
}

/** Replace the edited map; on the main map keep crew fields linked. */
function withMap(state, rows, moved) {
  const lv = { ...state.level };
  if (state.floor === 0) {
    lv.map = rows;
    return syncCrew(lv, state.level.map, moved);
  }
  lv.floors = lv.floors.map((f, i) => (i === state.floor - 1 ? rows : f));
  return lv;
}

function resizeRows(rows, w, h) {
  const out = [];
  for (let y = 0; y < h; y++) {
    const r = rows[y] ?? '';
    out.push((r + '.'.repeat(w)).slice(0, w));
  }
  return out;
}

/** Apply one edit; returns the new level and floor, or null for a no-op. */
function edit(state, a) {
  const lv = state.level;
  const rows = editedMap(state);
  switch (a.type) {
    case 'paint': {
      if (!TILE_CHARS.includes(a.tile) || !inside(rows, a.x, a.y) || rows[a.y][a.x] === a.tile) return null;
      return { level: withMap(state, setCell(rows, a.x, a.y, a.tile)) };
    }
    case 'robot': {
      const ch = ROBOT_CHARS[a.dir];
      if (!ch || !inside(rows, a.x, a.y) || rows[a.y][a.x] === ch) return null;
      const isRobot = ROBOT_CHARS.includes(rows[a.y][a.x]);
      if (!isRobot && robotsOf(rows).length >= MAX_CREW) return null;
      return { level: withMap(state, setCell(rows, a.x, a.y, ch)) };
    }
    case 'moveRobot': {
      const { from, to } = a;
      if (!from || !to || !inside(rows, from.x, from.y) || !inside(rows, to.x, to.y)) return null;
      const ch = rows[from.y][from.x];
      if (!ROBOT_CHARS.includes(ch) || (from.x === to.x && from.y === to.y)) return null;
      if (ROBOT_CHARS.includes(rows[to.y][to.x])) return null; // target taken
      const next = setCell(setCell(rows, from.x, from.y, '.'), to.x, to.y, ch);
      return { level: withMap(state, next, { [`${from.x},${from.y}`]: `${to.x},${to.y}` }) };
    }
    case 'resize': {
      const w = a.width, h = a.height;
      if (![w, h].every(Number.isInteger) || w < MIN_SIZE || h < MIN_SIZE || w > MAX_W || h > MAX_H) return null;
      if (w === lv.map[0].length && h === lv.map.length) return null;
      let out = { ...lv, map: resizeRows(lv.map, w, h) };
      if (lv.floors) out.floors = lv.floors.map((f) => resizeRows(f, w, h));
      out = syncCrew(out, lv.map);
      return { level: out };
    }
    case 'meta': {
      const out = { ...lv };
      let changed = false;
      for (const k of ['id', 'name', 'brief', 'hint']) {
        if (a[k] === undefined || a[k] === lv[k]) continue;
        if (k === 'hint' && a[k] === '') delete out.hint; else out[k] = String(a[k]);
        changed = true;
      }
      return changed ? { level: out } : null;
    }
    case 'win':
      if (!Array.isArray(a.rules)) return null;
      return { level: { ...lv, win: clone(a.rules) } };
    case 'capacity':
    case 'maxSteps': {
      if (lv[a.type] === a.value) return null;
      const out = { ...lv };
      if (a.value === undefined || a.value === null) delete out[a.type]; else out[a.type] = a.value;
      return { level: out };
    }
    case 'par': {
      const out = { ...lv };
      if (!a.value) delete out.par; else out.par = clone(a.value);
      return { level: out };
    }
    case 'tools': {
      const out = { ...lv };
      if (a.robot === null || a.robot === undefined) {
        if (a.tools) out.tools = clone(a.tools); else delete out.tools;
        return { level: out };
      }
      const n = robotsOf(lv.map).length;
      if (n < 2 || a.robot < 0 || a.robot >= n) return null;
      out.robots = (lv.robots ?? Array.from({ length: n }, () => ({}))).map((r, i) => {
        if (i !== a.robot) return r;
        const o = { ...r };
        if (a.tools) o.tools = clone(a.tools); else delete o.tools;
        return o;
      });
      return { level: out };
    }
    case 'robotName': {
      const n = robotsOf(lv.map).length;
      if (n < 2 || a.robot < 0 || a.robot >= n) return null;
      const out = { ...lv };
      out.robots = (lv.robots ?? Array.from({ length: n }, () => ({}))).map((r, i) => {
        if (i !== a.robot) return r;
        const o = { ...r };
        if (a.name) o.name = a.name; else delete o.name;
        return o;
      });
      return { level: out };
    }
    case 'solution': {
      const out = { ...lv };
      if (lv.solutions) {
        if (a.robot < 0 || a.robot >= lv.solutions.length || lv.solutions[a.robot] === a.source) return null;
        out.solutions = lv.solutions.map((s, i) => (i === a.robot ? a.source : s));
      } else {
        if ((a.robot ?? 0) !== 0 || lv.solution === a.source) return null;
        out.solution = a.source;
      }
      return { level: out };
    }
    case 'addFloor': {
      const floors = lv.floors ?? [];
      if (floors.length >= MAX_FLOORS - 1) return null; // main map + floors <= MAX_FLOORS
      return { level: { ...lv, floors: [...floors, [...rows]] }, floor: floors.length + 1 };
    }
    case 'removeFloor': {
      const floors = lv.floors ?? [];
      if (!Number.isInteger(a.index) || a.index < 1 || a.index > floors.length) return null;
      const out = { ...lv, floors: floors.filter((_, i) => i !== a.index - 1) };
      if (!out.floors.length) delete out.floors;
      return { level: out, floor: Math.min(state.floor, out.floors ? out.floors.length : 0) };
    }
    default:
      throw new Error(`unknown editor action '${a.type}'`);
  }
}

const snap = (s) => ({ level: s.level, floor: s.floor, solved: s.solved });
const pushPast = (past, s) => [...past, snap(s)].slice(-HISTORY_LIMIT);

/** The reducer. Returns the same state object when an action changes nothing. */
export function editorReducer(state, action) {
  switch (action.type) {
    case 'undo': {
      if (!state.past.length) return state;
      const prev = state.past[state.past.length - 1];
      return { ...prev, past: state.past.slice(0, -1), future: [snap(state), ...state.future] };
    }
    case 'redo': {
      if (!state.future.length) return state;
      const [next, ...rest] = state.future;
      return { ...next, past: pushPast(state.past, state), future: rest };
    }
    case 'selectFloor': {
      const n = state.level.floors ? state.level.floors.length : 0;
      if (!Number.isInteger(action.index) || action.index < 0 || action.index > n || action.index === state.floor) return state;
      return { ...state, floor: action.index, past: pushPast(state.past, state), future: [] };
    }
    case 'markSolved':
      return state.solved ? state : { ...state, solved: true };
    default: {
      const r = edit(state, action);
      if (!r) return state;
      return { level: r.level, floor: r.floor ?? state.floor, solved: false, past: pushPast(state.past, state), future: [] };
    }
  }
}

/** Apply a list of actions. */
export const applyAll = (state, actions) => actions.reduce(editorReducer, state);

export const canUndo = (s) => s.past.length > 0;
export const canRedo = (s) => s.future.length > 0;

/** Problems with the draft (no solution needed yet; test-play proves it on Day 23). */
export const editorProblems = (state) => validateLevel(state.level, { requireSolution: false });
