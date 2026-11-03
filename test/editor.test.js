import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineCount, lineStart, lineAt, errorRange, gutterRows, editKey } from '../src/ui/editor-model.js';

const src = 'move\nrepeat 2\n  left\nend';

test('line offsets', () => {
  assert.equal(lineCount(src), 4);
  assert.equal(lineCount(''), 1);
  assert.equal(lineStart(src, 1), 0);
  assert.equal(lineStart(src, 2), 5);
  assert.equal(lineStart(src, 99), lineStart(src, 4));
  assert.equal(lineAt(src, 0), 1);
  assert.equal(lineAt(src, 5), 2);
  assert.equal(lineAt(src, src.length), 4);
});

test('errorRange selects the column span or the whole line', () => {
  assert.deepEqual(errorRange(src, { line: 3, col: 3, length: 4 }), [16, 20]);
  assert.deepEqual(errorRange(src, { line: 2, col: 0 }), [5, 13]);
  assert.deepEqual(errorRange(src, { line: 1, col: 3, length: 50 }), [2, 4], 'clamped to line end');
  assert.deepEqual(errorRange(src, { line: 9 }), [src.length, src.length]);
  assert.equal(errorRange(src, { line: 0 }), null);
});

test('gutter marks active and error lines (error wins)', () => {
  const g = gutterRows(3, { active: 2, error: 3 });
  assert.deepEqual(g.map((r) => r.mark), ['', 'active', 'error']);
  assert.deepEqual(gutterRows(2, { active: 1, error: 1 }).map((r) => r.mark), ['error', '']);
});

test('gutter rows flag breakpoints independently of marks', () => {
  const g = gutterRows(3, { active: 2, breakpoints: new Set([2, 3, 9]) });
  assert.deepEqual(g.map((r) => [r.mark, r.bp]), [['', false], ['active', true], ['', true]]);
  assert.ok(gutterRows(2).every((r) => r.bp === false));
});

test('Tab / Shift+Tab indent and unindent', () => {
  assert.deepEqual(editKey('Tab', 'move', 0, 0), { text: '  move', start: 2, end: 2 });
  const t = 'a\nb\nc';
  const ind = editKey('Tab', t, 0, 3);
  assert.equal(ind.text, '  a\n  b\nc');
  assert.deepEqual([ind.start, ind.end], [2, 7]);
  const un = editKey('Tab', ind.text, ind.start, ind.end, { shift: true });
  assert.equal(un.text, t);
  assert.deepEqual([un.start, un.end], [0, 3]);
  assert.equal(editKey('Tab', 'x', 0, 0, { shift: true }).text, 'x');
});

test('Enter keeps indent and indents after block openers', () => {
  assert.equal(editKey('Enter', '  move', 6, 6).text, '  move\n  ');
  const r = editKey('Enter', 'repeat 3', 8, 8);
  assert.equal(r.text, 'repeat 3\n  ');
  assert.equal(r.start, 11);
  assert.equal(editKey('Enter', '  if wall', 9, 9).text, '  if wall\n    ');
  assert.equal(editKey('x', 'a', 0, 0), null);
});
