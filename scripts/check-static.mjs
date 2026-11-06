// Static sanity check for the browser side (no browser needed):
// every file referenced from index.html and every relative ES import exists,
// and every JS module parses (node --check).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const problems = [];
const html = readFileSync(join(root, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
  if (!existsSync(join(root, m[1]))) problems.push(`index.html -> missing ${m[1]}`);
}
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
});
const files = walk(join(root, 'src'));
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/^\s*import\s[^'"]*['"](\.[^'"]+)['"]/gm)) {
    if (!existsSync(join(dirname(f), m[1]))) problems.push(`${f.slice(root.length + 1)} -> missing import ${m[1]}`);
  }
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { problems.push(`${f.slice(root.length + 1)} -> syntax error\n${e.stderr}`); }
}
// every $('id') used by main.js exists in index.html or is given to an element by UI code (el.id = '...')
const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const uiSrc = files.filter((f) => f.includes('/ui/')).map((f) => readFileSync(f, 'utf8')).join('\n');
for (const m of uiSrc.matchAll(/\.id = '([^']+)'/g)) htmlIds.add(m[1]);
const mainSrc = readFileSync(join(root, 'src/ui/main.js'), 'utf8');
for (const m of new Set([...mainSrc.matchAll(/\$\('([^']+)'\)/g)].map((x) => x[1]))) {
  if (!htmlIds.has(m)) problems.push(`src/ui/main.js -> no element with id "${m}"`);
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`static check ok: ${files.length} modules`);
