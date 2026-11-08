import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ART_PX, PIP, PART, PART_SMALL, mirror, spriteProblems, eachPixel, layout,
  tileHash, wallMask, easeInOut, tweenMs, Animator,
} from '../src/ui/art.js';
import { World } from '../src/world/world.js';
import { ALL_LEVELS as LEVELS } from '../src/game/levels.js';

test('sprites are well-formed and the right size', () => {
  assert.equal(PIP.length, 4);
  for (const [name, s] of [['N', PIP[0]], ['E', PIP[1]], ['S', PIP[2]], ['W', PIP[3]], ['part', PART]]) {
    assert.deepEqual(spriteProblems(s), [], name);
    assert.equal(s.length, ART_PX, `${name} height`);
    assert.equal(s[0].length, ART_PX, `${name} width`);
  }
  assert.deepEqual(spriteProblems(PART_SMALL), []);
  assert.deepEqual(spriteProblems(['ab', 'a']).length, 2); // width + unknown 'b'
});

test('four distinct facings; west mirrors east', () => {
  assert.equal(new Set(PIP.map((s) => s.join('\n'))).size, 4);
  assert.deepEqual(PIP[3], mirror(PIP[1]));
  assert.deepEqual(mirror(mirror(PIP[1])), PIP[1]);
});

test('Pip leaves the tile corners free so a goal pad stays visible', () => {
  for (const s of PIP) {
    for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15]]) assert.equal(s[y][x], '.');
  }
});

test('eachPixel visits only opaque pixels with colours', () => {
  const seen = [];
  eachPixel(['.k', 'a.'], (x, y, c) => seen.push([x, y, c]));
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map(([x, y]) => [x, y]), [[1, 0], [0, 1]]);
  assert.ok(seen.every(([, , c]) => /^#[0-9a-f]{6}$/i.test(c)));
});

test('layout scales by whole art pixels and centres the board', () => {
  const L = layout({ width: 7, height: 3 }, 640, 400);
  assert.equal(L.cell, 80);           // 91 rounded down to a multiple of 16
  assert.equal(L.scale, 5);
  assert.equal(L.ox, (640 - 560) / 2);
  assert.equal(L.oy, (400 - 240) / 2);
  const small = layout({ width: 40, height: 40 }, 640, 400); // too tight to snap
  assert.equal(small.cell, 10);
  for (const lv of LEVELS) {
    const w = new World(lv, { maxRobots: 4 });
    const l = layout(w, 640, 400);
    assert.ok(l.cell * w.width <= 640 && l.cell * w.height <= 400, lv.id);
    assert.ok(Number.isInteger(l.scale), `${lv.id} scale ${l.scale}`);
  }
});

test('tileHash is deterministic, in range and varied', () => {
  assert.equal(tileHash(3, 4), tileHash(3, 4));
  const vals = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) vals.push(tileHash(x, y));
  assert.ok(vals.every((v) => v >= 0 && v < 1));
  assert.ok(new Set(vals).size > 90);
  assert.notEqual(tileHash(1, 1, 0), tileHash(1, 1, 7));
});

test('wallMask reads neighbours (outside counts as wall)', () => {
  const w = new World({ map: ['###', '#>#', '#.#', '###'] });
  assert.equal(wallMask(w, 0, 0), 0b1111);  // corner: N and W outside, E and S walls
  assert.equal(wallMask(w, 1, 0), 0b1011);  // top middle: floor to the south
  assert.equal(wallMask(w, 0, 1), 0b1101);  // left: floor to the east
});

test('easing and tween lengths', () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.equal(easeInOut(0.5), 0.5);
  assert.equal(tweenMs(0), 0);
  assert.equal(tweenMs(30), 0);
  assert.equal(tweenMs(300), 240);
  assert.equal(tweenMs(600), 320);
  assert.equal(tweenMs(300, true), 0);
});

test('Animator tweens a move and snaps on a new world', () => {
  const w = new World({ map: ['#####', '#>..#', '#####'] });
  const a = new Animator();
  a.sync(w, 200);
  assert.deepEqual(a.pose(), { x: 1, y: 1, dir: 1, hop: 0, bumping: false });
  w.act('move');
  a.sync(w, 200);
  assert.equal(a.pose().x, 1);
  a.update(100);
  assert.equal(a.pose().x, 1.5);
  a.update(100);
  assert.equal(a.pose().x, 2);
  assert.equal(a.busy, false);
  // a new run (fresh world) snaps back
  const w2 = new World({ map: ['#####', '#>..#', '#####'] });
  a.sync(w2, 200);
  assert.equal(a.pose().x, 1);
});

test('Animator: turns swap facing halfway with a hop; bumps lurch and return', () => {
  const w = new World({ map: ['####', '#>.#', '####'] });
  const a = new Animator();
  a.sync(w, 100);
  w.act('right');
  a.sync(w, 100);
  a.update(25);
  assert.equal(a.pose().dir, 1);
  a.update(30);
  assert.equal(a.pose().dir, 2);
  assert.ok(a.pose().hop > 0);
  a.update(100);
  assert.equal(a.pose().hop, 0);

  w.act('left');
  w.act('move');
  a.sync(w, 0); // several events in one sync tween straight to the newest pose
  assert.deepEqual([a.pose().x, a.pose().dir], [2, 1]);
  w.act('move'); // bump into the east wall from x=2
  a.sync(w, 100);
  assert.equal(a.pose().bumping, true);
  a.update(a.dur / 2);
  const mid = a.pose();
  assert.ok(mid.x > 2 && mid.x < 2.3, `lurch x ${mid.x}`);
  a.update(a.dur);
  assert.deepEqual(a.pose(), { x: 2, y: 1, dir: 1, hop: 0, bumping: false });
});

test('Animator with zero duration snaps immediately (instant speed / reduced motion)', () => {
  const w = new World({ map: ['#####', '#>..#', '#####'] });
  const a = new Animator();
  a.sync(w, 0);
  w.act('move'); w.act('move');
  a.sync(w, 0);
  assert.equal(a.pose().x, 3);
  assert.equal(a.busy, false);
});
