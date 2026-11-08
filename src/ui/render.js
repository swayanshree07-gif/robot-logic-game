// Canvas renderer: all art is drawn in code (no image assets).
//
// Everything is pixel art at ART_PX pixels per cell (see art.js). The static
// floor/walls are drawn once per world into an offscreen canvas and scaled up;
// parts, goal-pad glow and Pip are drawn every frame in art-pixel units.
import {
  ART_PX, PALETTE, PIP, PART, PART_SMALL, eachPixel, layout, tileHash, wallMask,
} from './art.js';

const T = ART_PX;
const C = {
  floorA: '#3a4157', floorB: '#3e465d', grout: '#2b3043', floorHi: '#4c5571', occl: '#262a3a',
  wallTop: '#1d2130', wallHi: '#3a4260', wallFace: '#525c80', wallFaceDk: '#3f4767', wallEdge: '#11131c',
  pipe: '#7c8496', pipeHi: '#a8b0c2', pipeDk: '#4d5466',
  red: '#e5484d', yellow: '#f5d90a', blue: '#3e9bff',
  goal: PALETTE.g, goalDk: '#1f4636', goalCore: '#b6ffd9',
  bin: '#7a5cff', binDk: '#4e37b8', binHi: '#a08bff', binIn: '#120f24',
  bump: '#ff6b6b',
  belt: '#23262f', beltEdge: '#555c6e', beltArrow: '#f2a33a',
  plate: '#6b7286', plateHi: '#9aa2bb', plateOn: '#5fd39a',
  door: '#8a5a2b', doorDk: '#5a3a1a', doorStripe: '#f5d90a',
};

const statics = new WeakMap(); // world -> offscreen canvas of floor & walls

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function px(ctx, x, y, w, h, colour) { ctx.fillStyle = colour; ctx.fillRect(x, y, w, h); }

function sprite(ctx, rows, x, y) { eachPixel(rows, (sx, sy, col) => px(ctx, x + sx, y + sy, 1, 1, col)); }

/** Static layer, cached per world. Tiles never change during a run. */
function staticLayer(world) {
  let c = statics.get(world);
  if (c) return c;
  c = makeCanvas(world.width * T, world.height * T);
  const ctx = c.getContext('2d');
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const t = world.tiles[y][x];
      if (t === 'wall') drawWall(ctx, world, x, y);
      else {
        drawFloor(ctx, world, x, y);
        const paint = world.paint && world.paint[y][x];
        if (paint) drawPaint(ctx, x * T, y * T, paint);
        if (t === 'goal') drawPadBase(ctx, x * T, y * T);
        else if (t === 'bin') drawBin(ctx, x * T, y * T);
        else if (t === 'belt') drawBelt(ctx, x * T, y * T, world.belts[y][x]);
        else if (t === 'plate') drawPlate(ctx, x * T, y * T);
      }
    }
  }
  statics.set(world, c);
  return c;
}

function drawFloor(ctx, world, x, y) {
  const X = x * T, Y = y * T;
  px(ctx, X, Y, T, T, (x + y) % 2 ? C.floorA : C.floorB);
  px(ctx, X, Y, T, 1, C.grout);
  px(ctx, X, Y, 1, T, C.grout);
  px(ctx, X + 1, Y + 1, 1, 1, C.floorHi);
  // ambient occlusion under a wall
  if (world.tile(x, y - 1) === 'wall') { px(ctx, X, Y, T, 2, C.occl); px(ctx, X, Y + 2, T, 1, C.grout); }
  if (world.tile(x - 1, y) === 'wall') px(ctx, X, Y, 1, T, C.occl);
  const h = tileHash(x, y);
  if (world.tiles[y][x] !== 'floor' || (world.paint && world.paint[y][x])) return;
  if (h < 0.14) { // bolted plate
    for (const [a, b] of [[3, 4], [12, 4], [3, 13], [12, 13]]) px(ctx, X + a, Y + b, 1, 1, C.floorHi);
  } else if (h < 0.22) { // drain grate
    for (let i = 0; i < 3; i++) px(ctx, X + 5, Y + 6 + i * 2, 6, 1, C.grout);
  } else if (h < 0.3) { // scuff
    px(ctx, X + 4 + Math.floor(h * 40) % 6, Y + 9, 3, 1, C.floorHi);
  }
}

function drawWall(ctx, world, x, y) {
  const X = x * T, Y = y * T;
  const m = wallMask(world, x, y);
  const openS = !(m & 4), openN = !(m & 1), openE = !(m & 2), openW = !(m & 8);
  const face = openS ? 5 : 0; // 3/4 view: show the front face where the floor is below
  px(ctx, X, Y, T, T - face, C.wallTop);
  if (openN) px(ctx, X, Y, T, 1, C.wallHi);
  if (openW) px(ctx, X, Y, 1, T - face, C.wallEdge);
  if (openE) px(ctx, X + T - 1, Y, 1, T - face, C.wallEdge);
  // pipe along long horizontal runs
  if ((m & 2) && (m & 8) && tileHash(x, y, 7) < 0.4) {
    px(ctx, X, Y + 4, T, 3, C.pipe);
    px(ctx, X, Y + 4, T, 1, C.pipeHi);
    px(ctx, X, Y + 6, T, 1, C.pipeDk);
    if (tileHash(x, y, 9) < 0.5) { px(ctx, X + 6, Y + 3, 3, 5, C.pipeDk); px(ctx, X + 7, Y + 3, 1, 5, C.pipe); }
  } else if (tileHash(x, y, 3) < 0.3) {
    px(ctx, X + 4, Y + 4, 1, 1, C.wallFace); px(ctx, X + 11, Y + 4, 1, 1, C.wallFace);
  }
  if (openS) {
    const fy = Y + T - face;
    px(ctx, X, fy, T, face, C.wallFace);
    px(ctx, X, fy, T, 1, C.wallEdge);
    for (let i = 3; i < T; i += 5) px(ctx, X + i, fy + 1, 1, face - 1, C.wallFaceDk);
    px(ctx, X, Y + T - 1, T, 1, C.wallEdge);
  }
}

// Painted floor marking. Each colour also has its own shape (stripe, ring,
// dots) so it can be told apart without relying on hue alone.
function drawPaint(ctx, X, Y, colour) {
  const col = C[colour];
  ctx.globalAlpha = 0.85;
  if (colour === 'red') { // hazard stripe with diagonal notches
    px(ctx, X + 1, Y + 6, T - 2, 4, col);
    for (let i = 2; i < T - 2; i += 4) px(ctx, X + i, Y + 7, 2, 2, C.floorA);
  } else if (colour === 'yellow') { // ring
    const r = [[6, 3, 4, 1], [6, 12, 4, 1], [3, 6, 1, 4], [12, 6, 1, 4],
      [4, 4, 2, 1], [10, 4, 2, 1], [4, 11, 2, 1], [10, 11, 2, 1],
      [4, 5, 1, 1], [11, 5, 1, 1], [4, 10, 1, 1], [11, 10, 1, 1]];
    for (const [a, b, w, h] of r) { px(ctx, X + a, Y + b, w, h, col); px(ctx, X + a, Y + b + 1, w, h, col); }
  } else { // four dots
    for (const [a, b] of [[3, 3], [10, 3], [3, 10], [10, 10]]) px(ctx, X + a, Y + b, 3, 3, col);
  }
  ctx.globalAlpha = 1;
}

function drawPadBase(ctx, X, Y) {
  px(ctx, X + 2, Y + 2, 12, 12, C.goalDk);
  // corner brackets reach the tile edge, so they stay visible under Pip
  for (const [a, b, sx, sy] of [[1, 1, 1, 1], [14, 1, -1, 1], [1, 14, 1, -1], [14, 14, -1, -1]]) {
    px(ctx, X + Math.min(a, a + sx * 3), Y + b, 4, 1, C.goal);
    px(ctx, X + a, Y + Math.min(b, b + sy * 3), 1, 4, C.goal);
  }
}

function drawBin(ctx, X, Y) {
  px(ctx, X + 2, Y + 4, 12, 11, C.binDk);
  px(ctx, X + 2, Y + 4, 12, 9, C.bin);
  px(ctx, X + 1, Y + 3, 14, 2, C.binHi);
  px(ctx, X + 3, Y + 5, 10, 3, C.binIn);
  px(ctx, X + 4, Y + 10, 8, 1, C.binDk);
  px(ctx, X + 7, Y + 9, 2, 3, C.binHi); // down-arrow-ish label
}

// Conveyor: dark rubber with side rails and two chevrons pointing the way.
function drawBelt(ctx, X, Y, dir) {
  px(ctx, X + 1, Y + 1, T - 2, T - 2, C.belt);
  const horiz = dir === 1 || dir === 3;
  if (horiz) { px(ctx, X, Y + 1, T, 1, C.beltEdge); px(ctx, X, Y + T - 2, T, 1, C.beltEdge); }
  else { px(ctx, X + 1, Y, 1, T, C.beltEdge); px(ctx, X + T - 2, Y, 1, T, C.beltEdge); }
  for (const off of [3, 9]) {
    for (let i = 0; i < 4; i++) {
      // chevron drawn pointing east in local coords (u along belt, v across)
      for (const [u, v] of [[off + i, 4 + i], [off + i, 11 - i]]) {
        const [a, b] = [[v, T - 1 - u], [u, v], [v, u], [T - 1 - u, v]][dir];
        px(ctx, X + a, Y + b, 1, 1, C.beltArrow);
      }
    }
  }
}

function drawPlate(ctx, X, Y) {
  px(ctx, X + 2, Y + 2, 12, 12, C.wallEdge);
  px(ctx, X + 3, Y + 3, 10, 10, C.plate);
  px(ctx, X + 3, Y + 3, 10, 1, C.plateHi);
}

// Plate indicator light (live) and doors (open/shut change during a run).
function drawPlateLight(ctx, X, Y, on) {
  px(ctx, X + 7, Y + 7, 2, 2, on ? C.plateOn : C.wallEdge);
}

function drawDoor(ctx, X, Y, open) {
  if (open) { // slid into the frame: two thin jambs
    px(ctx, X, Y, 2, T, C.doorDk); px(ctx, X + T - 2, Y, 2, T, C.doorDk);
    return;
  }
  px(ctx, X, Y, T, T, C.doorDk);
  px(ctx, X + 1, Y + 1, T - 2, T - 2, C.door);
  for (let i = 0; i < T - 2; i += 4) px(ctx, X + 1 + i, Y + 6, 2, 3, C.doorStripe);
  px(ctx, X + 7, Y + 1, 2, T - 2, C.doorDk);
}

function drawPadGlow(ctx, X, Y, time) {
  const pulse = 0.5 + 0.5 * Math.sin(time / 380);
  ctx.globalAlpha = 0.35 + 0.45 * pulse;
  px(ctx, X + 5, Y + 5, 6, 6, C.goal);
  ctx.globalAlpha = 1;
  // a small lightning bolt: "charging pad"
  for (const [a, b, w] of [[8, 4, 2], [7, 5, 2], [6, 6, 3], [6, 7, 4], [8, 8, 2], [8, 9, 1], [7, 10, 1]]) {
    px(ctx, X + a, Y + b, w, 1, C.goalCore);
  }
}

/** Crew colours: robot 1 keeps Pip's look, the others get a tinted visor ring + number. */
export const CREW_TINTS = ['#ffd84a', '#5ad1ff', '#ff7ad9', '#8cff6a'];

function drawPip(ctx, pose, holding, time) {
  const X = Math.round(pose.x * T * 4) / 4, Y = Math.round(pose.y * T * 4) / 4;
  const top = Y - 1 - pose.hop;
  ctx.globalAlpha = 0.45;
  px(ctx, X + 3, Y + 14, 10, 2, '#000');
  ctx.globalAlpha = 1;
  const carry = holding > 0;
  const gx = [4, 11, 4, -3][pose.dir], gy = [-3, 7, 9, 7][pose.dir];
  if (carry && pose.dir === 0) sprite(ctx, PART_SMALL, X + gx, top + gy); // behind Pip when facing away
  sprite(ctx, PIP[pose.dir], X, top);
  if (carry && pose.dir !== 0) sprite(ctx, PART_SMALL, X + gx, top + gy);
  // antenna tip blinks while idle-ish (purely decorative)
  if (Math.floor(time / 700) % 2) px(ctx, X + 7, top, 2, 1, PALETTE.e);
}

/**
 * Draw the board.
 * @param {CanvasRenderingContext2D} ctx
 * @param {World} world
 * @param {{bump?: {x,y}, pose?: object, time?: number}} [opt]
 *   pose: from Animator.pose() (defaults to Pip's exact tile); time: ms for glow.
 */
export function draw(ctx, world, { bump = null, pose = null, time = 0 } = {}) {
  const c = ctx.canvas;
  const L = layout(world, c.width, c.height);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(staticLayer(world), L.ox, L.oy, world.width * L.cell, world.height * L.cell);

  ctx.save();
  ctx.translate(L.ox, L.oy);
  ctx.scale(L.scale, L.scale);
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) if (world.tiles[y][x] === 'goal') drawPadGlow(ctx, x * T, y * T, time);
  }
  for (const p of world.plates || []) drawPlateLight(ctx, p.x * T, p.y * T, world.occupied(p.x, p.y));
  for (const d of world.doors || []) drawDoor(ctx, d.x * T, d.y * T, d.open);
  for (const it of world.items) sprite(ctx, PART, it.x * T, it.y * T);
  const bots = world.robots && world.robots.length > 1 ? world.robots : [world.robot];
  const poses = bots.map((b, i) => (Array.isArray(pose) ? pose[i] : i === 0 ? pose : null) || { x: b.x, y: b.y, dir: b.dir, hop: 0 });
  bots.forEach((b, i) => {
    drawPip(ctx, poses[i], b.holding, time);
    if (bots.length > 1) { // tint stripe under the robot + its number
      px(ctx, poses[i].x * T + 3, poses[i].y * T + 15, 10, 1, CREW_TINTS[i % CREW_TINTS.length]);
    }
  });
  const r = world.robot;
  const p = poses[0];
  if (bump) {
    ctx.globalAlpha = 0.9;
    const X = bump.x * T, Y = bump.y * T;
    px(ctx, X, Y, T, 1, C.bump); px(ctx, X, Y + T - 1, T, 1, C.bump);
    px(ctx, X, Y, 1, T, C.bump); px(ctx, X + T - 1, Y, 1, T, C.bump);
    for (const [a, b] of [[7, 3], [4, 7], [11, 8], [7, 12]]) px(ctx, X + a, Y + b, 2, 2, C.bump);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  if (bots.length > 1) { // robot numbers, in screen pixels
    ctx.font = `bold ${Math.max(10, Math.round(L.cell * 0.3))}px monospace`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    bots.forEach((b, i) => {
      ctx.fillStyle = CREW_TINTS[i % CREW_TINTS.length];
      ctx.fillText(String(i + 1), L.ox + poses[i].x * L.cell + 2, L.oy + poses[i].y * L.cell + 2);
    });
  }
  if (bots.length === 1 && r.holding > 1) { // hopper count badge, in screen pixels
    ctx.fillStyle = PALETTE.e;
    ctx.font = `bold ${Math.max(10, Math.round(L.cell * 0.3))}px monospace`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(String(r.holding), L.ox + (p.x + 1) * L.cell - 2, L.oy + p.y * L.cell + 2);
  }
}
