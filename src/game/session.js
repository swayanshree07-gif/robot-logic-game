// Play-session controller: the Run / Pause / Step / Stop / Reset / Speed logic
// of the level screen, without any DOM or timers. The UI calls `update(dt)`
// from requestAnimationFrame and renders `session.world` + `session.view()`.
//
// States:
//   edit     program not started; board shows the level's start position
//   running  ticking automatically at the chosen speed
//   paused   started, waiting for Step or Run
//   done     run finished (win / fail / error / timeout / loop) or stopped
//
//   edit --run--> running --pause--> paused --run--> running
//   edit/paused --step--> paused (one tick)        any --reset--> edit
//   running/paused --stop--> done (result 'stopped', board kept as is)
//   done --run/step--> starts over from the level's start
//   running --breakpoint--> paused (before the breakpoint line runs; no action taken)
//   edit/paused --stepOver--> paused (one action, but a call runs to its return)
//   paused (inside a function) --stepOut--> paused right after the function returns
//
// Breakpoints are line numbers; they survive reset and program edits. Run
// pauses *before* a breakpoint line; Run/Resume or Step continue past it.
//
// Test floors (level.floors): the player watches one floor at a time
// (setFloor). When the watched run wins, the program is also run headlessly on
// every other floor; the result is only a win if all of them win, otherwise a
// 'fail' naming the floor (result.floorFail, 0-based). Stars are always scored
// on floor 1 (the main map), so par means the same whichever floor is watched.
import { Runner, runLevel, describeResult, DEFAULT_MAX_TICKS } from './run.js';
import { floorCount, floorLevel } from '../world/level.js';
import { World } from '../world/world.js';
import { scoreRun, parLine } from './score.js';
import { analyze } from '../lang/lint.js';

/** Speeds offered in the UI: ms between ticks (0 = as fast as possible). */
export const SPEEDS = [
  { id: 'slow', label: 'Slow', ms: 600 },
  { id: 'normal', label: 'Normal', ms: 300 },
  { id: 'fast', label: 'Fast', ms: 120 },
  { id: 'turbo', label: 'Turbo', ms: 30 },
  { id: 'instant', label: 'Instant', ms: 0 },
];
/** Cap on ticks per update at 'instant' so one frame can't freeze the page. */
export const MAX_TICKS_PER_UPDATE = 500;

export class PlaySession {
  /**
   * @param {object} level   level data (format v1)
   * @param {{speed?: string}} [opt]
   */
  constructor(level, { speed = 'normal' } = {}) {
    this.level = level;
    this.source = '';
    this.breakpoints = new Set();
    this.floor = 0;
    this.setSpeed(speed);
    this.reset();
  }

  setSpeed(id) {
    const s = SPEEDS.find((x) => x.id === id);
    if (!s) throw new Error(`unknown speed '${id}'`);
    this.speed = s;
  }

  /** How many floors this level is tested on (1 = just the main map). */
  get floors() { return floorCount(this.level); }

  /** The level as played on the watched floor. */
  get played() { return floorLevel(this.level, this.floor); }

  /** Watch another test floor (0-based); throws away any run in progress. */
  setFloor(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.floors) throw new RangeError(`no floor ${i + 1}`);
    if (i === this.floor) return;
    this.floor = i;
    this.reset();
  }

  /** Changing the program throws away any run in progress. */
  setSource(text) {
    if (text === this.source) return;
    this.source = text;
    if (this.state !== 'edit') this.reset();
  }

  /** Parse + lint of the current source, cached until it changes: { error, warnings, defs }. */
  get analysis() {
    if (!this.analysisCache || this.analysisCache.source !== this.source) {
      this.analysisCache = { source: this.source, ...analyze(this.source) };
    }
    return this.analysisCache;
  }

  reset() {
    this.state = 'edit';
    this.runner = null;
    this.world = new World(this.played);
    this.result = null; // { result, ticks, size, unmet, error, message }
    this.line = 0; // line of the last executed action (0 = none)
    this.bump = null;
    this.acc = 0;
    this.atBreak = 0; // line of the breakpoint we're paused at (0 = none)
    this.resumeNext = false;
  }

  toggleBreakpoint(line) {
    if (this.breakpoints.has(line)) this.breakpoints.delete(line);
    else this.breakpoints.add(line);
    return this.breakpoints.has(line);
  }

  setBreakpoints(lines) { this.breakpoints = new Set(lines); }

  /** Start a fresh run; returns false if the program didn't compile (state becomes done). */
  start() {
    this.reset();
    this.runner = new Runner(this.source, this.played);
    this.world = this.runner.world;
    if (this.runner.done) { this.end(); return false; }
    return true;
  }

  run() {
    if (this.state === 'running') return;
    if (this.state === 'edit' || this.state === 'done') { if (!this.start()) return; }
    else if (this.state === 'paused') this.resumeNext = true; // continue past a breakpoint here
    this.state = 'running';
    this.acc = this.speed.ms; // take the first step right away
  }

  pause() { if (this.state === 'running') this.state = 'paused'; }

  toggle() { if (this.state === 'running') this.pause(); else this.run(); }

  step() {
    if (this.state === 'edit' || this.state === 'done') { if (!this.start()) return; }
    this.state = 'paused';
    this.tick(true);
  }

  /**
   * Step over: like Step, but a function call on the way runs to completion
   * in one go (pausing before the next line back at this level). Breakpoints
   * inside the call still pause it.
   */
  stepOver() {
    if (this.state === 'edit' || this.state === 'done') { if (!this.start()) return; }
    this.state = 'paused';
    const d = this.runner.vm.depth;
    if (!this.tick(true)) return;
    if (this.runner.vm.depth > d) this.runUntil((vm) => vm.depth <= d);
  }

  /**
   * Step out: finish the current function and pause right after it returns.
   * In the main program there is nothing to step out of, so this is Run.
   */
  stepOut() {
    if (this.state === 'edit' || this.state === 'done' || this.runner.vm.depth === 0) { this.run(); return; }
    this.state = 'paused';
    const d = this.runner.vm.depth;
    this.runUntil((vm) => vm.depth < d, true);
  }

  /** Tick synchronously until `stopWhen(vm)` before a line, a breakpoint or the end. */
  runUntil(stopWhen, resume = false) {
    for (let first = true; ; first = false) {
      if (!this.tick(first && resume, stopWhen)) return;
    }
  }

  /** Halt the run where it is. */
  stop() {
    if (this.state !== 'running' && this.state !== 'paused') return;
    this.state = 'done';
    this.result = { result: 'stopped', ticks: this.runner.ticks, size: this.runner.size, unmet: [], error: null, message: 'Stopped.' };
  }

  /**
   * Execute one tick. Returns true if the run continues.
   * `resume` = move past a breakpoint on the current line (Step always does).
   */
  tick(resume = false, stopWhen = null) {
    const ev = this.runner.tick({
      breakpoints: this.breakpoints.size ? this.breakpoints : null,
      resume: resume || this.resumeNext,
      stopWhen,
    });
    this.atBreak = 0;
    this.resumeNext = false;
    if (ev.type === 'break') {
      this.state = 'paused';
      this.line = ev.line;
      if (ev.reason === 'breakpoint') this.atBreak = ev.line;
      return false;
    }
    if (ev.type === 'end') { this.end(ev); return false; }
    this.line = ev.line;
    return true;
  }

  end(ev = null) {
    const r = this.runner;
    if (ev && ev.error && ev.error.line) this.line = ev.error.line;
    const last = this.world.log[this.world.log.length - 1];
    this.bump = r.error && last && last.type === 'bump' ? last : null;
    this.state = 'done';
    const summary = { result: r.result, ticks: r.ticks, size: r.size, unmet: this.world.unmetGoals(), error: r.error };
    summary.message = describeResult(summary);
    if (summary.result === 'win' && this.floors > 1) this.checkFloors(summary);
    if (summary.result === 'win') {
      const main = this.floor === 0 ? summary : runLevel(this.source, this.level);
      summary.score = scoreRun(main, this.level.par);
    } else summary.score = scoreRun(summary, this.level.par);
    this.result = summary;
  }

  /** A win on the watched floor only counts if every other floor wins too. */
  checkFloors(summary) {
    for (let i = 0; i < this.floors; i++) {
      if (i === this.floor) continue;
      const r = runLevel(this.source, floorLevel(this.level, i));
      if (r.result === 'win') continue;
      summary.result = 'fail';
      summary.floorFail = i;
      summary.message = `It works on floor ${this.floor + 1}, but not on test floor ${i + 1}: ${floorReason(r)} Watch floor ${i + 1} to see why.`;
      return;
    }
    summary.floors = this.floors;
    summary.message = `${summary.message} Passed all ${this.floors} test floors.${this.floor ? ' Stars are scored on floor 1.' : ''}`;
  }

  /**
   * Advance by `dt` milliseconds of wall time. Returns the number of ticks run.
   * At 'instant' speed runs up to MAX_TICKS_PER_UPDATE ticks per call.
   */
  update(dt) {
    if (this.state !== 'running') return 0;
    let n = 0;
    if (this.speed.ms === 0) {
      while (this.state === 'running' && n < MAX_TICKS_PER_UPDATE) { n++; this.tick(); }
      return n;
    }
    this.acc += dt;
    while (this.state === 'running' && this.acc >= this.speed.ms) {
      this.acc -= this.speed.ms;
      n++;
      this.tick();
    }
    return n;
  }

  /** Everything the UI needs to draw controls and the status line. */
  view() {
    const s = this.state;
    const ins = this.runner?.vm ? this.runner.vm.inspect() : null;
    return {
      state: s,
      line: this.line,
      ticks: this.runner ? this.runner.ticks : 0,
      battery: this.runner?.vm?.maxTicks ?? this.level.maxSteps ?? DEFAULT_MAX_TICKS,
      canRun: true,
      runLabel: s === 'running' ? 'Pause' : s === 'paused' ? 'Resume' : 'Run',
      atBreak: this.atBreak,
      callStack: this.runner?.vm ? this.runner.vm.callStack : [],
      loopCounters: this.runner?.vm ? this.runner.vm.loopCounters : [],
      // debugger panel: [{name, line}] frames and [{line, total, pass}] repeat blocks, outermost first
      frames: ins ? ins.frames : [],
      loops: ins ? ins.loops : [],
      // function panel: [{name, line, calls, active}] in source order (calls 0 before a run)
      functions: ins ? ins.functions
        : this.analysis.defs.map((d) => ({ ...d, calls: 0, active: 0 })),
      // lint warnings (CogError kind 'warning') for the program as written; only while editing
      warnings: s === 'edit' ? this.analysis.warnings : [],
      canStepOut: s === 'paused' && Boolean(this.runner?.vm?.depth),
      canStep: s !== 'running',
      canStop: s === 'running' || s === 'paused',
      canReset: s !== 'edit',
      result: this.result,
      floor: this.floor,
      floors: this.floors,
    };
  }
}

/** Why a headless run on another floor didn't win, as one short sentence. */
function floorReason(r) {
  if (r.result === 'fail') return `the program ends with the job unfinished (${r.unmet.join('; ')}).`;
  if (r.result === 'timeout') return 'the battery runs flat.';
  if (r.result === 'loop') return 'Pip gets stuck in a loop.';
  return `${r.error ? r.error.message.replace(/\.$/, '') : r.result}.`;
}

/** Banner shown when a run ends: { kind, title, text, next } (next = offer "next level"). */
export function resultBanner(result, { hasNext = false } = {}) {
  if (!result) return null;
  switch (result.result) {
    case 'win': {
      const sc = result.score;
      return {
        kind: 'win', title: 'Job done!', text: result.message, next: hasNext,
        stars: sc ? sc.stars : 1, par: sc && (sc.steps.par !== null || sc.size.par !== null) ? parLine(sc) : '',
      };
    }
    case 'fail': return result.floorFail !== undefined
      ? { kind: 'fail', title: 'Calibration failed', text: result.message, next: false, floor: result.floorFail }
      : { kind: 'fail', title: 'Not quite', text: result.message, next: false };
    case 'timeout': return { kind: 'fail', title: 'Battery flat', text: `${result.error.detail}. ${result.error.hint ? `Hint: ${result.error.hint}.` : ''}`.trim(), next: false };
    case 'loop': return { kind: 'fail', title: 'Stuck in a loop', text: result.error.hint || result.error.message, next: false };
    case 'stopped': return null;
    default: return { kind: 'error', title: result.error && result.error.kind === 'runtime' ? 'Pip stopped' : 'Program error', text: result.error ? result.error.message : 'error', next: false };
  }
}
