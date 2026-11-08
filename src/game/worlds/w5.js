// World 5 — "Swarm Floor". Two robots, one job: Pip and Bolt share the floor.
//   1 a partner holds the plate: poll the door with `while not clear: wait`
//   2 signals both ways: `send open` / `wait out` so the plate is held exactly
//     as long as Pip is inside (floors move the part, fixed waits fail)
//   3 bucket brigade: Bolt fetches, drops on the yellow hand-off tile, Pip
//     carries to the bin; `ready` / `free` signals keep them from colliding
//   4 door swap: each robot holds a plate for the other; the swap happens in
//     one round (Pip steps off plate A as Bolt steps on plate B) so the door
//     never shuts
// Robots are numbered in map reading order. Every level is checked in
// test/world5.test.js: shipped programs win on every floor, and one-robot or
// signal-free attempts fail.
const HANDS = ['move', 'left', 'right', 'grab', 'drop', 'wait'];
const src = (...lines) => lines.join('\n');
const tools = (sensors, blocks) => ({ actions: HANDS, sensors, blocks });

const FETCH_BACK = ['while not item', '  move', 'end', 'grab', 'right', 'right', 'while not bin', '  move', 'end', 'drop'];

export const WORLD5 = {
  id: 'w5',
  name: 'Swarm Floor',
  blurb: 'Bolt joins Pip on the factory floor. Two robots, two programs, one job: hold doors, hand parts over, and signal each other.',
  levels: [
    {
      id: 'w5-1',
      par: { steps: 14, size: 11 },
      name: 'Hold the Door',
      brief: 'Meet Bolt, the new crew robot. The part is behind a door, and the door only opens while someone stands on the plate. Bolt\'s job: step onto the plate and stay. Pip\'s job: wait until the door is open, then fetch the part.',
      hint: 'Pip: while not clear: wait. Bolt: one move, then its program just ends and it stays put.',
      tools: tools(['clear', 'item', 'bin'], ['while', 'repeat', 'if']),
      robots: [{ name: 'Pip' }, { name: 'Bolt' }],
      win: 'deliver',
      map: [
        '##########',
        '#B..>D.o.#',
        '######_###',
        '######^###',
        '##########',
      ],
      floors: [
        ['##########', '#B..>D..o#', '######_###', '######^###', '##########'],
        ['###########', '#B..>D.o..#', '######_####', '######^####', '###########'],
      ],
      solutions: [src('while not clear', '  wait', 'end', ...FETCH_BACK), 'move'],
    },
    {
      id: 'w5-2',
      par: { steps: 25, size: 19 },
      name: 'Round Trip',
      brief: 'This time both robots must end on a charging pad, so Bolt can\'t stay on the plate forever. Signals tell the other robot what happened: "send open" when the plate is held, "wait out" until Pip is back outside.',
      hint: 'Bolt: move 2, send open, wait out, turn round, move. Pip: wait open, fetch, drop, turn round, step onto the pad, send out.',
      tools: tools(['clear', 'item', 'bin'], ['while', 'repeat', 'if', 'signal']),
      robots: [{ name: 'Pip' }, { name: 'Bolt' }],
      win: ['deliver', 'reach'],
      map: [
        '##########',
        '#BG>D...o#',
        '#####_####',
        '#####G####',
        '#####^####',
        '##########',
      ],
      floors: [
        ['##########', '#BG>D.o..#', '#####_####', '#####G####', '#####^####', '##########'],
        ['############', '#BG>D.....o#', '#####_######', '#####G######', '#####^######', '############'],
      ],
      solutions: [
        src('wait open', ...FETCH_BACK, 'right', 'right', 'move', 'send out'),
        src('move 2', 'send open', 'wait out', 'right', 'right', 'move'),
      ],
    },
    {
      id: 'w5-3',
      par: { steps: 81, size: 28 },
      name: 'Bucket Brigade',
      brief: 'The corridor is too narrow to pass. Bolt fetches parts and drops them on the yellow hand-off tile; Pip takes them from there to the bin. Neither may step onto the yellow tile while the other is using it.',
      hint: 'Pip sends "free" first. Bolt: wait free, fetch, walk back to yellow, drop, step away, send ready. Pip: wait ready, step on, grab, deliver, walk back, send free.',
      tools: tools(['clear', 'item', 'bin', 'yellow'], ['while', 'repeat', 'if', 'signal']),
      robots: [{ name: 'Pip' }, { name: 'Bolt' }],
      win: 'deliver',
      map: [
        '############',
        '#B...>y>ooo#',
        '############',
      ],
      floors: [
        ['##############', '#B...>y>o.o.o#', '##############'],
        ['#############', '#B...>y>.ooo#', '#############'],
      ],
      solutions: [
        src('send free', 'repeat 3', '  wait ready', '  move', '  grab', '  right', '  right', '  while not bin', '    move', '  end', '  drop', '  right', '  right', '  move 4', '  send free', 'end'),
        src('repeat 3', '  wait free', '  while not item', '    move', '  end', '  grab', '  right', '  right', '  while not yellow', '    move', '  end', '  drop', '  right', '  right', '  move', '  send ready', 'end'),
      ],
    },
    {
      id: 'w5-4',
      par: { steps: 33, size: 30 },
      name: 'Door Swap',
      brief: 'Each robot has a part for the bin on the far side of the door. Pip holds plate A while Bolt crosses and comes back; then they swap in a single step: Pip steps off A in the same round that Bolt steps onto B, so the door never shuts.',
      hint: 'Robots act in number order inside a round. Pip: "send swap" then move off the plate; Bolt: "wait swap" then move onto its plate.',
      tools: tools(['clear', 'item', 'bin'], ['while', 'repeat', 'if', 'signal']),
      robots: [{ name: 'Pip' }, { name: 'Bolt' }],
      win: 'deliver',
      map: [
        '###########',
        '#B.o.D.o.B#',
        '##^#_#_#^##',
        '###########',
      ],
      solutions: [
        src('move', 'right', 'move', 'grab', 'move', 'right', 'move', 'send open', 'wait back', 'right', 'right', 'send swap', 'move', 'right', 'move 5', 'drop'),
        src('move', 'left', 'move', 'grab', 'wait open', 'move 6', 'drop', 'right', 'right', 'move 5', 'right', 'send back', 'wait swap', 'move'),
      ],
    },
  ],
};
