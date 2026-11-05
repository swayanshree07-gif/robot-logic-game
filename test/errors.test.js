// Error-message snapshot tests.
//
// Every case's fully formatted message (with caret snippet) is compared with
// test/snapshots/errors.snap.txt. After an intentional wording change run
//   UPDATE_SNAPSHOTS=1 node --test test/errors.test.js
// and review the diff of the snapshot file before committing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { parse } from '../src/lang/parser.js';
import { formatError, suggest, editDistance } from '../src/lang/errors.js';
import { runLevel } from '../src/game/run.js';

const SNAP = new URL('./snapshots/errors.snap.txt', import.meta.url);
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';

const LAB = { map: ['######', '#>..G#', '#....#', '######'], win: 'reach' };

// [name, source, 'syntax' | runLevel options]
const CASES = [
  // --- typos and unknown words
  ['typo in command', 'move\nmvoe 2'],
  ['typo in function call', 'def zigzag\n  move\nend\nzigzga'],
  ['unknown command, no suggestion', 'teleport'],
  ['typo in sensor', 'while clera\n  move\nend'],
  ['unknown sensor, no suggestion', 'if banana\n  move\nend'],
  ['sensor used as command', 'goal'],
  ['word from another language: for', 'for i in range(3)\n  move\nend'],
  ['word from another language: turn', 'turn left'],
  ['endif instead of end', 'if wall\n  left\nendif'],
  // --- block structure
  ['missing end', 'move\nrepeat 3\n  move\n  left'],
  ['missing end of nested if', 'while clear\n  if goal\n    wait\nend'],
  ['extra end', 'move\nend'],
  ['end with a word after it', 'repeat 2\n  move\nend repeat'],
  ['else without if', 'move\nelse\n  left'],
  ['else if', 'if wall\n  left\nelse if goal\n  wait\nend'],
  ['two elses', 'if wall\n  left\nelse\n  right\nelse\n  wait\nend'],
  ['elif after else', 'if wall\n  left\nelse\n  right\nelif goal\n  wait\nend'],
  ['else with condition', 'if wall\n  left\nelse clear\n  move\nend'],
  ['python colon', 'while clear:\n  move\nend'],
  ['curly braces', 'repeat 3 {\n  move\n}'],
  ['body on the same line', 'while clear move\nend'],
  ['def inside a loop', 'repeat 2\n  def hop\n    move\n  end\nend'],
  // --- arguments and numbers
  ['repeat without number', 'repeat\n  move\nend'],
  ['repeat forever', 'repeat forever\n  move\nend'],
  ['repeat a sensor', 'repeat clear\n  move\nend'],
  ['repeat zero', 'repeat 0\n  move\nend'],
  ['repeat too big', 'repeat 5000\n  move\nend'],
  ['repeat with command after count', 'repeat 3 move\nend'],
  ['move too far', 'move 100'],
  ['move negative', 'move -2'],
  ['turn with a count', 'left 2'],
  ['action with brackets', 'move()'],
  ['line starts with a number', '3 move'],
  ['stray character', '  ?'],
  // --- conditions
  ['while without condition', 'while\n  move\nend'],
  ['condition ends with and', 'if clear and\n  move\nend'],
  ['C-style operators', 'if !wall && clear\n  move\nend'],
  ['comparison', 'if wall == true\n  left\nend'],
  ['two sensors without and', 'if clear goal\n  move\nend'],
  ['unclosed bracket', 'while (clear and not goal\n  move\nend'],
  ['stray closing bracket', 'while clear)\n  move\nend'],
  ['number as condition', 'if 1\n  move\nend'],
  // --- functions
  ['reserved function name', 'def move\n  left\nend'],
  ['function defined twice', 'def hop\n  move\nend\n\ndef hop\n  left\nend'],
  ['def without name', 'def\n  move\nend'],
  ['def with brackets', 'def hop()\n  move\nend'],
  ['call with brackets', 'def hop\n  move\nend\nhop()'],
  // --- runtime (run on a small lab map)
  ['runtime: bump into wall', 'move\nleft\nmove', {}],
  ['runtime: grab nothing', 'move\ngrab', {}],
  ['runtime: endless recursion', 'def again\n  again\nend\nagain', {}],
  ['runtime: mutual recursion', 'def ping\n  pong\nend\ndef pong\n  ping\nend\nping', {}],
  ['runtime: idle loop', 'while not goal\n  if wall\n    left\n  end\nend', {}],
  ['runtime: going in circles', 'while true\n  right\nend', {}],
  ['runtime: out of steps', 'repeat 999\n  wait\nend', { maxTicks: 50 }],
];

function render(src, opt) {
  if (opt === undefined) {
    try { parse(src); } catch (e) { return formatError(src, e); }
    return '(no error)';
  }
  const r = runLevel(src, LAB, opt);
  return r.error ? `[${r.result}] ${formatError(src, r.error)}` : `(no error: ${r.result})`;
}

function readSnapshots() {
  if (!existsSync(SNAP)) return {};
  const out = {};
  for (const block of readFileSync(SNAP, 'utf8').split(/^### /m).slice(1)) {
    const nl = block.indexOf('\n');
    out[block.slice(0, nl)] = block.slice(nl + 1).replace(/\n+$/, '');
  }
  return out;
}

test('error messages match snapshots', () => {
  const actual = Object.fromEntries(CASES.map(([name, src, opt]) => [name, render(src, opt)]));
  assert.equal(new Set(CASES.map((c) => c[0])).size, CASES.length, 'case names must be unique');
  if (UPDATE) {
    mkdirSync(new URL('./snapshots/', import.meta.url), { recursive: true });
    const header = '# Generated by test/errors.test.js (UPDATE_SNAPSHOTS=1). Review diffs by eye.\n\n';
    writeFileSync(SNAP, header + Object.entries(actual).map(([k, v]) => `### ${k}\n${v}\n`).join('\n'));
    return;
  }
  const snaps = readSnapshots();
  for (const [name, text] of Object.entries(actual)) {
    assert.ok(name in snaps, `no snapshot for '${name}' — run with UPDATE_SNAPSHOTS=1`);
    assert.equal(text, snaps[name], `snapshot mismatch: ${name}`);
  }
  for (const name of Object.keys(snaps)) assert.ok(name in actual, `stale snapshot '${name}'`);
});

test('every syntax case really is an error with a position', () => {
  for (const [name, src, opt] of CASES) {
    if (opt !== undefined) continue;
    let e = null;
    try { parse(src); } catch (x) { e = x; }
    assert.ok(e, `${name}: expected an error`);
    assert.ok(e.line >= 1, `${name}: no line`);
    assert.ok(e.col >= 1, `${name}: no column`);
  }
});

test('suggestions: transpositions, short words and no wild guesses', () => {
  assert.equal(editDistance('mvoe', 'move'), 1);
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(suggest('mvoe', ['move', 'left']), 'move');
  assert.equal(suggest('rigth', ['move', 'right']), 'right');
  assert.equal(suggest('clera', ['clear', 'wall']), 'clear');
  assert.equal(suggest('xyz', ['move', 'left']), null);
  assert.equal(suggest('mo', ['move']), null); // 2 edits on a short word is a guess
});

test('formatError draws a caret under the problem', () => {
  const src = 'move\n  while clera\nend';
  let e;
  try { parse(src); } catch (x) { e = x; }
  assert.equal(formatError(src, e), [
    "Line 2, col 9: unknown sensor 'clera' — did you mean 'clear'?",
    ' 2 |   while clera',
    '   |         ^^^^^',
  ].join('\n'));
});
