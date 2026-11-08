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
// Signals: `send NAME` adds one pending NAME signal (shared by the crew, no
// tick); `wait NAME` uses one up, or, if none is pending, blocks the robot
// for this round (it stands still and tries again next round). Signals count
// up, so two sends let two waits through. The `signal` sensor is true while
// any signal is pending. If a round passes in which every running robot is
// blocked and nothing on the floor moved, nothing can ever change again:
// the run ends as a 'deadlock' with a message naming who waits for what.
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
import { MAX_CREW, robotTools } from '../world/level.js';

export { MAX_CREW };

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
    this.signals = new Map(); // name -> pending count
    this.blocked = []; // per robot: signal name it is waiting for this round, or null
    this.vms = [];
    this.sizes = [];
    const n = this.world.robots.length;
    if (sources.length !== n) {
      throw new RangeError(`level has ${n} robot${n === 1 ? '' : 's'} but ${sources.length} program${sources.length === 1 ? ' was' : 's were'} given`);
    }
    for (let i = 0; i < n; i++) {
      try {
        const ast = parse(sources[i]);
        checkTools(ast, robotTools(level, i));
        this.sizes.push(programSize(ast));
        const host = {
          act: (name) => this.world.select(i).act(name),
          sense: (name) => (name === 'signal' ? this.pending > 0 : this.world.select(i).sense(name)),
          send: (name) => this.signals.set(name, (this.signals.get(name) || 0) + 1),
          take: (name) => {
            const n = this.signals.get(name) || 0;
            if (!n) return false;
            if (n === 1) this.signals.delete(name); else this.signals.set(name, n - 1);
            return true;
          },
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

  /** Total pending signals. */
  get pending() { let n = 0; for (const v of this.signals.values()) n += v; return n; }

  /** Pending signals as a sorted plain object, e.g. { ready: 1 } (for the debugger). */
  get signalCounts() { return Object.fromEntries([...this.signals].sort(([a], [b]) => (a < b ? -1 : 1))); }

  sigKey() { return [...this.signals].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(','); }

  key() { return `${this.world.stateKey()}#${this.vms.map((v) => v.stateKey()).join('#')}#${this.sigKey()}`; }

  finish(result, error = null, robot = -1) {
    this.result = result;
    this.error = error;
    if (error) error.robot = robot;
    return { type: 'end', result, error };
  }

  /** End the run because every running robot waits for a signal nobody can send. */
  deadlock(running) {
    const who = running.map((i) => `robot ${i + 1} waits for '${this.blocked[i]}'`);
    const ended = this.vms.map((v, i) => i).filter((i) => this.vms[i].status !== 'running').map((i) => i + 1);
    const list = who.length === 1 ? who[0] : `${who.slice(0, -1).join(', ')} and ${who.at(-1)}`;
    const hint = ended.length
      ? `${list}, but ${ended.length === 1 ? `robot ${ended[0]} has` : `robots ${ended.join(', ')} have`} already finished; nobody is left to send it`
      : `${list}; every robot is waiting, so nobody can send anything`;
    const first = running[0];
    const e = new CogError('deadlock: the crew is stuck waiting for signals', this.vms[first].line, { kind: 'runtime', hint });
    e.code = 'deadlock';
    return this.finish('deadlock', e, first);
  }

  /**
   * Play one round. Returns { type: 'round', events } (events[i] is robot i's
   * VM event: an action, { type: 'blocked', name } while waiting for a signal,
   * or null if its program had already ended) or { type: 'end', ... }.
   */
  tick() {
    if (this.done) return { type: 'end', result: this.result, error: this.error };
    if (this.rounds >= this.maxTicks) {
      const e = new CogError(`the crew's batteries ran out after ${this.maxTicks} steps`, 0, { kind: 'runtime', hint: 'does one of the loops never end?' });
      e.code = 'steps';
      return this.finish('timeout', e);
    }
    const events = [];
    const before = `${this.world.stateKey()}#${this.sigKey()}`; // a send this round is progress too
    this.blocked = this.vms.map(() => null);
    for (let i = 0; i < this.vms.length; i++) {
      const vm = this.vms[i];
      if (vm.status !== 'running') { events.push(null); continue; }
      this.world.select(i);
      const ev = vm.tick();
      events.push(ev);
      if (ev.type === 'blocked') this.blocked[i] = ev.name;
      if (ev.type === 'error') return this.finish(ev.error.code === 'steps' ? 'timeout' : 'error', ev.error, i);
    }
    this.world.select(0);
    this.rounds++;
    this.world.endTick();
    if (this.world.isWon()) return this.finish('win');
    if (this.vms.every((v) => v.status !== 'running')) return this.finish('fail');
    const running = this.vms.map((v, i) => i).filter((i) => this.vms[i].status === 'running');
    if (running.every((i) => this.blocked[i] !== null) && `${this.world.stateKey()}#${this.sigKey()}` === before) return this.deadlock(running);
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
  const out = { result: r.result, ticks: r.ticks, size: r.size, sizes: [...r.sizes], unmet: r.world.unmetGoals(), world: r.world, signals: r.signalCounts };
  if (r.error) out.error = r.error;
  return out;
}
