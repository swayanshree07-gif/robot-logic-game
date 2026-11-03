import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, parseMap } from '../src/world/world.js';
import { runLevel } from '../src/game/run.js';
import { LEVELS } from '../src/game/levels.js';

test('parseMap finds robot, items and validates shape', () => {
  const m = parseMap(['#v#', '.o.', 'GB#']);
  assert.deepEqual(m.robot, { x: 1, y: 0, dir: 2 });
  assert.deepEqual(m.items, [{ x: 1, y: 1 }]);
  assert.equal(m.tiles[2][0], 'goal');
  assert.throws(() => parseMap(['##', '#']), /length/);
  assert.throws(() => parseMap(['..']), /no robot/);
  assert.throws(() => parseMap(['>>']), /more than one/);
  assert.throws(() => parseMap(['>?']), /unknown map character/);
});

test('sensors and movement', () => {
  const w = new World({ map: ['#####', '#>..#', '#####'] });
  assert.equal(w.sense('clear'), true);
  assert.equal(w.sense('clear_left'), false);
  assert.ok(w.act('move').ok);
  assert.ok(w.act('move').ok);
  assert.equal(w.sense('wall'), true);
  const r = w.act('move');
  assert.equal(r.ok, false);
  assert.match(r.error, /wall/);
  w.act('left');
  assert.equal(w.robot.dir, 0);
});

test('edges of the map count as walls', () => {
  const w = new World({ map: ['>G'] });
  w.act('left');
  assert.equal(w.sense('wall'), true);
});

test('grab / drop / deliver', () => {
  const w = new World({ map: ['>oB'], win: 'deliver' });
  assert.equal(w.act('grab').ok, false);
  w.act('move');
  assert.equal(w.sense('item'), true);
  assert.ok(w.act('grab').ok);
  assert.equal(w.sense('holding'), true);
  assert.equal(w.act('grab').ok, false);
  assert.equal(w.isWon(), false);
  w.act('move');
  assert.ok(w.act('drop').ok);
  assert.equal(w.isWon(), true);
});

test('every level has a working solution', () => {
  const ids = new Set();
  for (const level of LEVELS) {
    assert.ok(!ids.has(level.id), `duplicate id ${level.id}`);
    ids.add(level.id);
    const r = runLevel(level.solution, level);
    assert.equal(r.result, 'win', `${level.id}: ${r.result} ${r.error ? r.error.message : ''}`);
  }
});

test('runLevel classifies outcomes', () => {
  const lvl = LEVELS[0];
  assert.equal(runLevel('move', lvl).result, 'fail');
  assert.equal(runLevel('right\nmove', lvl).result, 'error'); // bumps wall
  assert.equal(runLevel('move 9', lvl).result, 'win'); // docking on the pad ends the run
  assert.equal(runLevel('moove', lvl).result, 'error');
  assert.equal(runLevel('while true\n  left\nend', lvl).result, 'loop');
  const t = runLevel('while true\n  left\nend', lvl, { maxTicks: 50, detectCycles: false });
  assert.equal(t.result, 'timeout');
  assert.equal(t.ticks, 50);
  assert.equal(t.error.code, 'steps');
});

test('floor colour and bin sensors', () => {
  const w = new World({ map: ['>ryb.B'] });
  const read = () => ['red', 'yellow', 'blue', 'bin'].filter((n) => w.sense(n)).join(',');
  const seen = [read()];
  for (let i = 0; i < 5; i++) { w.act('move'); seen.push(read()); }
  assert.deepEqual(seen, ['', 'red', 'yellow', 'blue', '', 'bin']);
});

test('colour tiles are walkable floor, stateKey tracks mutable state', () => {
  const w = new World({ map: ['>oB'] });
  assert.equal(w.tiles[0][1], 'floor');
  const k0 = w.stateKey();
  w.act('left'); w.act('right');
  assert.equal(w.stateKey(), k0);
  w.act('move'); w.act('grab');
  assert.notEqual(w.stateKey(), k0);
});
