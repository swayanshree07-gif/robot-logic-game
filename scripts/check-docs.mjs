#!/usr/bin/env node
// Docs check (Day 29): every relative Markdown link in README.md and docs/*.md
// points at an existing file (and an existing heading, for #anchors); every
// `backticked/path.js`-style source path mentioned exists; and every Cog
// command, sensor and keyword is explained in docs/cog-reference.md and in
// the in-game help. Exit 1 with a list of problems, else print "ok".
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIONS, SENSORS, MEMORY_OPS, SIGNAL_OPS, COMPARE_OPS, RESERVED } from '../src/lang/parser.js';
import { helpWords } from '../src/game/help.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** GitHub-style heading slug. */
export const slug = (h) => h.trim().toLowerCase().replace(/[`*_]/g, '')
  .replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-');

const headings = (text) => new Set(text.split('\n').filter((l) => /^#{1,6} /.test(l))
  .map((l) => slug(l.replace(/^#+ /, ''))));

/** Remove fenced code blocks (their contents are not links). */
const prose = (text) => text.replace(/```[\s\S]*?```/g, '');

export function checkDocs(dir = root) {
  const problems = [];
  const files = ['README.md', ...readdirSync(join(dir, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];
  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8');
    const body = prose(text);
    for (const [, target] of body.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(target)) continue; // external (http:, mailto:) — not checked offline
      const [path, anchor] = target.split('#');
      const abs = path ? resolve(dirname(join(dir, file)), path) : join(dir, file);
      if (!existsSync(abs)) { problems.push(`${file}: broken link ${target}`); continue; }
      if (anchor && abs.endsWith('.md') && !headings(readFileSync(abs, 'utf8')).has(anchor)) {
        problems.push(`${file}: no heading #${anchor} in ${relative(dir, abs)}`);
      }
    }
    for (const [, p] of body.matchAll(/`((?:src|test|scripts|docs|css)\/[\w./-]+\.(?:js|mjs|md|sh|css|png))`/g)) {
      if (!p.includes('*') && !existsSync(join(dir, p))) problems.push(`${file}: missing file ${p}`);
    }
  }
  const ref = readFileSync(join(dir, 'docs/cog-reference.md'), 'utf8');
  const help = helpWords();
  const words = [...new Set([...RESERVED, ...ACTIONS, ...SENSORS, ...MEMORY_OPS, ...SIGNAL_OPS, ...COMPARE_OPS])];
  for (const w of words) {
    if (!ref.includes(w)) problems.push(`docs/cog-reference.md: '${w}' not documented`);
    if (!help.has(w)) problems.push(`in-game help: '${w}' not explained`);
  }
  return { files, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { files, problems } = checkDocs();
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log(`ok, ${files.length} docs`);
}
