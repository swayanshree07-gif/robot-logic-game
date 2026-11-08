// Crew runner: several robots on one map, each with its own Cog program.
//
// Lock-step scheduling (docs/ticks.md, "Crews"): one game tick = one round.
// In a round every robot that is still running executes its program up to
// and including its next action, in robot order (robot 1 first; robots are
// numbered in map reading order). Then the factory updates once (belts,
// doors) and the win rules are checked. So a robot may step into a tile that
// a lower-numbered robot left earlier in the same round, but two robots can
// never pass through each other: moving into an occupied tile is a crash,
// which ends the run like a bump.
//
// A robot whose program ends just stands still; the run fails when every
// program has ended without a win. Loop detection works like the one-robot
// Runner, over the world state plus every VM's state.
import { parse } from '../lang/parser.js';
import { compile, programSize } from '../lang/compiler.js';
import { checkTools } from '../lang/restrict.js';
import { VM, DEFAULT_MAX_TICKS } from '../lang/vm.js';
import { CogError } from '../lang/errors.js';
import { World, parseMap } from '../world/world.js';

export const MAX_CREW = 4;

/** Number of robot starts on a map (crew size). */
export const crewSize = (map) => parseMap(map, { maxRobots: MAX_CREW }).robots.length;

export class CrewRunner {
  /**
   * @param {string[]} sources  one Cog program per robot, in robot order
   * @param {object} level      level data; level.maxSteps limits rounds
   * @param {{maxTicks?: number, detectCycles?: boolean}} [opt]
   * Never throws for bad programs: check `result` (and `error.robot`, 0-based).
   */
  constructor(sources, level, { maxTicks = level.maxSteps ?? DEFAULT_MAX_TICKS, detectCycles = true } = {}) {
    this.world = new World(level, { maxRobots: MAX_CREW });
    this.world.deferTicks = true;
    this.result = null;
    this.error = null;
    this.rounds = 0;
    this.maxTicks = maxTicks;
    this.detectCycles = detectCycles;
    this.seen = new Map();
    this.vms = [];
    this.sizes = [];
    const n = this.world.robots.length;
    if (sources.length !== n) {
      throw new RangeError(`level has ${n} robot${n === 1 ? '' : 's'} but ${sources.length} program${sources.length === 1 ? ' was' : 's were'} given`);
    }
    for (let i = 0; i < n; i++) {
      try {
        const ast = parse(sources[i]);
        checkTools(ast, level.tools);
        this.sizes.push(programSize(ast));
        const host = {
          act: (name) => this.world.select(i).act(name),
          sense: (name) => this.world.select(i).sense(name),
        };
        this.vms.push(new VM(compile(ast), host, { maxTicks }));
      } catch (e) {
        if (!(e instanceof CogError)) throw e;
        this.finish('error', e, i);
        return;
      }
    }
    if (detectCycles) this.seen.set(this.key(), 0);
  }

  get done() { return this.result !== null; }
  /** Rounds played (the crew's step count). */
  get ticks() { return this.rounds; }
  /** Total program size over all robots (for scoring). */
  get size() { return this.sizes.reduce((a, b) => a + b, 0); }

  key() { return `${this.world.stateKey()}#${this.vms.map((v) => v.stateKey()).join('#')}`; }

  finish(result, error = null, robot = -1) {
    this.result = result;
    this.error = error;
    if (error) error.robot = robot;
    return { type: 'end', result, error };
  }

  /**
   * Play one round. Returns { type: 'round', events } (events[i] is robot i's
   * VM event, or null if its program had already ended) or { type: 'end', ... }.
   */
  tick() {
    if (this.done) return { type: 'end', result: this.result, error: this.error };
    if (this.rounds >= this.maxTicks) {
      const e = new CogError(`the crew's batteries ran out after ${this.maxTicks} steps`, 0, { kind: 'runtime', hint: 'does one of the loops never end?' });
      e.code = 'steps';
      return this.finish('timeout', e);
    }
    const events = [];
    for (let i = 0; i < this.vms.length; i++) {
      const vm = this.vms[i];
      if (vm.status !== 'running') { events.push(null); continue; }
      this.world.select(i);
      const ev = vm.tick();
      events.push(ev);
      if (ev.type === 'error') return this.finish(ev.error.code === 'steps' ? 'timeout' : 'error', ev.error, i);
    }
    this.world.select(0);
    this.rounds++;
    this.world.endTick();
    if (this.world.isWon()) return this.finish('win');
    if (this.vms.every((v) => v.status !== 'running')) return this.finish('fail');
    if (this.detectCycles) {
      const k = this.key();
      const first = this.seen.get(k);
      if (first !== undefined) {
        const e = new CogError('the crew is stuck in a loop', 0, {
          kind: 'runtime',
          hint: `after step ${this.rounds} everything is exactly as it was after step ${first}, so the job can never be finished`,
        });
        e.code = 'loop';
        return this.finish('loop', e);
      }
      this.seen.set(k, this.rounds);
    }
    return { type: 'round', events };
  }
}

/** Run a crew to the end: { result, ticks, size, sizes, unmet, world, error? }. */
export function runCrew(sources, level, opt = {}) {
  const r = new CrewRunner(sources, level, opt);
  while (!r.done) r.tick();
  const out = { result: r.result, ticks: r.ticks, size: r.size, sizes: [...r.sizes], unmet: r.world.unmetGoals(), world: r.world };
  if (r.error) out.error = r.error;
  return out;
}
