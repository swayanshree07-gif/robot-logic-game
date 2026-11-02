// Grid world model for Ferrolab. Pure, no DOM.
//
// Map legend (ASCII rows, all the same length):
//   #  wall            .  floor
//   G  goal pad        o  spare part (item) on floor
//   B  bin (drop parts here)
//   ^ > v <  Pip's start position and facing (floor underneath)

export const DIRS = [
  { name: 'N', dx: 0, dy: -1 },
  { name: 'E', dx: 1, dy: 0 },
  { name: 'S', dx: 0, dy: 1 },
  { name: 'W', dx: -1, dy: 0 },
];
const START = { '^': 0, '>': 1, 'v': 2, '<': 3 };
const TILES = { '#': 'wall', '.': 'floor', 'G': 'goal', 'B': 'bin', 'o': 'floor' };

export function parseMap(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('map must be a non-empty array of rows');
  const width = rows[0].length;
  const tiles = [];
  const items = [];
  let robot = null;
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`map row ${y} has length ${row.length}, expected ${width}`);
    const line = [];
    [...row].forEach((ch, x) => {
      if (ch in START) {
        if (robot) throw new Error('map has more than one robot start');
        robot = { x, y, dir: START[ch] };
        line.push('floor');
      } else if (ch in TILES) {
        line.push(TILES[ch]);
        if (ch === 'o') items.push({ x, y });
      } else {
        throw new Error(`unknown map character '${ch}' at ${x},${y}`);
      }
    });
    tiles.push(line);
  });
  if (!robot) throw new Error('map has no robot start (^ > v <)');
  return { width, height: rows.length, tiles, items, robot };
}

export class World {
  /** level: { map: string[], win?: 'reach' | 'deliver' } */
  constructor(level) {
    const m = parseMap(level.map);
    this.width = m.width;
    this.height = m.height;
    this.tiles = m.tiles;
    this.items = m.items.map((p) => ({ ...p }));
    this.robot = { ...m.robot, holding: false };
    this.delivered = 0;
    this.totalItems = m.items.length;
    this.win = level.win || 'reach';
    this.log = []; // events for renderer/sound: {type, ...}
  }

  tile(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 'wall';
    return this.tiles[y][x];
  }

  itemAt(x, y) {
    return this.items.findIndex((it) => it.x === x && it.y === y);
  }

  ahead(turn = 0) {
    const d = DIRS[(this.robot.dir + turn + 4) % 4];
    return { x: this.robot.x + d.dx, y: this.robot.y + d.dy };
  }

  isBlocked(x, y) {
    return this.tile(x, y) === 'wall';
  }

  sense(name) {
    const r = this.robot;
    switch (name) {
      case 'clear': { const p = this.ahead(0); return !this.isBlocked(p.x, p.y); }
      case 'wall': { const p = this.ahead(0); return this.isBlocked(p.x, p.y); }
      case 'clear_left': { const p = this.ahead(-1); return !this.isBlocked(p.x, p.y); }
      case 'clear_right': { const p = this.ahead(1); return !this.isBlocked(p.x, p.y); }
      case 'goal': return this.tile(r.x, r.y) === 'goal';
      case 'item': return this.itemAt(r.x, r.y) >= 0;
      case 'holding': return r.holding;
      default: throw new Error(`unknown sensor ${name}`);
    }
  }

  act(name) {
    const r = this.robot;
    switch (name) {
      case 'move': {
        const p = this.ahead(0);
        if (this.isBlocked(p.x, p.y)) {
          this.log.push({ type: 'bump', x: p.x, y: p.y });
          return { ok: false, error: 'Pip bumped into a wall' };
        }
        r.x = p.x; r.y = p.y;
        this.log.push({ type: 'move', x: r.x, y: r.y });
        return { ok: true };
      }
      case 'left': r.dir = (r.dir + 3) % 4; this.log.push({ type: 'turn', dir: r.dir }); return { ok: true };
      case 'right': r.dir = (r.dir + 1) % 4; this.log.push({ type: 'turn', dir: r.dir }); return { ok: true };
      case 'wait': this.log.push({ type: 'wait' }); return { ok: true };
      case 'grab': {
        if (r.holding) return { ok: false, error: 'Pip is already holding a part' };
        const i = this.itemAt(r.x, r.y);
        if (i < 0) return { ok: false, error: 'there is no part here to grab' };
        this.items.splice(i, 1);
        r.holding = true;
        this.log.push({ type: 'grab', x: r.x, y: r.y });
        return { ok: true };
      }
      case 'drop': {
        if (!r.holding) return { ok: false, error: 'Pip is not holding anything' };
        if (this.tile(r.x, r.y) === 'bin') {
          this.delivered++;
        } else {
          if (this.itemAt(r.x, r.y) >= 0) return { ok: false, error: 'there is already a part on this tile' };
          this.items.push({ x: r.x, y: r.y });
        }
        r.holding = false;
        this.log.push({ type: 'drop', x: r.x, y: r.y });
        return { ok: true };
      }
      default: return { ok: false, error: `unknown action ${name}` };
    }
  }

  isWon() {
    if (this.win === 'reach') return this.tile(this.robot.x, this.robot.y) === 'goal';
    if (this.win === 'deliver') return this.delivered === this.totalItems;
    return false;
  }
}
