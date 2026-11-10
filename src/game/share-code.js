// Share codes for levels: "FL1.<payload>.<check>"
//   FL1     = format + version (bump when the payload shape changes)
//   payload = URL-safe base64 (no padding) of the level's compact JSON (UTF-8)
//   check   = 8 hex digits, FNV-1a 32-bit hash of the payload text
// Pure module (TextEncoder/btoa/atob exist in browsers and Node >= 16).
import { normalizeLevel, validateLevel } from '../world/level.js';

export const SHARE_PREFIX = 'FL';
export const SHARE_VERSION = 1;
export const MAX_CODE_LENGTH = 20000;

export class ShareCodeError extends Error {
  constructor(kind, message) { super(message); this.name = 'ShareCodeError'; this.kind = kind; }
}

export function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function toB64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new ShareCodeError('corrupt', 'Code has characters that do not belong in a share code.');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Fields that travel in a code (no progress, no ids from someone else's library). */
function shareable(level) {
  const n = normalizeLevel(level, { requireSolution: false });
  const out = { name: n.name, brief: n.brief, map: n.map, win: n.win, capacity: n.capacity, maxSteps: n.maxSteps, tools: n.tools };
  for (const k of ['solution', 'solutions', 'robots', 'hint', 'par', 'floors']) if (n[k] !== undefined) out[k] = n[k];
  return out;
}

/** Level → share code. Throws LevelError on an invalid level. */
export function encodeLevel(level) {
  const payload = toB64url(JSON.stringify(shareable(level)));
  return `${SHARE_PREFIX}${SHARE_VERSION}.${payload}.${fnv1a(payload)}`;
}

/** Pull a code out of pasted text or a URL (?code=…). */
export function extractCode(text) {
  const s = String(text ?? '').trim();
  const m = s.match(/[?&#]code=([^&#\s]+)/);
  return (m ? decodeURIComponent(m[1]) : s).replace(/\s+/g, '');
}

/** Share code → normalized level (id = `id`). Throws ShareCodeError with kind empty|format|version|checksum|corrupt|invalid. */
export function decodeLevel(text, { id = 'shared' } = {}) {
  const code = extractCode(text);
  if (!code) throw new ShareCodeError('empty', 'Paste a share code first.');
  if (code.length > MAX_CODE_LENGTH) throw new ShareCodeError('format', 'Code is too long.');
  const m = code.match(/^FL(\d+)\.([^.]*)\.([0-9a-f]{8})$/i);
  if (!m) throw new ShareCodeError('format', 'This does not look like a share code (it should start with FL1.).');
  if (Number(m[1]) !== SHARE_VERSION) throw new ShareCodeError('version', `Code version ${m[1]} is not supported (this game reads version ${SHARE_VERSION}).`);
  if (fnv1a(m[2]) !== m[3].toLowerCase()) throw new ShareCodeError('checksum', 'Code is damaged (checksum mismatch). Copy it again.');
  let data;
  try { data = JSON.parse(fromB64url(m[2])); } catch (e) {
    if (e instanceof ShareCodeError) throw e;
    throw new ShareCodeError('corrupt', 'Code could not be read.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ShareCodeError('corrupt', 'Code does not contain a level.');
  const level = { ...data, id };
  const problems = validateLevel(level, { requireSolution: false });
  if (problems.length) throw new ShareCodeError('invalid', `Level in code is broken: ${problems[0]}`);
  return normalizeLevel(level, { requireSolution: false });
}

/** Link that opens the code (base = page URL without query). */
export function shareUrl(code, base) {
  return `${String(base).split(/[?#]/)[0]}?code=${code}`;
}
