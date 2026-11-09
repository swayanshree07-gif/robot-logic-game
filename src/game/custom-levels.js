// Custom levels made in the level editor: test-play gating and a small library
// kept in localStorage. Pure logic (storage is injected), no DOM.
//
// Rule: a draft can only be shared (Day 24 share codes) once it is valid AND its
// stored solution(s) won on every floor in test-play since the last edit.
// The reducer clears `solved` on every level edit, so this stays honest.

import { normalizeLevel, floorCount, floorLevel, levelSolutions, levelCrew } from '../world/level.js';
import { runSolution } from './run.js';
import { editorReducer, editorProblems, createEditor } from './level-editor.js';

export const CUSTOM_KEY = 'ferrolab.custom';
export const CUSTOM_VERSION = 1;
export const MAX_CUSTOM = 50;

/** Programs to test-play with: one per robot, blanks filled with ''. */
export function draftPrograms(level) {
  const n = Math.max(1, levelCrew(level));
  const given = levelSolutions(level);
  return Array.from({ length: n }, (_, i) => given[i] ?? '');
}

/**
 * Test-play a draft with its stored solution(s) (or `programs`) on every floor.
 * Returns { ok, state, problems, floors: [{result, ticks}], failed, message }.
 * On a win `state` has `solved: true`; otherwise it is returned unchanged.
 */
export function testPlay(state, programs = null) {
  const problems = editorProblems(state);
  if (problems.length) return { ok: false, state, problems, floors: [], failed: -1, message: `Fix the level first: ${problems[0]}` };
  const level = normalizeLevel(state.level, { requireSolution: false });
  const progs = programs ?? draftPrograms(level);
  if (progs.every((p) => !p.trim())) return { ok: false, state, problems: [], floors: [], failed: -1, message: 'Write a solution program first.' };
  const floors = [];
  let failed = -1;
  for (let i = 0; i < floorCount(level); i++) {
    const r = runSolution(floorLevel(level, i), progs);
    floors.push({ result: r.result, ticks: r.ticks });
    if (failed < 0 && r.result !== 'win') failed = i;
  }
  if (failed >= 0) {
    const where = floorCount(level) > 1 ? ` on floor ${failed + 1}` : '';
    return { ok: false, state, problems: [], floors, failed, message: `Test-play ${floors[failed].result}${where}. Not solved yet.` };
  }
  return { ok: true, state: editorReducer(state, { type: 'markSolved' }), problems: [], floors, failed, message: 'Solved! This level can be shared.' };
}

/** Can the draft be shared? { ok, reason }. */
export function shareCheck(state) {
  const problems = editorProblems(state);
  if (problems.length) return { ok: false, reason: `Level has problems: ${problems[0]}` };
  if (!state.solved) return { ok: false, reason: 'Solve the level in test-play first.' };
  return { ok: true, reason: '' };
}

const emptyLib = () => ({ version: CUSTOM_VERSION, levels: [] });

/** Library of custom levels: [{ level, solved, updated }] in one localStorage key. */
export class CustomLibrary {
  constructor(storage, { now = () => Date.now() } = {}) {
    this.storage = storage;
    this.now = now;
    this.data = this.load();
    this.error = '';
  }

  load() {
    try {
      const raw = this.storage && this.storage.getItem(CUSTOM_KEY);
      if (!raw) return emptyLib();
      const d = JSON.parse(raw);
      if (!d || d.version !== CUSTOM_VERSION || !Array.isArray(d.levels)) return emptyLib();
      const levels = d.levels.filter((e) => e && e.level && typeof e.level.id === 'string' && Array.isArray(e.level.map))
        .map((e) => ({ level: e.level, solved: e.solved === true, updated: Number(e.updated) || 0 }));
      return { version: CUSTOM_VERSION, levels };
    } catch { return emptyLib(); }
  }

  persist() {
    this.error = '';
    if (!this.storage) return true;
    try { this.storage.setItem(CUSTOM_KEY, JSON.stringify(this.data)); return true; } catch (e) {
      this.error = `Could not save: ${e && e.name === 'QuotaExceededError' ? 'storage full' : 'storage unavailable'}`;
      return false;
    }
  }

  /** Entries, newest first. */
  list() { return [...this.data.levels].sort((a, b) => b.updated - a.updated); }
  get(id) { return this.data.levels.find((e) => e.level.id === id) || null; }

  /** A free id like custom-3. */
  nextId() {
    const used = new Set(this.data.levels.map((e) => e.level.id));
    let n = 1;
    while (used.has(`custom-${n}`)) n++;
    return `custom-${n}`;
  }

  /** Save an editor state's level (replaces same id). Returns false when full or storage fails. */
  put(state) {
    const entry = { level: JSON.parse(JSON.stringify(state.level)), solved: state.solved === true, updated: this.now() };
    const i = this.data.levels.findIndex((e) => e.level.id === entry.level.id);
    if (i < 0 && this.data.levels.length >= MAX_CUSTOM) { this.error = `Library full (${MAX_CUSTOM} levels)`; return false; }
    if (i >= 0) this.data.levels[i] = entry; else this.data.levels.push(entry);
    return this.persist();
  }

  remove(id) {
    const n = this.data.levels.length;
    this.data.levels = this.data.levels.filter((e) => e.level.id !== id);
    return n !== this.data.levels.length && this.persist();
  }

  /** Re-open an entry in the editor (keeps its solved flag). */
  open(id) {
    const e = this.get(id);
    if (!e) return null;
    return { ...createEditor(e.level), solved: e.solved };
  }
}
