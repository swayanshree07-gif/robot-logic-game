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
node --test test/                 # parser, VM, world, runner, error and level-solution tests
node scripts/check-static.mjs     # browser files/imports exist and parse
UPDATE_SNAPSHOTS=1 node --test test/errors.test.js   # regenerate error-message snapshots
```
Error-message wording is pinned by `test/snapshots/errors.snap.txt`; after an
intentional change, regenerate it and review the diff.

Dev shortcut: `index.html?level=N` opens level N; add `&run=1` to take one step.

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

## Layout
- `src/lang/` — parser (source → AST), compiler (AST → bytecode), steppable VM,
  `errors.js` (positions, "did you mean", caret formatting)
- `src/world/` — grid world: map format, sensors, actions, win rules
- `src/game/` — level data (each with a tested solution) and `Runner` (world + VM,
  win check, step budget, infinite-loop detection), shared by tests and UI
- `src/ui/` — browser code: canvas renderer (art drawn in code) and page logic
- `test/` — `node --test` suites; `scripts/` — check scripts

## Status
Day 2 of 30: language core (parser, compiler, VM) with friendly positioned
errors and typo suggestions, step/call-depth limits and infinite-loop
detection; world model with grab/drop/deliver and colour floor markings;
6 prototype levels; a playable prototype page (choose level, write code,
Run / Step / Reset, errors highlighted in the editor). 36 automated tests.
