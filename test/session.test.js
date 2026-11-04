import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaySession, SPEEDS, MAX_TICKS_PER_UPDATE, resultBanner } from '../src/game/session.js';
import { ALL_LEVELS as LEVELS } from '../src/game/levels.js';

const hall = { id: 't', name: 'T', map: ['#######', '#>...G#', '#######'], win: 'reach' };

test('run ticks at the chosen speed and ends in a win', () => {
  const s = new PlaySession(hall, { speed: 'normal' });
  s.setSource('move 4');
  assert.equal(s.view().state, 'edit');
  s.run();
  assert.equal(s.view().runLabel, 'Pause');
  assert.equal(s.update(0), 1, 'first step is immediate');
  assert.equal(s.update(299), 0);
  assert.equal(s.update(1), 1);
  assert.equal(s.view().ticks, 2);
  assert.equal(s.view().line, 1);
  s.update(10000);
  assert.equal(s.state, 'done');
  assert.equal(s.result.result, 'win');
  assert.match(s.result.message, /4 steps/);
  assert.deepEqual(resultBanner(s.result, { hasNext: true }).next, true);
});

test('pause, step, resume, stop and reset', () => {
  const s = new PlaySession(hall);
  s.setSource('move\nmove\nmove\nmove');
  s.step();
  assert.equal(s.state, 'paused');
  assert.equal(s.view().line, 1);
  assert.equal(s.world.robot.x, 2);
  s.step();
  assert.equal(s.view().line, 2);
  s.run();
  assert.equal(s.state, 'running');
  s.pause();
  assert.equal(s.view().runLabel, 'Resume');
  assert.ok(s.view().canStop);
  s.stop();
  assert.equal(s.state, 'done');
  assert.equal(s.result.result, 'stopped');
  assert.equal(resultBanner(s.result), null);
  assert.equal(s.world.robot.x, 3, 'stop keeps the board');
  s.reset();
  assert.equal(s.state, 'edit');
  assert.equal(s.world.robot.x, 1, 'reset restores the start');
  // run after done starts over
  s.step(); s.stop(); s.step();
  assert.equal(s.view().ticks, 1);
});

test('editing the program throws away the run', () => {
  const s = new PlaySession(hall);
  s.setSource('move 2');
  s.step();
  s.setSource('move 3');
  assert.equal(s.state, 'edit');
  assert.equal(s.world.robot.x, 1);
});

test('compile errors end the run at once with an error banner', () => {
  const s = new PlaySession(hall);
  s.setSource('mvoe');
  s.run();
  assert.equal(s.state, 'done');
  assert.equal(s.result.result, 'error');
  const b = resultBanner(s.result);
  assert.equal(b.kind, 'error');
  assert.equal(b.title, 'Program error');
  assert.match(b.text, /did you mean 'move'/);
});

test('runtime outcomes: bump, fail, loop, timeout', () => {
  const bump = new PlaySession(hall);
  bump.setSource('move 9');
  bump.setSpeed('instant');
  bump.level = { ...hall, map: ['#####', '#>..#', '#####'] }; bump.reset();
  bump.run(); bump.update(16);
  assert.equal(bump.result.result, 'error');
  assert.ok(bump.bump, 'bump event kept for the renderer');
  assert.equal(resultBanner(bump.result).title, 'Pip stopped');

  const fail = new PlaySession(hall, { speed: 'instant' });
  fail.setSource('move');
  fail.run(); fail.update(16);
  assert.equal(resultBanner(fail.result).title, 'Not quite');
  assert.match(fail.result.message, /not on a goal pad/);

  const loop = new PlaySession(hall, { speed: 'instant' });
  loop.setSource('while not goal\n  left\nend');
  loop.run(); loop.update(16);
  assert.equal(loop.result.result, 'loop');
  assert.equal(resultBanner(loop.result).title, 'Stuck in a loop');

  const flat = new PlaySession({ ...hall, maxSteps: 3 }, { speed: 'instant' });
  flat.setSource('move\nleft\nright\nmove');
  assert.equal(flat.view().battery, 3);
  flat.run(); flat.update(16);
  assert.equal(flat.result.result, 'timeout');
  assert.equal(resultBanner(flat.result).title, 'Battery flat');
});

test('instant speed is capped per update so a frame cannot freeze', () => {
  const big = { id: 'b', name: 'B', map: ['####', '#>.#', '####'], win: 'reach', maxSteps: 5000 };
  const s = new PlaySession(big, { speed: 'instant' });
  s.setSource('repeat 999\n  wait\nend'); // the repeat counter changes, so no loop detection
  s.run();
  const n = s.update(16);
  assert.equal(n, MAX_TICKS_PER_UPDATE);
  assert.equal(s.state, 'running');
});

test('speeds are ordered slowest to fastest and every level runs in a session', () => {
  for (let i = 1; i < SPEEDS.length; i++) assert.ok(SPEEDS[i].ms < SPEEDS[i - 1].ms);
  assert.throws(() => new PlaySession(hall, { speed: 'warp' }));
  for (const lvl of LEVELS) {
    const s = new PlaySession(lvl, { speed: 'instant' });
    s.setSource(lvl.solution);
    s.run();
    while (s.state === 'running') s.update(16);
    assert.equal(s.result.result, 'win', lvl.id);
  }
});
