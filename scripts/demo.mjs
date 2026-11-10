#!/usr/bin/env node
// Day 30 scripted demo: a terminal walkthrough of the whole game without a browser.
// For one level per world it shows the brief, the map, the known Cog program,
// runs it and scores it; then it round-trips a level through a share code and
// finishes with the solver proof for those levels. Exits 1 if any step fails.
// Usage: node scripts/demo.mjs
import { WORLDS, LEVELS } from '../src/game/levels.js';
import { runSolution, describeResult } from '../src/game/run.js';
import { scoreRun, starText } from '../src/game/score.js';
import { encodeLevel, decodeLevel } from '../src/game/share-code.js';
import { verifyLevel } from '../src/game/verify.js';
import { levelSolutions, levelCrew } from '../src/world/level.js';

let bad = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) bad++; };

console.log(`Ferrolab demo — ${WORLDS.length} worlds, ${LEVELS.length} levels\n`);
const picks = WORLDS.map((w) => [w, w.levels[Math.min(2, w.levels.length - 1)]]);
for (const [world, level] of picks) {
  console.log(`== ${world.name} / ${level.id}: ${level.name ?? ''}`);
  if (level.brief) console.log(`  ${String(level.brief).split('\n')[0]}`);
  for (const row of level.map) console.log(`    ${row}`);
  const progs = levelSolutions(level);
  progs.forEach((p, i) => {
    if (levelCrew(level) > 1) console.log(`  robot ${i + 1}:`);
    for (const line of p.trim().split('\n')) console.log(`    | ${line}`);
  });
  const run = runSolution(level);
  const result = run.result ?? 'win';
  const s = scoreRun({ result, ticks: run.ticks, size: run.size }, level.par);
  console.log(`  ${run.result ? describeResult(run) : `result: ${result}`}  ${starText(s.stars)}`);
  ok(result === 'win', `${level.id} solution wins`);
  console.log();
}

console.log('== Share code round trip');
const lvl = picks[0][1];
const code = encodeLevel(lvl);
console.log(`  ${code.slice(0, 60)}… (${code.length} chars)`);
const back = decodeLevel(code);
ok(JSON.stringify(back.map) === JSON.stringify(lvl.map), 'decoded map matches');
let rejected = false;
try { decodeLevel(code.slice(0, -1) + (code.endsWith('0') ? '1' : '0')); } catch { rejected = true; }
ok(rejected, 'damaged code rejected');

console.log('\n== Solver proof (quick caps)');
for (const [, level] of picks) {
  const v = verifyLevel(level, { maxStates: 50000, crewMaxStates: 30000 });
  ok(v.ok, `${level.id}: ${v.floors.map((f) => f.method).join(', ')}`);
}
console.log(bad ? `\n${bad} check(s) failed` : '\nDemo complete: all checks passed.');
process.exit(bad ? 1 : 0);
