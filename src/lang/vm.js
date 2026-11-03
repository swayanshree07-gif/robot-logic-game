// Steppable virtual machine for compiled Cog bytecode.
//
// The VM is host-agnostic: a host object supplies
//   host.act(name)   -> { ok: true } | { ok: false, error: string, code?: string }
//   host.sense(name) -> boolean
// so the same VM can drive one robot or many.
//
// Limits (all produce a runtime CogError with a `code`):
//   'recursion' - more than maxCallDepth nested calls
//   'idle'      - more than MAX_IDLE_OPS ops in a row without an action
//   'steps'     - more than maxTicks actions (Pip's battery runs out)
//   host codes  - e.g. 'bump' when an action fails

import { CogError } from './errors.js';

export const MAX_CALL_DEPTH = 64;
export const MAX_IDLE_OPS = 10000; // ops in a row without an action => probably stuck
export const DEFAULT_MAX_TICKS = 2000;

const OP_WORD = { push: 'repeat', loop: 'repeat', jf: 'while' };

export class VM {
  /** @param {{code: object[]}} program  @param {object} host  @param {{maxTicks?, maxCallDepth?}} [opt] */
  constructor(program, host, { maxTicks = DEFAULT_MAX_TICKS, maxCallDepth = MAX_CALL_DEPTH } = {}) {
    this.code = program.code;
    this.host = host;
    this.maxTicks = maxTicks;
    this.maxCallDepth = maxCallDepth;
    this.pc = 0;
    this.counters = [];
    this.calls = [];
    this.status = 'running'; // running | halted | error
    this.error = null;
    this.ticks = 0; // actions performed
    this.opsExecuted = 0;
  }

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
    return `${this.pc}|${this.counters.join(',')}|${this.calls.map((c) => c.ret).join(',')}`;
  }

  evalCond(c) {
    switch (c.type) {
      case 'const': return c.value;
      case 'not': return !this.evalCond(c.arg);
      case 'and': return this.evalCond(c.left) && this.evalCond(c.right);
      case 'or': return this.evalCond(c.left) || this.evalCond(c.right);
      case 'sensor': return Boolean(this.host.sense(c.name));
      default: throw new Error(`bad condition ${c.type}`);
    }
  }

  /** Stop with a runtime error pointing at instruction `ins` (or the current one). */
  fail(message, code, { ins = this.code[this.pc], hint = '' } = {}) {
    this.status = 'error';
    const word = ins && (ins.name || OP_WORD[ins.op]);
    this.error = new CogError(message, ins ? ins.line : 0, {
      col: ins && ins.line ? ins.col || 0 : 0, length: word ? word.length : 1, hint, kind: 'runtime',
    });
    this.error.code = code;
    return { type: 'error', error: this.error };
  }

  /**
   * Execute exactly one instruction.
   * Returns an event: { type: 'action', name, ok, line } | { type: 'op', line }
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
        const r = this.host.act(ins.name);
        this.ticks++;
        this.pc++;
        if (!r.ok) return this.fail(r.error, r.code || 'action', { ins });
        return { type: 'action', name: ins.name, ok: true, line: ins.line, col: ins.col };
      }
      case 'jmp': this.pc = ins.to; break;
      case 'jf': this.pc = this.evalCond(ins.cond) ? this.pc + 1 : ins.to; break;
      case 'push': this.counters.push(ins.n); this.pc++; break;
      case 'loop': {
        const top = this.counters.length - 1;
        if (this.counters[top] === 0) { this.counters.pop(); this.pc = ins.to; }
        else { this.counters[top]--; this.pc++; }
        break;
      }
      case 'call':
        if (this.calls.length >= this.maxCallDepth) {
          return this.fail(`too many nested calls (limit ${this.maxCallDepth})`, 'recursion',
            { hint: `is '${ins.name}' calling itself forever?` });
        }
        this.calls.push({ ret: this.pc + 1, name: ins.name });
        this.pc = ins.fn;
        break;
      case 'ret': this.pc = this.calls.pop().ret; break;
      case 'halt': this.status = 'halted'; return { type: 'halt' };
      default: throw new Error(`bad op ${ins.op}`);
    }
    this.opsExecuted++;
    return { type: 'op', line: ins.line };
  }

  /** Run until one action happens (one game tick), the program halts or errors. */
  tick() {
    let idle = 0;
    let where = null; // last real source statement seen, for the error
    for (;;) {
      if (this.code[this.pc] && this.code[this.pc].line) where = this.code[this.pc];
      const ev = this.step();
      if (ev.type !== 'op') return ev;
      if (++idle > MAX_IDLE_OPS) {
        return this.fail('the program loops without doing anything', 'idle',
          { ins: where, hint: 'check your while conditions' });
      }
    }
  }
}
