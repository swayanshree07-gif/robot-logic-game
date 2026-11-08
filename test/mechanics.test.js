// Factory mechanics: conveyor belts, pressure plates, doors and the tick order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, parseMap } from '../src/world/world.js';
import { runLevel } from '../src/game/run.js';
import { solve } from '../src/game/solver.js';
import { validateLevel } from '../src/world/level.js';
import { PROTOTYPES } from '../src/game/levels.js';
import { cuesForEvents } from '../src/ui/audio.js';

const lv = (map, win = 'reach', extra = {}) => ({ id: 't', name: 't', map, win, solution: 'wait', ...extra });
const rig = PROTOTYPES.find((p) => p.id === 'proto-10');

test('map legend: belts, plates, doors', () => {
  const m = parseMap(['#>NESW_D#']);
  assert.deepEqual(m.tiles[0].slice(2, 8), ['belt', 'belt', 'belt', 'belt', 'plate', 'door']);
  assert.deepEqual(m.belts[0].slice(2, 6), [0, 1, 2, 3]);
  assert.equal(m.belts[0][1], null);
});

test('a belt carries Pip one tile after each action, waits included', () => {
  const w = new World(lv(['#######', '#>EE..#', '#######']));
  w.act('move'); // onto (2,1), then carried to (3,1)
  assert.deepEqual([w.robot.x, w.robot.y], [3, 1]);
  assert.deepEqual(w.log.map((e) => e.type), ['move', 'belt']);
  w.act('wait'); // (3,1) belt -> (4,1)
  assert.equal(w.robot.x, 4);
  w.act('wait'); // plain floor: stays
  assert.equal(w.robot.x, 4);
  assert.equal(w.robot.dir, 1, 'belts never turn Pip');
});

test('a belt into a wall holds Pip in place without a bump', () => {
  const w = new World(lv(['#####', '#>E#.', '#####']));
  assert.ok(w.act('move').ok);
  assert.equal(w.robot.x, 2);
  assert.ok(w.act('wait').ok);
  assert.equal(w.robot.x, 2);
  assert.ok(!w.log.some((e) => e.type === 'bump'));
});

test('parts ride belts as a queue and drop into bins at the end', () => {
  const w = new World(lv(['########', '#>.EEEB#', '########'], 'deliver'));
  w.items = [{ x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }];
  w.act('wait');
  // front part enters the bin, the others move up together
  assert.equal(w.delivered, 1);
  assert.deepEqual(w.items.map((i) => i.x).sort(), [4, 5]);
  w.act('wait'); w.act('wait');
  assert.equal(w.delivered, 3);
  assert.ok(w.isWon());
  assert.ok(w.log.some((e) => e.type === 'drop' && e.belt && e.bin));
});

test('a part blocked by a parked part waits its turn', () => {
  const w = new World(lv(['######', '#>.EE#', '######'], 'collect'));
  w.items = [{ x: 3, y: 1 }, { x: 4, y: 1 }];
  w.act('wait');
  assert.deepEqual(w.items.map((i) => i.x).sort(), [3, 4], 'front part is at the wall, the queue stays');
});

test('doors open while a plate holds Pip or a part, and jam when occupied', () => {
  const w = new World(lv(['#######', '#>_.D.#', '#######']));
  assert.equal(w.sense('clear'), true, 'a plate is floor');
  assert.equal(w.doors[0].open, false);
  w.act('move'); // on plate
  assert.equal(w.doors[0].open, true);
  w.act('move'); // off plate -> shuts again
  assert.equal(w.doors[0].open, false);
  assert.equal(w.sense('clear'), false, 'a shut door blocks like a wall');
  const r = w.act('move');
  assert.equal(r.code, 'bump');
  assert.deepEqual(w.log.filter((e) => e.type === 'door').map((e) => e.open), [true, false]);
});

test('a part left on the plate holds the door; standing in a doorway jams it', () => {
  const w = new World(lv(['########', '#>o_.D.#', '########']));
  w.act('move'); w.act('grab'); w.act('move'); w.act('drop');
  w.act('move'); w.act('move'); w.act('move');
  assert.equal(w.robot.x, 6, 'walked through the held door');
  // jam: plate pressed by Pip only, Pip steps into the doorway
  const j = new World(lv(['######', '#>_D.#', '######']));
  j.act('move'); j.act('move');
  assert.deepEqual([j.robot.x, j.doors[0].open], [3, true], 'door cannot shut on Pip');
  j.act('move');
  assert.equal(j.doors[0].open, false, 'shuts once Pip leaves');
});

test('doors start shut; a part resting on a plate opens them', () => {
  const w = new World(lv(['######', '#>.D.#', '######']));
  assert.equal(w.doors[0].open, false);
  // a part resting on the plate (placed before the first tick) holds it open
  const pre = new World(lv(['#######', '#>_.D.#', '#######']));
  pre.items.push({ x: 2, y: 1 });
  pre.updateDoors();
  assert.equal(pre.doors[0].open, true);
});

test('tick order: belt moves first, then doors see the new positions', () => {
  // Pip steps onto a belt that carries it onto the plate in the same tick
  const w = new World(lv(['#######', '#>E_D.#', '#######']));
  w.act('move');
  assert.equal(w.robot.x, 3);
  assert.equal(w.doors[0].open, true);
});

test('state key covers doors; cycle detection still separates states', () => {
  const w = new World(lv(['######', '#>_D.#', '######']));
  const k0 = w.stateKey();
  w.act('move');
  assert.notEqual(w.stateKey(), k0);
  assert.match(w.stateKey(), /\|1$/);
});

test('test rig level: valid, solution wins, solver finds a route using belts and doors', () => {
  assert.deepEqual(validateLevel(rig), []);
  const r = runLevel(rig.solution, rig);
  assert.equal(r.result, 'win', JSON.stringify(r.error));
  const s = solve(rig, { floorDrops: true });
  assert.ok(s && s.steps <= 22, `solver steps ${s && s.steps}`);
  // walking straight to the door without weighing the plate bumps
  assert.equal(runLevel('move 5', rig).result, 'error');
});

test('wait on a belt is how a program lets the factory work', () => {
  const level = lv(['#######', '#>EEEG#', '#######'], 'reach', { solution: 'move\nwait\nwait' });
  assert.equal(runLevel('move\nwait\nwait', level).result, 'win');
  assert.equal(runLevel('move', level).result, 'fail');
});

test('belt and door events have sounds', () => {
  assert.deepEqual(cuesForEvents([{ type: 'belt' }, { type: 'carry' }, { type: 'door', open: true }], 400), ['belt', 'door']);
});
