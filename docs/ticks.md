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
