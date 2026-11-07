// Grid world model for Ferrolab. Pure, no DOM.
//
// Map legend (ASCII rows, all the same length):
//   #  wall            .  floor
//   G  goal pad        o  spare part (item) on floor
//   B  bin (drop parts here)
//   r y b  floor painted red / yellow / blue (read with the colour sensors)
//   ^ > v <  Pip's start position and facing (floor underneath)

export const DIRS = [
  { name: 'N', dx: 0, dy: -1 },
  { name: 'E', dx: 1, dy: 0 },
  { name: 'S', dx: 0, dy: 1 },
  { name: 'W', dx: -1, dy: 0 },
];
const START = { '^': 0, '>': 1, 'v': 2, '<': 3 };
const TILES = { '#': 'wall', '.': 'floor', 'G': 'goal', 'B': 'bin', 'o': 'floor', 'r': 'floor', 'y': 'floor', 'b': 'floor' };
export const PAINT = { r: 'red', y: 'yellow', b: 'blue' };

export function parseMap(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('map must be a non-empty array of rows');
  const width = rows[0].length;
  const tiles = [];
  const paint = [];
  const items = [];
  let robot = null;
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`map row ${y} has length ${row.length}, expected ${width}`);
    const line = [];
    paint.push([...row].map((ch) => PAINT[ch] || null));
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
  return { width, height: rows.length, tiles, paint, items, robot };
}

/** Normalise a `win` field into an array of { type, count? } rules (no validation). */
export function winRules(win = 'reach') {
  const list = Array.isArray(win) ? win : [win];
  return list.map((r) => (typeof r === 'string' ? { type: r } : { ...r }));
}

export class World {
  /**
   * level: { map: string[], win?: rule | rule[], capacity?: number } (see level.js)
   * robot.holding is the number of parts Pip carries (0 = empty gripper).
   */
  constructor(level) {
    const m = parseMap(level.map);
    this.width = m.width;
    this.height = m.height;
    this.tiles = m.tiles;
    this.paint = m.paint;
    this.items = m.items.map((p) => ({ ...p }));
    this.robot = { ...m.robot, holding: 0 };
    this.capacity = level.capacity ?? 1;
    this.delivered = 0;
    this.totalItems = m.items.length;
    this.rules = winRules(level.win);
    this.stats = { move: 0, left: 0, right: 0, grab: 0, drop: 0, wait: 0 };
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
      case 'holding': return r.holding > 0;
      case 'bin': return this.tile(r.x, r.y) === 'bin';
      case 'red': case 'yellow': case 'blue': return this.paint[r.y][r.x] === name;
      default: throw new Error(`unknown sensor ${name}`);
    }
  }

  act(name) {
    const res = this.doAct(name);
    if (res.ok) this.stats[name]++;
    return res;
  }

  doAct(name) {
    const r = this.robot;
    switch (name) {
      case 'move': {
        const p = this.ahead(0);
        if (this.isBlocked(p.x, p.y)) {
          this.log.push({ type: 'bump', x: p.x, y: p.y });
          return { ok: false, error: 'Pip bumped into a wall', code: 'bump' };
        }
        r.x = p.x; r.y = p.y;
        this.log.push({ type: 'move', x: r.x, y: r.y });
        return { ok: true };
      }
      case 'left': r.dir = (r.dir + 3) % 4; this.log.push({ type: 'turn', dir: r.dir }); return { ok: true };
      case 'right': r.dir = (r.dir + 1) % 4; this.log.push({ type: 'turn', dir: r.dir }); return { ok: true };
      case 'wait': this.log.push({ type: 'wait' }); return { ok: true };
      case 'grab': {
        const i = this.itemAt(r.x, r.y);
        if (i < 0) return { ok: false, error: 'there is no part here to grab', code: 'grab' };
        if (r.holding >= this.capacity) {
          return this.capacity === 1
            ? { ok: false, error: 'Pip is already holding a part', code: 'full' }
            : { ok: false, error: `Pip's gripper is full (${this.capacity} parts)`, code: 'full' };
        }
        this.items.splice(i, 1);
        r.holding++;
        this.log.push({ type: 'grab', x: r.x, y: r.y });
        return { ok: true };
      }
      case 'drop': {
        if (!r.holding) return { ok: false, error: 'Pip is not holding anything', code: 'drop' };
        const intoBin = this.tile(r.x, r.y) === 'bin';
        if (intoBin) {
          this.delivered++;
        } else {
          if (this.itemAt(r.x, r.y) >= 0) return { ok: false, error: 'there is already a part on this tile', code: 'drop' };
          this.items.push({ x: r.x, y: r.y });
        }
        r.holding--;
        this.log.push({ type: 'drop', x: r.x, y: r.y, bin: intoBin });
        return { ok: true };
      }
      default: return { ok: false, error: `unknown action ${name}` };
    }
  }

  /** Compact string of all mutable state (used for cycle detection). */
  stateKey() {
    const r = this.robot;
    const items = this.items.map((it) => `${it.x},${it.y}`).sort().join(';');
    return `${r.x},${r.y},${r.dir},${r.holding}|${items}|${this.delivered}`;
  }

  /** Is one win rule satisfied right now? */
  ruleMet(rule) {
    switch (rule.type) {
      case 'reach': return this.tile(this.robot.x, this.robot.y) === 'goal';
      case 'collect': return this.items.length === 0;
      case 'deliver': return this.delivered >= (rule.count ?? this.totalItems);
      default: return false;
    }
  }

  /** All rules must hold at the same moment. Checked after every action. */
  isWon() {
    return this.rules.length > 0 && this.rules.every((r) => this.ruleMet(r));
  }

  /** Plain-language list of the rules not yet met (for the "not done yet" message). */
  unmetGoals() {
    const out = [];
    for (const rule of this.rules) {
      if (this.ruleMet(rule)) continue;
      if (rule.type === 'reach') out.push('Pip is not on a goal pad');
      else if (rule.type === 'collect') {
        const n = this.items.length;
        out.push(`${n} part${n === 1 ? ' is' : 's are'} still on the floor`);
      } else if (rule.type === 'deliver') {
        const n = rule.count ?? this.totalItems;
        out.push(`${this.delivered} of ${n} part${n === 1 ? '' : 's'} delivered to a bin`);
      }
    }
    return out;
  }
}
