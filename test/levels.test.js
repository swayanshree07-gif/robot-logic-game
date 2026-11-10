// World-by-world level checks: solutions win, tools unlock in order, each
// level's new idea is actually needed/used, and step budgets are fair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLDS, LEVELS, ALL_LEVELS, PROTOTYPES, levelPlace } from '../src/game/levels.js';
import { WORLD1 } from '../src/game/worlds/w1.js';
import { runLevel } from '../src/game/run.js';
import { solve, actionsToCog } from '../src/game/solver.js';
import { parse } from '../src/lang/parser.js';
import { validateLevel, normalizeLevel } from '../src/world/level.js';
import { scoreRun } from '../src/game/score.js';
import { lint } from '../src/lang/lint.js';

/** Max nesting depth of repeat blocks in a program. */
function repeatDepth(src) {
  const walk = (stmts) => Math.max(0, ...stmts.map((s) => (s.type === 'repeat' ? 1 : 0) + walk(s.body || [])));
  return walk(parse(src).main);
}

test('level ids are unique and every playable level has a place in a world', () => {
  const ids = ALL_LEVELS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const l of LEVELS) assert.ok(levelPlace(l), l.id);
  assert.equal(levelPlace(WORLD1.levels[2]).n, 3);
  assert.equal(levelPlace(PROTOTYPES[0]), null); // superseded prototype, fixtures only
  assert.equal(WORLDS[0], WORLD1);
});

test('World 1 "Boot Sequence": 8 valid levels whose solutions win', () => {
  assert.equal(WORLD1.levels.length, 8);
  WORLD1.levels.forEach((lv, i) => {
    assert.equal(lv.id, `w1-${i + 1}`);
    assert.deepEqual(validateLevel(lv), [], lv.id);
    assert.ok(lv.brief && lv.hint, `${lv.id} has brief and hint`);
    const r = runLevel(lv.solution, lv);
    assert.equal(r.result, 'win', `${lv.id}: ${r.result} ${r.error ? r.error.message : r.unmet.join('; ')}`);
    assert.ok(r.ticks <= normalizeLevel(lv).maxSteps);
  });
});

test('World 1 unlocks tools in order and never uses sensors', () => {
  let prev = { actions: [], blocks: [] };
  for (const lv of WORLD1.levels) {
    const t = lv.tools;
    assert.deepEqual(t.sensors, [], `${lv.id} has no sensors`);
    for (const k of ['actions', 'blocks']) {
      for (const w of prev[k]) assert.ok(t[k].includes(w), `${lv.id} keeps '${w}' unlocked`);
      // anything newly unlocked here is used by the solution
      const fresh = t[k].filter((w) => !prev[k].includes(w));
      for (const w of fresh) assert.match(lv.solution, new RegExp(`\\b${w}\\b`), `${lv.id} solution uses new '${w}'`);
    }
    prev = t;
  }
});

test('World 1 teaches its ideas: repeat on 4 and 6, nested repeat on 8', () => {
  const byId = Object.fromEntries(WORLD1.levels.map((l) => [l.id, l]));
  assert.equal(repeatDepth(byId['w1-4'].solution), 1);
  assert.equal(repeatDepth(byId['w1-6'].solution), 1);
  assert.equal(repeatDepth(byId['w1-8'].solution), 2);
  // repeat really shortens these programs compared to the shortest flat action list
  for (const id of ['w1-4', 'w1-6', 'w1-8']) {
    const flat = actionsToCog(solve(byId[id]).actions).split('\n').length;
    assert.ok(runLevel(byId[id].solution, byId[id]).size < flat, `${id}: repeat beats ${flat} flat lines`);
  }
});

test('World 1 "Low Battery": battery equals the fewest possible steps, wasting any fails', () => {
  const lv = WORLD1.levels.find((l) => l.id === 'w1-7');
  const best = solve(lv);
  assert.equal(best.steps, lv.maxSteps);
  assert.equal(runLevel(lv.solution, lv).ticks, lv.maxSteps);
  assert.equal(runLevel(`left\nright\n${lv.solution}`, lv).result, 'timeout');
  // the "hug the left wall" route is too long
  assert.notEqual(runLevel('right\nmove 2\nleft\nmove 2\nleft\nmove\nright\nmove\nleft\nmove 3\nright\nmove\nleft\nmove 2\nright\nmove\nleft\nmove', lv).result, 'win');
});

test('solver: every playable level is solvable, never in more steps than the known solution', () => {
  for (const lv of LEVELS.filter((l) => !l.solutions)) { // crews: joint solver in verify.test.js
    const best = solve(lv);
    assert.ok(best, `${lv.id} solvable`);
    assert.ok(best.steps <= runLevel(lv.solution, lv).ticks, lv.id);
    // the solver's own plan, written as Cog, wins too
    assert.equal(runLevel(actionsToCog(best.actions), { ...lv, tools: undefined }).result, 'win', lv.id);
  }
});

test('solver basics', () => {
  const hall = { map: ['#######', '#>...G#', '#######'], win: 'reach' };
  assert.deepEqual(solve(hall), { steps: 4, actions: ['move', 'move', 'move', 'move'] });
  assert.equal(solve({ map: ['#####', '#>#G#', '#####'], win: 'reach' }), null); // walled off
  assert.equal(actionsToCog(['move', 'move', 'left', 'left', 'grab', 'move']), 'move 2\nleft\nleft\ngrab\nmove');
  // respects locked actions: without turns this corner is impossible
  const corner = { map: ['####', '#>.#', '##G#', '####'], win: 'reach' };
  assert.equal(solve(corner).steps, 3);
  assert.equal(solve({ ...corner, tools: { actions: ['move'] } }), null);
});

test('World 1 par: steps = solver optimum, size = the solution, warning-free solutions', () => {
  for (const lv of WORLD1.levels) {
    assert.ok(lv.par && lv.par.steps && lv.par.size, `${lv.id} has par`);
    assert.equal(lv.par.steps, solve(lv).steps, `${lv.id} par.steps is the optimum`);
    const r = runLevel(lv.solution, lv);
    assert.equal(r.size, lv.par.size, `${lv.id} solution size is par`);
    assert.ok(scoreRun(r, lv.par).stars >= 2, lv.id);
    assert.deepEqual(lint(parse(lv.solution)), [], `${lv.id} solution has no warnings`);
  }
  // 1-8: the solver's step-optimal route earns the steps star, the nested repeat the size star
  const lv = WORLD1.levels[7];
  const fast = runLevel(actionsToCog(solve(lv).actions), lv);
  assert.deepEqual([scoreRun(fast, lv.par).steps.ok, scoreRun(fast, lv.par).size.ok], [true, false]);
});
