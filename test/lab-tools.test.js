// Lab palette tools: click → reducer action, pixel → cell, win form; plus a full
// "paint, solve, test-play, save, reopen" flow driven only through tool actions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor, blankLevel, editorReducer as R, editedMap } from '../src/game/level-editor.js';
import { LAB_TOOLS, toolAction, cellAt, winFromForm, toolById } from '../src/game/lab-tools.js';
import { testPlay, shareCheck, CustomLibrary } from '../src/game/custom-levels.js';
import { MemoryStorage } from '../src/game/save.js';
import { layout } from '../src/ui/art.js';
import { validateLevel } from '../src/world/level.js';

test('every palette tile is a valid map char and ids are unique', () => {
  const ids = new Set(LAB_TOOLS.map((t) => t.id));
  assert.equal(ids.size, LAB_TOOLS.length);
  for (const t of LAB_TOOLS) if (!t.robot) assert.equal(toolAction(createEditor(), t.id, 0, 0)?.tile ?? '#', t.tile);
  assert.equal(toolById('nope'), null);
});

test('tool actions: paint, no-op on same tile, robot place and turn, out of range', () => {
  const s = createEditor();
  assert.deepEqual(toolAction(s, 'wall', 2, 1), { type: 'paint', x: 2, y: 1, tile: '#' });
  assert.equal(toolAction(s, 'wall', 0, 0), null);
  assert.equal(toolAction(s, 'wall', 99, 0), null);
  assert.deepEqual(toolAction(s, 'robot', 1, 2), { type: 'robot', x: 1, y: 2, dir: 2 }); // '>' turns to 'v'
  assert.deepEqual(toolAction(s, 'robot', 2, 1), { type: 'robot', x: 2, y: 1, dir: 1 });
  const turned = R(s, toolAction(s, 'robot', 1, 2));
  assert.equal(editedMap(turned)[2][1], 'v');
});

test('cellAt maps canvas pixels to grid cells using the renderer layout', () => {
  const L = layout({ width: 7, height: 5 }, 640, 440);
  assert.deepEqual(cellAt(L, 7, 5, L.ox + 1, L.oy + 1), { x: 0, y: 0 });
  assert.deepEqual(cellAt(L, 7, 5, L.ox + L.cell * 6.5, L.oy + L.cell * 4.5), { x: 6, y: 4 });
  assert.equal(cellAt(L, 7, 5, L.ox - 1, L.oy), null);
  assert.equal(cellAt(L, 7, 5, L.ox + L.cell * 7, L.oy), null);
});

test('win form: count only kept for deliver', () => {
  assert.deepEqual(winFromForm('reach', '3'), [{ type: 'reach' }]);
  assert.deepEqual(winFromForm('collect', '2'), [{ type: 'collect' }]);
  assert.deepEqual(winFromForm('deliver', '2'), [{ type: 'deliver', count: 2 }]);
  assert.deepEqual(winFromForm('deliver', ''), [{ type: 'deliver' }]);
});

test('editor flow through tools: build a deliver level, test-play gates sharing, library round trip', () => {
  let s = createEditor(blankLevel('custom-1'));
  const use = (id, x, y) => { const a = toolAction(s, id, x, y); if (a) s = R(s, a); };
  use('part', 2, 2); use('bin', 5, 2); use('floor', 5, 2); use('bin', 5, 2);
  s = R(s, { type: 'win', rules: winFromForm('deliver', '') });
  assert.deepEqual(validateLevel(s.level, { requireSolution: false }), []);
  assert.equal(shareCheck(s).ok, false);
  s = R(s, { type: 'solution', robot: 0, source: 'move 1\ngrab\nmove 2\ndrop' });
  let t = testPlay(s);
  assert.equal(t.ok, false, 'drop one tile short of the bin');
  s = R(s, { type: 'solution', robot: 0, source: 'move 1\ngrab\nmove 3\ndrop' });
  t = testPlay(s);
  assert.equal(t.ok, true, t.message);
  s = t.state;
  assert.equal(shareCheck(s).ok, true);
  const store = new MemoryStorage();
  const lib = new CustomLibrary(store);
  assert.equal(lib.put(s), true);
  const back = new CustomLibrary(store).open('custom-1');
  assert.equal(back.solved, true);
  assert.equal(shareCheck(back).ok, true);
  use('wall', 3, 1);
  assert.equal(shareCheck(s).ok, false, 'painting re-locks sharing');
});
