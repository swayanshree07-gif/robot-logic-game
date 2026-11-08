// Level data (format v1, see src/world/level.js), grouped into worlds.
// Every level carries `solution` — tests run it and require a win — and
// `tools`, the commands unlocked so far.
//
//   WORLDS      worlds in play order: { id, name, blurb, levels }
//   LEVELS      every playable level, flattened in play order (what the UI lists)
//   PROTOTYPES  the Day 1-3 prototype levels; still used as test fixtures, and the
//               sensor ones stay playable in "Prototype Bay" until Worlds 2+ replace them
//   ALL_LEVELS  LEVELS plus prototypes that aren't playable (for level-wide tests)
import { WORLD1 } from './worlds/w1.js';
import { WORLD2 } from './worlds/w2.js';
import { WORLD3 } from './worlds/w3.js';
import { WORLD4 } from './worlds/w4.js';

export const PROTOTYPES = [
  {
    id: 'proto-1',
    name: 'Power On',
    tools: { actions: ['move'], sensors: [], blocks: [] },
    brief: 'Pip just woke up. Roll forward to the charging pad.',
    win: 'reach',
    map: [
      '#######',
      '#>...G#',
      '#######',
    ],
    solution: 'move 4',
  },
  {
    id: 'proto-2',
    name: 'Corner Office',
    tools: { actions: ['move', 'left', 'right'], sensors: [], blocks: [] },
    brief: 'The pad is around the corner. Turn with left / right.',
    win: 'reach',
    map: [
      '#####',
      '#>..#',
      '###.#',
      '###G#',
      '#####',
    ],
    solution: 'move 2\nright\nmove 2',
  },
  {
    id: 'proto-3',
    name: 'Stairwell',
    tools: { actions: ['move', 'left', 'right'], sensors: [], blocks: ['repeat'] },
    brief: 'Same steps again and again. A repeat block saves typing.',
    win: 'reach',
    map: [
      '#######',
      '#>.####',
      '##..###',
      '###..##',
      '####.G#',
      '#######',
    ],
    solution: 'repeat 3\n  move\n  right\n  move\n  left\nend\nmove',
  },
  {
    id: 'proto-4',
    name: 'Long Hall',
    tools: { actions: ['move', 'left', 'right'], sensors: ['clear', 'wall', 'goal'], blocks: ['repeat', 'while'] },
    brief: "You don't know how long the hall is. Move while the way is clear.",
    win: 'reach',
    map: [
      '############',
      '#>........G#',
      '############',
    ],
    solution: 'while clear\n  move\nend',
  },
  {
    id: 'proto-5',
    name: 'Spare Parts',
    tools: { sensors: [], blocks: ['repeat', 'def'] },
    brief: 'Carry the spare part to the bin.',
    win: 'deliver',
    map: [
      '#######',
      '#>.o.B#',
      '#######',
    ],
    solution: 'def fetch\n  move 2\n  grab\n  move 2\n  drop\nend\nfetch',
  },
  {
    id: 'proto-6',
    name: 'Floor Signs',
    brief: 'Painted marks show the route. Turn right on yellow or blue, otherwise keep rolling.',
    win: 'reach',
    map: [
      '########',
      '#>..y###',
      '####.###',
      '#G..b###',
      '########',
    ],
    solution: 'while not goal\n  if yellow or blue\n    right\n  end\n  move\nend',
  },
  {
    id: 'proto-7',
    name: 'Bolt Sweep',
    brief: "Pip's new hopper holds three parts. Sweep up every bolt in the corridor.",
    win: 'collect',
    capacity: 3,
    tools: { actions: ['move', 'left', 'right', 'grab'], sensors: [], blocks: ['repeat'] },
    map: [
      '#########',
      '#>.o.o.o#',
      '#########',
    ],
    solution: 'repeat 3\n  move 2\n  grab\nend',
  },
  {
    id: 'proto-8',
    name: 'Round Trip',
    brief: 'Bin the part, then come back and dock. Rolling over the pad early does not count.',
    win: ['deliver', 'reach'],
    map: [
      '#######',
      '#G>.oB#',
      '#######',
    ],
    solution: 'move 2\ngrab\nmove\ndrop\nright\nright\nmove 4',
  },
  {
    id: 'proto-10',
    name: 'Belt & Plate Test Rig',
    brief: 'Dev rig for factory mechanics: weigh the plate down with a part to hold the door, ride the belt to the bin, then dock.',
    win: [{ type: 'deliver', count: 1 }, 'reach'],
    map: [
      '#########',
      '#>o_..DG#',
      '#.##.####',
      '#oEEB####',
      '#########',
    ],
    solution: 'move\ngrab\nmove\ndrop\nleft\nleft\nmove 2\nleft\nmove 2\ngrab\nleft\nmove\ndrop\nleft\nmove 2\nright\nmove 3',
  },
  {
    id: 'proto-11',
    name: 'Relay Test Bench',
    brief: 'Dev rig for crews: Bolt holds the plate so Pip can pass the door, then both dock.',
    win: 'reach',
    robots: [{ name: 'Pip' }, { name: 'Bolt' }],
    map: [
      '#######',
      '#>.D.G#',
      '###_###',
      '###^###',
      '###G###',
      '#######',
    ],
    solutions: ['wait go\nmove 3\nsend through\nmove', 'move\nsend go\nwait through\nright\nright\nmove 2'],
  },
  {
    id: 'proto-9',
    name: 'Shuttle Run',
    brief: 'Three parts, one gripper. Shuttle them to the bin one by one — the sensors tell you when to stop.',
    win: 'deliver',
    tools: { sensors: ['item', 'bin', 'holding'], blocks: ['repeat', 'while'] },
    map: [
      '#######',
      '#B>ooo#',
      '#######',
    ],
    solution: [
      'repeat 3',
      '  while not item',
      '    move',
      '  end',
      '  grab',
      '  right',
      '  right',
      '  while not bin',
      '    move',
      '  end',
      '  drop',
      '  right',
      '  right',
      'end',
    ].join('\n'),
  },
];

// The Day-1..4 prototypes are no longer played: World 2 grew out of them.
// They stay in PROTOTYPES / ALL_LEVELS as test fixtures.
export const WORLDS = [WORLD1, WORLD2, WORLD3, WORLD4];

export const LEVELS = WORLDS.flatMap((w) => w.levels);
export const ALL_LEVELS = [...LEVELS, ...PROTOTYPES.filter((p) => !LEVELS.includes(p))];

/** World a level belongs to and its 1-based number inside it, e.g. { world, n: 3 }. */
export function levelPlace(level) {
  for (const world of WORLDS) {
    const i = world.levels.indexOf(level);
    if (i >= 0) return { world, n: i + 1 };
  }
  return null;
}
