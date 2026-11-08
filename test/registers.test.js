// Memory registers: set / add / sub statements and comparisons in conditions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseCondition, parseValue, MAX_REGISTERS } from '../src/lang/parser.js';
import { compileSource } from '../src/lang/compiler.js';
import { VM } from '../src/lang/vm.js';
import { lint } from '../src/lang/lint.js';
import { checkTools } from '../src/lang/restrict.js';
import { toBlocks, toText, format, palette, condText, registerNames, registerProblem } from '../src/lang/blocks.js';
import { missingTiles } from '../src/ui/code-mode.js';
import { runLevel } from '../src/game/run.js';
import { PlaySession } from '../src/game/session.js';
import { normalizeLevel } from '../src/world/level.js';

/** Run a program with a fake host; returns { vm, acts }. */
function run(src, sense = () => false) {
  const acts = [];
  const vm = new VM(compileSource(src), { act: (n) => { acts.push(n); return { ok: true }; }, sense });
  while (vm.status === 'running') vm.tick();
  return { vm, acts };
}
const regs = (vm) => Object.fromEntries(vm.registers.map((r) => [r.name, r.value]));

test('registers: set/add/sub with numbers, negatives and other registers', () => {
  const { vm, acts } = run('set a 5\nadd a 3\nsub a -2\nset b a\nsub b 20\nadd a b');
  assert.equal(vm.status, 'halted');
  assert.deepEqual(regs(vm), { a: 10 + -10, b: -10 });
  assert.deepEqual(acts, [], 'memory ops take no tick');
  assert.equal(vm.ticks, 0);
});

test('registers start at 0 and are listed in first-write order', () => {
  const p = compileSource('if b == 0\n  add a 1\nend\nset b 2');
  assert.deepEqual(p.registers, ['a', 'b']);
  const { vm } = run('if b == 0\n  add a 1\nend\nset b 2');
  assert.deepEqual(vm.registers, [{ name: 'a', value: 1 }, { name: 'b', value: 2 }]);
});

test('comparisons: every operator, both operand kinds, mixed with sensors', () => {
  const cases = [
    ['==', 3, 3, true], ['==', 3, 4, false], ['!=', 3, 4, true], ['!=', 2, 2, false],
    ['<', 2, 3, true], ['<', 3, 3, false], ['>', 4, 3, true], ['>', 3, 3, false],
    ['<=', 3, 3, true], ['<=', 4, 3, false], ['>=', 3, 3, true], ['>=', 2, 3, false],
  ];
  for (const [op, a, b, want] of cases) {
    const { acts } = run(`set x ${a}\nset y ${b}\nif x ${op} y\n  move\nend\nif x ${op} ${b}\n  left\nend`);
    assert.deepEqual(acts, want ? ['move', 'left'] : [], `${a} ${op} ${b}`);
  }
  // precedence: comparison binds tighter than not/and/or
  const { acts } = run('set n 2\nif not n == 3 and clear\n  move\nend', (s) => s === 'clear');
  assert.deepEqual(acts, ['move']);
  assert.equal(condText(parseCondition('not (n == 3) and (clear or k < -2)')), 'not n == 3 and (clear or k < -2)');
});

test('a counting loop: the classic "do it exactly N times with while"', () => {
  const { vm, acts } = run('set n 0\nwhile n < 4\n  move\n  add n 1\nend');
  assert.deepEqual(acts, ['move', 'move', 'move', 'move']);
  assert.equal(regs(vm).n, 4);
});

test('overflow is a positioned runtime error', () => {
  const { vm } = run('set n 0\nwhile true\n  add n 100\nend');
  assert.equal(vm.status, 'error');
  assert.equal(vm.error.code, 'overflow');
  assert.equal(vm.error.line, 3);
  assert.equal(vm.error.kind, 'runtime');
  assert.match(vm.error.message, /would be 1000/);
});

test('stateKey includes registers, so counting is not mistaken for a loop', () => {
  const lab = { map: ['######', '#>..G#', '######'], win: 'reach' };
  // `wait` leaves the world unchanged; only the register tells the passes apart.
  const prog = 'set n 0\nwhile n < 5\n  wait\n  add n 1\nend\nmove 3';
  const r = runLevel(prog, lab, { detectCycles: true });
  assert.equal(r.result, 'win');
  assert.equal(r.ticks, 8);
  // ...while a genuinely stuck program is still caught
  const stuck = runLevel('set n 1\nwhile n > 0\n  wait\nend', lab, { detectCycles: true });
  assert.equal(stuck.result, 'loop');
});

test('state machine: a two-state patrol that flips mode on every wall', () => {
  // corridor: Pip shuttles right, turns around at a wall, counts the trips
  // the pad is off the corridor, so the run ends when the program does
  const lab = { id: 'patrol', name: 'Patrol', solution: 'move', win: 'reach', map: ['#####', '#>..#', '###G#'] };
  const src = [
    'set trips 0',
    'while trips < 3',
    '  if wall',
    '    right', '    right',
    '    add trips 1',
    '  else',
    '    move',
    '  end',
    'end',
  ].join('\n');
  const r = runLevel(src, normalizeLevel(lab));
  assert.equal(r.error, undefined);
  assert.equal(r.result, 'fail', 'ends without reaching the pad');
  assert.equal(r.stats.move, 2 + 2 + 2);
});

test('inspect() and the session view expose registers for the debugger', () => {
  const hall = { id: 't', name: 'T', map: ['#######', '#>...G#', '#######'], win: 'reach' };
  const s = new PlaySession(hall);
  s.setSource('set n 0\nwhile n < 4\n  move\n  add n 1\nend');
  assert.deepEqual(s.view().registers, []);
  s.step(); // set n 0, then stops before/at the first move
  s.step();
  const v = s.view();
  assert.ok(v.registers.length === 1 && v.registers[0].name === 'n');
  assert.ok(v.registers[0].value >= 0 && v.registers[0].value <= 2);
  s.run();
  s.update(1e6);
  assert.equal(s.result.result, 'win');
  // reaching the pad ends the run before the last `add n 1`
  assert.deepEqual(s.view().registers, [{ name: 'n', value: 3 }]);
});

test('parser: register limit, function-name clash, reserved words', () => {
  const many = Array.from({ length: MAX_REGISTERS }, (_, i) => `set r${i} ${i}`).join('\n');
  assert.equal(parse(many).registers.length, MAX_REGISTERS);
  assert.throws(() => parse(`${many}\nset extra 1`), /only has 8 memory registers/);
  assert.throws(() => parse('def set\n  move\nend'), /reserved word/);
  assert.throws(() => parse('def n\n  move\nend\nadd n 1'), /already a function name/);
  assert.deepEqual(parseValue(' -12 '), { type: 'num', value: -12 });
  assert.equal(parseValue('k').name, 'k');
  assert.throws(() => parseValue('clear'), /number or a register/);
  assert.throws(() => parseValue('3 4'), /unexpected/);
});

test('lint: a register that is written but never read', () => {
  // n is read (by set k n), so only k is reported
  const w2 = lint(parse('set n 0\nadd n 1\nset k n\nmove'));
  assert.deepEqual(w2.map((x) => [x.code, x.line]), [['unread', 3]]);
  assert.deepEqual(lint(parse('set n 0\nwhile n < 3\n  add n 1\n  move\nend')), []);
});

test('tools: memory is a lockable block; locked levels reject set and comparisons', () => {
  const locked = { blocks: ['repeat', 'while', 'if'] };
  assert.throws(() => checkTools(parse('move\nset n 1'), locked), (e) => e.code === 'locked' && e.line === 2 && /'set'/.test(e.message));
  assert.throws(() => checkTools(parse('set n 1\nadd n 1'), { blocks: [] }), (e) => e.line === 1);
  const cmp = parse('set n 1\nwhile n < 3\n  add n 1\nend');
  assert.throws(() => checkTools(cmp, { blocks: ['while'] }), /'set'/);
  assert.doesNotThrow(() => checkTools(cmp, { blocks: ['while', 'memory'] }));
  assert.doesNotThrow(() => checkTools(cmp, {}));
  // a level that unlocks memory in its tools passes validation
  assert.deepEqual(normalizeLevel({ id: 'm', name: 'M', solution: 'move', map: ['####', '#>G#', '####'], win: 'reach', tools: { blocks: ['memory'] } }).tools.blocks, ['memory']);
});

test('blocks: lossless round trip and palette tiles for memory', () => {
  const src = [
    'set count 0 # start',
    'while count < 3 and not wall',
    '  move',
    '  add count 1',
    'end',
    'sub count -2',
    'set other count',
    'if other >= count',
    '  wait',
    'end',
  ].join('\n');
  const b = toBlocks(src);
  assert.deepEqual(b[0], { kind: 'set', name: 'count', value: { type: 'num', value: 0 }, comment: ' start' });
  assert.deepEqual(b[3], { kind: 'set', name: 'other', value: { type: 'reg', name: 'count' } });
  assert.equal(toText(b), src);
  assert.equal(format(src), src);
  assert.equal(format('SET  n   3\nwhile (n>0)\nsub n 1\nend'), 'set n 3\nwhile n > 0\n  sub n 1\nend');
  assert.deepEqual(registerNames(b), ['count', 'other']);
  assert.equal(registerProblem(b, 'move'), "'move' is a reserved word");
  assert.equal(registerProblem(b, 'k'), '');

  const ids = palette({}, b).map((p) => p.id);
  assert.ok(['set', 'add', 'sub'].every((id) => ids.includes(id)));
  assert.deepEqual(palette({}, b).find((p) => p.id === 'add').make(b), { kind: 'add', name: 'count', value: { type: 'num', value: 1 } });
  assert.ok(!palette({ blocks: ['while'] }, b).some((p) => p.group === 'memory'));
  assert.deepEqual(missingTiles(b, { blocks: ['while', 'if'] }).sort(), ['add', 'set', 'sub']);
  assert.deepEqual(missingTiles(b, {}), []);
});
