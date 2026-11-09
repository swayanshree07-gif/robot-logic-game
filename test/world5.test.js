// World 5 "Swarm Floor": shipped crew programs win on every floor; one-robot
// and signal-free attempts fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD5 } from '../src/game/worlds/w5.js';
import { runSolution } from '../src/game/run.js';
import { validateLevel, floorCount, floorLevel } from '../src/world/level.js';

const ids = Object.fromEntries(WORLD5.levels.map((l) => [l.id, l]));
const allFloors = (lv, progs) => [...Array(floorCount(lv)).keys()].map((i) => runSolution(floorLevel(lv, i), progs).result);

test('World 5: valid crew levels; shipped programs win every floor at par', () => {
  for (const lv of WORLD5.levels) {
    assert.deepEqual(validateLevel(lv), [], lv.id);
    assert.equal(lv.solutions.length, lv.robots.length, lv.id);
    assert.equal(runSolution(lv).size, lv.par.size, `${lv.id} size`);
    assert.ok(allFloors(lv).every((r) => r === 'win'), lv.id);
    assert.equal(runSolution(lv).ticks, lv.par.steps, lv.id);
  }
});

test('World 5: every robot is needed (any one program emptied fails)', () => {
  for (const lv of WORLD5.levels) {
    lv.solutions.forEach((_, i) => {
      const progs = lv.solutions.map((s, j) => (j === i ? '' : s));
      assert.notEqual(runSolution(lv, progs).result, 'win', `${lv.id} without robot ${i + 1}`);
    });
  }
});

test('World 5: levels 5-5..5-8 are three-robot crews named Pip, Bolt, Cog', () => {
  assert.equal(WORLD5.levels.length, 8);
  for (const lv of WORLD5.levels.slice(4)) assert.deepEqual(lv.robots.map((r) => r.name), ['Pip', 'Bolt', 'Cog'], lv.id);
});

test('World 5: attempts without waiting / signals fail', () => {
  const strip = (s) => s.split('\n').filter((l) => !/^\s*(send|wait)\b/.test(l)).join('\n');
  assert.notEqual(runSolution(ids['w5-1'], [ids['w5-1'].solutions[0].split('\n').slice(3).join('\n'), 'move']).result, 'win');
  for (const id of ['w5-2', 'w5-3', 'w5-4', 'w5-5', 'w5-6', 'w5-7', 'w5-8']) {
    const lv = ids[id];
    assert.notEqual(runSolution(lv, lv.solutions.map(strip)).result, 'win', id);
  }
});
