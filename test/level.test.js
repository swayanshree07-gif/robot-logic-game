// Day 3: level format v1, win rules, tool allow-lists, richer runLevel results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLevel, normalizeLevel, levelToJSON, levelFromJSON, describeGoal, LevelError, LEVEL_FORMAT,
} from '../src/world/level.js';
import { World } from '../src/world/world.js';
import { runLevel, describeResult } from '../src/game/run.js';
import { LEVELS } from '../src/game/levels.js';
import { formatError } from '../src/lang/errors.js';

const byId = (id) => LEVELS.find((l) => l.id === id);
const base = { id: 't-1', name: 'Test', map: ['#####', '#>.G#', '#####'], win: 'reach', solution: 'move 2' };
const lvl = (over) => ({ ...base, ...over });

test('every shipped level is valid format v1 and its solution wins', () => {
  for (const level of LEVELS) {
    assert.deepEqual(validateLevel(level), [], level.id);
    const r = runLevel(level.solution, level);
    assert.equal(r.result, 'win', `${level.id}: ${r.result} ${r.error ? r.error.message : r.unmet.join(';')}`);
    // The normalised copy behaves identically.
    assert.equal(runLevel(level.solution, normalizeLevel(level)).ticks, r.ticks, level.id);
  }
});

test('validateLevel reports each kind of problem', () => {
  const cases = [
    [lvl({ id: 'Bad Id' }), /id must be/],
    [lvl({ name: '' }), /name is required/],
    [lvl({ solution: undefined }), /solution is required/],
    [lvl({ colour: 'red' }), /unknown field 'colour'/],
    [lvl({ format: 2 }), /unsupported format 2/],
    [lvl({ map: 'not rows' }), /array of strings/],
    [lvl({ map: ['#>#', '##'] }), /length/],
    [lvl({ map: ['>.'.padEnd(17, '.')] }), /at most 16x12/],
    [lvl({ win: 'teleport' }), /unknown win rule 'teleport'/],
    [lvl({ win: ['reach', 'reach'] }), /listed twice/],
    [lvl({ win: [] }), /at least one rule/],
    [lvl({ map: ['>..'] }), /needs a goal pad/],
    [lvl({ map: ['>#G'] }), /no goal pad can be reached/],
    [lvl({ win: 'collect' }), /at least one part/],
    [lvl({ win: 'deliver', map: ['>o.'] }), /needs a bin/],
    [lvl({ win: 'deliver', map: ['>.B#o'] }), /can't be reached/],
    [lvl({ win: { type: 'deliver', count: 3 }, map: ['>oB'] }), /more than the 1 part/],
    [lvl({ win: { type: 'reach', count: 1 } }), /only allowed on deliver/],
    [lvl({ capacity: 0 }), /capacity/],
    [lvl({ maxSteps: 1.5 }), /maxSteps/],
    [lvl({ tools: { actions: ['fly'] } }), /unknown entry 'fly'/],
    [lvl({ tools: { gadgets: [] } }), /unknown tools list 'gadgets'/],
    [lvl({ tools: { blocks: 'repeat' } }), /must be an array/],
  ];
  for (const [level, re] of cases) {
    const problems = validateLevel(level);
    assert.ok(problems.some((p) => re.test(p)), `${re} not in ${JSON.stringify(problems)}`);
  }
  assert.deepEqual(validateLevel(lvl({ solution: undefined }), { requireSolution: false }), []);
  assert.deepEqual(validateLevel(null), ['level must be an object']);
  assert.throws(() => normalizeLevel(lvl({ win: 'x' })), (e) => e instanceof LevelError && e.problems.length === 1);
});

test('normalizeLevel fills defaults; JSON round-trips', () => {
  const n = normalizeLevel(base);
  assert.equal(n.format, LEVEL_FORMAT);
  assert.deepEqual(n.win, [{ type: 'reach' }]);
  assert.equal(n.capacity, 1);
  assert.equal(n.maxSteps, 2000);
  assert.ok(n.tools.actions.includes('grab') && n.tools.blocks.includes('def'));
  for (const level of LEVELS) {
    const back = levelFromJSON(levelToJSON(level));
    assert.deepEqual(back, normalizeLevel(level), level.id);
    assert.deepEqual(levelFromJSON(JSON.stringify(back)), back);
  }
  assert.throws(() => levelFromJSON('{oops'), /not valid JSON/);
  assert.throws(() => levelFromJSON('{"id":"x"}'), LevelError);
});

test('win rule: reach ends the run on the pad, combined rules need all at once', () => {
  const trip = byId('proto-8');
  // Rolling over the pad before delivering does not win.
  const early = runLevel('left\nleft\nmove', trip);
  assert.equal(early.result, 'fail');
  assert.deepEqual(early.unmet, ['0 of 1 part delivered to a bin']);
  // Delivering without docking is not enough either.
  const noDock = runLevel('move 2\ngrab\nmove\ndrop', trip);
  assert.equal(noDock.result, 'fail');
  assert.deepEqual(noDock.unmet, ['Pip is not on a goal pad']);
  assert.match(describeResult(noDock), /job isn't done: Pip is not on a goal pad/);
});

test('win rule: collect with a multi-part hopper', () => {
  const sweep = byId('proto-7');
  const r = runLevel(sweep.solution, sweep);
  assert.equal(r.result, 'win');
  assert.equal(r.world.robot.holding, 3);
  const partial = runLevel('move 2\ngrab\nmove 2\ngrab', sweep);
  assert.equal(partial.result, 'fail');
  assert.deepEqual(partial.unmet, ['1 part is still on the floor']);
  // Capacity 1 (default): a second grab fails with a clear message.
  const w = new World({ map: ['>oo'], win: 'collect' });
  w.act('move'); assert.ok(w.act('grab').ok);
  w.act('move');
  assert.deepEqual(w.act('grab'), { ok: false, error: 'Pip is already holding a part', code: 'full' });
  const big = new World({ map: ['>o'], capacity: 2 });
  big.act('move'); big.act('grab');
  big.items.push({ x: 1, y: 0 }); big.act('grab'); big.items.push({ x: 1, y: 0 });
  assert.match(big.act('grab').error, /gripper is full \(2 parts\)/);
});

test('win rule: deliver all or a count; parts dropped on floor are not delivered', () => {
  const two = { map: ['>ooB'], win: { type: 'deliver', count: 1 }, capacity: 2 };
  assert.equal(runLevel('move\ngrab\nmove 2\ndrop', two).result, 'win');
  const all = { map: ['>ooB'], win: 'deliver', capacity: 2 };
  const r = runLevel('move\ngrab\nmove\ngrab\nmove\ndrop', all);
  assert.equal(r.result, 'fail');
  assert.deepEqual(r.unmet, ['1 of 2 parts delivered to a bin']);
  assert.equal(runLevel('move\ngrab\nmove\ngrab\nmove\ndrop\ndrop', all).result, 'win');
  const floor = runLevel('move\ngrab\nmove\ndrop', { map: ['>o.B'], win: 'deliver' });
  assert.equal(floor.result, 'fail');
  assert.equal(floor.world.items.length, 1);
});

test('known wrong programs fail for the right reason on sample levels', () => {
  const cases = [
    ['proto-1', 'move 3', 'fail', /not on a goal pad/],
    ['proto-2', 'move 3', 'error', /bumped into a wall/],
    ['proto-5', 'move 2\ngrab\nmove\ndrop', 'fail', /0 of 1 part delivered/],
    ['proto-5', 'move 2\ndrop', 'error', /not holding anything/],
    ['proto-9', 'while not bin\n  move\nend', 'error', /bumped/],
    ['proto-9', 'while true\n  wait\nend', 'loop', /stuck in a loop/],
  ];
  for (const [id, src, result, re] of cases) {
    const r = runLevel(src, byId(id));
    assert.equal(r.result, result, `${id}: ${src}`);
    assert.match(describeResult(r), re, `${id}: ${src}`);
  }
});

test('tools: locked commands, sensors and blocks give positioned errors', () => {
  const p1 = byId('proto-1');
  const r = runLevel('move 2\nright', p1);
  assert.equal(r.result, 'error');
  assert.equal(r.error.code, 'locked');
  assert.equal(formatError('move 2\nright', r.error),
    "Line 2, col 1: command 'right' isn't unlocked on this level — available here: move\n 2 | right\n   | ^^^^^");
  const p9 = byId('proto-9');
  const s = runLevel('repeat 3\n  if clear or goal\n    move\n  end\nend', p9);
  assert.match(s.error.message, /^Line 2, col 3: block 'if' isn't unlocked on this level/);
  const g = runLevel('while not goal\n  move\nend', p9);
  assert.match(g.error.message, /^Line 1, col 11: sensor 'goal' isn't unlocked on this level/);
  assert.match(g.error.hint, /available here: item, bin, holding/);
  // The first problem in source order is reported, even inside functions defined later.
  const d = runLevel('move\nhop\ndef hop\n  move\nend', p1);
  assert.equal(d.error.line, 2);
  // Syntax errors still win over tool errors.
  assert.match(runLevel('mvoe', p1).error.message, /did you mean 'move'/);
  // No tools field = everything allowed.
  assert.equal(runLevel('right\nleft\nrepeat 2\n  move\nend', { map: base.map }).result, 'win');
});

test('runLevel reports size, stats and per-level battery', () => {
  const p9 = byId('proto-9');
  const r = runLevel(p9.solution, p9);
  assert.equal(r.size, 11); // statements, not counting 'end'
  assert.equal(r.stats.grab, 3);
  assert.equal(r.stats.drop, 3);
  assert.equal(r.stats.move, r.ticks - r.stats.grab - r.stats.drop - r.stats.right);
  assert.match(describeResult(r), new RegExp(`Finished in ${r.ticks} steps with 11 lines`));
  const short = runLevel(p9.solution, { ...p9, maxSteps: 10 });
  assert.equal(short.result, 'timeout');
  assert.equal(short.ticks, 10);
  assert.match(short.error.message, /battery ran out after 10 steps/);
});

test('describeGoal phrases each rule', () => {
  assert.equal(describeGoal(byId('proto-1')), 'Reach a goal pad.');
  assert.equal(describeGoal(byId('proto-5')), 'Deliver the part to a bin.');
  assert.equal(describeGoal(byId('proto-7')), 'Pick up all 3 parts.');
  assert.equal(describeGoal(byId('proto-8')), 'Deliver the part to a bin, then reach a goal pad.');
  assert.equal(describeGoal(byId('proto-9')), 'Deliver all 3 parts to a bin.');
  assert.equal(describeGoal({ map: ['>ooB'], win: { type: 'deliver', count: 1 } }), 'Deliver 1 part to a bin.');
});
