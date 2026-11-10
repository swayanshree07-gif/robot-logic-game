#!/usr/bin/env node
// Prints a table per world: par steps/size, solver optimum, solution steps/size,
// battery, test floors, and the commands each level unlocks. Exits 1 if any
// level's solution fails (on any floor) or its par disagrees with the solver.
// Levels with test floors: par steps = the solution's steps on floor 1, which
// may be above the one-floor optimum (a hard-coded route) but never below it. Usage: node scripts/level-report.mjs [--md]
import { WORLDS } from '../src/game/levels.js';
import { runSolution } from '../src/game/run.js';
import { floorCount, floorLevel, levelCrew } from '../src/world/level.js';
import { solve } from '../src/game/solver.js';

const md = process.argv.includes('--md');
let problems = 0;
const out = [];
for (const world of WORLDS) {
  out.push(md ? `\n### ${world.name}\n` : `\n${world.name}`);
  const head = ['#', 'id', 'name', 'opt', 'par steps', 'par size', 'sol steps', 'sol size', 'battery', 'floors', 'new'];
  const rows = [];
  const seen = new Set();
  world.levels.forEach((l, i) => {
    // crews: 'opt' is '-' here (joint search is slow; see scripts/verify-levels.mjs), par = the shipped programs
    const crew = levelCrew(l) > 1;
    const run = runSolution(l);
    const best = crew ? null : solve(l);
    const tools = l.tools ? [...(l.tools.actions || []), ...(l.tools.sensors || []), ...(l.tools.blocks || [])] : ['(all)'];
    const fresh = tools.filter((t) => !seen.has(t));
    tools.forEach((t) => seen.add(t));
    const bad = [];
    const floors = floorCount(l);
    const all = { result: 'win', failed: -1 };
    for (let f = 0; f < floors && all.failed < 0; f++) {
      const r = runSolution(floorLevel(l, f));
      if (r.result !== 'win') Object.assign(all, { result: r.result, failed: f });
    }
    if (run.result !== 'win') bad.push(`solution ${run.result}`);
    else if (all.result !== 'win') bad.push(`solution ${all.result} on floor ${all.failed + 1}`);
    if (!best && !crew) bad.push('solver found no win');
    if (crew && l.par && l.par.steps !== run.ticks) bad.push(`par steps ${l.par.steps} ≠ solution ${run.ticks}`);
    if (l.par && best && floors === 1 && l.par.steps !== best.steps) bad.push(`par steps ${l.par.steps} ≠ optimum ${best.steps}`);
    if (l.par && best && floors > 1 && (l.par.steps !== run.ticks || l.par.steps < best.steps)) bad.push(`par steps ${l.par.steps} ≠ solution ${run.ticks} (optimum ${best.steps})`);
    if (l.par && l.par.size !== run.size) bad.push(`par size ${l.par.size} ≠ solution ${run.size}`);
    problems += bad.length;
    rows.push([i + 1, l.id, l.name, best ? best.steps : crew ? '-' : '?', l.par?.steps ?? '-', l.par?.size ?? '-',
      run.ticks, run.size, l.maxSteps ?? 2000, floors, fresh.join(' ') + (bad.length ? `  !! ${bad.join('; ')}` : '')].map(String));
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
