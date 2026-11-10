// World 3 — "Assembly Line". Functions (`def`) and memory registers
// (`set`/`add`/`sub`, comparisons) for counting and small state machines.
//   1 def: one stair step, called four times   2 def + while + if: loop round a pillar
//   3 memory: count the trip out, walk it back (no bin sensor)
//   4 state machine: a register toggles which way the next blue mark turns
//   5 def + memory: a counted fetch, called three times
//   6 counter that resets: every third yellow mark is a turn
//   7 read a number off the floor (red marks) and use it as a distance
//   8 finale: fetch until the hall is empty, a flag register ends the loop
// Several levels take sensors away (no `bin`, no `clear`), so Pip has to
// remember instead of look. Levels with `floors` are checked on every floor
// (test/world3.test.js). `par` = the solution's steps on floor 1 and its size.
const HANDS = ['move', 'left', 'right', 'grab', 'drop'];
const ALL_SENSORS = ['bin', 'goal', 'clear', 'wall', 'item', 'clear_right', 'red', 'blue', 'clear_left', 'holding'];
const FN = ['repeat', 'while', 'if', 'def'];
const MEM = [...FN, 'memory'];
const tools = (sensors, blocks) => ({ actions: HANDS, sensors, blocks });
const src = (...lines) => lines.join('\n');

export const WORLD3 = {
  id: 'w3',
  name: 'Assembly Line',
  blurb: 'The factory floor. Pip learns to name routines and to remember numbers when sensors go dark.',
  outro: 'Pip names its routines and keeps count in the dark. Next stop: the storage wing nobody has mapped in years.',
  levels: [
    {
      id: 'w3-1',
      par: { steps: 17, size: 8 },
      name: 'Pallet Stairs',
      brief: 'Parts fell down the loading stairs. Every step is the same five moves, so teach Pip a routine once: `def step … end` names it, and writing `step` runs it.',
      hint: 'def step: move, grab, right, move, left. Then call step four times.',
      tools: tools([], FN),
      win: 'collect',
      capacity: 4,
      map: [
        '#########',
        '#>o######',
        '##.o#####',
        '###.o####',
        '####.o###',
        '#########',
      ],
      solution: src('def step', '  move', '  grab', '  right', '  move', '  left', 'end', 'repeat 4', '  step', 'end'),
    },
    {
      id: 'w3-2',
      par: { steps: 21, size: 8 },
      name: 'Pillar Loop',
      brief: 'A machine pillar fills the middle of each bay. Write one routine for a side of the room (drive to the corner, picking up on the way, then turn) and run it round.',
      hint: 'def side: while clear (move, if item grab), then right. repeat 4 side.',
      tools: tools(ALL_SENSORS, FN),
      win: 'collect',
      capacity: 4,
      map: [
        '#######',
        '#>..o.#',
        '#.###.#',
        '#o###o#',
        '#.###.#',
        '#..o..#',
        '#######',
      ],
      floors: [
        [
          '##########',
          '#>.o.....#',
          '#.######o#',
          '#o.......#',
          '##########',
        ],
        [
          '#####',
          '#>.o#',
          '#.#.#',
          '#.#.#',
          '#o.o#',
          '#####',
        ],
      ],
      solution: src('def side', '  while clear', '    move', '    if item', '      grab', '    end', '  end', '  right', 'end', 'repeat 4', '  side', 'end'),
    },
    {
      id: 'w3-3',
      par: { steps: 13, size: 12 },
      name: 'Odometer',
      brief: "The bin sensor is out for repair. Pip has memory now: `set n 0` stores a number, `add n 1` counts, and `while n > 0` checks it. Count the tiles to the part, then walk the same count back — the bin is one tile behind where Pip starts.",
      hint: 'Count moves while not item. Grab, turn round, move once, then move while n > 0 (sub n 1 each time), then drop.',
      tools: tools(['item', 'clear', 'wall'], MEM),
      win: 'deliver',
      map: [
        '#############',
        '#..B>...o...#',
        '#############',
      ],
      floors: [
        [
          '#############',
          '#.B>o.......#',
          '#############',
        ],
        [
          '#############',
          '#B>.......o.#',
          '#############',
        ],
      ],
      solution: src('set n 0', 'while not item', '  move', '  add n 1', 'end', 'grab', 'right', 'right', 'move', 'while n > 0', '  move', '  sub n 1', 'end', 'drop'),
    },
    {
      id: 'w3-4',
      par: { steps: 15, size: 10 },
      name: 'Zigzag Relay',
      brief: 'The relay route is marked in blue only. The first blue mark means turn right, the next means turn left, and so on. Pip has no wall sensors here, so a register must remember which turn comes next. That is a state machine.',
      hint: 'Keep `turn` at 0 or 1. On blue: if turn == 0 then right and set turn 1, else left and set turn 0. Move every tick.',
      tools: tools(['goal', 'blue'], MEM),
      win: 'reach',
      map: [
        '##########',
        '#>.b.....#',
        '#........#',
        '#..b..b..#',
        '#........#',
        '#.....b.G#',
        '##########',
      ],
      floors: [
        [
          '##########',
          '#>b......#',
          '#.bb.....#',
          '#..bb....#',
          '#...bb...#',
          '#....G...#',
          '##########',
        ],
        [
          '##########',
          '#>.....b.#',
          '#........#',
          '#........#',
          '#......G.#',
          '##########',
        ],
      ],
      solution: src('set turn 0', 'while not goal', '  if blue', '    if turn == 0', '      right', '      set turn 1', '    else', '      left', '      set turn 0', '    end', '  end', '  move', 'end'),
    },
    {
      id: 'w3-5',
      par: { steps: 47, size: 18 },
      name: 'Return Trip',
      brief: 'Three parts down the line, one gripper, and still no bin sensor. Put the counted out-and-back trip in a routine and run it three times. Registers keep their value between calls, so reset the count at the start of each trip.',
      hint: 'def fetch: set n 0, count out to the item, grab, turn, walk n back plus one onto the bin, drop, turn, move back to the start.',
      tools: tools(['item', 'clear', 'wall'], MEM),
      win: 'deliver',
      map: [
        '############',
        '#.B>.o.o..o#',
        '############',
      ],
      floors: [
        [
          '############',
          '#.B>ooo....#',
          '############',
        ],
        [
          '############',
          '#B>....o.oo#',
          '############',
        ],
      ],
      solution: src(
        'def fetch', '  set n 0', '  while not item', '    move', '    add n 1', '  end', '  grab', '  right', '  right',
        '  while n > 0', '    move', '    sub n 1', '  end', '  move', '  drop', '  right', '  right', '  move', 'end',
        'repeat 3', '  fetch', 'end'),
    },
    {
      id: 'w3-6',
      par: { steps: 12, size: 8 },
      name: 'Every Third Mark',
      brief: 'Yellow marks are spaced along the inspection route, but only every third one is a turn (right). Count the marks, turn on the third, and start counting again.',
      hint: 'On yellow: add k 1, and if k == 3 then right and set k 0. Move every tick until goal.',
      tools: tools(['goal', 'yellow'], MEM),
      win: 'reach',
      map: [
        '###########',
        '#>y.yy....#',
        '#....y....#',
        '#....y....#',
        '#.Gyyy....#',
        '#.........#',
        '###########',
      ],
      floors: [
        [
          '###########',
          '#>yyy.....#',
          '#...y.....#',
          '#...G.....#',
          '#.........#',
          '###########',
          '###########',
        ],
        [
          '###########',
          '#>.y..y.y.#',
          '#.........#',
          '#.......G.#',
          '#.........#',
          '#.........#',
          '###########',
        ],
      ],
      solution: src('set k 0', 'while not goal', '  if yellow', '    add k 1', '    if k == 3', '      right', '      set k 0', '    end', '  end', '  move', 'end'),
    },
    {
      id: 'w3-7',
      par: { steps: 12, size: 12 },
      name: 'Floor Select',
      brief: 'The work order is painted on the floor: the number of red marks in the hall is the level of the lift shaft that needs the part. The shaft goes on below the bin, and the bin sensor is still out, so count.',
      hint: 'Grab, count red tiles while clear, turn right at the end, move down k tiles, drop.',
      tools: tools(['clear', 'wall', 'red'], MEM),
      win: 'deliver',
      map: [
        '##########',
        '#>or.r...#',
        '########.#',
        '########B#',
        '########.#',
        '########.#',
        '##########',
      ],
      floors: [
        [
          '##########',
          '#>or.rr..#',
          '########.#',
          '########.#',
          '########B#',
          '########.#',
          '##########',
        ],
        [
          '##########',
          '#>o..r...#',
          '########B#',
          '########.#',
          '########.#',
          '########.#',
          '##########',
        ],
      ],
      solution: src('move', 'grab', 'set k 0', 'while clear', '  move', '  if red', '    add k 1', '  end', 'end', 'right', 'while k > 0', '  move', '  sub k 1', 'end', 'drop'),
    },
    {
      id: 'w3-8',
      par: { steps: 29, size: 23 },
      name: 'Last Call',
      brief: 'End of the line: bin every part in the hall, however many there are. Pip only knows the hall is empty when a trip reaches the far wall without finding one, so keep a flag register `more` and loop while it is 1.',
      hint: 'In fetch: count out while not item and clear. If item, grab; else set more 0. Walk back, drop if holding, turn and step out again.',
      tools: tools(['item', 'clear', 'wall', 'holding'], MEM),
      win: 'deliver',
      map: [
        '############',
        '#.B>..o.o..#',
        '############',
      ],
      floors: [
        [
          '############',
          '#.B>o......#',
          '############',
        ],
        [
          '############',
          '#.B>.o.o.oo#',
          '############',
        ],
      ],
      solution: src(
        'def fetch', '  set n 0', '  while not item and clear', '    move', '    add n 1', '  end',
        '  if item', '    grab', '  else', '    set more 0', '  end', '  right', '  right',
        '  while n > 0', '    move', '    sub n 1', '  end', '  move', '  if holding', '    drop', '  end',
        '  right', '  right', '  move', 'end',
        'set more 1', 'while more == 1', '  fetch', 'end'),
    },
  ],
};
