// Signals between crew robots: send / wait NAME, the signal sensor, deadlocks,
// tool locks, lint across the crew, and the block editor round trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, RESERVED } from '../src/lang/parser.js';
import { compileSource } from '../src/lang/compiler.js';
import { checkTools } from '../src/lang/restrict.js';
import { lintCrew } from '../src/lang/lint.js';
import { toBlocks, toText, format, palette, signalProblem } from '../src/lang/blocks.js';
import { runCrew, CrewRunner } from '../src/game/crew.js';
import { runLevel } from '../src/game/run.js';
import { WORLDS } from '../src/game/levels.js';

const lvl = (map, win = 'reach', extra = {}) => ({ id: 't', name: 't', map, win, ...extra });

test('parser: send/wait NAME are signal statements, plain wait stays an action', () => {
  const ast = parse('send go\nwait go\nwait\nwait  ready_2 # hi');
  assert.deepEqual(ast.main.map((s) => [s.type, s.op || s.name, s.name]), [
    ['signal', 'send', 'go'], ['signal', 'wait', 'go'], ['action', 'wait', 'wait'], ['signal', 'wait', 'ready_2'],
  ]);
  assert.ok(RESERVED.includes('send'));
  assert.throws(() => parse('send'), /'send' needs a signal name/);
  assert.throws(() => parse('send move'), /'move' is a reserved word/);
  assert.throws(() => parse('send a b'), /unexpected 'b' after the signal name/);
  assert.throws(() => parse('wait 3'), /'wait' takes no arguments/);
  assert.throws(() => parse('def send\nend'), /reserved/);
  const code = compileSource('send go\nwait go').code;
  assert.deepEqual(code.slice(0, 2).map((i) => [i.op, i.kind, i.name]), [['sig', 'send', 'go'], ['sig', 'wait', 'go']]);
});

test('hand-off: robot 2 waits until robot 1 sends, then goes', () => {
  const map = ['>..G', '####', '>..G'];
  const r = runCrew(['move 3\nsend done', 'wait done\nmove 3'], lvl(map));
  assert.equal(r.result, 'win');
  // send costs no tick: robot 2 is blocked rounds 1-3, sees the signal in round 4 and moves in rounds 4-6.
  assert.equal(r.ticks, 6);
  assert.deepEqual(r.signals, {});
});

test('blocked robots stand still: the round event says what they wait for', () => {
  const c = new CrewRunner(['move\nsend go', 'wait go\nmove'], lvl(['>.G', '>.G']));
  const ev = c.tick();
  assert.equal(ev.type, 'round');
  assert.equal(ev.events[0].type, 'action');
  assert.deepEqual([ev.events[1].type, ev.events[1].name], ['blocked', 'go']);
  assert.equal(c.world.robots[1].x, 0);
  assert.equal(c.vms[1].ticks, 0, 'waiting does not drain the battery');
});

test('signals count up: two sends let two waits through, extras stay pending', () => {
  const map = ['>...G', '#####', '>...G'];
  const r = runCrew(['send a\nsend a\nsend a\nmove 4', 'wait a\nwait a\nmove 4'], lvl(map));
  assert.equal(r.result, 'win');
  assert.deepEqual(r.signals, { a: 1 });
  // Order inside a round: robot 2 acts after robot 1, so it sees robot 1's sends at once.
  assert.equal(r.ticks, 4);
});

test('signal sensor is true while any signal is pending (and does not use it up)', () => {
  const map = ['>.G', '###', '>.G'];
  const r = runCrew(['wait\nsend x\nmove 2', 'while not signal\nwait\nend\nmove 2'], lvl(map));
  assert.equal(r.result, 'win');
  assert.deepEqual(r.signals, { x: 1 });
});

test('deadlock: everyone waiting is reported with who waits for what', () => {
  const r = runCrew(['wait a\nmove', 'wait b\nmove'], lvl(['>.G', '>.G']));
  assert.equal(r.result, 'deadlock');
  assert.equal(r.error.code, 'deadlock');
  assert.equal(r.ticks, 1);
  assert.match(r.error.message, /deadlock/);
  assert.match(r.error.hint, /robot 1 waits for 'a' and robot 2 waits for 'b'; every robot is waiting/);
  assert.equal(r.error.line, 1);
});

test('deadlock: the only sender has already finished', () => {
  const r = runCrew(['move\nsend a', 'wait a\nwait a\nmove 2'], lvl(['>.G', '>..G'.slice(0, 3)]));
  assert.equal(r.result, 'deadlock');
  assert.match(r.error.hint, /robot 2 waits for 'a', but robot 1 has already finished/);
  assert.equal(r.error.robot, 1);
});

test('waiting while a belt still carries a robot is not a deadlock yet', () => {
  // Robot 1 rides a belt to the pad while robot 2 waits for a signal that never comes:
  // the floor keeps changing, then robot 1 arrives and the deadlock is reported afterwards.
  const map = ['>EEEG', '#####', '>...G'];
  const r = runCrew(['move\nwait done', 'wait done\nmove 4'], lvl(map));
  assert.equal(r.result, 'deadlock');
  assert.ok(r.ticks >= 3, `ticks ${r.ticks}`);
  assert.equal(r.world.robots[0].x, 4);
});

test('sending to yourself in a loop never blocks: it is caught as an idle loop, not a hang', () => {
  const r = runCrew(['while true\nsend t\nwait t\nend', 'wait\nmove'], lvl(['>.G', '>.G']));
  assert.equal(r.result, 'error');
  assert.equal(r.error.code, 'idle');
  assert.equal(r.error.robot, 0);
});

test('one robot alone: signals are a clear runtime error, not a crash', () => {
  const r = runLevel('send a\nmove', lvl(['>.G']));
  assert.equal(r.result, 'error');
  assert.equal(r.error.code, 'signal');
  assert.match(r.error.message, /crew/);
});

test('tools: signals need the signal block, the sensor needs to be listed; Worlds 1-4 lock both', () => {
  const ast = parse('send a\nif signal\nwait a\nend');
  assert.throws(() => checkTools(ast, { blocks: ['if'] }), /command 'send' isn't unlocked/);
  assert.throws(() => checkTools(ast, { blocks: ['if', 'signal'], sensors: [] }), /sensor 'signal' isn't unlocked/);
  checkTools(ast, { blocks: ['if', 'signal'], sensors: ['signal'] });
  for (const w of WORLDS.filter((x) => x.id !== 'w5')) {
    for (const l of w.levels) {
      assert.ok(l.tools.blocks && !l.tools.blocks.includes('signal'), l.id);
      assert.ok(l.tools.sensors && !l.tools.sensors.includes('signal'), l.id);
    }
  }
});

test('lintCrew: waits nobody sends and sends nobody waits for', () => {
  const asts = ['send go\nsend spare', 'wait go\nwait never'].map(parse);
  const [a, b] = lintCrew(asts);
  assert.deepEqual(a.map((w) => [w.code, w.line, w.col]), [['nowait', 2, 6]]);
  assert.deepEqual(b.map((w) => [w.code, w.line, w.col]), [['nosend', 2, 6]]);
  assert.match(b[0].message, /no robot ever sends 'never'/);
  assert.deepEqual(lintCrew(['def f\nsend x\nend\nf', 'wait x'].map(parse)), [[], []]);
});

test('blocks: signals round-trip and appear in the palette only when unlocked', () => {
  const src = 'send go # tell\nrepeat 2\n  wait go\n  wait\nend';
  const bs = toBlocks(src);
  assert.deepEqual(bs[0], { kind: 'send', name: 'go', comment: ' tell' });
  assert.deepEqual(bs[1].body[0], { kind: 'await', name: 'go' });
  assert.deepEqual(bs[1].body[1], { kind: 'action', name: 'wait', count: 1 });
  assert.equal(toText(bs), src);
  assert.equal(format('SEND  Go'), 'send go');
  assert.equal(format(format(src)), format(src));
  const ids = (tools) => palette(tools).map((p) => p.id);
  assert.ok(!ids({ blocks: ['repeat'] }).includes('send'));
  assert.ok(ids({ blocks: ['signal'] }).includes('send') && ids({ blocks: ['signal'] }).includes('await'));
  const made = palette({ blocks: ['signal'] }).find((p) => p.id === 'await').make([]);
  assert.equal(toText([made]), 'wait go');
  assert.equal(signalProblem([], 'ready'), '');
  assert.match(signalProblem([], 'move'), /reserved/);
});
