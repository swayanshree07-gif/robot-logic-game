import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medalFor, scoreRun, mergeBest, recordMedals, medalText, betterMedal } from '../src/game/score.js';
import { SaveStore, sanitize } from '../src/game/save.js';
import { mapModel } from '../src/game/progress.js';
import { WORLDS } from '../src/game/levels.js';

class Mem { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); } key(i) { return [...this.m.keys()][i]; } get length() { return this.m.size; } }

test('medal thresholds: gold <= par, silver <= 1.5x par, else bronze', () => {
  assert.equal(medalFor(true, 10, 10), 'gold');
  assert.equal(medalFor(true, 9, 10), 'gold');
  assert.equal(medalFor(true, 15, 10), 'silver');
  assert.equal(medalFor(true, 16, 10), 'bronze');
  assert.equal(medalFor(true, 5, null), 'bronze');
  assert.equal(medalFor(false, 1, 10), null);
  assert.equal(betterMedal('silver', 'gold'), 'gold');
  assert.equal(betterMedal(null, 'bronze'), 'bronze');
});

test('scoreRun gives a medal per metric', () => {
  const sc = scoreRun({ result: 'win', ticks: 14, size: 20 }, { steps: 10, size: 8 });
  assert.equal(sc.steps.medal, 'silver');
  assert.equal(sc.size.medal, 'bronze');
  assert.equal(scoreRun({ result: 'fail', ticks: 3, size: 3 }, { steps: 10, size: 8 }).steps.medal, null);
});

test('best values are kept per metric across runs', () => {
  const par = { steps: 10, size: 8 };
  let rec = mergeBest(null, scoreRun({ result: 'win', ticks: 30, size: 8 }, par));
  rec = mergeBest(rec, scoreRun({ result: 'win', ticks: 12, size: 20 }, par));
  rec = mergeBest(rec, scoreRun({ result: 'fail', ticks: 1, size: 1 }, par));
  assert.equal(rec.bestSteps, 12);
  assert.equal(rec.bestSize, 8);
  assert.deepEqual(recordMedals(rec, par), { steps: 'silver', size: 'gold' });
  assert.match(medalText(recordMedals(rec, par)), /Steps 🥈 silver · Size 🥇 gold/);
  assert.equal(medalText(recordMedals(null, par)), '');
});

test('old star-only records migrate: par flag = gold, plain win = bronze', () => {
  const s = sanitize({ v: 1, levels: { a: { won: true, steps: true, size: false }, b: { won: true, legacy: 2 } } });
  assert.deepEqual(recordMedals(s.levels.a, { steps: 5, size: 5 }), { steps: 'gold', size: 'bronze' });
  assert.deepEqual(recordMedals(s.levels.b, { steps: 5, size: 5 }), { steps: 'bronze', size: 'bronze' });
});

test('SaveStore saves best values and reloads medals', () => {
  const mem = new Mem();
  const par = { steps: 10, size: 4 };
  const st = new SaveStore(mem);
  st.recordRun('x', scoreRun({ result: 'win', ticks: 10, size: 6 }, par));
  const again = new SaveStore(mem);
  assert.deepEqual(again.medals('x', par), { steps: 'gold', size: 'silver' });
  const bad = sanitize({ v: 1, levels: { y: { won: true, bestSteps: -3, bestSize: 'x' } } });
  assert.equal(bad.levels.y.bestSteps, undefined);
});

test('map model carries medals for every built level', () => {
  const st = new SaveStore(null);
  const first = WORLDS[0].levels[0];
  st.recordRun(first.id, scoreRun({ result: 'win', ticks: first.par.steps, size: first.par.size }, first.par));
  const m = mapModel(WORLDS, st);
  assert.deepEqual(m[0].levels[0].medals, { steps: 'gold', size: 'gold' });
  assert.deepEqual(m[0].levels[1].medals, { steps: null, size: null });
});
