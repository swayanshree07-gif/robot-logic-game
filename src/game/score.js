// Par scores and stars.
//
// A level's `par` is { steps, size }:
//   steps - fewest actions that can win (found by the BFS solver; tests keep it honest)
//   size  - program size (statements, see programSize) of the shortest known
//           program; the level's `solution` is written to hit it exactly
// Stars for a run: 0 if not won, otherwise 1 + one for meeting each par.
// Steps and size often pull in different directions, so a level's three stars
// may need two different programs; best stars are kept per level.

/** Score a finished run ({ result, ticks, size }) against `par` (may be missing). */
export function scoreRun(run, par) {
  const won = run.result === 'win';
  const steps = { value: run.ticks, par: par?.steps ?? null };
  const size = { value: run.size, par: par?.size ?? null };
  steps.ok = won && steps.par !== null && steps.value <= steps.par;
  size.ok = won && size.par !== null && size.value <= size.par;
  return { stars: won ? 1 + steps.ok + size.ok : 0, steps, size };
}

/** "★★☆" for 0..3 stars. */
export const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

/** One line comparing a win with par, e.g. "Steps 31 (par 29) · Size 8 (par 8 ✓)". */
export function parLine(score) {
  const part = (label, s) => (s.par === null ? `${label} ${s.value}`
    : `${label} ${s.value} (par ${s.par}${s.ok ? ' ✓' : ''})`);
  return `${part('Steps', score.steps)} · ${part('Size', score.size)}`;
}

/** Combine a stored best (0..3 or null) with a new score. */
export const bestStars = (prev, score) => Math.max(prev || 0, score.stars);
