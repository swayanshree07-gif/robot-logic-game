import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLevel, normalizeLevel, levelFromJSON, levelToJSON, levelCrew, robotTools, robotName, levelSolutions, describeGoal } from '../src/world/level.js';
import { PROTOTYPES } from '../src/game/levels.js';
import { runSolution } from '../src/game/run.js';
import { runCrew } from '../src/game/crew.js';
import { PlaySession, resultBanner } from '../src/game/session.js';
import { Animator } from '../src/ui/art.js';
import { World } from '../src/world/world.js';

const bench = PROTOTYPES.find((p) => p.id === 'proto-11');
const duo = {
  id: 'duo', name: 'Duo', win: 'reach',
  map: ['#####', '#>.G#', '#>.G#', '#####'],
  solutions: ['move 2', 'move 2'],
};
const play = (level, sources, { robot = 0, bp = [] } = {}) => {
  const s = new PlaySession(level, { speed: 'instant' });
  s.setSources(sources);
  s.selectRobot(robot);
  s.setBreakpoints(bp);
  return s;
};

test('crew level format: valid fixture, helpers, goal text', () => {
  assert.deepEqual(validateLevel(bench), []);
  assert.deepEqual(validateLevel(duo), []);
  assert.equal(levelCrew(bench), 2);
  assert.equal(levelCrew(PROTOTYPES[0]), 1);
  assert.deepEqual(levelSolutions(duo), ['move 2', 'move 2']);
  assert.deepEqual(levelSolutions(PROTOTYPES[0]), ['move 4']);
  assert.equal(robotName(bench, 1), 'Bolt');
  assert.equal(robotName(duo, 1), 'Robot 2');
  assert.equal(robotName(PROTOTYPES[0], 0), 'Pip');
  assert.equal(describeGoal(duo), 'Park every robot on a goal pad.');
  assert.equal(runSolution(bench).result, 'win');
});

test('crew level validation reports each problem', () => {
  const bad = (patch, re) => {
    const p = validateLevel({ ...duo, ...patch });
    assert.ok(p.some((x) => re.test(x)), `${re}: ${p.join(' | ')}`);
  };
  bad({ solutions: undefined }, /solutions is required/);
  bad({ solutions: ['move 2'] }, /1 program\(s\) but the map has 2 robots/);
  bad({ solution: 'move 2' }, /use 'solutions'/);
  bad({ solutions: [1, 2] }, /list of programs/);
  bad({ solutions: ['', ' '] }, /all empty/);
  bad({ robots: [{}] }, /1 entry but the map has 2/);
  bad({ robots: [{ name: '' }, {}] }, /robots\[0\]\.name/);
  bad({ robots: [{ hat: 1 }, {}] }, /unknown field 'hat'/);
  bad({ robots: [{}, { tools: { actions: ['fly'] } }] }, /robots\[1\]\.tools\.actions has unknown entry 'fly'/);
  bad({ map: ['#####', '#>.G#', '#####'], solutions: ['move 2'] }, /only for maps with 2 or more/);
  bad({ map: ['#######', '#>>>>G#', '#>....#', '#######'] }, /more than 4 robot starts/);
  bad({ floors: [['#####', '#>.G#', '#.#G#', '#####']] }, /test floor 2 has 1 robot\(s\), the main map has 2/);
  // a goal any robot can reach is enough for the reachability check
  assert.deepEqual(validateLevel({ ...duo, map: ['#####', '#>#G#', '#>..#', '#####'] }), []);
  assert.deepEqual(validateLevel({ ...duo, solutions: undefined }, { requireSolution: false }), []);
});

test('crew levels normalise and round-trip through JSON', () => {
  const n = normalizeLevel(bench);
  assert.deepEqual(n.solutions, bench.solutions);
  assert.deepEqual(n.robots.map((r) => r.name), ['Pip', 'Bolt']);
  assert.ok(n.tools.blocks.includes('signal'), 'signal is part of the default tool set');
  assert.deepEqual(levelFromJSON(levelToJSON(bench)), n);
  assert.equal(runSolution(n).result, 'win');
});

test('per-robot tools: each robot is held to its own list', () => {
  const level = { ...duo, robots: [{ tools: { actions: ['move'] } }, { tools: { actions: ['move', 'left'] } }] };
  assert.deepEqual(validateLevel(level), []);
  assert.deepEqual(robotTools(level, 1).actions, ['move', 'left']);
  assert.equal(robotTools({ ...duo, tools: { actions: ['move'] } }, 1).actions[0], 'move');
  const r = runCrew(['move\nleft', 'move 2'], level);
  assert.equal(r.result, 'error');
  assert.equal(r.error.robot, 0);
  assert.equal(runCrew(['move 2', 'left\nleft\nleft\nleft\nmove 2'], level).result, 'win');
});

test('a robot that sends and then waits in the same round is not a deadlock', () => {
  // round 2 of the bench: Pip blocked on go, Bolt sends go then blocks on through
  const r = runCrew(bench.solutions, bench);
  assert.equal(r.result, 'win');
  assert.equal(runCrew(['wait a', 'send a\nwait b'], { ...duo, solutions: undefined }).result, 'deadlock');
});

test('PlaySession: one program per robot, tabs, crew view and win', () => {
  const s = new PlaySession(bench, { speed: 'instant' });
  assert.equal(s.crew, 2);
  assert.equal(s.world.robots.length, 2);
  s.setSource('move', 1);
  assert.equal(s.source, '');
  s.selectRobot(1);
  assert.equal(s.source, 'move');
  assert.throws(() => s.selectRobot(2), RangeError);
  assert.throws(() => s.setSources(['a']), RangeError);
  s.setSources(bench.solutions);
  assert.deepEqual(s.view().crew.map((c) => c.status), ['edit', 'edit']);
  s.step(); s.step();
  const v = s.view();
  assert.equal(v.ticks, 2);
  assert.equal(v.crew[0].blocked, 'go');
  assert.equal(v.crew[1].blocked, 'through');
  assert.equal(v.crew[1].name, 'Bolt');
  assert.equal(v.robot, 1);
  s.step();
  assert.deepEqual(s.view().signals, {});
  assert.equal(s.view().crew[0].line, 2);
  s.run();
  while (s.state === 'running') s.update(0);
  assert.equal(s.result.result, 'win');
  assert.equal(resultBanner(s.result).kind, 'win');
  assert.equal(new PlaySession(PROTOTYPES[0]).view().crew, null);
});

test('PlaySession: breakpoints follow the selected robot', () => {
  const s = play(bench, bench.solutions, { robot: 1, bp: [5] });
  s.run();
  while (s.state === 'running') s.update(0);
  assert.equal(s.state, 'paused');
  assert.equal(s.view().atBreak, 5);
  assert.equal(s.runner.vm.line, 5); // Bolt's second `right`
  s.run();
  while (s.state === 'running') s.update(0);
  assert.equal(s.result.result, 'win');
  // Step over / out on a crew just step one round / run
  const t = play(bench, bench.solutions);
  t.stepOver();
  assert.equal(t.view().ticks, 1);
});

test('PlaySession: errors jump to the failing robot; deadlock gets its own banner', () => {
  const s = play(bench, ['move', 'move\nmove\nmove'], { robot: 0 });
  s.run();
  while (s.state === 'running') s.update(0);
  assert.equal(s.result.result, 'error');
  assert.equal(s.result.robot, 1);
  assert.equal(s.robot, 1, 'editor tab switches to the robot that crashed');
  assert.ok(s.bump, 'bump marker shown');
  const d = play(bench, ['wait go', 'wait through']);
  d.run();
  while (d.state === 'running') d.update(0);
  assert.equal(d.result.result, 'deadlock');
  const b = resultBanner(d.result);
  assert.equal(b.title, 'Deadlock');
  assert.match(b.text, /waits for 'go'/);
});

test('PlaySession: crew test floors must all win', () => {
  const level = { ...duo, floors: [['#####', '#>.G#', '#>..#', '#####']] };
  const s = play(level, duo.solutions);
  s.run();
  while (s.state === 'running') s.update(0);
  assert.equal(s.result.result, 'fail');
  assert.equal(s.result.floorFail, 1);
});

test('Animator follows its own robot in a crew', () => {
  const w = new World(bench, { maxRobots: 4 });
  const a0 = new Animator(0), a1 = new Animator(1);
  a0.sync(w); a1.sync(w);
  assert.deepEqual([a1.pose().x, a1.pose().y], [3, 3]);
  w.select(1).act('move');
  w.select(0);
  a0.sync(w, 100); a1.sync(w, 100);
  assert.equal(a0.busy, false, 'robot 1 did not move');
  assert.equal(a1.busy, true);
  a1.update(100);
  assert.deepEqual([a1.pose().x, a1.pose().y], [3, 2]);
});
