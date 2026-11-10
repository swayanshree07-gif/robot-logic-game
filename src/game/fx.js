// Win celebration particles (pure, seeded, no DOM). The UI draws `particles`
// each frame on an overlay canvas; this module only does the physics.

/** Small seeded PRNG (mulberry32) so bursts are reproducible in tests. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CONFETTI_COLOURS = ['#ffcc4d', '#5ad1a0', '#6aa8ff', '#ff7a7a', '#d59bff'];
export const GRAVITY = 520; // px/s²
export const DRAG = 0.6;    // fraction of speed lost per second

/**
 * Burst of `n` confetti pieces from (x, y), thrown upward in a fan.
 * medals (0..3) adds more pieces for better results.
 */
export function burst(x, y, { n = 60, seed = 1, medals = 0 } = {}) {
  const r = rng(seed);
  const count = n + medals * 20;
  return Array.from({ length: count }, () => {
    const ang = -Math.PI / 2 + (r() - 0.5) * Math.PI * 0.9;
    const speed = 220 + r() * 320;
    return {
      x, y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      rot: r() * Math.PI * 2,
      spin: (r() - 0.5) * 12,
      size: 4 + r() * 5,
      colour: CONFETTI_COLOURS[Math.floor(r() * CONFETTI_COLOURS.length)],
      life: 1.6 + r() * 1.2, // seconds left
    };
  });
}

/** Advance particles by dt seconds; returns the ones still alive and on screen. */
export function step(particles, dt, height = Infinity) {
  const keep = Math.max(0, 1 - DRAG * dt);
  const out = [];
  for (const p of particles) {
    const q = {
      ...p,
      vx: p.vx * keep,
      vy: p.vy * keep + GRAVITY * dt,
      rot: p.rot + p.spin * dt,
      life: p.life - dt,
    };
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    if (q.life > 0 && q.y < height + 20) out.push(q);
  }
  return out;
}

/** Opacity for a particle: fades out over its last half-second. */
export const alpha = (p) => Math.max(0, Math.min(1, p.life / 0.5));
