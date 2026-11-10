# Cog language reference

Cog is the little language Pip and the crew run. It is line based: one
statement per line, blocks close with `end`, `#` starts a comment, and words
are case-insensitive. The in-game **? Help** dialog is a short version of this
page. Source of truth: `src/lang/parser.js` (syntax), `src/lang/vm.js`
(running), `src/world/world.js` (what actions and sensors do).

Contents: [Actions](#actions) · [Blocks](#blocks) · [Functions](#functions) ·
[Sensors](#sensors) · [Conditions](#conditions) · [Memory registers](#memory-registers) ·
[Signals](#signals) · [Limits and stops](#limits-and-stops) · [Scoring](#scoring) ·
[Unlock order](#unlock-order)

## Actions
Each action costs one **step** (one tick of the factory: belts and doors move
after every action, see [ticks.md](ticks.md)).

| Command | Effect |
|---|---|
| `move` / `move N` | drive forward 1 or N tiles (N = 1–99; each tile is a step). Driving into a wall stops the run with a bump. |
| `left`, `right` | turn 90° on the spot |
| `grab` | pick up the part on this tile (up to the level's `capacity`) |
| `drop` | put a part down; on a bin it counts as delivered |
| `wait` | stand still for one step (with a name it is a signal wait, see below) |

## Blocks
```
repeat 4          # or: repeat 4 times   (1–999)
  move
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
```
Blocks nest freely. `elif` and `else` are optional; at most one `else`, last.

## Functions
```
def hop           # top level only, anywhere in the file
  move
  left
end
hop               # call by name
hop
```
Functions take no arguments, may call each other and themselves (up to 64
calls deep). A function name may not clash with a command, sensor or register.

## Sensors
All sensors are true/false and cost no step.

| Sensor | True when |
|---|---|
| `clear` | the tile ahead can be driven onto |
| `wall` | the tile ahead is a wall or a closed door (other robots are not walls) |
| `clear_left`, `clear_right` | the tile to that side is free |
| `goal` | standing on a charging pad |
| `item` | a part lies on this tile |
| `holding` | the gripper holds at least one part |
| `bin` | standing on a bin |
| `red`, `yellow`, `blue` | the floor under Pip has that colour |
| `scan` | path planner: the tile ahead is one step closer (shortest path) to the current target — a bin while holding, else the nearest part, else a pad |
| `signal` | crews: some signal is pending |

## Conditions
Combine sensors with `not`, `and`, `or` and parentheses; `not` binds tightest,
then `and`, then `or`. `true` and `false` are constants. Registers and numbers
compare with `==  !=  <  >  <=  >=`:
```
while not (goal or holding)
if n >= 3 and clear
```
A number alone is not a condition, and sensors can't be compared.

## Memory registers
```
set n 0           # store a number
add n 1           # n = n + 1   (the value may be a register: add n m)
sub n 1
if n == 3
```
Registers are named integers (−999..999) that start at 0. They are created by
being written; reading one that is never written anywhere is an error (it is
almost always a typo). At most 8 names. `set`/`add`/`sub` cost no step.
The debugger's memory panel shows their values while stepping.

## Signals
Crew levels (several robots, one program each) coordinate with signals:

| Command | Effect |
|---|---|
| `send NAME` | raise signal NAME (no step). Signals count up: two sends, two waits. |
| `wait NAME` | stand still until a NAME signal is pending, then use one up |

Robots act in lock-step rounds in robot order. If every running robot waits
and nothing can move, the run stops with a **deadlock** message naming who
waits for what. Two robots driving into the same tile is a crash.

## Limits and stops
A run stops with a clear message when Pip:
- bumps into a wall or closed door,
- recurses more than 64 calls deep,
- runs 10 000 operations in a row without an action (stuck in a loop that
  only senses or counts),
- repeats exactly the same situation (position, memory, program point):
  a provable infinite loop,
- uses up the battery (`maxSteps`, 2000 by default).

Mistakes in the source give a positioned error with a hint, e.g.
`Line 2, col 6: unknown sensor 'yelow' — did you mean 'yellow'?`. Lint
warnings (never-called function, empty block, `repeat 1`, a signal nobody sends, …) don't stop a run.

## Scoring
- **steps**: actions used by the winning run.
- **size**: number of statements; every line that does something counts once,
  plus each `elif`/`else` and each `def`. Comments, `end` and blank lines are free.

Stars: 1 for a win, +1 for steps ≤ par, +1 for size ≤ par (kept separately,
so two programs may earn them). Medals per metric: gold ≤ par, silver ≤ 1.5 ×
par, bronze for any win. See `src/game/score.js`.

## Unlock order
Each level lists the commands it allows (`tools`); using a locked one gives a
positioned error. Roughly: World 1 actions, `repeat`; World 2 sensors,
`while`, `if/elif/else`; World 3 `def` and registers; World 4 maze sensing and
`scan`; World 5 `send`, `wait NAME`, `signal`. `node scripts/level-report.mjs`
lists the new commands per level.
