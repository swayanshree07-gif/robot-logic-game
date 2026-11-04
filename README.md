# Night Shift at Ferrolab

An original browser puzzle game. You program **Pip**, a small maintenance robot
working the night shift in the Ferrolab robotics factory, using **Cog** — a tiny
line-based command language — to solve grid puzzles. The planned game has 40
levels in 5 worlds that each teach one robotics/CS idea (sequencing, sensing,
loops, conditionals, functions, state machines, path planning, cooperation),
plus a step debugger, level editor with share codes, sound and saved progress.
See `PLAN.md` for the 30-day roadmap and `PROGRESS.md` for the daily log.

## Run it
No build step, no dependencies. ES modules need to be served over HTTP:

```sh
timeout 600 python3 -m http.server 8000   # then open http://localhost:8000
```

## Test it
Requires Node 18+.

```sh
node --test test/                 # parser, VM, world, runner, debugger, errors, every level's solution, solver
node scripts/check-static.mjs     # browser files/imports exist and parse
UPDATE_SNAPSHOTS=1 node --test test/errors.test.js   # regenerate error-message snapshots
scripts/screenshots.sh            # headless-Firefox smoke shots -> .tmp/shots/ (optional)
```
Error-message wording is pinned by `test/snapshots/errors.snap.txt`; after an
intentional change, regenerate it and review the diff.

Dev URL parameters (handy for scripted screenshots): `?level=N` opens level N
(position in the full list: 1–8 World 1, 9–13 Prototype Bay);
`&code=...` (URL-encoded) loads that program; `&run=1` takes one step,
`&run=all` runs it instantly (finished before the first paint); `&solve=1` runs
the level's known solution; `&bp=2,5` sets breakpoints.

## Playing
Pick a level, write Pip's program, then **Run** (Ctrl+Enter; becomes Pause),
**Step** one action at a time (Ctrl+Shift+Enter), **Stop** where it is, or
**Reset** to the start (Esc). Speed goes from Slow to Instant and is remembered.
The running line is highlighted in the editor; errors get a red gutter mark and
the offending text is selected. A banner reports the result and offers the next
level after a win. Tab / Shift+Tab indent, Enter keeps indentation. Each level's
draft is saved in localStorage.

**Debugging:** click a line number (or press F9 on a line) to set a
breakpoint (red dot). Run pauses *before* that line executes (the line gets a
red band); Resume or Step continue past it. **Step over** (F10) is Step, but a
function call runs to completion in one go; **Step out** (Shift+F11) finishes
the current function and pauses right after it returns. While a run is in
progress the debugger panel lists the call stack (innermost first, with the
line each function was called from) and every active `repeat` block with its
line and pass ("pass 2 of 4"). Breakpoints are saved per level and still
pause step over / step out.

**Look:** the factory floor is pixel art drawn entirely in code (16 art pixels
per tile, scaled by whole numbers): steel floor plates with grates and bolts,
walls in 3/4 view with pipes, charging-pad goals, purple bins, gear parts, and
Pip with four facing sprites. Pip glides between tiles, hops when turning and
lurches when bumping a wall; with `prefers-reduced-motion` it snaps instead.

## Cog in 30 seconds
```
# comments start with #
move 3            # also: left right grab drop wait
repeat 4
  move
  right
end
while clear and not goal
  move
end
if wall
  left
elif clear_right
  right
else
  wait
end
def hop           # functions: define anywhere at top level, call by name
  move
  left
end
hop
```
Sensors: `clear`, `wall`, `clear_left`, `clear_right` (range finders), `goal`,
`item`, `holding`, `bin` (tile / gripper), `red`, `yellow`, `blue` (floor colour
under Pip). Combine with `not`, `and`, `or`, parentheses.

Mistakes get a friendly message with line, column and a caret, plus a hint:
```
Line 2, col 6: unknown sensor 'yelow' — did you mean 'yellow'?
 2 |   if yelow
   |      ^^^^^
```
Runs stop with a clear reason when Pip bumps a wall, recurses more than 64
calls deep, loops without acting, repeats exactly the same situation (provable
infinite loop), or uses up the 2000-step battery.

## Level format (v1)
Levels are plain JSON-compatible objects (`src/world/level.js` validates them,
fills defaults and round-trips JSON):
```js
{ id: 'proto-8', name: 'Round Trip', brief: 'Shown to the player.',
  map: ['#######',
        '#G>.oB#',
        '#######'],
  win: ['deliver', 'reach'],   // or 'reach' | 'collect' | {type:'deliver', count:2}
  capacity: 1,                 // parts Pip can carry (1..9)
  maxSteps: 2000,              // battery
  tools: { actions: [...], sensors: [...], blocks: ['repeat','while','if','def'] },
  solution: 'move 2\ngrab\n…', hint: 'optional' }
```
Map legend: `#` wall, `.` floor, `G` goal pad, `B` bin, `o` part, `r y b`
coloured floor, `> v < ^` Pip's start and facing. Win rules: **reach** (stand on
a pad), **collect** (no parts left on the floor), **deliver** (parts dropped into
bins, all or `count`); a list means all at once. `tools` restricts the commands
on a level; using a locked one gives a positioned error. Validation catches
unreachable goals/parts/bins, unknown fields, bad counts, oversize maps, etc.

## Levels
Levels are grouped into worlds (`src/game/levels.js` → `WORLDS`, `LEVELS`).
- **World 1 "Boot Sequence"** (`src/game/worlds/w1.js`, 8 levels, no sensors):
  1-1 Wake-Up Call (`move N`), 1-2 Locker Corner (turns), 1-3 About Face
  (turning around), 1-4 Stairwell (`repeat`), 1-5 Loose Bolt (`grab`/`drop`),
  1-6 Restock Run (a job inside a repeat), 1-7 Low Battery (battery = the
  fewest possible steps, so turns matter), 1-8 Junction Sweep (nested repeat).
- **Prototype Bay** (P-1…P-5): the earlier sensor/loop test rigs, playable
  until Worlds 2–5 replace them.

`test/levels.test.js` checks per world that every solution wins, tools unlock
in order (nothing learned is taken away; each new command is used), the
level's idea is really used (e.g. nested repeat on 1-8, repeat beats the flat
program), and that 1-7's battery equals the optimum found by the BFS solver
(`src/game/solver.js`, which also proves every level solvable).

## Layout
- `src/lang/` — parser (source → AST), compiler (AST → bytecode), steppable VM,
  `errors.js` (positions, "did you mean", caret formatting)
- `src/world/` — grid world: map format, sensors, actions, win rules
- `src/game/` — level data by world (each with a tested solution), BFS
  `solver.js` (fewest-action wins), `Runner` (world + VM,
  win check, step budget, infinite-loop detection) and `PlaySession`
  (run/pause/step/stop/reset/speed state machine), shared by tests and UI
- `src/world/level.js` — level format v1: validation, defaults, JSON, goal text
- `src/ui/art.js` — pure art data/helpers: sprite strings, layout, wall
  autotile masks, tile hash, easing, `Animator` (tweens Pip between ticks)
- `src/ui/` — browser code: canvas renderer (art drawn in code), code editor
  (gutter + line band; pure logic in `editor-model.js`) and page wiring
- `test/` — `node --test` suites; `scripts/` — check scripts

## Status
Day 5 of 30 (milestones through Day 7 done): language core with friendly
positioned errors, step limits and infinite-loop detection; level format v1
with validation, per-level unlocked commands and reach/collect/deliver win
rules; World 1 (8 levels) plus 5 prototype levels; a level-screen UI with
line-numbered editor, Run/Pause/Step/Stop/Reset, speed control, HUD and result
banner; code-drawn pixel art with tweened animation; a step debugger with
breakpoints, step over / step out and a call-stack / repeat-block panel; a BFS
solver for level verification. 92 automated tests. Next: Day 8 — functions
polish and par scores (size & steps) for World 1.
