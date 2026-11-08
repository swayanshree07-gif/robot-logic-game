// World map model: which levels are open, star totals, where to continue.
// Pure: takes the worlds and a "won/stars" lookup (normally a SaveStore).
//
// Unlock rule (decided Day 9 session): levels open in play order, but the player may
// have up to OPEN_AHEAD unsolved levels open at once, so one stuck puzzle never
// blocks the game. A level that has been won always stays open. Worlds aren't
// gated separately: a world opens when its first level does.
// Dev URLs (?level=, ?id=) ignore locks.

export const OPEN_AHEAD = 2;

/** Worlds in the plan that aren't built yet, shown as locked cards on the map
 *  (an entry whose id is already a built world is skipped). */
export const UPCOMING_WORLDS = [
  { id: 'w4', name: 'Maze Wing', blurb: 'Path planning and memory in the old storage wing.' },
  { id: 'w5', name: 'Swarm Floor', blurb: 'Several robots, one job: signals and cooperation.' },
];

/** For each level in play order: is it open? `won(id)` → boolean. */
export function openLevels(levels, won) {
  let unsolved = 0;
  return levels.map((l) => {
    if (won(l.id)) return true; // a solved level can always be replayed
    return unsolved++ < OPEN_AHEAD;
  });
}

/**
 * Map model: [{ id, name, blurb, tag, open, built, stars, maxStars, solved, levels: [
 *   { index, id, name, label, stars, won, open, current } ] }]
 * `progress` has won(id) and stars(id); `current` is the level id to mark.
 */
export function mapModel(worlds, progress, { current = null, upcoming = UPCOMING_WORLDS } = {}) {
  const flat = worlds.flatMap((w) => w.levels);
  const open = openLevels(flat, (id) => progress.won(id));
  const built = worlds.map((w, wi) => {
    const levels = w.levels.map((l, n) => {
      const index = flat.indexOf(l);
      return {
        index, id: l.id, name: l.name, label: `${wi + 1}-${n + 1}`,
        stars: progress.stars(l.id), won: progress.won(l.id), open: open[index], current: l.id === current,
      };
    });
    return {
      id: w.id, name: w.name, blurb: w.blurb, tag: String(wi + 1), built: true,
      open: levels.some((l) => l.open),
      stars: levels.reduce((a, l) => a + l.stars, 0),
      maxStars: levels.length * 3,
      solved: levels.filter((l) => l.won).length,
      levels,
    };
  });
  const later = upcoming.filter((w) => !worlds.some((b) => b.id === w.id)).map((w, i) => ({
    ...w, tag: String(worlds.length + i + 1), built: false, open: false, stars: 0, maxStars: 0, solved: 0, levels: [],
  }));
  return [...built, ...later];
}

/** Total stars over the built worlds: { stars, maxStars, solved, count }. */
export function totals(model) {
  const b = model.filter((w) => w.built);
  return {
    stars: b.reduce((a, w) => a + w.stars, 0),
    maxStars: b.reduce((a, w) => a + w.maxStars, 0),
    solved: b.reduce((a, w) => a + w.solved, 0),
    count: b.reduce((a, w) => a + w.levels.length, 0),
  };
}

/**
 * Where "Continue" goes: the last level opened if it's still open and unsolved,
 * otherwise the first open unsolved level, otherwise the last level opened, otherwise 0.
 */
export function continueIndex(levels, progress, last = null) {
  const open = openLevels(levels, (id) => progress.won(id));
  const lastI = levels.findIndex((l) => l.id === last);
  if (lastI >= 0 && open[lastI] && !progress.won(last)) return lastI;
  const next = levels.findIndex((l, i) => open[i] && !progress.won(l.id));
  if (next >= 0) return next;
  return lastI >= 0 ? lastI : 0;
}

/** Is level `i` open? */
export const isOpen = (levels, progress, i) => openLevels(levels, (id) => progress.won(id))[i] === true;
