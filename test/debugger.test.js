// Step-debugger foundations: VM line traces, breakpoints, session pause/resume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSource } from '../src/lang/compiler.js';
import { VM, breakableLines } from '../src/lang/vm.js';
import { PlaySession } from '../src/game/session.js';

// A host that never blocks: records actions, `clear` is true for the first n checks.
function host(clearFor = 0) {
  const h = { acts: [], checks: 0 };
  h.act = (name) => { h.acts.push(name); return { ok: true }; };
  h.sense = () => h.checks++ < clearFor;
  return h;
}

/** Lines of every action until halt, plus every break, for a VM with breakpoints. */
function trace(src, { bps = null, clearFor = 0, max = 100 } = {}) {
  const vm = new VM(compileSource(src), host(clearFor));
  const out = [];
  let resume = false;
  for (let i = 0; i < max; i++) {
    const ev = vm.tick({ breakpoints: bps && new Set(bps), resume });
    resume = ev.type === 'break';
    if (ev.type === 'action') out.push(ev.line);
    else if (ev.type === 'break') out.push(`b${ev.line}`);
    else return out;
  }
  throw new Error('did not halt');
}

const PROG = [
  'repeat 2',   // 1
  '  move',     // 2
  '  hop',      // 3
  'end',        // 4
  'while clear',// 5
  '  left',     // 6
  'end',        // 7
  'def hop',    // 8
  '  right',    // 9
  '  wait',     // 10
  'end',        // 11
].join('\n');

test('action line trace follows repeat, calls and while', () => {
  assert.deepEqual(trace(PROG, { clearFor: 2 }), [2, 9, 10, 2, 9, 10, 6, 6]);
  assert.deepEqual(trace('move 3\nleft'), [1, 1, 1, 2]);
});

test('breakableLines lists lines with instructions only', () => {
  assert.deepEqual([...breakableLines(compileSource(PROG))].sort((a, b) => a - b), [1, 2, 3, 5, 6, 9, 10]);
});

test('breakpoints pause before the line, once per arrival', () => {
  // body line: pause before every move
  assert.deepEqual(trace(PROG, { bps: [2], clearFor: 2 }), ['b2', 2, 9, 10, 'b2', 2, 9, 10, 6, 6]);
  // repeat header (push + loop on one line) pauses once on entry, then at each loop-back
  assert.deepEqual(trace(PROG, { bps: [1] }), ['b1', 2, 9, 10, 'b1', 2, 9, 10, 'b1']);
  // while header pauses before each condition check
  assert.deepEqual(trace(PROG, { bps: [5], clearFor: 2 }), [2, 9, 10, 2, 9, 10, 'b5', 6, 'b5', 6, 'b5']);
  // inside a function
  assert.deepEqual(trace(PROG, { bps: [10] }), [2, 9, 'b10', 10, 2, 9, 'b10', 10]);
  // a line with no code never triggers
  assert.deepEqual(trace(PROG, { bps: [4, 8, 11] }), [2, 9, 10, 2, 9, 10]);
});

test('call stack and loop counters are visible at a breakpoint', () => {
  const vm = new VM(compileSource(PROG), host());
  assert.equal(vm.tick({ breakpoints: new Set([9]) }).type, 'action'); // move on line 2
  const ev = vm.tick({ breakpoints: new Set([9]) });
  assert.deepEqual(ev, { type: 'break', line: 9 });
  assert.deepEqual(vm.callStack, ['hop']);
  assert.deepEqual(vm.loopCounters, [1]); // one more pass after this one
  assert.equal(vm.ticks, 1);
});

const LEVEL = { id: 't', name: 'T', map: ['#######', '#>...G#', '#######'], win: 'reach' };
const SRC = 'repeat 2\n  move\nend\nmove 2'; // move, move (loop) then move 2

test('session: Run pauses at a breakpoint, Resume continues, Step moves one action', () => {
  const s = new PlaySession(LEVEL, { speed: 'instant' });
  s.setSource(SRC);
  s.toggleBreakpoint(2);
  s.run();
  s.update(16);
  assert.equal(s.state, 'paused');
  assert.equal(s.view().atBreak, 2);
  assert.equal(s.view().ticks, 0);
  assert.equal(s.view().runLabel, 'Resume');
  s.run(); s.update(16);
  assert.equal(s.state, 'paused');
  assert.equal(s.view().ticks, 1); // stopped again before the second pass
  s.step();
  assert.equal(s.view().ticks, 2);
  assert.equal(s.view().atBreak, 0);
  s.run(); s.update(16);
  assert.equal(s.state, 'done');
  assert.equal(s.result.result, 'win');
});

test('session: breakpoints survive reset and edits; toggling off runs straight through', () => {
  const s = new PlaySession(LEVEL, { speed: 'instant' });
  s.setSource(SRC);
  assert.equal(s.toggleBreakpoint(4), true);
  s.run(); s.update(16);
  assert.deepEqual([s.state, s.view().ticks, s.line], ['paused', 2, 4]);
  s.reset();
  s.setSource(`${SRC}\n`);
  assert.ok(s.breakpoints.has(4));
  assert.equal(s.toggleBreakpoint(4), false);
  s.run(); s.update(16);
  assert.equal(s.result.result, 'win');
});

test('session: Step from the start passes a breakpoint on the first line', () => {
  const s = new PlaySession(LEVEL);
  s.setSource('move 4');
  s.setBreakpoints([1]);
  s.step();
  assert.equal(s.view().ticks, 1);
  // Run from paused moves past the current position first, then pauses
  // before line 1 runs again (move 4 repeats on one line)
  s.run(); s.update(1000);
  assert.equal(s.state, 'paused');
  assert.equal(s.view().ticks, 2);
});
