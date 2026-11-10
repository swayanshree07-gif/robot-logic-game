// Solvability proof for levels (Day 25). For every floor of a level:
//   1. search for the optimum with the real World rules: solve() for one
//      robot, solveCrew() (joint-state BFS, signals ignored) for crews; if
//      the search ends without a win and without hitting its state cap, it
//      tries again allowing drops on plain floor (hand-off puzzles);
//   2. replay the solver's own plan as Cog: it must win;
//   3. if the search was cut off (big crew levels), the shipped solution
//      winning on that floor is the proof instead ('solution' method).
// A floor fails when neither proof works, when the solver proves no win
// exists, or when the shipped solution beats the "optimum" (solver bug).
// Level checks: par steps must never be below the floor-1 optimum.
import { solveInfo, solveCrewInfo, actionsToCog, plansToCog } from './solver.js';
import { runSolution } from './run.js';
import { floorCount, floorLevel, levelCrew } from '../world/level.js';

function search(lv, crew, maxStates) {
  const run = (floorDrops) => (crew ? solveCrewInfo : solveInfo)(lv, { maxStates, floorDrops });
  let r = run(false);
  if (!r.best && !r.capped) r = run(true);
  return r;
}

/**
 * @returns {{ id, crew, ok, problems: string[], floors: Array<{ floor, method: 'solver'|'solution'|null, optimum, solution, states }> }}
 */
export function verifyLevel(level, { maxStates = 200000, crewMaxStates = 300000 } = {}) {
  const crew = levelCrew(level) > 1;
  const problems = [];
  const floors = [];
  for (let f = 0; f < floorCount(level); f++) {
    const lv = floorLevel(level, f);
    const sol = runSolution(lv);
    const r = search(lv, crew, crew ? crewMaxStates : maxStates);
    const row = { floor: f + 1, method: null, optimum: r.best ? r.best.steps : null, solution: sol.result === 'win' ? sol.ticks : null, states: r.states };
    if (r.best) {
      // replay the plan with every tool unlocked (the plan only uses allowed actions)
      const free = { ...lv, tools: undefined, robots: undefined, maxSteps: undefined };
      const replay = crew ? runSolution(free, plansToCog(r.best.plans)) : runSolution(free, [actionsToCog(r.best.actions)]);
      if (replay.result === 'win') row.method = 'solver';
      else problems.push(`floor ${f + 1}: solver plan replays as '${replay.result}'`);
      if (row.solution !== null && row.solution < r.best.steps) problems.push(`floor ${f + 1}: solution ${row.solution} steps beats optimum ${r.best.steps}`);
    } else if (!r.capped) {
      problems.push(`floor ${f + 1}: solver proved there is no win`);
    }
    if (!row.method && row.solution !== null && r.capped) row.method = 'solution';
    if (!row.method && !problems.some((p) => p.startsWith(`floor ${f + 1}:`))) problems.push(`floor ${f + 1}: unproved (search capped, solution ${sol.result})`);
    floors.push(row);
  }
  const opt1 = floors[0].optimum;
  if (level.par && opt1 !== null && level.par.steps < opt1) problems.push(`par steps ${level.par.steps} below optimum ${opt1}`);
  return { id: level.id, crew, ok: problems.length === 0, problems, floors };
}
