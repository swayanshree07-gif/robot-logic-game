import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, CogError } from '../src/lang/parser.js';

const err = (src) => {
  try { parse(src); } catch (e) { assert.ok(e instanceof CogError, `expected CogError, got ${e}`); return e; }
  assert.fail('expected a parse error');
};

test('parses simple actions with comments and blank lines', () => {
  const ast = parse('# hello\nmove\n\nLeft  # turn\nmove 3');
  assert.deepEqual(ast.main.map((s) => [s.name, s.count, s.line]), [['move', 1, 2], ['left', 1, 4], ['move', 3, 5]]);
});

test('parses nested repeat / while / if-elif-else', () => {
  const ast = parse(`repeat 2 times
  while clear and not goal
    move
  end
  if wall
    left
  elif clear_right or (item)
    right
  else
    wait
  end
end`);
  const rep = ast.main[0];
  assert.equal(rep.type, 'repeat');
  assert.equal(rep.count, 2);
  assert.equal(rep.body[0].type, 'while');
  assert.deepEqual(rep.body[0].cond, { type: 'and', left: { type: 'sensor', name: 'clear' }, right: { type: 'not', arg: { type: 'sensor', name: 'goal' } } });
  const iff = rep.body[1];
  assert.equal(iff.branches.length, 2);
  assert.equal(iff.branches[1].cond.type, 'or');
  assert.equal(iff.elseBody[0].name, 'wait');
});

test('functions can be called before they are defined', () => {
  const ast = parse('hop\ndef hop\n  move\nend');
  assert.equal(ast.main[0].type, 'call');
  assert.ok(ast.functions.hop);
});

test('reports errors with line numbers', () => {
  assert.equal(err('move\nrepeat 3\nmove').line, 2);
  assert.equal(err('end').line, 1);
  assert.equal(err('move\njump').line, 2);
  assert.match(err('move\njump').message, /unknown command or function 'jump'/);
  assert.equal(err('repeat x\nend').line, 1);
  assert.equal(err('repeat 0\nend').line, 1);
  assert.equal(err('while\nend').line, 1);
  assert.match(err('while banana\nend').message, /unknown sensor 'banana'/);
  assert.equal(err('else').line, 1);
  assert.equal(err('repeat 2\ndef f\nend\nend').line, 2);
  assert.match(err('def move\nend').message, /reserved/);
  assert.match(err('def f\nend\ndef f\nend').message, /already defined/);
  assert.match(err('left 2').message, /takes no arguments/);
  assert.match(err('if clear\nelse\nend\nend').message, /without an open block/);
  assert.match(err('while (clear\nend').message, /missing '\)'/);
});
