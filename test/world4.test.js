// World 4 "Maze Wing": wall following, the Pledge algorithm, then the `scan`
// planner. Every level wins on all its floors, the full-rules BFS solver agrees
// each floor is solvable in at most the solution's steps, and the weaker
// strategy each level is meant to replace really fails somewhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD4 } from '../src/game/worlds/w4.js';
import { WORLD3 } from '../src/game/worlds/w3.js';
import { LEVELS } from '../src/game/levels.js';
import { runLevel, runFloors } from '../src/game/run.js';
import { solve, actionsToCog } from '../src/game/solver.js';
import { routeToTarget } from '../src/world/paths.js';
import { World } from '../src/world/world.js';
import { validateLevel, floorCount, floorLevel } from '../src/world/level.js';
import { parse } from '../src/lang/parser.js';
import { lint } from '../src/lang/lint.js';
import { checkTools } from '../src/lang/restrict.js';

const byId = Object.fromEntries(WORLD4.levels.map((l) => [l.id, l]));
const free = (lv) => ({ ...lv, tools: undefined });
const follow = (side, other) => `while not goal\n  if clear_${side}\n    ${side}\n    move\n  elif clear\n    move\n  else\n    ${other}\n  end\nend`;
const RIGHT_HAND = follow('right', 'left');

test('World 4 "Maze Wing": 8 valid levels with par, brief and hint; lint-clean solutions within their tools', () => {
  assert.equal(WORLD4.levels.length, 8);
  WORLD4.levels.forEach((lv, i) => {
    assert.equal(lv.id, `w4-${i + 1}`);
    assert.deepEqual(validateLevel(lv), [], lv.id);
    assert.ok(lv.brief && lv.hint && lv.par && lv.floors?.length === 2, lv.id);
    assert.deepEqual(lint(parse(lv.solution)), [], `${lv.id} lint`);
    assert.doesNotThrow(() => checkTools(parse(lv.solution), lv.tools), `${lv.id} tools`);
  });
});

test('World 4 solutions win on every floor; par = floor 1; solver agrees (optimum <= solution)', () => {
  for (const lv of WORLD4.levels) {
    const all = runFloors(lv.solution, lv);
    assert.equal(all.result, 'win', `${lv.id} fails on floor ${all.failed + 1}`);
    assert.equal(all.floors[0].ticks, lv.par.steps, `${lv.id} par.steps`);
    assert.equal(all.floors[0].size, lv.par.size, `${lv.id} par.size`);
    for (let i = 0; i < floorCount(lv); i++) {
      const best = solve(floorLevel(lv, i));
      assert.ok(best && best.steps <= all.floors[i].ticks, `${lv.id} floor ${i + 1}`);
      // and the optimal route really wins that floor
      assert.equal(runLevel(actionsToCog(best.actions), free(floorLevel(lv, i))).result, 'win', `${lv.id} floor ${i + 1} optimum`);
    }
  }
});

test('on the reach-only mazes, A* (paths.js) and the full-rules solver give the same optimum', () => {
  for (const lv of WORLD4.levels.filter((l) => l.win === 'reach')) {
    for (let i = 0; i < floorCount(lv); i++) {
      const fl = floorLevel(lv, i);
      const route = routeToTarget(new World(fl));
      assert.equal(route.actions.length, solve(fl).steps, `${lv.id} floor ${i + 1}`);
    }
  }
});

test('floors defeat fixed routes (4-5 floors share a start row, so only some routes fail there)', () => {
  for (const lv of WORLD4.levels) {
    const fails = [];
    for (let i = 0; i < floorCount(lv); i++) {
      const route = actionsToCog(solve(floorLevel(lv, i)).actions);
      fails.push(runFloors(route, free(lv)).result !== 'win');
    }
    if (lv.id === 'w4-5') assert.ok(fails.some(Boolean), lv.id);
    else assert.ok(fails.every(Boolean), `${lv.id}: ${fails}`);
  }
});

test('each idea is needed: the simpler strategy fails', () => {
  // 4-3: the right range finder is locked
  assert.throws(() => checkTools(parse(RIGHT_HAND), byId['w4-3'].tools), /clear_right/);
  // 4-5: plain wall following circles a crate; "straight until a wall, then turn" runs the battery flat
  assert.notEqual(runFloors(RIGHT_HAND, free(byId['w4-5'])).result, 'win');
  for (const t of ['left', 'right']) {
    assert.notEqual(runFloors(`while not goal\n  if clear\n    move\n  else\n    ${t}\n  end\nend`, free(byId['w4-5'])).result, 'win', t);
  }
  // 4-6: the maze has loops; right-hand wall following goes round forever on some floor
  assert.notEqual(runFloors(RIGHT_HAND, free(byId['w4-6'])).result, 'win');
  // 4-7 / 4-8: a wall-following fetch loop fails (loops or flat battery)
  const fetch = (end) => `while ${end}\n  if item and not holding\n    grab\n  elif bin and holding\n    drop\n  elif clear_right\n    right\n    move\n  elif clear\n    move\n  else\n    left\n  end\nend`;
  assert.notEqual(runFloors(fetch('true'), free(byId['w4-7'])).result, 'win');
  assert.notEqual(runFloors(fetch('not goal'), free(byId['w4-8'])).result, 'win');
});

test('4-5 really uses its turn register (memory locked → rejected)', () => {
  const lv = byId['w4-5'];
  assert.match(lv.solution, /^\s*(add|sub) t 1/m);
  assert.throws(() => checkTools(parse(lv.solution), { ...lv.tools, blocks: lv.tools.blocks.filter((b) => b !== 'memory') }), /isn't unlocked/);
});

test('World 4 keeps all World 3 blocks once def and memory return, and follows World 3', () => {
  assert.equal(LEVELS[LEVELS.indexOf(WORLD3.levels.at(-1)) + 1], WORLD4.levels[0]);
  for (const lv of WORLD4.levels.slice(3)) assert.ok(lv.tools.blocks.includes('def'), lv.id);
  for (const lv of WORLD4.levels.slice(4)) assert.ok(lv.tools.blocks.includes('memory'), lv.id);
});
