// Level-editor ("Lab") palette tools: which reducer action a click on a cell makes.
// Pure (no DOM), unit-tested; the UI in src/ui/lab-view.js only maps pixels to cells.
import { ROBOT_CHARS, editedMap } from './level-editor.js';

/** Palette entries in display order: { id, label, tile?, robot? }. */
export const LAB_TOOLS = [
  { id: 'floor', label: 'Floor', tile: '.' },
  { id: 'wall', label: 'Wall', tile: '#' },
  { id: 'goal', label: 'Goal pad', tile: 'G' },
  { id: 'part', label: 'Part', tile: 'o' },
  { id: 'bin', label: 'Bin', tile: 'B' },
  { id: 'red', label: 'Red paint', tile: 'r' },
  { id: 'yellow', label: 'Yellow paint', tile: 'y' },
  { id: 'blue', label: 'Blue paint', tile: 'b' },
  { id: 'beltN', label: 'Belt ↑', tile: 'N' },
  { id: 'beltE', label: 'Belt →', tile: 'E' },
  { id: 'beltS', label: 'Belt ↓', tile: 'S' },
  { id: 'beltW', label: 'Belt ←', tile: 'W' },
  { id: 'plate', label: 'Plate', tile: '_' },
  { id: 'door', label: 'Door', tile: 'D' },
  { id: 'robot', label: 'Robot (click again to turn)', robot: true },
];

export const toolById = (id) => LAB_TOOLS.find((t) => t.id === id) || null;

/**
 * Action for using `toolId` on cell (x, y), or null when nothing would change.
 * Robot tool: empty cell → place facing east; robot cell → turn clockwise.
 */
export function toolAction(state, toolId, x, y) {
  const tool = toolById(toolId);
  const rows = editedMap(state);
  if (!tool || y < 0 || y >= rows.length || x < 0 || x >= rows[0].length) return null;
  const here = rows[y][x];
  if (tool.robot) {
    const d = ROBOT_CHARS.indexOf(here);
    return { type: 'robot', x, y, dir: d < 0 ? 1 : (d + 1) % 4 };
  }
  return here === tool.tile ? null : { type: 'paint', x, y, tile: tool.tile };
}

/** Grid cell under canvas pixel (px, py) for a w×h map drawn with art.js `layout`. */
export function cellAt(L, w, h, px, py) {
  const x = Math.floor((px - L.ox) / L.cell), y = Math.floor((py - L.oy) / L.cell);
  return x >= 0 && y >= 0 && x < w && y < h ? { x, y } : null;
}

/** Win rule list from the form: type + count (deliver only; '' / 0 = all). */
export function winFromForm(type, count) {
  const n = Number(count);
  return [Number.isInteger(n) && n > 0 && type === 'deliver' ? { type, count: n } : { type }];
}

