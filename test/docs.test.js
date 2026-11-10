import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDocs, slug } from '../scripts/check-docs.mjs';
import { HELP_SECTIONS, helpWords, helpHtml } from '../src/game/help.js';
import { ACTIONS, SENSORS, RESERVED, COMPARE_OPS } from '../src/lang/parser.js';

test('docs: links, anchors, paths valid and every Cog word documented', () => {
  const { files, problems } = checkDocs();
  assert.ok(files.includes('docs/cog-reference.md') && files.includes('docs/level-design.md'));
  assert.deepEqual(problems, []);
});

test('heading slugs match GitHub style', () => {
  assert.equal(slug('Level format (v1)'), 'level-format-v1');
  assert.equal(slug('Memory registers'), 'memory-registers');
});

test('in-game help covers the whole language', () => {
  const w = helpWords();
  for (const x of [...ACTIONS, ...SENSORS, ...RESERVED, ...COMPARE_OPS]) assert.ok(w.has(x), x);
  for (const s of HELP_SECTIONS) for (const [k, v] of s.items) assert.ok(k && v.length < 100, k);
});

test('help HTML is escaped and only uses safe tags', () => {
  const html = helpHtml();
  assert.ok(html.includes('&lt;='));
  const tags = new Set([...html.matchAll(/<\/?([a-z0-9]+)/g)].map((m) => m[1]));
  assert.deepEqual([...tags].sort(), ['code', 'dd', 'dl', 'dt', 'h3']);
});
