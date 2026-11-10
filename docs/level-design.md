# Level design guide

How the 40 shipped levels are built and checked, and how to add one (in code
or in the in-game **Lab**). Format details: the "Level format (v1)" section of
the [README](../README.md#level-format-v1); language: [cog-reference.md](cog-reference.md);
tick order of belts/plates/doors: [ticks.md](ticks.md).

## One idea per level
Every level teaches or tests exactly one new idea, and its `tools` unlock only
what that idea needs. Tests enforce the ladder: tools never get taken away
inside a world's order, and every newly unlocked command is used by the
level's solution (`test/levels.test.js`).

Recipe that worked for all five worlds:
1. **Name the idea** in one sentence ("a register can remember which way to
   turn next"). Write the brief around it; mention new commands in backticks.
2. **Make the idea necessary**, not just possible:
   - sensing levels get 3 test floors where *the best fixed route for one
     floor fails another* (World 2/4 tests check this);
   - memory levels lock the sensor that would make counting pointless;
   - battery (`maxSteps`) set to the optimum forces the efficient route (1-7);
   - crew levels need every robot (World 5 tests run with a robot removed),
     and signal-free versions must fail.
3. **Keep maps small** (most are under 10×8). Big empty rooms make the BFS
   solver slow and the idea blurry.
4. **Write the solution** in the plainest style a player would find. It must
   win on every floor (World 1 tests also require no lint warnings).
5. **Set par**: `steps` = the solver's optimum (`node scripts/level-report.mjs`
   shows it); `size` = the smallest program you know. If a smaller program
   costs more steps, keep both medals as a trade-off and say so in PROGRESS.
6. **Add a hint** that nudges toward the idea without giving the program.

## Story and difficulty
Worlds move from Boot Sequence (sequencing) to Sensor Calibration (sensing,
branches), Assembly Line (functions, state), Maze Wing (wall following, path
planning) and Swarm Floor (crews, signals). Each world opens with an intro and
ends with an outro (`blurb`/`outro` on the world object in `src/game/worlds/w*.js`); the last
level of a world mixes everything it taught. Start a world easy: its first
level should be winnable in under a minute by someone who just learned the
command.

## Checks every level must pass
| Check | Command |
|---|---|
| validates (reachable goals, sizes, fields) and solution wins on every floor | `node --test test/` |
| solvable, par not below the proven optimum | `node scripts/verify-levels.mjs` (`--quick` ≈ 15 s) |
| optimum / par / size table, nothing flagged `!!` | `node scripts/level-report.mjs --md` |
| brief + distinct hint, no TODO, story beats in place | `test/content.test.js` |
| route hint replays and wins (solo levels) | `test/content.test.js` |

## Building in the Lab
The **✎ Lab** screen edits tiles, robots, win rules, tools and up to 5 test
floors with undo/redo. A custom level can only be saved or shared after you
**test-play** it to a win, so every shared level has a known solution. **Share**
produces an `FL1-…` code (version + checksum; `src/game/share-code.js`);
**Import** accepts a code or a `?code=` link.

## Adding a level to the game
1. Add the object to the right world file (`src/game/worlds/w1.js` … `w5.js`) (keep 8 per world).
2. Run the checks above; regenerate `docs/par-table.md` with
   `node scripts/level-report.mjs --md > docs/par-table.md`.
3. Update the level list in the README.
