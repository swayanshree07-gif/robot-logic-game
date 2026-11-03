// Canvas renderer: all art is drawn in code (no image assets).
import { DIRS } from '../world/world.js';

const PAL = {
  floorA: '#262b3d', floorB: '#2a3044', grout: '#1c2030',
  wall: '#454d6b', wallTop: '#5b6488', wallShade: '#323850',
  red: '#e5484d', yellow: '#f5d90a', blue: '#3e9bff',
  goal: '#5fd39a', bin: '#7a5cff', item: '#ffb547',
  body: '#d9dde8', bodyShade: '#9aa2bb', eye: '#38e1ff', tread: '#30354a',
};

export function cellSize(world, canvas) {
  return Math.floor(Math.min(canvas.width / world.width, canvas.height / world.height));
}

export function draw(ctx, world, { bump = null } = {}) {
  const c = ctx.canvas;
  const s = cellSize(world, c);
  const ox = Math.floor((c.width - s * world.width) / 2);
  const oy = Math.floor((c.height - s * world.height) / 2);
  ctx.clearRect(0, 0, c.width, c.height);
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const px = ox + x * s, py = oy + y * s;
      const t = world.tiles[y][x];
      if (t === 'wall') {
        ctx.fillStyle = PAL.wallShade; ctx.fillRect(px, py, s, s);
        ctx.fillStyle = PAL.wall; ctx.fillRect(px, py, s, s * 0.8);
        ctx.fillStyle = PAL.wallTop; ctx.fillRect(px, py, s, s * 0.12);
        // rivets
        ctx.fillStyle = PAL.wallShade;
        ctx.fillRect(px + s * 0.15, py + s * 0.3, s * 0.08, s * 0.08);
        ctx.fillRect(px + s * 0.77, py + s * 0.3, s * 0.08, s * 0.08);
        continue;
      }
      ctx.fillStyle = PAL.grout; ctx.fillRect(px, py, s, s);
      ctx.fillStyle = (x + y) % 2 ? PAL.floorA : PAL.floorB;
      ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
      const paint = world.paint && world.paint[y][x];
      if (paint) drawPaint(ctx, px, py, s, paint);
      if (t === 'goal') {
        ctx.strokeStyle = PAL.goal; ctx.lineWidth = Math.max(2, s * 0.06);
        ctx.strokeRect(px + s * 0.18, py + s * 0.18, s * 0.64, s * 0.64);
        ctx.fillStyle = PAL.goal;
        ctx.fillRect(px + s * 0.44, py + s * 0.3, s * 0.12, s * 0.4); // lightning-ish bar
      } else if (t === 'bin') {
        ctx.fillStyle = PAL.bin;
        ctx.fillRect(px + s * 0.2, py + s * 0.3, s * 0.6, s * 0.5);
        ctx.fillStyle = '#5a40d0'; ctx.fillRect(px + s * 0.15, py + s * 0.24, s * 0.7, s * 0.1);
      }
    }
  }
  for (const it of world.items) drawPart(ctx, ox + it.x * s, oy + it.y * s, s);
  drawPip(ctx, ox + world.robot.x * s, oy + world.robot.y * s, s, world.robot);
  if (bump) {
    ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 3;
    ctx.strokeRect(ox + bump.x * s + 2, oy + bump.y * s + 2, s - 4, s - 4);
  }
}

// Painted floor marking. Each colour also has its own shape (stripe, ring,
// dots) so it can be told apart without relying on hue alone.
function drawPaint(ctx, px, py, s, colour) {
  ctx.fillStyle = PAL[colour];
  ctx.strokeStyle = PAL[colour];
  ctx.globalAlpha = 0.75;
  if (colour === 'red') {
    ctx.fillRect(px + s * 0.1, py + s * 0.42, s * 0.8, s * 0.16);
  } else if (colour === 'yellow') {
    ctx.lineWidth = Math.max(2, s * 0.08);
    ctx.beginPath(); ctx.arc(px + s / 2, py + s / 2, s * 0.3, 0, Math.PI * 2); ctx.stroke();
  } else {
    for (const [dx, dy] of [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]]) {
      ctx.beginPath(); ctx.arc(px + s * dx, py + s * dy, s * 0.09, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawPart(ctx, px, py, s) {
  // a little gear
  const cx = px + s / 2, cy = py + s / 2, r = s * 0.18;
  ctx.fillStyle = PAL.item;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.fillRect(cx + Math.cos(a) * r * 1.3 - s * 0.04, cy + Math.sin(a) * r * 1.3 - s * 0.04, s * 0.08, s * 0.08);
  }
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.floorA; ctx.beginPath(); ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2); ctx.fill();
}

function drawPip(ctx, px, py, s, robot) {
  const cx = px + s / 2, cy = py + s / 2;
  const d = DIRS[robot.dir];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.atan2(d.dy, d.dx) + Math.PI / 2); // art faces north
  const u = s / 16;
  ctx.fillStyle = PAL.tread;
  ctx.fillRect(-6 * u, -5 * u, 2 * u, 11 * u);
  ctx.fillRect(4 * u, -5 * u, 2 * u, 11 * u);
  ctx.fillStyle = PAL.bodyShade; ctx.fillRect(-4 * u, -4 * u, 8 * u, 10 * u);
  ctx.fillStyle = PAL.body; ctx.fillRect(-4 * u, -5 * u, 8 * u, 8 * u);
  ctx.fillStyle = PAL.eye; ctx.fillRect(-3 * u, -4 * u, 6 * u, 2 * u); // visor shows facing
  ctx.fillStyle = PAL.tread; ctx.fillRect(-u / 2, 0, u, 4 * u);
  if (robot.holding) {
    ctx.fillStyle = PAL.item; ctx.fillRect(-2 * u, -8 * u, 4 * u, 3 * u);
  }
  ctx.restore();
}
