#!/usr/bin/env node
// Proves every shipped level is solvable on every floor (see src/game/verify.js).
// Prints one line per level: proof method per floor, optimum vs solution steps,
// par. Exits 1 if any level is unproved or its par is below the optimum.
// Usage: node scripts/verify-levels.mjs [--quick]   (--quick: smaller search caps)
import { WORLDS } from '../src/game/levels.js';
import { verifyLevel } from '../src/game/verify.js';

const quick = process.argv.includes('--quick');
const opts = quick ? { maxStates: 50000, crewMaxStates: 30000 } : {};
let bad = 0, bySolver = 0, bySolution = 0, total = 0;
const t0 = Date.now();
for (const world of WORLDS) {
  console.log(`\n${world.name}`);
  for (const level of world.levels) {
    const v = verifyLevel(level, opts);
    const fl = v.floors.map((f) => `${f.method === 'solver' ? `opt ${f.optimum}` : f.method === 'solution' ? 'by solution' : 'UNPROVED'}/sol ${f.solution ?? '-'}`).join(', ');
    for (const f of v.floors) { total++; if (f.method === 'solver') bySolver++; else if (f.method === 'solution') bySolution++; }
    const par = level.par ? `par ${level.par.steps}` : 'no par';
    console.log(`  ${v.ok ? 'ok  ' : 'FAIL'} ${level.id.padEnd(6)} ${v.crew ? 'crew ' : '     '}${par.padEnd(7)} ${fl}${v.ok ? '' : `  <- ${v.problems.join('; ')}`}`);
    if (!v.ok) bad++;
  }
}
console.log(`\n${total} floors: ${bySolver} proved by solver optimum, ${bySolution} by the shipped solution (search capped). ${bad} level(s) failed. ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(bad ? 1 : 0);
