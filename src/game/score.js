// Par scores and stars.
//
// A level's `par` is { steps, size }:
//   steps - fewest actions that can win (found by the BFS solver; tests keep it honest)
//   size  - program size (statements, see programSize) of the shortest known
//           program; the level's `solution` is written to hit it exactly
// Stars for a run: 0 if not won, otherwise 1 + one for meeting each par.
// Steps and size often pull in different directions, so a level's three stars
// may need two different programs: each par star, once earned, is kept, so the
// best record per level ({ won, steps, size }, see mergeBest) adds them up.

/** Score a finished run ({ result, ticks, size }) against `par` (may be missing). */
export function scoreRun(run, par) {
  const won = run.result === 'win';
  const steps = { value: run.ticks, par: par?.steps ?? null };
  const size = { value: run.size, par: par?.size ?? null };
  steps.ok = won && steps.par !== null && steps.value <= steps.par;
  size.ok = won && size.par !== null && size.value <= size.par;
  steps.medal = medalFor(won, steps.value, steps.par);
  size.medal = medalFor(won, size.value, size.par);
  return { stars: won ? 1 + steps.ok + size.ok : 0, steps, size };
}

// --- Medals (Day 21) ---
// Each metric (steps, size) earns its own medal for a winning run:
//   gold   value <= par
//   silver value <= 1.5 * par
//   bronze solved (or the level has no par for that metric)
export const MEDALS = ['bronze', 'silver', 'gold'];
const RANK = { bronze: 1, silver: 2, gold: 3 };

/** Medal for one metric, or null when not won. */
export function medalFor(won, value, par) {
  if (!won) return null;
  if (par === null || par === undefined || !Number.isFinite(value)) return 'bronze';
  if (value <= par) return 'gold';
  if (value <= 1.5 * par) return 'silver';
  return 'bronze';
}

/** The better of two medals (either may be null). */
export const betterMedal = (a, b) => ((RANK[a] || 0) >= (RANK[b] || 0) ? a || null : b);

/**
 * Medals for a stored best record against the level's par: { steps, size } (null if not won).
 * Uses the best values (bestSteps/bestSize) when known; records from before Day 21
 * only have booleans, so a kept par flag counts as gold and a plain win as bronze.
 */
export function recordMedals(best, par) {
  if (!best || !best.won) return { steps: null, size: null };
  const one = (flag, value, p) => betterMedal(flag ? 'gold' : 'bronze',
    Number.isFinite(value) ? medalFor(true, value, p ?? null) : null);
  return { steps: one(best.steps, best.bestSteps, par?.steps), size: one(best.size, best.bestSize, par?.size) };
}

const MEDAL_ICON = { gold: '🥇', silver: '🥈', bronze: '🥉' };
/** "Steps 🥇 · Size 🥈" (empty when not won). */
export function medalText(m) {
  if (!m || (!m.steps && !m.size)) return '';
  return `Steps ${MEDAL_ICON[m.steps] || '–'} ${m.steps || ''} · Size ${MEDAL_ICON[m.size] || '–'} ${m.size || ''}`.replace(/ +/g, ' ').trim();
}

/** "★★☆" for 0..3 stars. */
export const starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

/** One line comparing a win with par, e.g. "Steps 31 (par 29) · Size 8 (par 8 ✓)". */
export function parLine(score) {
  const part = (label, s) => (s.par === null ? `${label} ${s.value}`
    : `${label} ${s.value} (par ${s.par}${s.ok ? ' ✓' : ''})`);
  return `${part('Steps', score.steps)} · ${part('Size', score.size)}`;
}

/** Combine a stored best (0..3 or null) with a new score (count only; prefer mergeBest). */
export const bestStars = (prev, score) => Math.max(prev || 0, score.stars);

/**
 * Best record for a level: { won, steps, size } booleans, each kept once earned
 * in any run. `prev` may be null or a malformed stored value.
 */
export function mergeBest(prev, score) {
  const p = prev && typeof prev === 'object' ? prev : {};
  const won = Boolean(p.won) || score.stars > 0;
  const rec = {
    won,
    steps: Boolean(p.steps) || Boolean(score.steps?.ok),
    size: Boolean(p.size) || Boolean(score.size?.ok),
  };
  const low = (a, b) => [a, b].filter((x) => Number.isInteger(x) && x >= 0).reduce((m, x) => Math.min(m, x), Infinity);
  if (score.stars > 0) {
    const bs = low(p.bestSteps, score.steps?.value); const bz = low(p.bestSize, score.size?.value);
    if (bs !== Infinity) rec.bestSteps = bs;
    if (bz !== Infinity) rec.bestSize = bz;
  } else {
    if (Number.isInteger(p.bestSteps)) rec.bestSteps = p.bestSteps;
    if (Number.isInteger(p.bestSize)) rec.bestSize = p.bestSize;
  }
  return rec;
}

/** Stars (0..3) for a best record from mergeBest. */
export const recordStars = (best) => (best && best.won ? 1 + Boolean(best.steps) + Boolean(best.size) : 0);
