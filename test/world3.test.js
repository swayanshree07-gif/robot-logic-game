// World 3 "Assembly Line": functions and memory registers. Every level wins on
// its test floors and on seeded random floors; the tool locks make the new
// ideas necessary (no bin / wall sensors on the counting levels).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD3 } from '../src/game/worlds/w3.js';
import { WORLD2 } from '../src/game/worlds/w2.js';
import { LEVELS } from '../src/game/levels.js';
import { runLevel, runFloors } from '../src/game/run.js';
import { solve, actionsToCog } from '../src/game/solver.js';
import { validateLevel, floorCount, floorLevel } from '../src/world/level.js';
import { parse } from '../src/lang/parser.js';
import { lint } from '../src/lang/lint.js';
import { checkTools } from '../src/lang/restrict.js';

const byId = Object.fromEntries(WORLD3.levels.map((l) => [l.id, l]));

function rng(seed) { // mulberry32
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
const pick = (r, k, lo, hi) => {
  const all = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  for (let i = all.length - 1; i > 0; i--) { const j = int(r, 0, i); [all[i], all[j]] = [all[j], all[i]]; }
  return all.slice(0, k).sort((a, b) => a - b);
};
const wallRow = (w) => '#'.repeat(w);
/** One-row hall: `marks` maps x → char, everything else floor. */
const hall = (w, marks) => [wallRow(w), [...Array(w)].map((_, x) => marks[x] ?? (x === 0 || x === w - 1 ? '#' : '.')).join(''), wallRow(w)];

const GEN = {
  // bin, Pip, then one part somewhere down the hall
  'w3-3': (r) => { const w = int(r, 7, 16), s = int(r, 2, 4); return hall(w, { [s - 1]: 'B', [s]: '>', [int(r, s + 1, w - 2)]: 'o' }); },
  // three parts anywhere after the start
  'w3-5': (r) => {
    const w = int(r, 8, 16), s = int(r, 2, 3), m = { [s - 1]: 'B', [s]: '>' };
    for (const x of pick(r, 3, s + 1, w - 2)) m[x] = 'o';
    return hall(w, m);
  },
  // 1..4 red marks, shaft depth to the bin matches
  'w3-7': (r) => {
    const w = 12, h = 8, reds = pick(r, int(r, 1, 4), 3, w - 3);
    const top = [...Array(w)].map((_, x) => (x === 0 || x === w - 1 ? '#' : x === 1 ? '>' : x === 2 ? 'o' : reds.includes(x) ? 'r' : '.')).join('');
    const shaft = (y) => [...Array(w)].map((_, x) => (x === w - 2 ? (y === 1 + reds.length ? 'B' : '.') : '#')).join('');
    return [wallRow(w), top, ...Array.from({ length: h - 3 }, (_, i) => shaft(i + 2)), wallRow(w)];
  },
  // any number (1..6) of parts after the start
  'w3-8': (r) => {
    const w = int(r, 7, 16), m = { 2: 'B', 3: '>' };
    for (const x of pick(r, int(r, 1, Math.min(6, w - 5)), 4, w - 2)) m[x] = 'o';
    return hall(w, m);
  },
};

test('World 3 "Assembly Line": 8 valid levels with par, brief and hint; lint-clean solutions', () => {
  assert.equal(WORLD3.levels.length, 8);
  WORLD3.levels.forEach((lv, i) => {
    assert.equal(lv.id, `w3-${i + 1}`);
    assert.deepEqual(validateLevel(lv), [], lv.id);
    assert.ok(lv.brief && lv.hint && lv.par, lv.id);
    assert.deepEqual(lint(parse(lv.solution)), [], `${lv.id} lint`);
    assert.doesNotThrow(() => checkTools(parse(lv.solution), lv.tools), `${lv.id} solution uses only its tools`);
  });
});

test('World 3 solutions win on every floor; par = the solution on floor 1, never below the optimum', () => {
  for (const lv of WORLD3.levels) {
    const all = runFloors(lv.solution, lv);
    assert.equal(all.result, 'win', `${lv.id} fails on floor ${all.failed + 1}`);
    assert.equal(all.floors[0].ticks, lv.par.steps, `${lv.id} par.steps`);
    assert.equal(all.floors[0].size, lv.par.size, `${lv.id} par.size`);
    for (let i = 0; i < floorCount(lv); i++) {
      const best = solve(floorLevel(lv, i));
      assert.ok(best && best.steps <= all.floors[i].ticks, `${lv.id} floor ${i + 1}`);
    }
  }
});

test('World 3 floors defeat fixed routes', () => {
  for (const lv of WORLD3.levels.filter((l) => l.floors)) {
    const free = { ...lv, tools: undefined };
    for (let i = 0; i < floorCount(lv); i++) {
      const route = actionsToCog(solve(floorLevel(lv, i)).actions);
      assert.notEqual(runFloors(route, free).result, 'win', `${lv.id}: floor ${i + 1}'s route should fail elsewhere`);
    }
  }
});

test('World 3 unlocks def first, then memory; memory levels really use registers', () => {
  const w2blocks = WORLD2.levels.at(-1).tools.blocks;
  assert.ok(!w2blocks.includes('def') && !w2blocks.includes('memory'));
  let seenMemory = false;
  for (const lv of WORLD3.levels) {
    const b = lv.tools.blocks;
    assert.ok(b.includes('def'), `${lv.id} has def`);
    for (const w of w2blocks) assert.ok(b.includes(w), `${lv.id} keeps ${w}`);
    if (seenMemory) assert.ok(b.includes('memory'), `${lv.id} keeps memory`);
    if (b.includes('memory')) {
      seenMemory = true;
      assert.match(lv.solution, /^\s*(set|add|sub) /m, `${lv.id} solution uses a register`);
      // without the memory block the solution is rejected
      assert.throws(() => checkTools(parse(lv.solution), { ...lv.tools, blocks: b.filter((x) => x !== 'memory') }), /isn't unlocked/);
    }
  }
  assert.ok(seenMemory);
  assert.match(byId['w3-1'].solution, /^def /m);
});

test('counting levels hide the bin sensor, and the state-machine levels hide wall sensors', () => {
  for (const id of ['w3-3', 'w3-5', 'w3-7', 'w3-8']) assert.ok(!byId[id].tools.sensors.includes('bin'), id);
  for (const id of ['w3-4', 'w3-6']) assert.deepEqual(byId[id].tools.sensors.filter((s) => /clear|wall/.test(s)), [], id);
  // the obvious sensor answer is locked
  assert.throws(() => checkTools(parse('while not bin\n  move\nend'), byId['w3-3'].tools), /sensor 'bin'/);
});

test('w3-4: a program without memory that always turns right fails', () => {
  const lv = byId['w3-4'];
  const r = runFloors('while not goal\n  if blue\n    right\n  end\n  move\nend', lv);
  assert.notEqual(r.result, 'win');
});

test('World 3 solutions also win on seeded random floors', () => {
  let n = 0;
  for (const [id, gen] of Object.entries(GEN)) {
    const lv = byId[id];
    for (let seed = 1; seed <= 60; seed++) {
      const map = gen(rng(seed * 104729 + id.length));
      const variant = { ...lv, floors: undefined, map };
      assert.deepEqual(validateLevel(variant), [], `${id} seed ${seed}\n${map.join('\n')}`);
      const r = runLevel(lv.solution, variant);
      assert.equal(r.result, 'win', `${id} seed ${seed}: ${r.result}\n${map.join('\n')}`);
      n++;
    }
  }
  assert.equal(n, 240);
});

test('World 3 follows World 2 in the level list', () => {
  assert.equal(LEVELS[LEVELS.indexOf(WORLD2.levels.at(-1)) + 1], WORLD3.levels[0]);
});

test('map: World 3 is a built world, and an upcoming entry with a built id is not shown twice', async () => {
  const { mapModel } = await import('../src/game/progress.js');
  const { WORLDS } = await import('../src/game/levels.js');
  const none = { won: () => false, stars: () => 0 };
  const m = mapModel(WORLDS, none, { upcoming: [{ id: 'w3', name: 'dup', blurb: '' }, { id: 'w9', name: 'Later', blurb: '' }] });
  assert.deepEqual(m.map((w) => w.id), ['w1', 'w2', 'w3', 'w9']);
  assert.equal(m[2].name, 'Assembly Line');
  assert.equal(m[3].tag, '4');
});
