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
node --test test/                 # parser, VM, world and level-solution tests
node scripts/check-static.mjs     # browser files/imports exist and parse
```

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
Sensors: `clear`, `wall`, `clear_left`, `clear_right`, `goal`, `item`, `holding`.
Combine with `not`, `and`, `or`, parentheses.

## Layout
- `src/lang/` — parser (source → AST), compiler (AST → bytecode), steppable VM
- `src/world/` — grid world: map format, sensors, actions, win rules
- `src/game/` — level data (each with a tested solution) and headless runner
- `src/ui/` — browser code: canvas renderer (art drawn in code) and page logic
- `test/` — `node --test` suites; `scripts/` — check scripts

## Status
Day 1 of 30: language core (parser, compiler, VM with loop/recursion guards),
world model with grab/drop/deliver, 5 prototype levels, and a playable
prototype page (choose level, write code, Run / Step / Reset).
