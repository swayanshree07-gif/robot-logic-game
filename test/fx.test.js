import { test } from 'node:test';
import assert from 'node:assert/strict';
import { burst, step, alpha, rng, CONFETTI_COLOURS } from '../src/game/fx.js';

test('burst is seeded and scales with medals', () => {
  assert.deepEqual(burst(10, 20, { seed: 7 }), burst(10, 20, { seed: 7 }));
  assert.notDeepEqual(burst(10, 20, { seed: 7 }), burst(10, 20, { seed: 8 }));
  assert.equal(burst(0, 0).length, 60);
  assert.equal(burst(0, 0, { medals: 3 }).length, 120);
  for (const p of burst(0, 0, { seed: 3 })) {
    assert.ok(p.vy < 0, 'thrown upward');
    assert.ok(CONFETTI_COLOURS.includes(p.colour));
  }
});

test('step applies gravity and removes dead particles', () => {
  let ps = burst(100, 100, { seed: 2 });
  const vy0 = ps[0].vy;
  ps = step(ps, 0.1);
  assert.ok(ps[0].vy > vy0, 'gravity pulls down');
  for (let i = 0; i < 100 && ps.length; i++) ps = step(ps, 0.05);
  assert.equal(ps.length, 0, 'all gone within 5 s');
});

test('particles below the canvas are dropped; alpha fades', () => {
  const p = { x: 0, y: 500, vx: 0, vy: 0, rot: 0, spin: 0, size: 4, colour: '#fff', life: 2 };
  assert.equal(step([p], 0.01, 400).length, 0);
  assert.equal(alpha({ life: 2 }), 1);
  assert.equal(alpha({ life: 0.25 }), 0.5);
  assert.equal(alpha({ life: -1 }), 0);
});

test('rng stays in [0,1)', () => {
  const r = rng(42);
  for (let i = 0; i < 1000; i++) { const v = r(); assert.ok(v >= 0 && v < 1); }
});
