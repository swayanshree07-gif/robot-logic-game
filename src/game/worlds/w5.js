// World 5 — "Swarm Floor". Crews of two, then three robots: Pip and Bolt share the floor.
//   1 a partner holds the plate: poll the door with `while not clear: wait`
//   2 signals both ways: `send open` / `wait out` so the plate is held exactly
//     as long as Pip is inside (floors move the part, fixed waits fail)
//   3 bucket brigade: Bolt fetches, drops on the yellow hand-off tile, Pip
//     carries to the bin; `ready` / `free` signals keep them from colliding
//   4 door swap: each robot holds a plate for the other; the swap happens in
//     one round (Pip steps off plate A as Bolt steps on plate B) so the door
//     never shuts
//   5 token ring: Cog joins; three robots share one bin and pass a turn
//     along with signals b -> c
//   6 doorstop: a part dropped on the plate holds the door for good; Pip
//     waits for the last robot before it may step out of the plate lane
//   7 relay line: two hand-off tiles, three robots, four signal names
//   8 night shift: Cog holds the plate; Pip and Bolt share a one-lane
//     corridor both ways and a side-alcove bin
// Robots are numbered in map reading order. Every level is checked in
// test/world5.test.js: shipped programs win on every floor, and one-robot or
// signal-free attempts fail.
const HANDS = ['move', 'left', 'right', 'grab', 'drop', 'wait'];
const src = (...lines) => lines.join('\n');
const R3 = [{ name: 'Pip' }, { name: 'Bolt' }, { name: 'Cog' }];
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
    {
      id: 'w5-5',
      par: { steps: 21, size: 36 },
      name: 'Token Ring',
      brief: 'Cog joins the crew. Three robots, three parts, one bin in the middle, and only one robot fits on the bin. Pass a turn token around: Pip goes first, then "send b" lets Bolt in, and Bolt\'s "send c" lets Cog in.',
      hint: 'Each robot: turn round, fetch its part, come back next to the bin. Bolt and Cog wait for their letter before stepping onto the bin; after dropping, step off and send the next letter.',
      tools: tools(['clear', 'item', 'bin'], ['while', 'repeat', 'if', 'signal']),
      robots: R3,
      win: 'deliver',
      map: [
        '#########',
        '#o.>B<.o#',
        '####^####',
        '####.####',
        '####o####',
        '#########',
      ],
      solutions: [
        src('right', 'right', 'move 2', 'grab', 'right', 'right', 'move 3', 'drop', 'right', 'right', 'move', 'send b'),
        src('right', 'right', 'move 2', 'grab', 'right', 'right', 'move 2', 'wait b', 'move', 'drop', 'right', 'right', 'move', 'send c'),
        src('right', 'right', 'move 2', 'grab', 'right', 'right', 'move 2', 'wait c', 'move', 'drop'),
      ],
    },
    {
      id: 'w5-6',
      par: { steps: 20, size: 18 },
      name: 'Doorstop',
      brief: 'All three robots must park on the pads behind the door, so nobody can stay on the plate. But a part lying on a plate holds it down too! Pip fetches the part from below the plate and drops it on the plate: a doorstop.',
      hint: 'Pip: turn south, step over the plate, grab, come back onto the plate, drop, send open, then wait until Cog has passed. Bolt: wait open, pass the signal on, go. Cog: wait open, go, send last.',
      tools: tools(['clear', 'item', 'goal'], ['while', 'repeat', 'if', 'signal']),
      robots: R3,
      win: 'reach',
      map: [
        '##########',
        '#GGGD.<<<#',
        '######_###',
        '######o###',
        '##########',
      ],
      solutions: [
        src('left', 'move 2', 'grab', 'right', 'right', 'move', 'drop', 'send open', 'wait last', 'move', 'left', 'move 3'),
        src('wait open', 'send open', 'move 6'),
        src('wait open', 'move 6', 'send last'),
      ],
    },
    {
      id: 'w5-7',
      par: { steps: 80, size: 45 },
      name: 'Relay Line',
      brief: 'A longer bucket brigade: Cog fetches parts and drops them on the right yellow tile, Bolt carries them to the left yellow tile, and Pip takes them to the bin. Two hand-off tiles means two pairs of signals.',
      hint: 'Use ready1/free1 between Pip and Bolt and ready2/free2 between Bolt and Cog. Whoever takes from a tile starts by sending its "free" signal once.',
      tools: tools(['clear', 'item', 'bin', 'yellow'], ['while', 'repeat', 'if', 'signal']),
      robots: R3,
      win: 'deliver',
      map: [
        '################',
        '#B.>.y.>.y.>ooo#',
        '################',
      ],
      solutions: [
        src('send free1', 'repeat 3', '  wait ready1', '  move 2', '  grab', '  right', '  right', '  while not bin', '    move', '  end', '  drop', '  right', '  right', '  move 2', '  send free1', 'end'),
        src('send free2', 'repeat 3', '  wait ready2', '  move 2', '  grab', '  right', '  right', '  move', '  send free2', '  wait free1', '  move 3', '  drop', '  right', '  right', '  move', '  send ready1', '  move', 'end'),
        src('repeat 3', '  wait free2', '  while not item', '    move', '  end', '  grab', '  right', '  right', '  while not yellow', '    move', '  end', '  drop', '  right', '  right', '  move', '  send ready2', 'end'),
      ],
    },
    {
      id: 'w5-8',
      par: { steps: 28, size: 32 },
      name: 'Night Shift',
      brief: 'Last job of the shift. Cog holds the door plate. Pip and Bolt fetch the two parts through the one-lane corridor and drop them in the bin in the side alcove. Robots act in number order, so Pip must lead on the way back and clear the alcove before Bolt arrives.',
      hint: 'Cog: move, send open twice. Pip: wait open, wait one round so Bolt goes first, fetch the near part, send go, walk back, use the bin, step out west, send free. Bolt: wait open, fetch the far part, wait go, walk back, wait free, use the bin.',
      tools: tools(['clear', 'item', 'bin'], ['while', 'repeat', 'if', 'signal']),
      robots: R3,
      win: 'deliver',
      map: [
        '###########',
        '#...>>D.oo#',
        '##B###_####',
        '######^####',
        '###########',
      ],
      solutions: [
        src('wait open', 'wait', 'move 4', 'grab', 'right', 'right', 'send go', 'move 6', 'left', 'move', 'drop', 'right', 'right', 'move', 'left', 'move', 'send free'),
        src('wait open', 'move 4', 'grab', 'right', 'right', 'wait go', 'move 6', 'wait free', 'move', 'left', 'move', 'drop'),
        src('move', 'send open', 'send open'),
      ],
    },
  ],
};
