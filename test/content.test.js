// Content lint (Day 26): every world has a story, every level a brief and a
// hint, and the hint helpers give a route that really wins on solo levels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLDS, LEVELS, levelPlace } from '../src/game/levels.js';
import { routeHint, trailTiles, hintTiers, hintMessage, storyBeats, traceActions } from '../src/game/hints.js';
import { floorCount, floorLevel, levelCrew } from '../src/world/level.js';
import { World } from '../src/world/world.js';

const words = (s) => s.trim().split(/\s+/).length;

test('every world has a name, an intro blurb and an outro', () => {
  assert.equal(WORLDS.length, 5);
  for (const w of WORLDS) {
    assert.ok(w.name, w.id);
    assert.ok(words(w.blurb) >= 8 && words(w.blurb) <= 45, `${w.id} blurb length`);
    assert.ok(words(w.outro) >= 8 && words(w.outro) <= 45, `${w.id} outro length`);
    assert.ok(w.blurb.length <= 280 && w.outro.length <= 280);
  }
});

test('every level has a brief and a hint that are not the same text', () => {
  for (const l of LEVELS) {
    assert.ok(l.name && l.name.length <= 28, `${l.id} name`);
    assert.ok(l.brief && words(l.brief) >= 6, `${l.id} brief`);
    assert.ok(l.hint && words(l.hint) >= 4, `${l.id} hint`);
    assert.notEqual(l.hint.trim(), l.brief.trim(), l.id);
    assert.doesNotMatch(l.brief + l.hint, /TODO|FIXME|lorem/i, l.id);
    assert.equal((l.brief.match(/`/g) || []).length % 2, 0, `${l.id}: unbalanced backticks`);
  }
});

test('level names are unique', () => {
  const names = LEVELS.map((l) => l.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

test('story beats: intro on the first level of a world, outro on the last', () => {
  for (const w of WORLDS) {
    const first = storyBeats(levelPlace(w.levels[0]));
    const last = storyBeats(levelPlace(w.levels.at(-1)));
    assert.equal(first.intro, w.blurb);
    assert.equal(last.outro, w.outro);
    assert.deepEqual(storyBeats(levelPlace(w.levels[1])), { intro: '', outro: '' });
  }
  assert.deepEqual(storyBeats(null), { intro: '', outro: '' });
});

test('hint tiers: text for all, route only for solo levels', () => {
  for (const l of LEVELS) {
    const t = hintTiers(l);
    assert.equal(t[0], 'text', l.id);
    assert.equal(t.includes('route'), levelCrew(l) === 1, l.id);
  }
});

test('route hint on every floor of every solo level wins (or reaches a target)', () => {
  let solutions = 0, targets = 0;
  for (const l of LEVELS) {
    if (levelCrew(l) > 1) { assert.equal(routeHint(l), null); continue; }
    for (let f = 0; f < floorCount(l); f++) {
      const r = routeHint(l, f);
      assert.ok(r, `${l.id} floor ${f + 1}: no route`);
      assert.equal(r.trail.length, r.actions.length + 1, `${l.id}: whole plan replays`);
      const w = new World(floorLevel(l, f));
      for (const a of r.actions) assert.ok(w.act(a).ok);
      if (r.kind === 'solution') { assert.ok(w.isWon(), `${l.id} floor ${f + 1}`); solutions++; } else targets++;
      const tiles = trailTiles(r.trail);
      assert.deepEqual(tiles[0], { x: r.trail[0].x, y: r.trail[0].y });
      assert.equal(new Set(tiles.map((t) => `${t.x},${t.y}`)).size, tiles.length);
      assert.match(hintMessage(l, 'route', r), /Route shown/);
    }
  }
  assert.ok(solutions > targets, `${solutions} solution routes, ${targets} target routes`);
});

test('traceActions stops at the first failed action', () => {
  const l = LEVELS[0];
  const t = traceActions(l, ['move', 'move', 'left', 'left', 'move', 'move', 'move']);
  assert.ok(t.length >= 4);
  assert.equal(hintMessage(l, 'text'), `Hint: ${l.hint}`);
  assert.equal(hintMessage(l, 'route', null), 'No route hint here.');
});
