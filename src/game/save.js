// Progress saving: one versioned JSON record in a Storage-like object
// (localStorage in the page, a fake Map-backed store in tests).
//
//   key `ferrolab.save` → {
//     v: 1,
//     levels:   { <level id>: { won, steps, size, legacy? } }   best record (score.js mergeBest)
//     drafts:   { <level id>: "cog text" }
//     bps:      { <level id>: [line, ...] }                     breakpoints
//     settings: { speed, mode }
//     last:     <level id> | null                               last level opened
//   }
//
// Before Day 11 the page kept loose keys (`ferrolab.best.<id>`, `ferrolab.stars.<id>`,
// `ferrolab.draft.<id>`, `ferrolab.bp.<id>`, `ferrolab.speed`, `ferrolab.mode`). The first
// load without a save imports them once (`legacy` keeps an old star count, since a bare
// count can't say which par was met). Old keys are left in place, never deleted.
//
// Robustness rules: a save that isn't valid JSON is copied to `ferrolab.save.bad` and the
// game starts fresh; a save from a *newer* version is never overwritten (the store goes
// read-only for the session); failed writes (quota, blocked storage) are reported in
// `lastError`, never thrown.
import { mergeBest, recordStars } from './score.js';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'ferrolab.save';
const LEGACY = 'ferrolab.';
const MAX_DRAFT = 20000; // characters; a longer draft isn't saved

export function emptySave() {
  return { v: SAVE_VERSION, levels: {}, drafts: {}, bps: {}, settings: {}, last: null };
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Clean a parsed v1 save: drop anything malformed instead of failing on it. */
export function sanitize(raw) {
  const s = emptySave();
  if (!isObj(raw)) return s;
  if (isObj(raw.levels)) {
    for (const [id, r] of Object.entries(raw.levels)) {
      if (!isObj(r)) continue;
      const rec = { won: Boolean(r.won), steps: Boolean(r.won && r.steps), size: Boolean(r.won && r.size) };
      const legacy = Math.min(3, Math.max(0, Math.floor(Number(r.legacy) || 0)));
      if (legacy) { rec.legacy = legacy; rec.won = true; }
      if (rec.won) s.levels[id] = rec;
    }
  }
  if (isObj(raw.drafts)) {
    for (const [id, t] of Object.entries(raw.drafts)) if (typeof t === 'string' && t.length <= MAX_DRAFT) s.drafts[id] = t;
  }
  if (isObj(raw.bps)) {
    for (const [id, lines] of Object.entries(raw.bps)) {
      if (!Array.isArray(lines)) continue;
      const ok = [...new Set(lines.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
      if (ok.length) s.bps[id] = ok;
    }
  }
  if (isObj(raw.settings)) {
    for (const [k, v] of Object.entries(raw.settings)) if (['string', 'number', 'boolean'].includes(typeof v)) s.settings[k] = v;
  }
  if (typeof raw.last === 'string') s.last = raw.last;
  return s;
}

function safeGet(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}

/** Every `ferrolab.*` key from before Day 11, as a v1 save (empty if there are none). */
export function importLegacy(storage) {
  const s = emptySave();
  let keys = [];
  try {
    for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
  } catch { keys = []; }
  for (const key of keys) {
    if (typeof key !== 'string' || !key.startsWith(LEGACY) || key.startsWith(SAVE_KEY)) continue;
    const rest = key.slice(LEGACY.length);
    const value = safeGet(storage, key);
    if (value === null) continue;
    const dot = rest.indexOf('.');
    const kind = dot < 0 ? rest : rest.slice(0, dot);
    const id = dot < 0 ? '' : rest.slice(dot + 1);
    try {
      if (kind === 'best' && id) {
        const b = JSON.parse(value);
        const p = s.levels[id] || {};
        if (isObj(b)) s.levels[id] = { ...p, won: Boolean(b.won || p.won), steps: Boolean(b.steps || p.steps), size: Boolean(b.size || p.size) };
      } else if (kind === 'stars' && id) {
        const n = Math.min(3, Math.max(0, Math.floor(Number(value) || 0)));
        if (n) s.levels[id] = { ...(s.levels[id] || { won: true, steps: false, size: false }), won: true, legacy: n };
      } else if (kind === 'draft' && id) s.drafts[id] = value;
      else if (kind === 'bp' && id) s.bps[id] = JSON.parse(value);
      else if ((kind === 'speed' || kind === 'mode') && !id) s.settings[kind] = value;
    } catch { /* one bad old key doesn't stop the rest */ }
  }
  return sanitize(s);
}

/** Stars (0..3) for a stored record, counting an imported old star count. */
export const savedStars = (rec) => Math.max(recordStars(rec), rec?.legacy || 0);

export class SaveStore {
  /** `storage`: a Storage-like object (getItem/setItem/key/length), or null for memory only. */
  constructor(storage, { key = SAVE_KEY } = {}) {
    this.storage = storage;
    this.key = key;
    this.readOnly = false;
    this.lastError = null;
    this.notes = []; // what happened on load ('fresh', 'imported', 'corrupt', 'newer')
    this.data = this._load();
  }

  _load() {
    if (!this.storage) { this.notes.push('memory'); return emptySave(); }
    const text = safeGet(this.storage, this.key);
    if (text === null) {
      const imported = importLegacy(this.storage);
      const any = Object.keys(imported.levels).length + Object.keys(imported.drafts).length
        + Object.keys(imported.bps).length + Object.keys(imported.settings).length;
      this.notes.push(any ? 'imported' : 'fresh');
      if (any) this._write(imported);
      return imported;
    }
    let raw;
    try { raw = JSON.parse(text); } catch { raw = undefined; }
    if (!isObj(raw) || !Number.isInteger(raw.v)) {
      this.notes.push('corrupt');
      try { this.storage.setItem(`${this.key}.bad`, text); } catch { /* best effort */ }
      const fresh = emptySave();
      this._write(fresh);
      return fresh;
    }
    if (raw.v > SAVE_VERSION) {
      // a newer game wrote this; play along in memory but never clobber it
      this.notes.push('newer');
      this.readOnly = true;
      return sanitize(raw);
    }
    return sanitize(raw); // v1 (future migrations from older versions go here)
  }

  _write(data = this.data) {
    if (this.readOnly || !this.storage) return false;
    try {
      this.storage.setItem(this.key, JSON.stringify(data));
      this.lastError = null;
      return true;
    } catch (e) {
      this.lastError = e && e.name === 'QuotaExceededError' ? 'Storage is full; progress is not being saved.'
        : 'Progress could not be saved (storage blocked?).';
      return false;
    }
  }

  // --- level records ---
  best(id) { return this.data.levels[id] || null; }
  stars(id) { return savedStars(this.best(id)); }
  won(id) { return Boolean(this.data.levels[id]?.won); }

  /** Merge a finished run's score; returns { before, after } star counts. */
  recordRun(id, score) {
    const before = this.stars(id);
    if (!score || score.stars <= 0) return { before, after: before };
    const prev = this.best(id);
    const rec = mergeBest(prev, score);
    if (prev?.legacy) rec.legacy = prev.legacy;
    this.data.levels[id] = rec;
    this._write();
    return { before, after: this.stars(id) };
  }

  // --- drafts, breakpoints, settings ---
  draft(id) { return this.data.drafts[id] ?? null; }
  setDraft(id, text) {
    if (typeof text !== 'string' || text.length > MAX_DRAFT) return;
    if (text === '') delete this.data.drafts[id]; else this.data.drafts[id] = text;
    this._write();
  }
  breakpoints(id) { return [...(this.data.bps[id] || [])]; }
  setBreakpoints(id, lines) {
    const ok = [...new Set([...lines].filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
    if (ok.length) this.data.bps[id] = ok; else delete this.data.bps[id];
    this._write();
  }
  setting(name, fallback = null) { return this.data.settings[name] ?? fallback; }
  setSetting(name, value) { this.data.settings[name] = value; this._write(); }
  get last() { return this.data.last; }
  set last(id) { this.data.last = id; this._write(); }

  /** Forget progress (stars, drafts, breakpoints, last level); settings stay. */
  resetProgress() {
    const settings = this.data.settings;
    this.data = { ...emptySave(), settings };
    this._write();
  }
}

/** A Map-backed Storage stand-in (tests, or when localStorage is unavailable). */
export class MemoryStorage {
  constructor(entries = {}, { quota = Infinity } = {}) {
    this.map = new Map(Object.entries(entries));
    this.quota = quota;
  }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    const s = String(v);
    let used = s.length;
    for (const [key, val] of this.map) if (key !== k) used += val.length;
    if (used > this.quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
    this.map.set(k, s);
  }
  removeItem(k) { this.map.delete(k); }
}
