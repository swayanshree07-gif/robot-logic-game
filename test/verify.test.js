// Day 25: automated solver check — every level (and every floor) is provably
// solvable; joint-state crew solver basics; the verifier catches bad levels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/game/levels.js';
import { solveCrew, solveCrewInfo, solveInfo, plansToCog } from '../src/game/solver.js';
import { runCrew } from '../src/game/crew.js';
import { verifyLevel } from '../src/game/verify.js';

test('crew solver: two robots reach their pads in the fewest rounds', () => {
  const lv = { map: ['>..G', '#..#', '>..G'], win: 'reach' };
  const best = solveCrew(lv);
  assert.equal(best.steps, 3);
  assert.equal(best.plans.length, 2);
  assert.equal(runCrew(plansToCog(best.plans), lv).result, 'win');
});

test('crew solver: plate-and-door teamwork, idle robots, unsolvable and capped searches', () => {
  const door = { map: ['>D.G', '####', '>_.G'], win: 'reach' };
  const best = solveCrew(door);
  assert.ok(best, 'door level solvable');
  assert.equal(runCrew(plansToCog(best.plans), door).result, 'win');
  // walled-off pad: exhaustive search, not capped
  const walled = solveCrewInfo({ map: ['>#G', '###', '>.G'], win: 'reach' });
  assert.equal(walled.best, null);
  assert.equal(walled.capped, false);
  // tiny cap: unknown, not impossible
  assert.equal(solveCrewInfo(door, { maxStates: 2 }).capped, true);
  // trailing idles are dropped, inner idles become wait
  assert.deepEqual(plansToCog([['idle', 'move', 'idle'], ['move', 'move']]), ['wait\nmove', 'move 2']);
  // per-robot tools: robot 2 may not turn, so it cannot reach a pad behind it
  const turn = { map: ['>.G', '###', 'G.>'], win: 'reach', robots: [{ tools: { actions: ['move', 'left', 'right'] } }, { tools: { actions: ['move'] } }] };
  assert.equal(solveCrew({ ...turn, robots: undefined }).steps, 4);
  assert.equal(solveCrew(turn), null);
});

test('single solver reports capped searches', () => {
  const hall = { map: ['#########', '#>.....G#', '#########'], win: 'reach' };
  assert.equal(solveInfo(hall).best.steps, 6);
  const r = solveInfo(hall, { maxStates: 3 });
  assert.equal(r.best, null);
  assert.equal(r.capped, true);
});

test('verifier: catches unsolvable floors, par below optimum, and accepts solution fallback', () => {
  const ok = { id: 't', map: ['#####', '#>.G#', '#####'], win: 'reach', solution: 'move 2', par: { steps: 2, size: 1 } };
  assert.equal(verifyLevel(ok).ok, true);
  const cheap = verifyLevel({ ...ok, par: { steps: 1, size: 1 } });
  assert.match(cheap.problems.join(), /par steps 1 below optimum 2/);
  const dead = verifyLevel({ ...ok, floors: [['#####', '#>#G#', '#####']] });
  assert.equal(dead.ok, false);
  assert.match(dead.problems.join(), /floor 2: solver proved there is no win/);
  const capped = verifyLevel(ok, { maxStates: 1 });
  assert.equal(capped.ok, true);
  assert.equal(capped.floors[0].method, 'solution');
});

test('every shipped level is solvable on every floor (quick caps)', () => {
  let floors = 0;
  for (const lv of LEVELS) {
    const v = verifyLevel(lv, { maxStates: 50000, crewMaxStates: 20000 });
    assert.ok(v.ok, `${lv.id}: ${v.problems.join('; ')}`);
    for (const f of v.floors) { floors++; assert.ok(f.method, `${lv.id} floor ${f.floor}`); }
  }
  assert.equal(LEVELS.length, 40);
  assert.ok(floors >= 90, `${floors} floors checked`);
});
