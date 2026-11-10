// Seeded fuzz tests (Day 27): random and mutated inputs must never crash the
// parser, the VM/runner or the share-code decoder with anything but their own
// documented error types, and must always terminate. Seeds are fixed so a
// failure reproduces; set FUZZ_SEED / FUZZ_N to explore further.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/lang/parser.js';
import { CogError } from '../src/lang/errors.js';
import { runLevel } from '../src/game/run.js';
import { runCrew } from '../src/game/crew.js';
import { LEVELS } from '../src/game/levels.js';
import { levelCrew, levelSolutions } from '../src/world/level.js';
import { encodeLevel, decodeLevel, ShareCodeError } from '../src/game/share-code.js';
import { SaveStore, MemoryStorage } from '../src/game/save.js';
import { CustomLibrary } from '../src/game/custom-levels.js';
import { createEditor } from '../src/game/level-editor.js';

const SEED = Number(process.env.FUZZ_SEED) || 20261110;
const N = Number(process.env.FUZZ_N) || 400;

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

const TOKENS = ['move', 'left', 'right', 'grab', 'drop', 'wait', 'repeat', 'while', 'until', 'if', 'else', 'end',
  'def', 'not', 'and', 'or', 'set', 'add', 'sub', 'send', 'wall', 'ahead', 'x', 'y', 'go', '==', '<', '>=', '(',
  ')', ':', '#', '0', '3', '999', '1000', '-1', 'red', 'é', '\t', '"', '{', '}', '9999999999'];

function soup(r) {
  const lines = [];
  for (let i = 0, n = 1 + Math.floor(r() * 10); i < n; i++) {
    const indent = '  '.repeat(Math.floor(r() * 4));
    const toks = [];
    for (let j = 0, m = 1 + Math.floor(r() * 5); j < m; j++) toks.push(pick(r, TOKENS));
    lines.push(indent + toks.join(' '));
  }
  return lines.join('\n');
}

function mutate(r, s) {
  const ops = [
    () => { const i = Math.floor(r() * (s.length + 1)); s = s.slice(0, i) + pick(r, TOKENS) + s.slice(i); },
    () => { const i = Math.floor(r() * s.length); s = s.slice(0, i) + s.slice(i + 1 + Math.floor(r() * 4)); },
    () => { const ls = s.split('\n'); const i = Math.floor(r() * ls.length); ls.splice(i, 0, ls[Math.floor(r() * ls.length)] ?? ''); s = ls.join('\n'); },
    () => { const ls = s.split('\n'); ls.splice(Math.floor(r() * ls.length), 1); s = ls.join('\n'); },
  ];
  for (let k = 0, n = 1 + Math.floor(r() * 3); k < n; k++) pick(r, ops)();
  return s;
}

const solo = LEVELS.filter((l) => levelCrew(l) === 1);
const crews = LEVELS.filter((l) => levelCrew(l) > 1);

test('parser: random token soup only ever throws CogError', () => {
  const r = rng(SEED);
  let ok = 0;
  for (let i = 0; i < N * 3; i++) {
    const src = soup(r);
    try { parse(src); ok++; } catch (e) { assert.ok(e instanceof CogError, `seed ${SEED} #${i}: ${e}\n${src}`); assert.ok(e.line >= 0); }
  }
  assert.ok(ok > 0, 'some soups parse');
});

test('runner: mutated solutions always finish with a known result on solo levels', () => {
  const r = rng(SEED + 1);
  const results = new Set(['win', 'fail', 'error', 'timeout', 'loop']);
  for (let i = 0; i < N; i++) {
    const lv = pick(r, solo);
    const src = mutate(r, levelSolutions(lv)[0]);
    let out;
    assert.doesNotThrow(() => { out = runLevel(src, lv, { maxTicks: 500 }); }, `${lv.id}\n${src}`);
    assert.ok(results.has(out.result), `${lv.id}: ${out.result}`);
    assert.ok(out.ticks <= 500);
    if (out.result === 'error') assert.ok(out.error instanceof CogError, String(out.error));
  }
});

test('crew runner: mutated crew programs always finish', () => {
  const r = rng(SEED + 2);
  for (let i = 0; i < Math.max(20, N / 8); i++) {
    const lv = pick(r, crews);
    const progs = levelSolutions(lv).map((p) => (r() < 0.6 ? mutate(r, p) : p));
    let out;
    assert.doesNotThrow(() => { out = runCrew(progs, lv, { maxTicks: 300 }); }, lv.id);
    assert.ok(typeof out.result === 'string', lv.id);
  }
});

test('share codes: flipped, cut and spliced codes only throw ShareCodeError', () => {
  const r = rng(SEED + 3);
  const codes = LEVELS.map((l) => encodeLevel(l));
  const alpha = 'ABCxyz019-_.=%+/ ';
  let accepted = 0;
  for (let i = 0; i < N * 2; i++) {
    let c = pick(r, codes);
    const k = Math.floor(r() * 4);
    const at = Math.floor(r() * c.length);
    if (k === 0) c = c.slice(0, at) + pick(r, [...alpha]) + c.slice(at + 1);
    else if (k === 1) c = c.slice(0, at);
    else if (k === 2) c = c.slice(0, at) + pick(r, codes).slice(at);
    else c = c.slice(0, at) + c.slice(at).split('').reverse().join('');
    try { const lv = decodeLevel(c); accepted++; assert.ok(Array.isArray(lv.map)); } catch (e) {
      assert.ok(e instanceof ShareCodeError, `#${i}: ${e}`);
    }
  }
  // a mutated code that still passes the checksum must be a real, unchanged code
  assert.ok(accepted < N / 4, `too many mutated codes accepted: ${accepted}`);
});

test('share codes: valid checksum over junk payload is rejected cleanly', async () => {
  const { fnv1a } = await import('../src/game/share-code.js');
  const r = rng(SEED + 4);
  for (let i = 0; i < 200; i++) {
    const obj = pick(r, [{}, [], null, 1, 'x', { map: 7 }, { map: ['#'] }, { map: ['..', 'R.'], name: 5 }, { map: [], robots: 'no' }]);
    const json = JSON.stringify(obj);
    const payload = Buffer.from(json, 'utf8').toString('base64url');
    const body = `FL1.${payload}`;
    for (const sum of [fnv1a(body), fnv1a(payload), fnv1a(json)]) {
      try { decodeLevel(`${body}.${sum}`); } catch (e) { assert.ok(e instanceof ShareCodeError, `${json}: ${e}`); }
    }
  }
});

test('storage: blocked or full storage never throws, and recovers when space frees', () => {
  const blocked = { getItem() { throw Object.assign(new Error('no'), { name: 'SecurityError' }); },
    setItem() { throw Object.assign(new Error('no'), { name: 'SecurityError' }); }, key() { return null; }, length: 0 };
  let s;
  assert.doesNotThrow(() => { s = new SaveStore(blocked); });
  assert.doesNotThrow(() => s.setSetting('speed', 'fast'));
  assert.equal(s.setting('speed'), 'fast', 'keeps working in memory');
  assert.doesNotThrow(() => new CustomLibrary(blocked).put(createEditor(LEVELS[0])));

  const st = new MemoryStorage({}, { quota: 400 });
  const save = new SaveStore(st);
  save.setDraft('1-1', 'x'.repeat(1000));
  assert.match(save.lastError, /full/);
  save.setDraft('1-1', 'move');
  assert.equal(save.lastError, null, 'error clears once a write fits again');
  assert.equal(new SaveStore(st).draft('1-1'), 'move');
});

test('balance: no solo solution has a removable line that keeps every floor winning at par steps', async () => {
  const { runFloors } = await import('../src/game/run.js');
  const loose = [];
  for (const lv of solo) {
    const lines = levelSolutions(lv)[0].split('\n');
    const base = runFloors(lines.join('\n'), lv);
    lines.forEach((_, i) => {
      const r = runFloors(lines.filter((__, j) => j !== i).join('\n'), lv);
      if (r.result === 'win' && r.floors[0].ticks <= base.floors[0].ticks) loose.push(`${lv.id}:${i + 1}`);
    });
  }
  assert.deepEqual(loose, [], 'par size could be beaten without costing steps');
});
