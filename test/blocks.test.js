// Block model: lossless text <-> blocks round trip and pure editing operations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toBlocks, toText, render, format, condText, parseCondition, insertBlock, removeBlock, updateBlock,
  moveBlock, addBranch, removeBranch, renameFunction, nameProblem, freshName, palette, getAt, clampCount,
} from '../src/lang/blocks.js';
import { parse } from '../src/lang/parser.js';
import { ALL_LEVELS } from '../src/game/levels.js';
import { runLevel } from '../src/game/run.js';

/** AST without positions, to compare meaning. */
const shape = (src) => JSON.parse(JSON.stringify(parse(src), (k, v) => (k === 'line' || k === 'col' || k === 'len' ? undefined : v)));

test('every level solution survives text -> blocks -> text unchanged', () => {
  for (const l of ALL_LEVELS) {
    assert.equal(toText(toBlocks(l.solution)), l.solution, l.id);
    // and blocks -> text -> blocks is stable too
    const b = toBlocks(l.solution);
    assert.deepEqual(toBlocks(toText(b)), b, l.id);
  }
});

test('every level still wins with its solution rebuilt from blocks', () => {
  for (const l of ALL_LEVELS) {
    assert.equal(runLevel(toText(toBlocks(l.solution)), l).result, 'win', l.id);
  }
});

const MESSY = [
  '# fetch two parts',
  'DEF Fetch   # the job',
  '    Move 2',
  '\tgrab',
  'END',
  '',
  '',
  'repeat 2 times',
  '  fetch',
  '  if (clear) and not (goal or red)   # look first',
  '      move 1',
  '  ELIF ((wall))',
  '  # turn away',
  '    left',
  '  else  #   otherwise',
  '    wait',
  '  end # if',
  'end',
  'while not not true',
  'drop',
  'end',
  '',
  '',
].join('\n');

const CANON = [
  '# fetch two parts',
  'def fetch # the job',
  '  move 2',
  '  grab',
  'end',
  '',
  '',
  'repeat 2',
  '  fetch',
  '  if clear and not (goal or red) # look first',
  '    move',
  '  elif wall',
  '    # turn away',
  '    left',
  '  else #   otherwise',
  '    wait',
  '  end # if',
  'end',
  'while not not true',
  '  drop',
  'end',
].join('\n');

test('round trip keeps comments, blank lines and meaning; only layout is normalised', () => {
  assert.equal(format(MESSY), CANON);
  assert.equal(format(CANON), CANON); // idempotent
  assert.deepEqual(shape(CANON), shape(MESSY));
  const b = toBlocks(MESSY);
  assert.equal(b[0].kind, 'note');
  assert.equal(b[1].comment, ' the job');
  assert.deepEqual(b.slice(2, 4), [{ kind: 'blank' }, { kind: 'blank' }]);
  const iff = b[4].body[1];
  assert.equal(iff.kind, 'if');
  assert.equal(iff.branches.length, 2);
  assert.equal(iff.branches[1].body[0].kind, 'note');
  assert.equal(iff.elseComment, '   otherwise');
  assert.equal(iff.endComment, ' if');
});

const noCols = (c) => JSON.parse(JSON.stringify(c, (k, v) => (k === 'col' ? undefined : v)));

test('conditions print with only the parentheses they need', () => {
  const cases = {
    'clear': 'clear',
    '(clear)': 'clear',
    'a_b': null,
    'not (clear and goal) or red': 'not (clear and goal) or red',
    'clear or (goal or red)': 'clear or (goal or red)',
    '(clear or goal) or red': 'clear or goal or red',
    'clear and (goal or red)': 'clear and (goal or red)',
    'not not false': 'not not false',
    '((clear_left) and (item))': 'clear_left and item',
  };
  for (const [src, want] of Object.entries(cases)) {
    if (want === null) { assert.throws(() => parseCondition(src), /unknown sensor/); continue; }
    const c = parseCondition(src);
    assert.equal(condText(c), want, src);
    assert.deepEqual(noCols(parseCondition(condText(c))), noCols(c)); // same tree
  }
});

test('render maps each block path to its line', () => {
  const { lines } = render(toBlocks(CANON));
  assert.equal(lines.get('1'), 2);           // def fetch
  assert.equal(lines.get('1.body.1'), 4);    // grab
  assert.equal(lines.get('4.body.1'), 10);   // if
  assert.equal(lines.get('4.body.1.branches.1.body.1'), 14); // left
  assert.equal(lines.get('4.body.1.elseBody.0'), 16);        // wait
  assert.equal(lines.get('0'), undefined);   // notes have no runnable line
});

test('insert, remove, update never mutate their input', () => {
  const b0 = toBlocks('move\nrepeat 2\n  left\nend');
  const frozen = JSON.stringify(b0);
  const b1 = insertBlock(b0, [1, 'body'], 0, { kind: 'action', name: 'grab', count: 1 });
  assert.equal(toText(b1), 'move\nrepeat 2\n  grab\n  left\nend');
  const b2 = removeBlock(b1, [0]);
  assert.equal(toText(b2), 'repeat 2\n  grab\n  left\nend');
  const b3 = updateBlock(b2, [0], { count: 5 });
  assert.equal(toText(b3), 'repeat 5\n  grab\n  left\nend');
  assert.equal(toText(insertBlock(b3, [], undefined, { kind: 'action', name: 'move', count: 3 })), 'repeat 5\n  grab\n  left\nend\nmove 3');
  assert.equal(JSON.stringify(b0), frozen);
  assert.throws(() => insertBlock(b0, [1, 'body'], 0, { kind: 'def', name: 'x', body: [] }), /top level/);
});

test('moveBlock handles same-list shifts, nesting and impossible moves', () => {
  const b = toBlocks('move\nleft\nrepeat 2\n  grab\nend\nright');
  assert.equal(toText(moveBlock(b, [0], [], 2)), 'left\nmove\nrepeat 2\n  grab\nend\nright');
  assert.equal(toText(moveBlock(b, [3], [], 0)), 'right\nmove\nleft\nrepeat 2\n  grab\nend');
  // into a later sibling's body: the target path shifts when an earlier block leaves
  assert.equal(toText(moveBlock(b, [0], [2, 'body'], 1)), 'left\nrepeat 2\n  grab\n  move\nend\nright');
  // out of a body to the top level
  assert.equal(toText(moveBlock(b, [2, 'body', 0], [], 0)), 'grab\nmove\nleft\nrepeat 2\nend\nright');
  // into itself: refused
  assert.equal(moveBlock(b, [2], [2, 'body'], 0), null);
  const d = toBlocks('def a\n  move\nend\nrepeat 2\n  a\nend');
  assert.equal(moveBlock(d, [0], [1, 'body'], 0), null); // def can't nest
});

test('if branches can be added and removed', () => {
  let b = toBlocks('if wall\n  left\nend');
  b = addBranch(b, [0], 'else');
  b = insertBlock(b, [0, 'elseBody'], 0, { kind: 'action', name: 'move', count: 1 });
  b = addBranch(b, [0], 'elif', parseCondition('clear_right'));
  b = insertBlock(b, [0, 'branches', 1, 'body'], 0, { kind: 'action', name: 'right', count: 1 });
  assert.equal(toText(b), 'if wall\n  left\nelif clear_right\n  right\nelse\n  move\nend');
  assert.equal(toText(removeBranch(b, [0], 1)), 'if wall\n  left\nelse\n  move\nend');
  assert.equal(toText(removeBranch(b, [0], 'else')), 'if wall\n  left\nelif clear_right\n  right\nend');
  assert.equal(toText(removeBranch(b, [0], 0)), toText(b)); // the first branch stays
});

test('functions: rename updates calls, names are checked, fresh names are unique', () => {
  const b = toBlocks('def hop\n  move\nend\nhop\nrepeat 2\n  hop\nend');
  assert.equal(toText(renameFunction(b, 'hop', 'skip')), 'def skip\n  move\nend\nskip\nrepeat 2\n  skip\nend');
  assert.equal(nameProblem(b, 'hop'), "'hop' already exists");
  assert.equal(nameProblem(b, 'hop', 'hop'), '');
  assert.equal(nameProblem(b, 'move'), "'move' is a reserved word");
  assert.match(nameProblem(b, '2go'), /letters/);
  assert.equal(freshName(b, 'hop'), 'hop2');
  assert.equal(freshName(b), 'job');
});

test('palette follows the level tools', () => {
  const ids = (t, b) => palette(t, b).map((p) => p.id);
  assert.deepEqual(ids({ actions: ['move'], sensors: [], blocks: [] }), ['move']);
  assert.deepEqual(ids({ actions: ['move', 'left'], sensors: [], blocks: ['repeat'] }), ['move', 'left', 'repeat']);
  const all = palette({}, toBlocks('def hop\n  move\nend'));
  assert.ok(all.some((p) => p.id === 'call:hop'));
  // with no sensors unlocked, a new while/if starts from `true`
  const w = palette({ sensors: [], blocks: ['while'] }).find((p) => p.id === 'while').make([]);
  assert.deepEqual(w.cond, { type: 'const', value: true });
  const w2 = palette({ sensors: ['item', 'bin'] }).find((p) => p.id === 'if').make([]);
  assert.equal(w2.branches[0].cond.name, 'item');
  const d = palette({}).find((p) => p.id === 'def').make(toBlocks('def job\nend'));
  assert.equal(d.name, 'job2');
  assert.equal(clampCount('repeat', 0), 1);
  assert.equal(clampCount('move', 500), 99);
  assert.equal(clampCount('repeat', '7'), 7);
});

test('getAt walks paths; invalid code throws the parser error', () => {
  const b = toBlocks('repeat 2\n  move\nend');
  assert.equal(getAt(b, [0, 'body', 0]).name, 'move');
  assert.throws(() => toBlocks('repeat 2\n  mvoe\nend'), /unknown command/);
});
