// World 1 played the way the UI plays it: through PlaySession at Instant speed,
// with the result banner, stars and "next level" offer the player sees.
// Complements test/levels.test.js (which checks the levels with runLevel/solver).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD1 } from '../src/game/worlds/w1.js';
import { LEVELS, levelPlace } from '../src/game/levels.js';
import { PlaySession, resultBanner } from '../src/game/session.js';
import { solve, actionsToCog } from '../src/game/solver.js';
import { mergeBest, recordStars } from '../src/game/score.js';

/** Run `source` on `level` like the page does; returns { result, banner }. */
function play(level, source) {
  const s = new PlaySession(level, { speed: 'instant' });
  s.setSource(source);
  s.run();
  for (let i = 0; i < 100 && s.state === 'running'; i++) s.update(16);
  assert.equal(s.state, 'done', `${level.id}: run did not finish`);
  const index = LEVELS.indexOf(level);
  return { result: s.result, banner: resultBanner(s.result, { hasNext: index < LEVELS.length - 1 }) };
}

test('World 1: every solution wins in the session, earns the size star and offers the next level', () => {
  for (const level of WORLD1.levels) {
    const { result, banner } = play(level, level.solution);
    assert.equal(banner.kind, 'win', level.id);
    assert.equal(banner.next, true, `${level.id} should offer a next level`);
    assert.ok(result.score.size.ok, `${level.id}: solution should meet size par`);
    assert.ok(banner.stars >= 2, level.id);
    assert.match(banner.par, /Size \d+ \(par \d+ ✓\)/, level.id);
  }
});

test('World 1: three stars are reachable on every level (best of solution + fastest route)', () => {
  for (const level of WORLD1.levels) {
    const fastest = actionsToCog(solve(level).actions);
    const a = play(level, level.solution).result.score;
    const b = play(level, fastest).result.score;
    assert.ok(b.steps.ok, `${level.id}: the solver's route should meet steps par`);
    // par stars add up across runs: one run may earn steps, another size
    assert.equal(recordStars(mergeBest(mergeBest(null, a), b)), 3, level.id);
    assert.equal(recordStars(mergeBest(mergeBest(null, b), a)), 3, `${level.id} (other order)`);
  }
});

test('World 1 ends by leading into the next world', () => {
  const last = WORLD1.levels.at(-1);
  const next = LEVELS[LEVELS.indexOf(last) + 1];
  assert.ok(next, 'a level follows 1-8');
  assert.notEqual(levelPlace(next).world, WORLD1);
  assert.equal(levelPlace(next).n, 1);
});

test('World 1: typical first mistakes end with a clear banner, not a silent stop', () => {
  const byId = Object.fromEntries(WORLD1.levels.map((l) => [l.id, l]));
  const cases = [
    ['w1-1', 'move 5', 'fail', /pad|goal|reach/i],            // one tile short (overshooting a pad still wins: reaching it ends the run)
    ['w1-2', 'move 4', 'error', /wall|bump/i],                 // overshoot the corner into the lockers
    ['w1-2', 'move 3\nleft\nmove 2', 'error', /wall|bump/i],   // turned the wrong way
    ['w1-3', 'move', 'error', /wall|bump/i],                   // forgot to turn around
    ['w1-1', 'right\nmove 6', 'error', /unlocked/],            // command not unlocked yet
    ['w1-5', 'drop', 'error', /./],                            // nothing to drop
  ];
  for (const [id, src, kind, text] of cases) {
    const { banner } = play(byId[id], src);
    assert.equal(banner.kind, kind, `${id} ${JSON.stringify(src)} → ${banner.title}: ${banner.text}`);
    assert.match(`${banner.title} ${banner.text}`, text, `${id} ${JSON.stringify(src)}`);
  }
});

test('World 1 "Low Battery": a route with spare turns runs the battery flat', () => {
  const level = WORLD1.levels.find((l) => l.id === 'w1-7');
  const fastest = solve(level).actions;
  // same route plus a wasted full turn at the start: 4 extra steps
  const { banner } = play(level, actionsToCog(['right', 'right', 'right', 'right', ...fastest]));
  assert.equal(banner.kind, 'fail');
  assert.equal(banner.title, 'Battery flat');
});

test('World 1 briefs only show commands that are unlocked on that level', () => {
  for (const level of WORLD1.levels) {
    const allowed = new Set([...level.tools.actions, ...level.tools.blocks, 'end']);
    const spans = [...level.brief.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    for (const span of spans) {
      const words = span.split(/\s+/).filter((w) => /^[a-z_]+$/.test(w));
      for (const w of words) assert.ok(allowed.has(w), `${level.id}: brief shows \`${span}\` but '${w}' is locked`);
    }
    assert.ok(level.hint && level.hint.length > 10, `${level.id} has a hint`);
  }
});

test('best record: par stars from different runs add up, a later loss takes nothing away', () => {
  const run = (stars, steps, size) => ({ stars, steps: { ok: steps }, size: { ok: size } });
  let best = mergeBest(null, run(2, false, true));
  assert.deepEqual(best, { won: true, steps: false, size: true });
  best = mergeBest(best, run(2, true, false));
  assert.equal(recordStars(best), 3);
  assert.deepEqual(mergeBest(best, run(0, false, false)), best);
  assert.equal(recordStars(mergeBest('garbage', run(0, false, false))), 0);
  assert.equal(recordStars(null), 0);
  assert.equal(recordStars(mergeBest(null, run(1, false, false))), 1);
});

test('scripts/level-report.mjs prints every World 1 level and finds no problems', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, ['scripts/level-report.mjs', '--md'], { encoding: 'utf8', timeout: 60000 });
  for (const l of WORLD1.levels) assert.match(out, new RegExp(`\\| ${l.id} \\| ${l.name} \\|`));
  assert.doesNotMatch(out, /!!/);
});
