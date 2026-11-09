// Level editor reducer: painting, robots/crew sync, floors, rules, undo/redo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor, editorReducer as R, applyAll, blankLevel, editedMap, editorProblems, robotsOf, canUndo, canRedo, HISTORY_LIMIT } from '../src/game/level-editor.js';
import { LEVELS } from '../src/game/levels.js';
import { runSolution } from '../src/game/run.js';
import { validateLevel, normalizeLevel } from '../src/world/level.js';

test('blank level is valid apart from the solution and solves after one edit', () => {
  let s = createEditor();
  assert.deepEqual(editorProblems(s), []);
  assert.ok(validateLevel(s.level).length > 0); // no solution yet
  s = R(s, { type: 'solution', robot: 0, source: 'move 4' });
  assert.deepEqual(validateLevel(s.level), []);
  assert.equal(runSolution(s.level).result, 'win');
});

test('paint changes one cell, ignores bad input and no-ops', () => {
  const s0 = createEditor();
  const s1 = R(s0, { type: 'paint', x: 3, y: 1, tile: '#' });
  assert.equal(s1.level.map[1], '#..#..#');
  assert.equal(s0.level.map[1], '#.....#', 'old state untouched');
  assert.equal(R(s1, { type: 'paint', x: 3, y: 1, tile: '#' }), s1);
  assert.equal(R(s1, { type: 'paint', x: 99, y: 1, tile: '#' }), s1);
  assert.equal(R(s1, { type: 'paint', x: 1, y: 1, tile: '?' }), s1);
  assert.equal(R(s1, { type: 'paint', x: 1, y: 1, tile: '>' }), s1, 'robots go through the robot action');
  assert.throws(() => R(s1, { type: 'nope' }), /unknown editor action/);
});

test('robots: place, turn, crew fields follow starts, max crew', () => {
  let s = createEditor();
  s = R(s, { type: 'solution', robot: 0, source: 'move 4' });
  s = R(s, { type: 'robot', x: 1, y: 2, dir: 0 }); // turn Pip north
  assert.equal(s.level.map[2][1], '^');
  assert.equal(s.level.solution, 'move 4');
  s = R(s, { type: 'robot', x: 1, y: 1, dir: 1 }); // new robot above: becomes robot 1
  assert.equal(s.level.solution, undefined);
  assert.deepEqual(s.level.solutions, ['', 'move 4']);
  s = applyAll(s, [{ type: 'robotName', robot: 1, name: 'Pip' }, { type: 'robotName', robot: 0, name: 'Bolt' }, { type: 'tools', robot: 0, tools: { blocks: [] } }]);
  assert.deepEqual(s.level.robots, [{ name: 'Bolt', tools: { blocks: [] } }, { name: 'Pip' }]);
  // move Bolt below Pip: reading order flips, fields follow
  s = R(s, { type: 'moveRobot', from: { x: 1, y: 1 }, to: { x: 1, y: 3 } });
  assert.deepEqual(s.level.solutions, ['move 4', '']);
  assert.deepEqual(s.level.robots.map((r) => r.name), ['Pip', 'Bolt']);
  assert.deepEqual(editorProblems(s), []);
  s = applyAll(s, [{ type: 'robot', x: 2, y: 1, dir: 2 }, { type: 'robot', x: 3, y: 1, dir: 2 }]);
  assert.equal(robotsOf(s.level.map).length, 4);
  assert.equal(R(s, { type: 'robot', x: 4, y: 1, dir: 2 }), s, 'fifth robot refused');
  // painting over robots removes them; back to one robot -> solution again
  s = applyAll(s, [2, 3].map((x) => ({ type: 'paint', x, y: 1, tile: '.' })).concat([{ type: 'paint', x: 1, y: 3, tile: '.' }]));
  assert.equal(s.level.solution, 'move 4');
  assert.equal(s.level.solutions, undefined);
  assert.equal(s.level.robots, undefined);
  assert.deepEqual(validateLevel(s.level), []);
});

test('removing the last robot keeps fields and reports the problem', () => {
  let s = R(createEditor(), { type: 'paint', x: 1, y: 2, tile: '.' });
  assert.ok(editorProblems(s).some((p) => /no robot start/.test(p)));
  s = R(s, { type: 'robot', x: 2, y: 2, dir: 1 });
  assert.deepEqual(editorProblems(s), []);
});

test('resize grows with floor, crops robots, applies to floors, limits', () => {
  let s = applyAll(createEditor(), [{ type: 'addFloor' }, { type: 'selectFloor', index: 0 }]);
  s = R(s, { type: 'resize', width: 9, height: 6 });
  assert.equal(s.level.map.length, 6);
  assert.equal(s.level.map[0], '#######..');
  assert.equal(s.level.floors[0][5], '.........');
  assert.equal(R(s, { type: 'resize', width: 17, height: 6 }), s);
  assert.equal(R(s, { type: 'resize', width: 2, height: 6 }), s);
  s = R(s, { type: 'resize', width: 3, height: 3 }); // crops goal
  assert.ok(editorProblems(s).some((p) => /goal/.test(p)));
});

test('test floors: add copies, edits stay on the selected floor, remove', () => {
  let s = R(createEditor(), { type: 'addFloor' });
  assert.equal(s.floor, 1);
  s = R(s, { type: 'paint', x: 5, y: 2, tile: '.' });
  s = R(s, { type: 'paint', x: 5, y: 3, tile: 'G' });
  assert.equal(editedMap(s)[3], '#....G#');
  assert.equal(s.level.map[2], '#>...G#', 'main map untouched');
  s = R(s, { type: 'solution', robot: 0, source: 'move 4' });
  assert.equal(runSolution(s.level).result, 'win');
  assert.ok(validateLevel(s.level).length === 0);
  for (let i = 0; i < 5; i++) s = R(s, { type: 'addFloor' });
  assert.equal(s.level.floors.length, 4, 'main + 4 floors = MAX_FLOORS');
  s = R(s, { type: 'removeFloor', index: 4 });
  assert.equal(s.floor, 3);
  s = applyAll(s, [1, 1, 1].map((index) => ({ type: 'removeFloor', index })));
  assert.equal(s.level.floors, undefined);
  assert.equal(s.floor, 0);
});

test('rules, numbers, meta, par, tools', () => {
  let s = applyAll(createEditor(), [
    { type: 'paint', x: 3, y: 1, tile: 'o' }, { type: 'paint', x: 3, y: 3, tile: 'B' },
    { type: 'win', rules: [{ type: 'deliver', count: 1 }] },
    { type: 'capacity', value: 2 }, { type: 'maxSteps', value: 300 },
    { type: 'meta', name: 'Test bay', brief: 'Bin it.', hint: 'grab first' },
    { type: 'par', value: { steps: 9, size: 5 } },
    { type: 'tools', robot: null, tools: { blocks: ['repeat'] } },
  ]);
  assert.deepEqual(editorProblems(s), []);
  const n = normalizeLevel({ ...s.level, solution: 'x' }, { requireSolution: false });
  assert.equal(n.capacity, 2);
  assert.deepEqual(n.tools.blocks, ['repeat']);
  s = applyAll(s, [{ type: 'meta', hint: '' }, { type: 'par', value: null }, { type: 'tools', robot: null, tools: null }, { type: 'capacity', value: null }]);
  assert.equal(s.level.hint, undefined);
  assert.equal(s.level.par, undefined);
  assert.equal(s.level.tools, undefined);
  assert.equal(s.level.capacity, undefined);
  s = R(s, { type: 'win', rules: [{ type: 'deliver', count: 5 }] });
  assert.ok(editorProblems(s).some((p) => /count 5/.test(p)));
  assert.equal(R(s, { type: 'tools', robot: 0, tools: {} }), s, 'per-robot tools need a crew');
});

test('undo/redo restore level, floor and solved; edits clear redo and solved', () => {
  const s0 = createEditor();
  let s = applyAll(s0, [{ type: 'paint', x: 2, y: 1, tile: '#' }, { type: 'addFloor' }, { type: 'markSolved' }]);
  assert.equal(s.solved, true);
  const solved = s;
  s = R(s, { type: 'paint', x: 2, y: 3, tile: '#' });
  assert.equal(s.solved, false);
  s = R(s, { type: 'undo' });
  assert.deepEqual(s.level, solved.level);
  assert.equal(s.solved, true);
  s = R(s, { type: 'undo' }); // undo addFloor
  assert.equal(s.floor, 0);
  assert.equal(s.level.floors, undefined);
  s = R(s, { type: 'undo' });
  assert.deepEqual(s.level, s0.level);
  assert.ok(!canUndo(s) && canRedo(s));
  assert.equal(R(s, { type: 'undo' }), s);
  s = applyAll(s, [{ type: 'redo' }, { type: 'redo' }]);
  assert.equal(s.floor, 1);
  assert.equal(s.level.floors.length, 1);
  s = R(s, { type: 'paint', x: 4, y: 1, tile: 'r' });
  assert.ok(!canRedo(s), 'new edit drops redo');
  let t = createEditor();
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) t = R(t, { type: 'paint', x: 1 + (i % 5), y: 1, tile: i % 2 ? 'r' : 'b' });
  assert.equal(t.past.length, HISTORY_LIMIT);
});

test('every shipped level opens in the editor unchanged and survives a no-op edit round trip', () => {
  for (const lv of LEVELS) {
    let s = createEditor(lv);
    const x = 0, y = 0, orig = lv.map[0][0];
    s = applyAll(s, [{ type: 'paint', x, y, tile: orig === '#' ? '.' : '#' }, { type: 'paint', x, y, tile: orig }]);
    assert.deepEqual(validateLevel(s.level), [], lv.id);
    assert.equal(runSolution(s.level).result, 'win', lv.id);
  }
  assert.equal(blankLevel('a').id, 'a');
});
