// Headless level runner: used by tests now, and by the UI's "verify" later.
import { compileSource } from '../lang/compiler.js';
import { VM } from '../lang/vm.js';
import { World } from '../world/world.js';

export const DEFAULT_MAX_TICKS = 2000;

/**
 * Run `source` on `level` to completion.
 * Returns { result: 'win'|'fail'|'error'|'timeout', ticks, world, error? }
 *   win     - level goal reached
 *   fail    - program ended without reaching the goal
 *   error   - parse error or runtime error (e.g. bumped a wall)
 *   timeout - more than maxTicks actions
 */
export function runLevel(source, level, { maxTicks = DEFAULT_MAX_TICKS } = {}) {
  const world = new World(level);
  let program;
  try {
    program = compileSource(source);
  } catch (e) {
    if (e.name === 'CogError') return { result: 'error', ticks: 0, world, error: e };
    throw e;
  }
  const vm = new VM(program, world);
  while (vm.ticks < maxTicks) {
    const ev = vm.tick();
    if (ev.type === 'error') return { result: 'error', ticks: vm.ticks, world, error: ev.error };
    if (world.isWon()) return { result: 'win', ticks: vm.ticks, world };
    if (ev.type === 'halt') return { result: 'fail', ticks: vm.ticks, world };
  }
  return { result: 'timeout', ticks: vm.ticks, world };
}
