# Tick semantics (factory mechanics)

A **tick** is one of Pip's actions (`move`, `left`, `right`, `grab`, `drop`, `wait`;
`move 3` is three ticks). Memory ops (`set`/`add`/`sub`) and sensor checks take
no time. The battery (`maxSteps`) counts ticks.

Each tick runs in this fixed order (`World.act` → `World.endTick`, `src/world/world.js`):

1. **Action.** Pip does the action. If it fails (bump, nothing to grab, …) the
   run ends with an error and the factory does **not** update.
2. **Belts.** If Pip stands on a belt (`N E S W` in maps), it is carried one
   tile in the belt's direction, unless that tile is a wall or a shut door
   (then Pip just stays; no bump). Belts never turn Pip. Then every part on a
   belt moves one tile the same way, as a queue: a part only moves if the next
   tile is open and free of parts (parts in front move first, so a line of parts
   advances together). A part that arrives on a bin is delivered.
3. **Doors.** Every door (`D`) is open while *any* pressure plate (`_`) holds
   Pip or a part, otherwise shut. A door with Pip or a part in it can't shut
   (it stays jammed open until the doorway is empty). All plates drive all
   doors in a level (one circuit). Doors are worked out once before the first
   tick, so a level may start with a door open.
4. **Win check.** The runner checks the win rules after the update, so a part
   that a belt drops into a bin counts on that tick, and Pip carried onto a
   goal pad by a belt has reached it.

Consequences worth knowing when designing levels:
- `wait` is how a program lets the factory work (ride a belt, let parts arrive).
- A shut door blocks `move` and reads as not `clear` / `wall`, like a wall.
- Weighing a plate down with a part (`drop` on it) holds doors open for good.
- A belt pointing into a wall parks whatever is on it.
- The solver (`src/game/solver.js`) tries `wait` too; pass `floorDrops: true` if
  the route needs a part dropped somewhere other than a bin (e.g. on a plate).

Events added to `world.log`: `belt` (Pip carried), `carry` (a part moved),
`door` (`open: true|false`), and `drop` with `belt: true` for belt deliveries.
They drive the sounds (`belt`, `door` cues) like the other events.

## Crews (several robots, Day 16)

Maps may hold up to 4 robot starts when run by the crew runner (`src/game/crew.js`);
robots are numbered in reading order (top row first, then left to right). Each robot
runs its own Cog program. One tick = one **round**:

1. Every robot whose program is still running executes up to and including its next
   action, in robot order (robot 1 first). A robot may move into a tile another robot
   left earlier in the same round. Moving into a tile a robot stands on is a **crash**
   (`code: 'crash'`) and ends the run, so robots can never swap places head-on.
2. The factory updates once: belts carry robots (never into another robot), then parts;
   then doors follow the plates (a robot on a plate holds it).
3. Win rules are checked. `reach` needs **every** robot on a goal pad.

A robot whose program ends stands still; the run fails once all programs have ended.
The battery (`maxSteps`) counts rounds. Loop detection covers the world plus all VMs.
One-robot levels still use `Runner` and are unchanged.
