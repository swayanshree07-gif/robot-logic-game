// Level runner shared by the headless tests and the browser UI.
//
// A Runner owns one World + one VM and advances them a tick at a time,
// checking the win rule, Pip's step budget and infinite loops.
//
// Infinite-loop detection: the world and VM are deterministic, so if the
// combined (world state, VM state) after an action equals one seen before,
// the program will repeat the same steps forever and can never win (the win
// rule only depends on world state, which was already checked last time).
import { compileSource } from '../lang/compiler.js';
import { VM, DEFAULT_MAX_TICKS } from '../lang/vm.js';
import { CogError } from '../lang/errors.js';
import { World } from '../world/world.js';

export { DEFAULT_MAX_TICKS };

export class Runner {
  /**
   * @param {string} source  Cog program
   * @param {object} level   level data ({ map, win })
   * @param {{maxTicks?: number, detectCycles?: boolean}} [opt]
   * Never throws for bad programs: check `runner.result` after construction.
   */
  constructor(source, level, { maxTicks = DEFAULT_MAX_TICKS, detectCycles = true } = {}) {
    this.world = new World(level);
    this.result = null; // null while running, else 'win' | 'fail' | 'error' | 'timeout' | 'loop'
    this.error = null;
    this.vm = null;
    this.detectCycles = detectCycles;
    this.seen = new Map(); // state key -> tick number
    try {
      this.vm = new VM(compileSource(source), this.world, { maxTicks });
    } catch (e) {
      if (!(e instanceof CogError)) throw e;
      this.finish('error', e);
      return;
    }
    if (detectCycles) this.seen.set(this.key(), 0);
  }

  get ticks() { return this.vm ? this.vm.ticks : 0; }
  get done() { return this.result !== null; }

  key() { return `${this.world.stateKey()}#${this.vm.stateKey()}`; }

  finish(result, error = null) {
    this.result = result;
    this.error = error;
    return { type: 'end', result, error };
  }

  /**
   * Advance one game tick. Returns the VM event ({type:'action',...}) while the
   * run continues, or { type: 'end', result, error } once it is over.
   */
  tick() {
    if (this.done) return { type: 'end', result: this.result, error: this.error };
    const ev = this.vm.tick();
    if (ev.type === 'error') return this.finish(ev.error.code === 'steps' ? 'timeout' : 'error', ev.error);
    if (this.world.isWon()) return this.finish('win');
    if (ev.type === 'halt') return this.finish('fail');
    if (this.detectCycles) {
      const k = this.key();
      const first = this.seen.get(k);
      if (first !== undefined) {
        // Point at the action that closed the cycle.
        const e = new CogError('Pip is stuck in a loop', ev.line, {
          kind: 'runtime', col: ev.col || 0, length: ev.name.length,
          hint: `after step ${this.vm.ticks} everything is exactly as it was after step ${first}, so the job can never be finished`,
        });
        e.code = 'loop';
        return this.finish('loop', e);
      }
      this.seen.set(k, this.vm.ticks);
    }
    return ev;
  }
}

/**
 * Run `source` on `level` to completion.
 * Returns { result, ticks, world, error? } where result is
 *   win     - level goal reached
 *   fail    - program ended without reaching the goal
 *   error   - parse error or runtime error (e.g. bumped a wall)
 *   timeout - ran out of steps (maxTicks actions)
 *   loop    - provably repeating forever (only when detectCycles is on)
 */
export function runLevel(source, level, opt = {}) {
  const r = new Runner(source, level, opt);
  while (!r.done) r.tick();
  const out = { result: r.result, ticks: r.ticks, world: r.world };
  if (r.error) out.error = r.error;
  return out;
}
