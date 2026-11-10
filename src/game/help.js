// In-game help: a short Cog reference + controls, as plain data so tests can
// check that every command, sensor and keyword of the language is explained.
// The UI (src/ui/main.js) renders it into the "? Help" dialog. The full
// reference is docs/cog-reference.md.

export const HELP_SECTIONS = [
  {
    title: 'Actions (each costs one step)',
    items: [
      ['move', 'drive forward one tile; `move 3` drives three (1–99)'],
      ['left', 'turn 90° left on the spot'],
      ['right', 'turn 90° right on the spot'],
      ['grab', 'pick up the part on this tile'],
      ['drop', 'put a part down (into a bin if there is one)'],
      ['wait', 'stand still for one step'],
    ],
  },
  {
    title: 'Blocks (close each with end)',
    items: [
      ['repeat', '`repeat 4` … `end` runs the lines inside 4 times'],
      ['while', '`while clear` … `end` loops while a condition holds'],
      ['if', '`if wall` … `elif …` … `else` … `end` picks one branch'],
      ['elif', 'another test inside an if'],
      ['else', 'runs when no earlier test of the if held'],
      ['def', '`def hop` … `end` defines a function; call it as `hop`'],
      ['end', 'closes repeat, while, if and def'],
    ],
  },
  {
    title: 'Sensors (true or false)',
    items: [
      ['clear', 'the tile ahead can be driven onto'],
      ['wall', 'the tile ahead is blocked'],
      ['clear_left', 'the tile to the left is free'],
      ['clear_right', 'the tile to the right is free'],
      ['goal', 'standing on a charging pad'],
      ['item', 'a part lies on this tile'],
      ['holding', 'the gripper holds a part'],
      ['bin', 'standing on a bin'],
      ['red', 'the floor here is red'],
      ['yellow', 'the floor here is yellow'],
      ['blue', 'the floor here is blue'],
      ['scan', 'the tile ahead is one step closer to the current target (World 4)'],
      ['signal', 'some crew signal is pending (World 5)'],
    ],
  },
  {
    title: 'Logic, memory and signals',
    items: [
      ['not', '`while not goal` flips a test'],
      ['and', 'both tests must hold'],
      ['or', 'either test may hold'],
      ['true', 'always true (`while true` loops forever)'],
      ['false', 'never true'],
      ['times', 'optional word: `repeat 3 times`'],
      ['set', '`set n 0` stores a number in register n (no step)'],
      ['add', '`add n 1` adds to a register (no step)'],
      ['sub', '`sub n 1` subtracts from a register (no step)'],
      ['== != < > <= >=', 'compare registers and numbers: `if n < 3`'],
      ['send', '`send go` raises signal go for the crew (no step)'],
      ['wait NAME', '`wait go` stands still until signal go is pending, then uses it up'],
    ],
  },
  {
    title: 'Keys',
    items: [
      ['Ctrl+Enter', 'run / pause'],
      ['Ctrl+Shift+Enter', 'one step'],
      ['F10 / Shift+F11', 'step over / step out (debugger)'],
      ['Esc', 'reset the run (or close a screen)'],
      ['H', 'hint (press again for a route)'],
      ['M', 'world map'],
      ['?', 'this help'],
    ],
  },
];

/** Every word documented in the help, split so `== != …` counts each op. */
export function helpWords() {
  const words = new Set();
  for (const s of HELP_SECTIONS) for (const [k] of s.items) for (const w of k.split(/\s+/)) words.add(w);
  return words;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const code = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

/** HTML for the help dialog body (escaped; only <h3>, <dl>, <code>). */
export function helpHtml() {
  return HELP_SECTIONS.map((s) => `<h3>${esc(s.title)}</h3><dl>${
    s.items.map(([k, v]) => `<dt><code>${esc(k)}</code></dt><dd>${code(v)}</dd>`).join('')}</dl>`).join('');
}
