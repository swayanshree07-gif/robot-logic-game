// World 2 "Sensor Calibration": sensor levels checked on their fixed test
// floors and on seeded random floors, plus the test-floor rules in PlaySession.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD2 } from '../src/game/worlds/w2.js';
import { WORLD1 } from '../src/game/worlds/w1.js';
import { LEVELS } from '../src/game/levels.js';
import { runLevel, runFloors } from '../src/game/run.js';
import { solve, actionsToCog } from '../src/game/solver.js';
import { validateLevel, floorCount, floorLevel, normalizeLevel } from '../src/world/level.js';
import { PlaySession, resultBanner } from '../src/game/session.js';
import { parse } from '../src/lang/parser.js';
import { lint } from '../src/lang/lint.js';

const byId = Object.fromEntries(WORLD2.levels.map((l) => [l.id, l]));

/** Small seeded PRNG (mulberry32) so random floors are the same on every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
/** k distinct numbers from lo..hi, sorted. */
const pick = (r, k, lo, hi) => {
  const all = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  for (let i = all.length - 1; i > 0; i--) { const j = int(r, 0, i); [all[i], all[j]] = [all[j], all[i]]; }
  return all.slice(0, k).sort((a, b) => a - b);
};
const row = (w, fill, marks = {}) => [...Array(w)].map((_, x) => marks[x] ?? (x === 0 || x === w - 1 ? '#' : fill)).join('');
const wallRow = (w) => '#'.repeat(w);

/** Random floors for a level: a generator per level id that returns a map. */
const GEN = {
  // hall of random length, part in front of Pip, bin anywhere after it
  'w2-1': (r) => { const w = int(r, 5, 16); const b = int(r, 3, w - 2); return [wallRow(w), row(w, '.', { 1: '>', 2: 'o', [b]: 'B' }), wallRow(w)]; },
  // L-shaped corridor: random length and depth
  'w2-2': (r) => {
    const w = int(r, 5, 14), h = int(r, 4, 10), x = int(r, 2, w - 2);
    return [...Array(h)].map((_, y) => {
      if (y === 0 || y === h - 1) return wallRow(w);
      if (y === 1) return [...Array(w)].map((_, i) => (i === 1 ? '>' : i > 1 && i <= x ? '.' : '#')).join('');
      return [...Array(w)].map((_, i) => (i === x ? (y === h - 2 ? 'G' : '.') : '#')).join('');
    });
  },
  // 1..3 bolts anywhere in a hall (hopper holds 3)
  'w2-3': (r) => { const w = int(r, 6, 16); const marks = { 1: '>' }; for (const x of pick(r, int(r, 1, 3), 2, w - 2)) marks[x] = 'o'; return [wallRow(w), row(w, '.', marks), wallRow(w)]; },
  // L-shaped paint route in an open room: blue turn then red turn, random places
  'w2-5': (r) => {
    const w = 10, h = 7;
    const y0 = int(r, 1, 3), bx = int(r, 2, 6), ry = int(r, y0 + 1, h - 2), gx = int(r, bx + 1, w - 2);
    return [...Array(h)].map((_, y) => {
      if (y === 0 || y === h - 1) return wallRow(w);
      const m = {};
      if (y === y0) { m[1] = '>'; m[bx] = 'b'; }
      if (y === ry) { m[bx] = 'r'; m[gx] = 'G'; }
      return row(w, '.', m);
    });
  },
  // shuttle: 1..4 parts down the hall behind a bin (the solution is written for 3)
  'w2-6': (r) => { const w = int(r, 7, 16); const marks = { 1: 'B', 2: '>' }; for (const x of pick(r, 3, 3, w - 2)) marks[x] = 'o'; return [wallRow(w), row(w, '.', marks), wallRow(w)]; },
  // lockers: any subset of alcoves over the hall (not over the start or the bin)
  'w2-7': (r) => {
    const w = int(r, 6, 16);
    const top = [...wallRow(w)];
    for (const x of pick(r, int(r, 1, Math.min(5, w - 4)), 2, w - 3)) top[x] = 'o';
    return [wallRow(w), top.join(''), row(w, '.', { 1: '>', [w - 2]: 'B' }), wallRow(w)];
  },
};

test('World 2 "Sensor Calibration": 8 valid levels with par, brief and hint, each tested on 3 floors', () => {
  assert.equal(WORLD2.levels.length, 8);
  WORLD2.levels.forEach((lv, i) => {
    assert.equal(lv.id, `w2-${i + 1}`);
    assert.deepEqual(validateLevel(lv), [], lv.id);
    assert.ok(lv.brief && lv.hint && lv.par, lv.id);
    assert.equal(floorCount(lv), 3, `${lv.id} has two extra test floors`);
    assert.deepEqual(lint(parse(lv.solution)), [], `${lv.id} solution has no warnings`);
  });
});

test('World 2 solutions win on every test floor; par = the solution, never below the one-floor optimum', () => {
  for (const lv of WORLD2.levels) {
    const all = runFloors(lv.solution, lv);
    assert.equal(all.result, 'win', `${lv.id} fails on floor ${all.failed + 1}`);
    const main = all.floors[0];
    assert.equal(main.ticks, lv.par.steps, `${lv.id} par.steps`);
    assert.equal(main.size, lv.par.size, `${lv.id} par.size`);
    for (let i = 0; i < floorCount(lv); i++) {
      const best = solve(floorLevel(lv, i));
      assert.ok(best, `${lv.id} floor ${i + 1} solvable`);
      assert.ok(best.steps <= all.floors[i].ticks, `${lv.id} floor ${i + 1}`);
    }
  }
});

test('World 2 needs sensors: the best hard-coded route for any one floor fails another floor', () => {
  for (const lv of WORLD2.levels) {
    const free = { ...lv, tools: undefined };
    for (let i = 0; i < floorCount(lv); i++) {
      const route = actionsToCog(solve(floorLevel(lv, i)).actions);
      assert.equal(runLevel(route, floorLevel(free, i)).result, 'win', `${lv.id} route wins floor ${i + 1}`);
      assert.notEqual(runFloors(route, free).result, 'win', `${lv.id}: floor ${i + 1}'s fixed route should fail another floor`);
    }
  }
});

test('World 2 unlocks tools in order after World 1, and uses what it unlocks', () => {
  let prev = normalizeLevel(WORLD1.levels.at(-1)).tools;
  prev = { actions: prev.actions, sensors: [], blocks: prev.blocks };
  for (const lv of WORLD2.levels) {
    const t = lv.tools;
    for (const k of ['actions', 'sensors', 'blocks']) {
      for (const w of prev[k]) assert.ok(t[k].includes(w), `${lv.id} keeps '${w}' unlocked`);
      const fresh = t[k].filter((w) => !prev[k].includes(w) && w !== 'wall'); // 'wall' is just `not clear`
      for (const w of fresh) assert.match(lv.solution, new RegExp(`\\b${w}\\b`), `${lv.id} solution uses new '${w}'`);
    }
    assert.ok(!t.blocks.includes('def'), 'functions come in World 3');
    prev = t;
  }
});

test('World 2 solutions also win on seeded random floors', () => {
  let floors = 0;
  for (const [id, gen] of Object.entries(GEN)) {
    const lv = byId[id];
    for (let seed = 1; seed <= 60; seed++) {
      const map = gen(rng(seed * 7919 + id.length));
      const variant = { ...lv, floors: undefined, map };
      const problems = validateLevel(variant);
      assert.deepEqual(problems, [], `${id} seed ${seed}: generator made a bad map\n${map.join('\n')}`);
      const r = runLevel(lv.solution, variant);
      assert.equal(r.result, 'win', `${id} seed ${seed}: ${r.result} ${r.error ? r.error.message : r.unmet.join('; ')}\n${map.join('\n')}`);
      floors++;
    }
  }
  assert.equal(floors, 60 * Object.keys(GEN).length);
});

test('World 2 follows World 1 in the level list', () => {
  const i = LEVELS.indexOf(WORLD1.levels.at(-1));
  assert.equal(LEVELS[i + 1], WORLD2.levels[0]);
});

// ---------- test floors in the play session ----------

const play = (s, src) => {
  s.setSource(src);
  s.run();
  for (let i = 0; i < 100 && s.state === 'running'; i++) s.update(16);
  assert.equal(s.state, 'done');
  return s.result;
};

test('session: a win on the watched floor needs every test floor; a fixed route fails "calibration"', () => {
  const lv = byId['w2-1'];
  const s = new PlaySession(lv, { speed: 'instant' });
  assert.equal(s.view().floors, 3);
  const good = play(s, lv.solution);
  assert.equal(good.result, 'win');
  assert.match(good.message, /Passed all 3 test floors/);
  assert.equal(good.score.stars, 3);

  const bad = play(s, 'move\ngrab\nmove 6\ndrop'); // floor 1's exact route
  assert.equal(bad.result, 'fail');
  assert.equal(bad.floorFail, 1);
  assert.match(bad.message, /works on floor 1, but not on test floor 2: .*wall/i);
  const banner = resultBanner(bad, { hasNext: true });
  assert.deepEqual([banner.kind, banner.title, banner.floor, banner.next], ['fail', 'Calibration failed', 1, false]);
});

test('session: watching another floor plays that map, and stars are still scored on floor 1', () => {
  const lv = byId['w2-1'];
  const s = new PlaySession(lv, { speed: 'instant' });
  s.setFloor(2);
  assert.equal(s.view().floor, 2);
  assert.equal(s.world.width, lv.floors[1][0].length);
  const r = play(s, lv.solution);
  assert.equal(r.result, 'win');
  assert.equal(r.ticks, 10); // floor 3's bin is further away
  assert.ok(r.score.steps.ok, 'scored on floor 1 (9 steps), not on the 10 watched');
  assert.match(r.message, /Stars are scored on floor 1/);
  // a fixed route that fits floor 3 fails floor 1 first
  const bad = play(s, 'move\ngrab\nmove 7\ndrop');
  assert.equal(bad.floorFail, 0);
  assert.match(bad.message, /works on floor 3, but not on test floor 1/);
  // switching floors resets a run; bad floor numbers throw
  s.setFloor(0);
  assert.equal(s.state, 'edit');
  assert.throws(() => s.setFloor(3), RangeError);
  // levels without test floors are unchanged
  const w1 = new PlaySession(WORLD1.levels[0], { speed: 'instant' });
  assert.equal(w1.view().floors, 1);
  assert.doesNotMatch(play(w1, 'move 6').message, /floors/);
});

test('level format: floors are validated like maps and kept by normalizeLevel', () => {
  const base = { id: 't', name: 'T', win: 'reach', solution: 'move', map: ['####', '#>G#', '####'] };
  assert.deepEqual(validateLevel({ ...base, floors: [['#####', '#>.G#', '#####']] }), []);
  assert.deepEqual(validateLevel({ ...base, floors: [['####', '#>.#', '####']] }), ["test floor 2: win 'reach' needs a goal pad (G) on the map"]);
  assert.match(validateLevel({ ...base, floors: [] }).join(), /floors must be a list/);
  assert.match(validateLevel({ ...base, floors: Array(6).fill(base.map) }).join(), /floors must be a list of 1\.\.5/);
  assert.deepEqual(normalizeLevel({ ...base, floors: [base.map] }).floors, [base.map]);
  assert.equal(floorLevel(base, 0), base);
  assert.throws(() => floorLevel(base, 1), RangeError);
});
