// Versioned progress saving (src/game/save.js) and the world-map model
// (src/game/progress.js), with a fake Map-backed storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveStore, MemoryStorage, SAVE_KEY, SAVE_VERSION, importLegacy, sanitize } from '../src/game/save.js';
import { mapModel, openLevels, continueIndex, totals, isOpen, OPEN_AHEAD, UPCOMING_WORLDS } from '../src/game/progress.js';
import { WORLDS, LEVELS } from '../src/game/levels.js';
import { PlaySession } from '../src/game/session.js';

const win = (steps, size) => ({ stars: 1 + steps + size, steps: { ok: steps }, size: { ok: size } });
const saved = (storage) => JSON.parse(storage.getItem(SAVE_KEY));

test('fresh storage: empty v1 save, nothing written until something changes', () => {
  const st = new MemoryStorage();
  const s = new SaveStore(st);
  assert.deepEqual(s.notes, ['fresh']);
  assert.equal(st.getItem(SAVE_KEY), null);
  assert.equal(s.stars('w1-1'), 0);
  s.setSetting('speed', 'fast');
  assert.equal(saved(st).v, SAVE_VERSION);
  assert.equal(saved(st).settings.speed, 'fast');
});

test('records survive a reload and par stars add up across runs', () => {
  const st = new MemoryStorage();
  let s = new SaveStore(st);
  assert.deepEqual(s.recordRun('w1-8', win(true, false)), { before: 0, after: 2 });
  assert.deepEqual(s.recordRun('w1-8', win(false, true)), { before: 2, after: 3 });
  assert.deepEqual(s.recordRun('w1-8', { stars: 0 }), { before: 3, after: 3 }); // a loss changes nothing
  s.setDraft('w1-8', 'move 2\nright');
  s.setBreakpoints('w1-8', [3, 1, 3, -1, 2.5]);
  s.last = 'w1-8';
  s = new SaveStore(st);
  assert.equal(s.stars('w1-8'), 3);
  assert.equal(s.draft('w1-8'), 'move 2\nright');
  assert.deepEqual(s.breakpoints('w1-8'), [1, 3]);
  assert.equal(s.last, 'w1-8');
  s.setDraft('w1-8', '');
  s.setBreakpoints('w1-8', []);
  assert.equal(s.draft('w1-8'), null);
  assert.deepEqual(saved(st).bps, {});
});

test('old loose keys are imported once and left in place', () => {
  const st = new MemoryStorage({
    'ferrolab.best.w1-1': JSON.stringify({ won: true, steps: true, size: false }),
    'ferrolab.stars.w1-2': '2',
    'ferrolab.stars.w1-3': 'nonsense',
    'ferrolab.draft.w1-1': 'move 3',
    'ferrolab.bp.w1-1': '[2, "x", 4]',
    'ferrolab.bp.w1-2': '{broken',
    'ferrolab.speed': 'slow',
    'ferrolab.mode': 'blocks',
    'other.app': 'untouched',
  });
  const s = new SaveStore(st);
  assert.deepEqual(s.notes, ['imported']);
  assert.equal(s.stars('w1-1'), 2);
  assert.equal(s.stars('w1-2'), 2); // only a count was known
  assert.equal(s.won('w1-3'), false);
  assert.equal(s.draft('w1-1'), 'move 3');
  assert.deepEqual(s.breakpoints('w1-1'), [2, 4]);
  assert.equal(s.setting('speed'), 'slow');
  assert.equal(s.setting('mode'), 'blocks');
  assert.equal(st.getItem('ferrolab.stars.w1-2'), '2');
  // a later run on an imported count keeps the count as a floor and adds par stars
  assert.deepEqual(s.recordRun('w1-2', win(false, false)), { before: 2, after: 2 });
  assert.deepEqual(s.recordRun('w1-2', win(true, true)), { before: 2, after: 3 });
  // once a save exists the old keys are not read again
  st.setItem('ferrolab.stars.w1-4', '3');
  assert.equal(new SaveStore(st).stars('w1-4'), 0);
});

test('corrupt save is backed up and replaced; malformed parts are dropped', () => {
  const st = new MemoryStorage({ [SAVE_KEY]: '{"v":1, oops' });
  const s = new SaveStore(st);
  assert.deepEqual(s.notes, ['corrupt']);
  assert.equal(st.getItem(`${SAVE_KEY}.bad`), '{"v":1, oops');
  assert.equal(saved(st).v, 1);
  for (const bad of ['null', '[]', '"text"', '{"levels":{}}']) {
    assert.deepEqual(new SaveStore(new MemoryStorage({ [SAVE_KEY]: bad })).notes, ['corrupt'], bad);
  }
  const clean = sanitize({
    v: 1,
    levels: { a: { won: true, steps: 1 }, b: 'x', c: { won: false, steps: true }, d: { legacy: 9 } },
    drafts: { a: 'move', b: 42, c: 'x'.repeat(30000) },
    bps: { a: [4, 4, 0, 'y'], b: 'no' },
    settings: { speed: 'fast', evil: { nested: 1 } },
    last: 7,
  });
  assert.deepEqual(clean.levels, { a: { won: true, steps: true, size: false }, d: { won: true, steps: false, size: false, legacy: 3 } });
  assert.deepEqual(clean.drafts, { a: 'move' });
  assert.deepEqual(clean.bps, { a: [4] });
  assert.deepEqual(clean.settings, { speed: 'fast' });
  assert.equal(clean.last, null);
});

test('a save from a newer version is used but never overwritten', () => {
  const text = JSON.stringify({ v: SAVE_VERSION + 1, levels: { 'w1-1': { won: true } }, future: [1, 2] });
  const st = new MemoryStorage({ [SAVE_KEY]: text });
  const s = new SaveStore(st);
  assert.deepEqual(s.notes, ['newer']);
  assert.equal(s.readOnly, true);
  assert.equal(s.won('w1-1'), true);
  s.recordRun('w1-2', win(true, true));
  assert.equal(s.stars('w1-2'), 3); // works for this session
  assert.equal(st.getItem(SAVE_KEY), text);
});

test('full or blocked storage: errors are reported, not thrown, and play goes on', () => {
  const st = new MemoryStorage({}, { quota: 60 });
  const s = new SaveStore(st);
  s.setDraft('w1-1', 'move\n'.repeat(50));
  assert.match(s.lastError, /full/);
  assert.equal(s.draft('w1-1').length, 250); // still kept in memory
  const blocked = { length: 0, key: () => null, getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const b = new SaveStore(blocked);
  b.recordRun('w1-1', win(true, true));
  assert.equal(b.stars('w1-1'), 3);
  assert.match(b.lastError, /could not be saved/);
  const mem = new SaveStore(null);
  mem.setSetting('mode', 'blocks');
  assert.equal(mem.setting('mode'), 'blocks');
  assert.equal(importLegacy(blocked).v, 1);
});

test('reset forgets progress but keeps settings', () => {
  const st = new MemoryStorage();
  const s = new SaveStore(st);
  s.setSetting('speed', 'fast');
  s.recordRun('w1-1', win(true, true));
  s.setDraft('w1-1', 'move');
  s.last = 'w1-1';
  s.resetProgress();
  const again = new SaveStore(st);
  assert.equal(again.stars('w1-1'), 0);
  assert.equal(again.draft('w1-1'), null);
  assert.equal(again.last, null);
  assert.equal(again.setting('speed'), 'fast');
});

test('unlocking: up to two unsolved levels are open at once', () => {
  const levels = LEVELS;
  const wonSet = new Set();
  const won = (id) => wonSet.has(id);
  assert.equal(OPEN_AHEAD, 2);
  assert.deepEqual(openLevels(levels, won).slice(0, 4), [true, true, false, false]);
  wonSet.add(levels[1].id); // skipped 1-1, solved 1-2
  assert.deepEqual(openLevels(levels, won).slice(0, 4), [true, true, true, false]);
  wonSet.add(levels[10].id); // won out of order (e.g. via a dev URL): it stays open, nothing else opens
  assert.deepEqual(openLevels(levels, won).slice(0, 12), [true, true, true, false, false, false, false, false, false, false, true, false]);
  levels.forEach((l) => wonSet.add(l.id));
  assert.ok(openLevels(levels, won).every(Boolean));
  // playing straight through: every level's solution opens the next one
  const st = new SaveStore(new MemoryStorage());
  for (let i = 0; i < levels.length; i++) {
    assert.ok(isOpen(levels, st, i), `${levels[i].id} open`);
    const s = new PlaySession(levels[i], { speed: 'instant' });
    s.setSource(levels[i].solution);
    s.run();
    while (s.state === 'running') s.update(0);
    assert.equal(s.result.result, 'win', levels[i].id);
    st.recordRun(levels[i].id, s.result.score);
  }
});

test('map model: worlds, labels, star totals, upcoming worlds, continue', () => {
  const st = new SaveStore(new MemoryStorage());
  let m = mapModel(WORLDS, st, { current: 'w1-1' });
  assert.equal(m.length, WORLDS.length + UPCOMING_WORLDS.length);
  assert.equal(m[0].levels[0].label, '1-1');
  assert.equal(m[1].levels[7].label, '2-8');
  assert.equal(m[1].levels[0].index, WORLDS[0].levels.length);
  assert.ok(m[0].levels[0].current);
  assert.equal(m[0].open, true);
  assert.equal(m[1].open, false);
  assert.ok(m.slice(WORLDS.length).every((w) => !w.built && !w.open));
  assert.deepEqual(totals(m), { stars: 0, maxStars: LEVELS.length * 3, solved: 0, count: LEVELS.length });
  assert.equal(continueIndex(LEVELS, st, null), 0);

  for (const l of WORLDS[0].levels) st.recordRun(l.id, win(true, l.id !== 'w1-8'));
  m = mapModel(WORLDS, st);
  assert.equal(m[0].stars, 23);
  assert.equal(m[0].solved, 8);
  assert.equal(m[1].open, true);
  assert.equal(totals(m).stars, 23);
  const w2first = WORLDS[0].levels.length;
  assert.equal(continueIndex(LEVELS, st, 'w1-3'), w2first); // last level solved → next unsolved
  assert.equal(continueIndex(LEVELS, st, LEVELS[w2first + 1].id), w2first + 1); // last level still open
  assert.equal(continueIndex(LEVELS, st, LEVELS[w2first + 5].id), w2first); // locked → first open
});
