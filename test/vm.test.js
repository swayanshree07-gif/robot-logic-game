import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSource } from '../src/lang/compiler.js';
import { VM, MAX_CALL_DEPTH } from '../src/lang/vm.js';

// A fake host that records actions and answers sensors from a script.
function fakeHost(sensors = {}) {
  const acts = [];
  return {
    acts,
    act(name) { acts.push(name); return { ok: true }; },
    sense(name) { const v = sensors[name]; return typeof v === 'function' ? v(acts) : Boolean(v); },
  };
}
const runAll = (src, host) => {
  const vm = new VM(compileSource(src), host);
  let ev;
  do { ev = vm.tick(); } while (ev.type === 'action');
  return { vm, ev };
};

test('repeat runs body exactly N times, nested repeats multiply', () => {
  const h = fakeHost();
  runAll('repeat 3\n  move\n  repeat 2\n    left\n  end\nend', h);
  assert.equal(h.acts.filter((a) => a === 'move').length, 3);
  assert.equal(h.acts.filter((a) => a === 'left').length, 6);
});

test('while loops until the sensor changes', () => {
  const h = fakeHost({ clear: (acts) => acts.length < 5 });
  const { ev } = runAll('while clear\n  move\nend\nright', h);
  assert.equal(ev.type, 'halt');
  assert.deepEqual(h.acts, ['move', 'move', 'move', 'move', 'move', 'right']);
});

test('if / elif / else picks exactly one branch', () => {
  for (const [sensors, want] of [[{ wall: 1 }, 'left'], [{ item: 1 }, 'grab'], [{}, 'wait']]) {
    const h = fakeHost(sensors);
    runAll('if wall\n  left\nelif item\n  grab\nelse\n  wait\nend', h);
    assert.deepEqual(h.acts, [want]);
  }
});

test('functions and calls inside loops', () => {
  const h = fakeHost();
  runAll('def step\n  move\n  right\nend\nrepeat 2\n  step\nend\nstep', h);
  assert.deepEqual(h.acts, ['move', 'right', 'move', 'right', 'move', 'right']);
});

test('recursion depth is limited', () => {
  const { ev } = runAll('def f\n  f\nend\nf', fakeHost());
  assert.equal(ev.type, 'error');
  assert.match(ev.error.message, new RegExp(`limit ${MAX_CALL_DEPTH}`));
  assert.equal(ev.error.line, 2);
});

test('loops that never act are detected', () => {
  const { ev } = runAll('while true\nend', fakeHost());
  assert.equal(ev.type, 'error');
  assert.match(ev.error.message, /loops without doing anything/);
});

test('step() reports source lines in execution order', () => {
  const vm = new VM(compileSource('repeat 2\n  move\nend'), fakeHost());
  const lines = [];
  while (vm.status === 'running') { lines.push(vm.line); vm.step(); }
  // push(1) loop(1) act(2) jmp(0) loop(1) act(2) jmp(0) loop(1) halt(0)
  assert.deepEqual(lines, [1, 1, 2, 0, 1, 2, 0, 1, 0]);
});

test('action failure stops the VM with the line number', () => {
  const host = { act: (n) => (n === 'move' ? { ok: false, error: 'bump' } : { ok: true }), sense: () => false };
  const { ev, vm } = runAll('left\nmove\nleft', host);
  assert.equal(ev.type, 'error');
  assert.equal(ev.error.line, 2);
  assert.equal(vm.status, 'error');
});
