// Custom levels: test-play gating ("solve before share") and the localStorage library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditor, editorReducer as R, applyAll } from '../src/game/level-editor.js';
import { testPlay, shareCheck, draftPrograms, CustomLibrary, CUSTOM_KEY, MAX_CUSTOM } from '../src/game/custom-levels.js';
import { MemoryStorage } from '../src/game/save.js';
import { LEVELS } from '../src/game/levels.js';
import { levelCrew } from '../src/world/level.js';

test('fresh draft cannot be shared; needs a solution, then a winning test-play', () => {
  let s = createEditor();
  assert.equal(shareCheck(s).ok, false);
  let t = testPlay(s);
  assert.equal(t.ok, false);
  assert.match(t.message, /solution/);
  s = R(s, { type: 'solution', robot: 0, source: 'move 2' });
  t = testPlay(s);
  assert.equal(t.ok, false);
  assert.equal(t.state.solved, false);
  assert.equal(shareCheck(t.state).ok, false);
  s = R(s, { type: 'solution', robot: 0, source: 'move 4' });
  t = testPlay(s);
  assert.equal(t.ok, true, t.message);
  assert.equal(t.state.solved, true);
  assert.equal(shareCheck(t.state).ok, true);
});

test('any edit after solving re-locks sharing; undo restores the solved snapshot', () => {
  let s = testPlay(R(createEditor(), { type: 'solution', robot: 0, source: 'move 4' })).state;
  assert.equal(s.solved, true);
  const edited = R(s, { type: 'paint', x: 3, y: 2, tile: '#' });
  assert.equal(shareCheck(edited).ok, false);
  assert.equal(testPlay(edited).ok, false); // wall now blocks the route
  assert.equal(R(edited, { type: 'undo' }).solved, true);
});

test('test-play checks every floor and reports the failing one', () => {
  let s = applyAll(createEditor(), [{ type: 'solution', robot: 0, source: 'move 4' }, { type: 'addFloor' }]);
  assert.equal(testPlay(s).ok, true);
  s = applyAll(s, [{ type: 'paint', x: 5, y: 2, tile: '#' }, { type: 'paint', x: 5, y: 1, tile: 'G' }]); // floor 2 goal moved
  const t = testPlay(s);
  assert.equal(t.ok, false);
  assert.equal(t.failed, 1);
  assert.match(t.message, /floor 2/);
});

test('invalid drafts are refused before running', () => {
  const s = R(createEditor(), { type: 'paint', x: 5, y: 2, tile: '.' }); // goal removed
  const t = testPlay(s);
  assert.equal(t.ok, false);
  assert.ok(t.problems.length > 0);
  assert.match(t.message, /Fix the level/);
});

test('every shipped level passes test-play in the editor (crews included)', () => {
  for (const lv of LEVELS) {
    const t = testPlay(createEditor(lv));
    assert.equal(t.ok, true, `${lv.id}: ${t.message}`);
    assert.equal(draftPrograms(lv).length, Math.max(1, levelCrew(lv)));
  }
});

test('library: save, list newest first, reload, reopen with solved flag, remove', () => {
  const store = new MemoryStorage();
  let clock = 1;
  const lib = new CustomLibrary(store, { now: () => clock++ });
  assert.equal(lib.nextId(), 'custom-1');
  const a = testPlay(R(createEditor(), { type: 'solution', robot: 0, source: 'move 4' })).state;
  assert.ok(lib.put(a));
  const b = R(createEditor(), { type: 'meta', id: lib.nextId(), name: 'Second' });
  assert.equal(b.level.id, 'custom-2');
  assert.ok(lib.put(b));
  const again = new CustomLibrary(store);
  assert.deepEqual(again.list().map((e) => e.level.id), ['custom-2', 'custom-1']);
  assert.equal(again.open('custom-1').solved, true);
  assert.equal(again.open('custom-2').solved, false);
  assert.equal(again.open('nope'), null);
  assert.ok(again.remove('custom-1'));
  assert.equal(new CustomLibrary(store).list().length, 1);
});

test('library survives junk, wrong version, quota errors and a full shelf', () => {
  assert.equal(new CustomLibrary(new MemoryStorage({ [CUSTOM_KEY]: '{bad' })).list().length, 0);
  assert.equal(new CustomLibrary(new MemoryStorage({ [CUSTOM_KEY]: '{"version":9,"levels":[]}' })).list().length, 0);
  const mixed = JSON.stringify({ version: 1, levels: [null, { level: { id: 'x' } }, { level: { id: 'ok', map: ['#'] }, solved: 'yes' }] });
  const l = new CustomLibrary(new MemoryStorage({ [CUSTOM_KEY]: mixed }));
  assert.deepEqual(l.list().map((e) => [e.level.id, e.solved]), [['ok', false]]);
  const tiny = new CustomLibrary(new MemoryStorage({}, { quota: 10 }));
  assert.equal(tiny.put(createEditor()), false);
  assert.match(tiny.error, /storage full/);
  const lib = new CustomLibrary(null);
  for (let i = 0; i < MAX_CUSTOM; i++) assert.ok(lib.put(R(createEditor(), { type: 'meta', id: `c-${i}` })));
  assert.equal(lib.put(R(createEditor(), { type: 'meta', id: 'one-more' })), false);
  assert.match(lib.error, /full/);
});
