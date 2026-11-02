// Steppable virtual machine for compiled Cog bytecode.
//
// The VM is host-agnostic: a host object supplies
//   host.act(name)   -> { ok: true } | { ok: false, error: string }
//   host.sense(name) -> boolean
// so the same VM can drive one robot or many.

import { CogError } from './parser.js';

export const MAX_CALL_DEPTH = 64;
export const MAX_IDLE_OPS = 10000; // ops in a row without an action => probably stuck

export class VM {
  constructor(program, host) {
    this.code = program.code;
    this.host = host;
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

  fail(message, line) {
    this.status = 'error';
    this.error = new CogError(message, line);
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
    this.opsExecuted++;
    switch (ins.op) {
      case 'act': {
        const r = this.host.act(ins.name);
        this.ticks++;
        this.pc++;
        if (!r.ok) return this.fail(r.error, ins.line);
        return { type: 'action', name: ins.name, ok: true, line: ins.line };
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
        if (this.calls.length >= MAX_CALL_DEPTH) {
          return this.fail(`too many nested calls (limit ${MAX_CALL_DEPTH}) — is '${ins.name}' calling itself forever?`, ins.line);
        }
        this.calls.push({ ret: this.pc + 1, name: ins.name, counterDepth: this.counters.length });
        this.pc = ins.fn;
        break;
      case 'ret': this.pc = this.calls.pop().ret; break;
      case 'halt': this.status = 'halted'; return { type: 'halt' };
      default: throw new Error(`bad op ${ins.op}`);
    }
    return { type: 'op', line: ins.line };
  }

  /** Run until one action happens (one game tick), the program halts or errors. */
  tick() {
    let idle = 0;
    for (;;) {
      const line = this.line;
      const ev = this.step();
      if (ev.type !== 'op') return ev;
      if (++idle > MAX_IDLE_OPS) {
        return this.fail('the program loops without doing anything — check your while conditions', line);
      }
    }
  }
}
