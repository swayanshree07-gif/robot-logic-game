// Day 8: functions polish (recursion, call counts, function panel data, lint
// warnings) and par scores / stars.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSource } from '../src/lang/compiler.js';
import { VM, MAX_CALL_DEPTH, recursionHint } from '../src/lang/vm.js';
import { parse } from '../src/lang/parser.js';
import { lint, analyze } from '../src/lang/lint.js';
import { runLevel } from '../src/game/run.js';
import { PlaySession, resultBanner } from '../src/game/session.js';
import { scoreRun, starText, parLine, bestStars } from '../src/game/score.js';
import { validateLevel } from '../src/world/level.js';

// a straight hall: Pip, then n tiles with the pad on the last one
const hall = (n) => ({ id: 't', name: 'T', map: ['#'.repeat(n + 3), `#>${'.'.repeat(n - 1)}G#`, '#'.repeat(n + 3)], win: 'reach' });

test('recursion that stops on a sensor works (a loop written as recursion)', () => {
  const lv = hall(10);
  const src = 'def go\n  if not goal\n    move\n    go\n  end\nend\ngo';
  const r = runLevel(src, lv);
  assert.equal(r.result, 'win');
  assert.equal(r.ticks, 10);
});

test('recursion deeper than the limit stops with a recursion error, pointing at the call', () => {
  const lv = hall(80);
  const src = 'def go\n  if not goal\n    move\n    go\n  end\nend\ngo';
  const r = runLevel(src, lv);
  assert.equal(r.result, 'error');
  assert.equal(r.error.code, 'recursion');
  assert.equal(r.error.line, 4);
  assert.equal(r.ticks, MAX_CALL_DEPTH); // 64 nested calls run (one move each), the 65th fails
  assert.match(r.error.message, /'go' calling itself forever/);
});

test('recursion hint names every function in the cycle', () => {
  const c = (...names) => names.map((name) => ({ name }));
  assert.match(recursionHint(c('a', 'a', 'a'), 'a'), /'a' calling itself/);
  assert.match(recursionHint(c('a', 'b', 'a', 'b'), 'a'), /^'a' and 'b' keep calling each other/);
  assert.match(recursionHint(c('a', 'b', 'c', 'a', 'b', 'c'), 'a'), /^'a', 'b' and 'c' keep/);
  // only the innermost calls count: a one-off 'start' at the bottom is not part of the cycle
  assert.match(recursionHint(c('start', ...Array(20).fill('spin')), 'spin'), /'spin' calling itself/);
});

test('VM counts calls per function and reports defs for the function panel', () => {
  const host = { act: () => ({ ok: true }), sense: () => false };
  const src = 'repeat 3\n  hop\nend\nspin\ndef spin\n  left\nend\ndef hop\n  move\n  spin\nend';
  const prog = compileSource(src);
  assert.deepEqual(prog.defs, [{ name: 'spin', line: 5 }, { name: 'hop', line: 8 }]);
  const vm = new VM(prog, host);
  vm.tick(); // first move, inside hop
  assert.deepEqual(vm.inspect().functions, [
    { name: 'spin', line: 5, calls: 0, active: 0 },
    { name: 'hop', line: 8, calls: 1, active: 1 },
  ]);
  vm.tick(); // left, inside hop > spin
  assert.deepEqual(vm.inspect().functions.map((f) => f.active), [1, 1]);
  let ev;
  do { ev = vm.tick(); } while (ev.type === 'action');
  assert.deepEqual(vm.inspect().functions.map((f) => [f.name, f.calls, f.active]), [['spin', 4, 0], ['hop', 3, 0]]);
});

test('lint: unused, self-only and dead-chain functions', () => {
  const codes = (src) => lint(parse(src)).map((w) => `${w.code}@${w.line}:${w.col}`);
  assert.deepEqual(codes('move\ndef hop\n  move\nend'), ['unused@2:5']);
  assert.deepEqual(codes('hop\ndef hop\n  move\nend'), []);
  assert.deepEqual(codes('def spin\n  left\n  spin\nend\nmove'), ['unused@1:5']);
  assert.match(lint(parse('def spin\n  left\n  spin\nend\nmove'))[0].message, /only calls itself/);
  // a and b only call each other; c is only called by a
  const w = lint(parse('move\ndef a\n  b\n  c\nend\ndef b\n  a\nend\ndef c\n  left\nend'));
  assert.deepEqual(w.map((x) => x.code), ['unused', 'unused', 'unused']);
  assert.match(w[2].message, /'c' is only called from functions that never run/);
  // recursion reached from main is fine
  assert.deepEqual(codes('go\ndef go\n  if clear\n    move\n    go\n  end\nend'), []);
  // called only from a used function: fine
  assert.deepEqual(codes('a\ndef a\n  b\nend\ndef b\n  move\nend'), []);
});

test('lint: empty blocks and repeat 1', () => {
  const codes = (src) => lint(parse(src)).map((w) => `${w.code}@${w.line}`);
  assert.deepEqual(codes('repeat 1\n  move\nend'), ['repeat1@1']);
  assert.deepEqual(codes('repeat 3\nend\nwhile clear\nend\nif wall\nend'), ['empty@1', 'empty@3', 'empty@5']);
  assert.deepEqual(codes('if wall\nelse\n  move\nend'), []); // empty then-branch with an else is a fair "unless"
  assert.deepEqual(codes('hop\ndef hop\nend'), ['empty@2']);
  const w = lint(parse('move\nrepeat 1\n  move\nend'))[0];
  assert.equal(w.kind, 'warning');
  assert.equal(w.message, "Line 2, col 1: 'repeat 1' runs its body just once — the repeat can go");
  // every World 1 solution is warning-free (checked in levels.test.js too)
});

test('analyze: parse error, warnings and defs without running', () => {
  const bad = analyze('mvoe');
  assert.ok(bad.error);
  assert.deepEqual(bad.warnings, []);
  const ok = analyze('hop\ndef hop\n  move\nend\ndef idle\n  wait\nend');
  assert.equal(ok.error, null);
  assert.deepEqual(ok.defs, [{ name: 'hop', line: 2 }, { name: 'idle', line: 5 }]);
  assert.deepEqual(ok.warnings.map((w) => w.code), ['unused']);
});

test('session view: functions before and during a run, warnings only while editing', () => {
  const s = new PlaySession(hall(4));
  s.setSource('repeat 2\n  hop\nend\ndef hop\n  move 2\nend\ndef unused\n  left\nend');
  let v = s.view();
  assert.deepEqual(v.functions, [{ name: 'hop', line: 4, calls: 0, active: 0 }, { name: 'unused', line: 7, calls: 0, active: 0 }]);
  assert.deepEqual(v.warnings.map((w) => w.code), ['unused']);
  s.step();
  v = s.view();
  assert.deepEqual(v.warnings, []);
  assert.deepEqual(v.functions[0], { name: 'hop', line: 4, calls: 1, active: 1 });
});

test('scoreRun: stars for winning and for meeting each par', () => {
  const par = { steps: 10, size: 4 };
  assert.equal(scoreRun({ result: 'win', ticks: 10, size: 4 }, par).stars, 3);
  assert.equal(scoreRun({ result: 'win', ticks: 9, size: 9 }, par).stars, 2);
  assert.equal(scoreRun({ result: 'win', ticks: 12, size: 9 }, par).stars, 1);
  assert.equal(scoreRun({ result: 'fail', ticks: 1, size: 1 }, par).stars, 0);
  assert.equal(scoreRun({ result: 'win', ticks: 5, size: 5 }, undefined).stars, 1);
  assert.equal(starText(2), '★★☆');
  assert.equal(parLine(scoreRun({ result: 'win', ticks: 12, size: 4 }, par)), 'Steps 12 (par 10) · Size 4 (par 4 ✓)');
  assert.equal(parLine(scoreRun({ result: 'win', ticks: 3, size: 2 }, null)), 'Steps 3 · Size 2');
  assert.equal(bestStars(2, { stars: 1 }), 2);
  assert.equal(bestStars(null, { stars: 3 }), 3);
});

test('win banner carries stars and the par line', () => {
  const lv = { ...hall(4), par: { steps: 4, size: 1 } };
  const s = new PlaySession(lv, { speed: 'instant' });
  s.setSource('move\nmove 3');
  s.run();
  s.update(0);
  const b = resultBanner(s.result);
  assert.equal(b.stars, 2);
  assert.equal(b.par, 'Steps 4 (par 4 ✓) · Size 2 (par 1)');
  const noPar = new PlaySession(hall(4), { speed: 'instant' });
  noPar.setSource('move 4'); noPar.run(); noPar.update(0);
  assert.equal(resultBanner(noPar.result).par, '');
});

test('level format: par is validated', () => {
  const base = { id: 'p', name: 'P', map: ['#####', '#>.G#', '#####'], win: 'reach', solution: 'move 2' };
  assert.deepEqual(validateLevel({ ...base, par: { steps: 2, size: 1 } }), []);
  assert.deepEqual(validateLevel({ ...base, par: { steps: 0 } }), ['par.steps must be a whole number above 0']);
  assert.deepEqual(validateLevel({ ...base, par: { lines: 2 } }), ["unknown par field 'lines' (use steps, size)"]);
  assert.deepEqual(validateLevel({ ...base, par: 3 }), ['par must be { steps, size }']);
});
