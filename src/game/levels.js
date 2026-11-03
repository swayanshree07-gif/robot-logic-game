// Level data. Day 1: a handful of prototype levels; the real 40 arrive per PLAN.md.
// Every level carries `solution` — tests run it and require a win.
export const LEVELS = [
  {
    id: 'proto-1',
    name: 'Power On',
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
];
