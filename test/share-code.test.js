// Share codes: round trip on every shipped level, corruption and version checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeLevel, decodeLevel, extractCode, shareUrl, fnv1a, ShareCodeError } from '../src/game/share-code.js';
import { LEVELS } from '../src/game/levels.js';
import { normalizeLevel } from '../src/world/level.js';
import { createEditor } from '../src/game/level-editor.js';
import { testPlay } from '../src/game/custom-levels.js';

const kind = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof ShareCodeError, String(e)); return e.kind; } return 'none'; };

test('all 40 levels round-trip and still win from the decoded copy', () => {
  assert.equal(LEVELS.length, 40);
  for (const lv of LEVELS) {
    const code = encodeLevel(lv);
    assert.match(code, /^FL1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/, lv.id);
    const back = decodeLevel(code, { id: lv.id });
    const { id, ...want } = normalizeLevel(lv, { requireSolution: false });
    const { id: _i, ...got } = back;
    assert.deepEqual(got, want, lv.id);
    assert.equal(id, lv.id);
    assert.equal(testPlay(createEditor(back)).ok, true, `${lv.id} wins after decode`);
  }
});

test('non-ASCII names survive; codes from URLs and with whitespace are accepted', () => {
  const lv = { ...LEVELS[0], name: 'Fábrica ✓ 工場' };
  const code = encodeLevel(lv);
  assert.equal(decodeLevel(code).name, 'Fábrica ✓ 工場');
  const url = shareUrl(code, 'http://x/index.html#lab');
  assert.equal(url, `http://x/index.html?code=${code}`);
  assert.equal(extractCode(url), code);
  assert.equal(decodeLevel(`  ${code.slice(0, 10)}\n${code.slice(10)} `).name, 'Fábrica ✓ 工場');
});

test('corrupt, wrong-version and bad codes are rejected with a kind', () => {
  const code = encodeLevel(LEVELS[5]);
  const [p, payload, sum] = code.split('.');
  assert.equal(kind(() => decodeLevel('')), 'empty');
  assert.equal(kind(() => decodeLevel('hello')), 'format');
  assert.equal(kind(() => decodeLevel(`FL2.${payload}.${sum}`)), 'version');
  const flipped = payload.slice(0, 20) + (payload[20] === 'A' ? 'B' : 'A') + payload.slice(21);
  assert.equal(kind(() => decodeLevel(`${p}.${flipped}.${sum}`)), 'checksum');
  assert.equal(kind(() => decodeLevel(`${p}.${payload.slice(0, -3)}.${sum}`)), 'checksum');
  // Valid checksum but junk content
  const junk = 'bm90IGpzb24';
  assert.equal(kind(() => decodeLevel(`FL1.${junk}.${fnv1a(junk)}`)), 'corrupt');
  // Valid JSON but a broken level
  const bad = Buffer.from(JSON.stringify({ name: 'x', map: ['###'] })).toString('base64url');
  assert.equal(kind(() => decodeLevel(`FL1.${bad}.${fnv1a(bad)}`)), 'invalid');
  assert.equal(kind(() => decodeLevel('FL1.' + 'A'.repeat(30000) + '.00000000')), 'format');
});

test('codes do not carry the sender id', () => {
  const code = encodeLevel({ ...LEVELS[0], id: 'custom-7' });
  assert.equal(decodeLevel(code, { id: 'custom-1' }).id, 'custom-1');
  assert.ok(!Buffer.from(code.split('.')[1], 'base64url').toString().includes('custom-7'));
});
