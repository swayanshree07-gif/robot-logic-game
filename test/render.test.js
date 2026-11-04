// Smoke test for the canvas renderer with a recording stub context (no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/world.js';
import { ALL_LEVELS as LEVELS } from '../src/game/levels.js';
import { runLevel } from '../src/game/run.js';

function stubCtx(width, height) {
  const calls = { fillRect: 0, drawImage: 0, fillText: 0 };
  const ctx = new Proxy({ calls, canvas: { width, height }, globalAlpha: 1 }, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args) => { if (k in calls) calls[k]++; if (k === 'getContext') return stubCtx(...args); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return ctx;
}
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; this.ctx = stubCtx(w, h); } getContext() { return this.ctx; } };
const { draw } = await import('../src/ui/render.js');

test('draw() renders every level, every facing, holding and bump, without throwing', () => {
  for (const lv of LEVELS) {
    const w = new World(lv);
    for (let dir = 0; dir < 4; dir++) {
      const ctx = stubCtx(640, 400);
      w.robot.holding = dir % 3; // 0, 1, 2 (badge)
      draw(ctx, w, { pose: { x: w.robot.x + 0.5, y: w.robot.y, dir, hop: 1 }, time: dir * 500, bump: dir === 3 ? { x: 0, y: 0 } : null });
      assert.equal(ctx.calls.drawImage, 1, lv.id);
      assert.ok(ctx.calls.fillRect > 50, `${lv.id} drew pixels`);
    }
  }
});

test('draw() works on a finished run and with default pose', () => {
  const lv = LEVELS.find((l) => l.id === 'proto-8');
  const res = runLevel(lv.solution, lv);
  assert.equal(res.result, 'win');
  const ctx = stubCtx(320, 200);
  draw(ctx, new World(lv));
  assert.ok(ctx.calls.fillRect > 0);
});
