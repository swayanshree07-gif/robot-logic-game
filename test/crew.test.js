// Multi-robot crews: lock-step scheduler, collisions, shared factory ticks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCrew, CrewRunner, crewSize } from '../src/game/crew.js';
import { World, parseMap } from '../src/world/world.js';
import { runLevel } from '../src/game/run.js';

const lvl = (map, win = 'reach', extra = {}) => ({ id: 't', name: 't', map, win, ...extra });

test('maps with several starts: numbered in reading order, single-robot maps still reject them', () => {
  const map = ['>..G', '#..#', '>..G'];
  assert.equal(crewSize(map), 2);
  assert.throws(() => parseMap(map), /more than one robot start/);
  assert.throws(() => parseMap(['>>>>>'], { maxRobots: 4 }), /more than 4 robot starts/);
  const w = new World(lvl(map), { maxRobots: 4 });
  assert.deepEqual(w.robots.map((r) => [r.id, r.x, r.y]), [[0, 0, 0], [1, 0, 2]]);
});

test('two robots each walk to a pad; win needs every robot on a pad', () => {
  const map = ['>..G', '####', '>..G'];
  const r = runCrew(['move 3', 'move 3'], lvl(map));
  assert.equal(r.result, 'win');
  assert.equal(r.ticks, 3);
  assert.equal(r.size, 2);
  const half = runCrew(['move 3', 'move 2'], lvl(map));
  assert.equal(half.result, 'fail');
  assert.match(half.unmet[0], /robot 2 not on a goal pad/);
});

test('program count must match the robots on the map', () => {
  assert.throws(() => new CrewRunner(['move'], lvl(['>.G', '>.G'])), /2 robots but 1 program/);
});

test('moving into another robot is a crash that names both robots', () => {
  const r = runCrew(['move', 'wait'], lvl(['>>.G']));
  assert.equal(r.result, 'error');
  assert.equal(r.error.code, 'crash');
  assert.equal(r.error.robot, 0);
  assert.match(r.error.message, /robot 1 ran into robot 2/);
  // Reversed roles: the robot in front leaves first, so the one behind can follow.
  const ok = runCrew(['wait\nmove 2', 'move 2'], lvl(['>>GG']));
  assert.equal(ok.result, 'win');
});

test('head-on swap is impossible: robots cannot pass through each other', () => {
  const r = runCrew(['move', 'move'], lvl(['G><G']));
  assert.equal(r.result, 'error');
  assert.equal(r.error.code, 'crash');
});

test('factory ticks once per round, after every robot has acted', () => {
  // Robot 2 steps onto the plate in round 1; the door opens only at the end of that round.
  const map = ['>D.G', '####', '>_.G'];
  const c = new CrewRunner(['wait\nmove 3', 'move\nwait\nwait\nmove 2'], lvl(map));
  assert.equal(c.world.doors[0].open, false);
  c.tick();
  assert.equal(c.world.doors[0].open, true);
  assert.equal(c.world.stats.wait + c.world.stats.move, 2);
  while (!c.done) c.tick();
  assert.equal(c.result, 'win');
});

test('belt carries one robot but not into another robot', () => {
  const map = ['E>.G', '####', '>..G'];
  const c = new CrewRunner(['wait', 'wait'], lvl(map));
  // The belt at x=0 would push east, but nothing stands on it and robot 1 is off-belt.
  assert.equal(c.world.robots[0].x, 1);
  c.tick();
  assert.equal(c.world.robots[0].x, 1);
  const map2 = ['>E.G', '####', '>..G'];
  const d = new CrewRunner(['move\nwait\nmove', 'move 3'], lvl(map2));
  d.tick(); // robot 1 moves onto the belt, which carries it on to x=2 (once per round)
  assert.equal(d.world.robots[0].x, 2);
  d.tick(); d.tick();
  assert.equal(d.result, 'win');
});

test('a robot holding a plate keeps a door open for its partner', () => {
  const map = ['>.D.G', '#####', '>_..G'];
  const r = runCrew(['wait\nmove 4', 'move\nwait\nwait\nmove 3'], lvl(map));
  assert.equal(r.result, 'win');
  assert.equal(r.ticks, 6);
  // Partner leaves the plate too early: the door shuts before robot 1 gets there.
  const early = runCrew(['wait\nmove 4', 'move 4'], lvl(map));
  assert.equal(early.result, 'error');
  assert.equal(early.error.code, 'bump');
  assert.equal(early.error.robot, 0);
});

test('crew loops are detected across all programs; finished programs stand still', () => {
  const r = runCrew(['while true\n  left\nend', 'move'], lvl(['>.G', '>.G']));
  assert.equal(r.result, 'loop');
  const f = runCrew(['move', 'move'], lvl(['>.G', '>.G']));
  assert.equal(f.result, 'fail');
});

test('crew battery limit counts rounds', () => {
  const r = runCrew(['repeat 50\n  left\nend', 'repeat 50\n  right\nend'], lvl(['>.G', '>.G'], 'reach', { maxSteps: 10 }), { detectCycles: false });
  assert.equal(r.result, 'timeout');
});

test('compile errors report which robot', () => {
  const r = runCrew(['move', 'mvoe'], lvl(['>.G', '>.G']));
  assert.equal(r.result, 'error');
  assert.equal(r.error.robot, 1);
});

test('one-robot levels behave exactly as before', () => {
  const r = runLevel('move 2', lvl(['>.G']));
  assert.equal(r.result, 'win');
  const single = runCrew(['move 2'], lvl(['>.G']));
  assert.equal(single.result, 'win');
  assert.equal(single.ticks, 2);
});
