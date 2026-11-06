// Text ⇄ Blocks mode: the path the level screen takes when the player switches
// editors (enterBlocks), edits blocks (toText -> PlaySession) and runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enterBlocks, blockMark, missingTiles, blockedMessage } from '../src/ui/code-mode.js';
import { toText, insertBlock, palette, render } from '../src/lang/blocks.js';
import { ALL_LEVELS, LEVELS } from '../src/game/levels.js';
import { PlaySession } from '../src/game/session.js';
import { normalizeLevel } from '../src/world/level.js';

const playToEnd = (level, src) => {
  const s = new PlaySession(level, { speed: 'instant' });
  s.setSource(src);
  s.run();
  while (s.state === 'running') s.update(0);
  return s;
};

test('every solution switches to blocks unchanged and still wins when run from the block text', () => {
  for (const l of ALL_LEVELS) {
    const r = enterBlocks(l.solution);
    assert.ok(r.ok, l.id);
    assert.equal(r.text, l.solution, `${l.id}: solutions are already tidy`);
    const s = playToEnd(l, toText(r.blocks));
    assert.equal(s.result.result, 'win', l.id);
  }
});

test('every played solution can be built from the level\'s own tile tray', () => {
  for (const l of LEVELS) {
    const { blocks } = enterBlocks(l.solution);
    assert.deepEqual(missingTiles(blocks, normalizeLevel(l).tools), [], l.id);
  }
});

test('a locked command shows up as a missing tile', () => {
  const l = LEVELS[0]; // 1-1: move only
  const { blocks } = enterBlocks('move\nright\nrepeat 2\n  move\nend');
  assert.deepEqual(missingTiles(blocks, normalizeLevel(l).tools).sort(), ['repeat', 'right']);
});

test('building a program tile by tile from an empty tray gives the same text as typing it', () => {
  const l = LEVELS.find((x) => /repeat/.test(x.solution) && !/def/.test(x.solution));
  const tray = palette(normalizeLevel(l).tools);
  const tile = (id) => tray.find((p) => p.id === id).make([]);
  // move / repeat 3 [ move, right ] -- built through the same ops the UI uses
  let b = [];
  b = insertBlock(b, [], 0, tile('move'));
  b = insertBlock(b, [], 1, { ...tile('repeat'), count: 3 });
  b = insertBlock(b, [1, 'body'], 0, tile('move'));
  b = insertBlock(b, [1, 'body'], 1, tile('right'));
  assert.equal(toText(b), 'move\nrepeat 3\n  move\n  right\nend');
  assert.equal(enterBlocks(toText(b)).text, toText(b));
});

test('messy text is tidied on the way in without moving any line', () => {
  const src = 'MOVE 2\n\n  repeat 3 times\n    right   # turn\n  END\n\n\n';
  const r = enterBlocks(src);
  assert.ok(r.ok);
  assert.equal(r.text, 'move 2\n\nrepeat 3\n  right # turn\nend');
  const { lines } = render(r.blocks);
  assert.equal(lines.get('2'), 3); // repeat is still on line 3
  assert.equal(lines.get('2.body.0'), 4);
});

test('text that does not parse stays in text mode with a positioned error', () => {
  const r = enterBlocks('move\nrepeat 2\n  mvoe\nend');
  assert.equal(r.ok, false);
  assert.equal(r.error.line, 3);
  assert.match(r.error.message, /move/);
  assert.match(blockedMessage('Line 3: oops'), /^Can't show this program as blocks/);
  assert.equal(enterBlocks('repeat 2\n  move').ok, false); // missing end
});

test('blockMark follows the session: running line, breakpoint, error, nothing while editing', () => {
  const l = LEVELS[0];
  const s = new PlaySession(l, { speed: 'slow' });
  s.setSource('move\nmove\nmove');
  assert.deepEqual(blockMark(s.view()), { line: 0, kind: 'active' });
  s.setBreakpoints([2]);
  s.run();
  while (s.state === 'running') s.update(1000);
  assert.equal(s.state, 'paused');
  assert.deepEqual(blockMark(s.view()), { line: 2, kind: 'break' });
  s.step();
  assert.deepEqual(blockMark(s.view()), { line: 2, kind: 'active' });

  const bad = new PlaySession(l, { speed: 'instant' });
  bad.setSource('move\nright');
  bad.run();
  while (bad.state === 'running') bad.update(0);
  assert.equal(bad.view().state, 'done');
  assert.deepEqual(blockMark(bad.view()), { line: 2, kind: 'error' });
});
