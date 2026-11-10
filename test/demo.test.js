import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('scripted demo runs and passes all checks', () => {
  const out = execFileSync(process.execPath, ['scripts/demo.mjs'], { encoding: 'utf8', timeout: 240000 });
  assert.match(out, /Demo complete: all checks passed\./);
  assert.doesNotMatch(out, /FAIL/);
});
