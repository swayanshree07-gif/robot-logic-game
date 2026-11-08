// Cog AST -> flat bytecode. Flat code makes single-stepping, breakpoints and
// running several robots in lock-step simple.
//
// Ops:
//   { op:'act', name }           perform a robot action (takes one tick)
//   { op:'jmp', to }             unconditional jump
//   { op:'jf', cond, to }        jump if condition is false
//   { op:'push', n }             push a repeat counter
//   { op:'loop', to }            counter==0 ? pop & jump to `to` : counter--
//   { op:'call', fn, name }      call function at address fn
//   { op:'ret' }                 return from function
//   { op:'halt' }                end of main program
//   { op:'mem', kind, name, value }  set/add/sub a register (no tick);
//                                value = { type:'num', value } | { type:'reg', name }
//   { op:'sig', kind, name }     kind 'send' raises signal `name` (no tick);
//                                kind 'wait' blocks until one is pending, then uses it up
// Every op carries `line` (source line, 0 for synthetic ops) and, for real
// statements, `col` (1-based column of the statement keyword).

import { parse } from './parser.js';

export function compile(ast) {
  const code = [];
  const fnAddr = {};
  const callFixups = [];
  const emit = (ins) => { code.push(ins); return code.length - 1; };

  function block(stmts) {
    for (const s of stmts) stmt(s);
  }

  function stmt(s) {
    switch (s.type) {
      case 'action':
        for (let i = 0; i < s.count; i++) emit({ op: 'act', name: s.name, line: s.line, col: s.col });
        break;
      case 'repeat': {
        emit({ op: 'push', n: s.count, line: s.line, col: s.col });
        const head = emit({ op: 'loop', to: -1, line: s.line, col: s.col });
        block(s.body);
        emit({ op: 'jmp', to: head, line: 0 });
        code[head].to = code.length;
        break;
      }
      case 'while': {
        const head = emit({ op: 'jf', cond: s.cond, to: -1, line: s.line, col: s.col });
        block(s.body);
        emit({ op: 'jmp', to: head, line: 0 });
        code[head].to = code.length;
        break;
      }
      case 'if': {
        const exits = [];
        for (const br of s.branches) {
          const test = emit({ op: 'jf', cond: br.cond, to: -1, line: br.line, col: br.col });
          block(br.body);
          exits.push(emit({ op: 'jmp', to: -1, line: 0 }));
          code[test].to = code.length;
        }
        if (s.elseBody) block(s.elseBody);
        for (const e of exits) code[e].to = code.length;
        break;
      }
      case 'memory':
        emit({ op: 'mem', kind: s.op, name: s.name, value: s.value, line: s.line, col: s.col });
        break;
      case 'signal':
        emit({ op: 'sig', kind: s.op, name: s.name, line: s.line, col: s.col });
        break;
      case 'call':
        callFixups.push(emit({ op: 'call', fn: -1, name: s.name, line: s.line, col: s.col }));
        break;
      default:
        throw new Error(`compile: unknown statement ${s.type}`);
    }
  }

  block(ast.main);
  emit({ op: 'halt', line: 0 });
  for (const [name, fn] of Object.entries(ast.functions)) {
    fnAddr[name] = code.length;
    block(fn.body);
    emit({ op: 'ret', line: 0 });
  }
  for (const i of callFixups) code[i].fn = fnAddr[code[i].name];
  // defs: [{ name, line }] in source order, for the function panel
  const defs = Object.entries(ast.functions).map(([name, fn]) => ({ name, line: fn.line })).sort((a, b) => a.line - b.line);
  return { code, functions: fnAddr, defs, registers: [...(ast.registers || [])] };
}

/** Parse + compile. Throws CogError on bad source. */
export function compileSource(source) {
  return compile(parse(source));
}

/** Count statements in source (used for scoring program size later). */
export function programSize(ast) {
  let n = 0;
  const walk = (stmts) => {
    for (const s of stmts) {
      n++;
      if (s.body) walk(s.body);
      if (s.branches) s.branches.forEach((b, i) => { if (i > 0) n++; walk(b.body); });
      if (s.elseBody) { n++; walk(s.elseBody); }
    }
  };
  walk(ast.main);
  for (const f of Object.values(ast.functions)) { n++; walk(f.body); }
  return n;
}
