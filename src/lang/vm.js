// Steppable virtual machine for compiled Cog bytecode.
//
// The VM is host-agnostic: a host object supplies
//   host.act(name)   -> { ok: true } | { ok: false, error: string, code?: string }
//   host.sense(name) -> boolean
//   host.send(name), host.take(name) -> boolean   (signals; crews only)
// so the same VM can drive one robot or many.
//
// Limits (all produce a runtime CogError with a `code`):
//   'recursion' - more than maxCallDepth nested calls
//   'idle'      - more than MAX_IDLE_OPS ops in a row without an action
//   'steps'     - more than maxTicks actions (Pip's battery runs out)
//   'overflow'  - a register would leave -MAX_VALUE..MAX_VALUE
//   host codes  - e.g. 'bump' when an action fails
//
// Registers (set/add/sub, comparisons in conditions) live in the VM, start at
// 0 and are part of stateKey(), so the run loop detector tells "counting" apart
// from "stuck".

import { CogError } from './errors.js';
import { MAX_VALUE } from './parser.js';

export const MAX_CALL_DEPTH = 64;
export const MAX_IDLE_OPS = 10000; // ops in a row without an action => probably stuck
export const DEFAULT_MAX_TICKS = 2000;

const OP_WORD = { push: 'repeat', loop: 'repeat', jf: 'while' }; // mem/sig ops use `kind`

export class VM {
  /** @param {{code: object[]}} program  @param {object} host  @param {{maxTicks?, maxCallDepth?}} [opt] */
  constructor(program, host, { maxTicks = DEFAULT_MAX_TICKS, maxCallDepth = MAX_CALL_DEPTH } = {}) {
    this.code = program.code;
    this.host = host;
    this.maxTicks = maxTicks;
    this.maxCallDepth = maxCallDepth;
    this.pc = 0;
    this.counters = [];
    this.counterIns = []; // the push instruction of each active repeat (parallel to counters)
    this.calls = [];
    this.defs = program.defs || [];
    this.callCounts = Object.create(null); // function name -> calls started so far
    this.status = 'running'; // running | halted | error
    this.error = null;
    this.ticks = 0; // actions performed
    this.opsExecuted = 0;
    this.registerNames = program.registers || [];
    this.regs = Object.create(null);
    for (const r of this.registerNames) this.regs[r] = 0;
  }

  /** Current register values in first-use order: [{ name, value }]. */
  get registers() {
    return this.registerNames.map((name) => ({ name, value: this.regs[name] }));
  }

  value(v) { return v.type === 'num' ? v.value : (this.regs[v.name] ?? 0); }

  get line() {
    const ins = this.code[this.pc];
    return ins ? ins.line : 0;
  }

  /** Names of the functions currently being executed, outermost first. */
  get callStack() {
    return this.calls.map((c) => c.name);
  }

  /** Compact string of everything that determines what the VM does next. */
  stateKey() {
    const regs = this.registerNames.length ? `|${this.registerNames.map((r) => this.regs[r]).join(',')}` : '';
    return `${this.pc}|${this.counters.join(',')}|${this.calls.map((c) => c.ret).join(',')}${regs}`;
  }

  evalCond(c) {
    switch (c.type) {
      case 'const': return c.value;
      case 'not': return !this.evalCond(c.arg);
      case 'and': return this.evalCond(c.left) && this.evalCond(c.right);
      case 'or': return this.evalCond(c.left) || this.evalCond(c.right);
      case 'sensor': return Boolean(this.host.sense(c.name));
      case 'cmp': {
        const a = this.value(c.left), b = this.value(c.right);
        switch (c.op) {
          case '==': return a === b;
          case '!=': return a !== b;
          case '<': return a < b;
          case '>': return a > b;
          case '<=': return a <= b;
          case '>=': return a >= b;
          default: throw new Error(`bad comparison ${c.op}`);
        }
      }
      default: throw new Error(`bad condition ${c.type}`);
    }
  }

  /** Stop with a runtime error pointing at instruction `ins` (or the current one). */
  fail(message, code, { ins = this.code[this.pc], hint = '' } = {}) {
    this.status = 'error';
    const word = ins && (ins.op === 'mem' || ins.op === 'sig' ? ins.kind : ins.name || OP_WORD[ins.op]);
    this.error = new CogError(message, ins ? ins.line : 0, {
      col: ins && ins.line ? ins.col || 0 : 0, length: word ? word.length : 1, hint, kind: 'runtime',
    });
    this.error.code = code;
    return { type: 'error', error: this.error };
  }

  /**
   * Execute exactly one instruction.
   * Returns an event: { type: 'action', name, ok, line } | { type: 'op', line }
   *                   | { type: 'blocked', name, line }  (`wait NAME` with no signal pending;
   *                     the pc stays on the wait, so the next tick tries again)
   *                   | { type: 'halt' } | { type: 'error', error }
   */
  step() {
    if (this.status !== 'running') return { type: this.status === 'halted' ? 'halt' : 'error', error: this.error };
    const ins = this.code[this.pc];
    switch (ins.op) {
      case 'act': {
        if (this.ticks >= this.maxTicks) {
          return this.fail(`Pip's battery ran out after ${this.maxTicks} steps`, 'steps',
            { hint: 'does one of your loops never end?' });
        }
        this.opsExecuted++;
        const depth = this.calls.length;
        const r = this.host.act(ins.name);
        this.ticks++;
        this.pc++;
        if (!r.ok) return this.fail(r.error, r.code || 'action', { ins });
        return { type: 'action', name: ins.name, ok: true, line: ins.line, col: ins.col, depth };
      }
      case 'jmp': this.pc = ins.to; break;
      case 'jf': this.pc = this.evalCond(ins.cond) ? this.pc + 1 : ins.to; break;
      case 'push': this.counters.push(ins.n); this.counterIns.push(ins); this.pc++; break;
      case 'loop': {
        const top = this.counters.length - 1;
        if (this.counters[top] === 0) { this.counters.pop(); this.counterIns.pop(); this.pc = ins.to; }
        else { this.counters[top]--; this.pc++; }
        break;
      }
      case 'call':
        if (this.calls.length >= this.maxCallDepth) {
          return this.fail(`too many nested calls (limit ${this.maxCallDepth})`, 'recursion',
            { hint: recursionHint(this.calls, ins.name) });
        }
        this.callCounts[ins.name] = (this.callCounts[ins.name] || 0) + 1;
        this.calls.push({ ret: this.pc + 1, name: ins.name, line: ins.line });
        this.pc = ins.fn;
        break;
      case 'ret': this.pc = this.calls.pop().ret; break;
      case 'mem': {
        const v = this.value(ins.value);
        const old = this.regs[ins.name] ?? 0;
        const next = ins.kind === 'set' ? v : ins.kind === 'add' ? old + v : old - v;
        if (Math.abs(next) > MAX_VALUE) {
          return this.fail(`register '${ins.name}' would be ${next}, past the limit of ${next > 0 ? '' : '-'}${MAX_VALUE}`, 'overflow',
            { hint: 'is a counter running away?' });
        }
        this.regs[ins.name] = next;
        this.pc++;
        break;
      }
      case 'sig': {
        if (typeof this.host.send !== 'function') {
          return this.fail('signals only work with a crew of robots', 'signal', { hint: `'${ins.kind} ${ins.name}' needs a partner robot` });
        }
        if (ins.kind === 'send') this.host.send(ins.name);
        else if (!this.host.take(ins.name)) return { type: 'blocked', name: ins.name, line: ins.line, col: ins.col };
        this.pc++;
        break;
      }
      case 'halt': this.status = 'halted'; return { type: 'halt' };
      default: throw new Error(`bad op ${ins.op}`);
    }
    this.opsExecuted++;
    return { type: 'op', line: ins.line };
  }

  /**
   * Run until one action happens (one game tick), the program halts or errors.
   * Breakpoints: with opt.breakpoints (a Set of line numbers) the VM stops
   * *before* executing an instruction on one of those lines and returns
   * { type: 'break', line }. Pass opt.resume = true to continue from a break:
   * the line it stopped on is ignored until execution leaves it.
   * opt.stopWhen(vm) is checked the same way (before each source line) and
   * returns { type: 'break', line, reason: 'step' } when true; the debugger
   * uses it for step over / step out. Breakpoints report reason 'breakpoint'.
   */
  tick({ breakpoints = null, resume = false, stopWhen = null } = {}) {
    let idle = 0;
    let where = null; // last real source statement seen, for the error
    let skip = resume ? this.line : 0;
    for (;;) {
      const ins = this.code[this.pc];
      if (ins && ins.line) {
        where = ins;
        if (ins.line !== skip) skip = 0;
        if (this.status === 'running') {
          if (stopWhen && stopWhen(this)) return { type: 'break', line: ins.line, reason: 'step' };
          if (breakpoints && breakpoints.has(ins.line) && !skip) return { type: 'break', line: ins.line, reason: 'breakpoint' };
        }
      }
      const ev = this.step();
      if (ev.type !== 'op') return ev;
      if (++idle > MAX_IDLE_OPS) {
        return this.fail('the program loops without doing anything', 'idle',
          { ins: where, hint: 'check your while conditions' });
      }
    }
  }

  /** Repeat counters of the active repeat blocks, outermost first (iterations left after this one). */
  get loopCounters() { return [...this.counters]; }

  /** Current call depth (0 = main program). */
  get depth() { return this.calls.length; }

  /**
   * Debugger snapshot, outermost first:
   *   frames: [{ name, line }]   name 'main' (line 0), then each call with the line it was called from
   *   loops:  [{ line, total, pass }]  each active repeat block: header line, count, current pass (1-based)
   *   functions: [{ name, line, calls, active }]  every def in source order: def line,
   *              calls started so far, and how many of its calls are running right now
   *   registers: [{ name, value }]  every register in first-use order
   */
  inspect() {
    return {
      frames: [{ name: 'main', line: 0 }, ...this.calls.map((c) => ({ name: c.name, line: c.line }))],
      loops: this.counterIns.map((ins, i) => ({ line: ins.line, total: ins.n, pass: ins.n - this.counters[i] })),
      functions: this.defs.map((d) => ({
        name: d.name, line: d.line, calls: this.callCounts[d.name] || 0,
        active: this.calls.filter((c) => c.name === d.name).length, // how many copies are running now
      })),
      registers: this.registers,
    };
  }
}

/**
 * Hint for the call-depth error: name the function(s) going round in circles.
 * Looks at the innermost calls, where a runaway recursion lives.
 */
export function recursionHint(calls, next) {
  const recent = [...calls.slice(-12).map((c) => c.name), next];
  const names = [...new Set(recent)];
  if (names.length === 1) return `is '${next}' calling itself forever?`;
  const quoted = names.map((n) => `'${n}'`);
  const list = quoted.length === 2 ? quoted.join(' and ') : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
  return `${list} keep calling each other; does either one ever stop?`;
}

/** Source lines that hold an instruction, i.e. where a breakpoint can trigger. */
export function breakableLines(program) {
  return new Set(program.code.map((i) => i.line).filter(Boolean));
}
