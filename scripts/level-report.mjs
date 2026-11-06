#!/usr/bin/env node
// Prints a table per world: par steps/size, solver optimum, solution steps/size,
// battery, and the commands each level unlocks. Exits 1 if any level's solution
// fails or its par disagrees with the solver. Usage: node scripts/level-report.mjs [--md]
import { WORLDS } from '../src/game/levels.js';
import { runLevel } from '../src/game/run.js';
import { solve } from '../src/game/solver.js';

const md = process.argv.includes('--md');
let problems = 0;
const out = [];
for (const world of WORLDS) {
  out.push(md ? `\n### ${world.name}\n` : `\n${world.name}`);
  const head = ['#', 'id', 'name', 'opt', 'par steps', 'par size', 'sol steps', 'sol size', 'battery', 'new'];
  const rows = [];
  const seen = new Set();
  world.levels.forEach((l, i) => {
    const run = runLevel(l.solution, l);
    const best = solve(l);
    const tools = l.tools ? [...(l.tools.actions || []), ...(l.tools.sensors || []), ...(l.tools.blocks || [])] : ['(all)'];
    const fresh = tools.filter((t) => !seen.has(t));
    tools.forEach((t) => seen.add(t));
    const bad = [];
    if (run.result !== 'win') bad.push(`solution ${run.result}`);
    if (l.par && best && l.par.steps !== best.steps) bad.push(`par steps ${l.par.steps} ≠ optimum ${best.steps}`);
    if (l.par && l.par.size !== run.size) bad.push(`par size ${l.par.size} ≠ solution ${run.size}`);
    problems += bad.length;
    rows.push([i + 1, l.id, l.name, best ? best.steps : '?', l.par?.steps ?? '-', l.par?.size ?? '-',
      run.ticks, run.size, l.maxSteps ?? 2000, fresh.join(' ') + (bad.length ? `  !! ${bad.join('; ')}` : '')].map(String));
  });
  if (md) {
    out.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`));
  } else {
    const w = head.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c].length)));
    const line = (r) => r.map((x, c) => (c === r.length - 1 ? x : x.padEnd(w[c]))).join('  ');
    out.push(line(head), ...rows.map(line));
  }
}
console.log(out.join('\n').trimStart());
if (problems) { console.error(`\n${problems} problem(s)`); process.exit(1); }
