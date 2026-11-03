import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runner, runLevel } from '../src/game/run.js';

const hall = { map: ['#######', '#>...G#', '#######'], win: 'reach' };
const box = { map: ['#####', '#>..#', '#...#', '#####'], win: 'reach' };

test('cycle detection catches programs that repeat forever', () => {
  for (const src of [
    'while true\n  wait\nend',
    'while true\n  right\nend',
    'def spin\n  left\n  spin\nend\nspin', // tail recursion hits the call limit first
    'while true\n  move\n  right\n  right\nend', // ping-pong between two tiles
  ]) {
    const r = runLevel(src, box);
    assert.ok(['loop', 'error'].includes(r.result), `${src}: ${r.result}`);
  }
  const r = runLevel('while true\n  move\n  left\n  left\n  move\n  left\n  left\nend', box);
  assert.equal(r.result, 'loop');
  assert.equal(r.error.code, 'loop');
  assert.match(r.error.hint, /after step 7 everything is exactly as it was after step 1/);
});

test('long but finite programs are not mistaken for loops', () => {
  const r = runLevel('repeat 300\n  wait\nend\nmove 4', hall);
  assert.equal(r.result, 'win');
  assert.equal(r.ticks, 304);
});

test('timeout when step budget runs out without a provable cycle', () => {
  const r = runLevel('repeat 999\n  wait\nend', hall, { maxTicks: 100 });
  assert.equal(r.result, 'timeout');
  assert.equal(r.ticks, 100);
});

test('Runner exposes tick-by-tick progress and never throws on bad code', () => {
  const bad = new Runner('mvoe', hall);
  assert.equal(bad.result, 'error');
  assert.match(bad.error.message, /did you mean 'move'/);
  const r = new Runner('move 2\nmove 2', hall);
  const events = [];
  while (!r.done) events.push(r.tick().type);
  assert.deepEqual(events, ['action', 'action', 'action', 'end']);
  assert.equal(r.result, 'win');
  assert.equal(r.tick().type, 'end'); // idempotent after the end
});
