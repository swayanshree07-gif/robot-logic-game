// Non-fatal advice about a program that parses fine ("warnings").
// The program still runs; the UI shows these in the status line before a run.
//
//   lint(ast) -> CogError[] with kind 'warning' and a `code`, in source order:
//     'unused'     function never runs (not called, only calls itself, or only
//                  called from functions that never run)
//     'empty'      a block or function with nothing inside
//     'repeat1'    `repeat 1` runs its body just once
import { CogError } from './errors.js';
import { parse } from './parser.js';

const warn = (code, message, node, length, hint = '') => {
  const e = new CogError(message, node.line, { col: node.col || 0, length, hint, kind: 'warning' });
  e.code = code;
  return e;
};

export function lint(ast) {
  const out = [];
  const callers = new Map(Object.keys(ast.functions).map((n) => [n, new Set()]));

  const walk = (stmts, owner) => {
    for (const s of stmts) {
      if (s.type === 'call') callers.get(s.name)?.add(owner);
      if (s.type === 'repeat') {
        if (s.count === 1) out.push(warn('repeat1', "'repeat 1' runs its body just once", s, 6, 'the repeat can go'));
        if (!s.body.length) out.push(warn('empty', "this 'repeat' block is empty", s, 6, 'put commands between repeat and end'));
        walk(s.body, owner);
      }
      if (s.type === 'while') {
        if (!s.body.length) out.push(warn('empty', "this 'while' block is empty", s, 5, 'put commands between while and end'));
        walk(s.body, owner);
      }
      if (s.type === 'if') {
        s.branches.forEach((b) => walk(b.body, owner));
        if (s.elseBody) walk(s.elseBody, owner);
        if (s.branches.every((b) => !b.body.length) && !(s.elseBody && s.elseBody.length)) {
          out.push(warn('empty', "this 'if' block is empty", s, 2, 'put commands between if and end'));
        }
      }
    }
  };
  walk(ast.main, null);
  for (const [name, fn] of Object.entries(ast.functions)) {
    walk(fn.body, name);
    if (!fn.body.length) out.push(warn('empty', `function '${name}' is empty`, fn, name.length, 'calling it does nothing'));
  }

  // A function is used if something other than itself calls it, and that caller
  // is used too (main always is). Mutually recursive pairs nobody calls are unused.
  const used = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, from] of callers) {
      if (used.has(name)) continue;
      if ([...from].some((c) => c === null || (c !== name && used.has(c)))) { used.add(name); grew = true; }
    }
  }
  for (const [name, fn] of Object.entries(ast.functions)) {
    if (used.has(name)) continue;
    const from = callers.get(name);
    const msg = !from.size ? `function '${name}' is never called`
      : from.size === 1 && from.has(name) ? `function '${name}' only calls itself, nothing else runs it`
        : `function '${name}' is only called from functions that never run`;
    out.push(warn('unused', msg, fn, name.length, `write '${name}' on a line of its own to run it`));
  }
  return out.sort((a, b) => a.line - b.line || a.col - b.col);
}

/**
 * Parse and lint without running: { error, warnings, defs } where error is the
 * CogError that stops the program from parsing (or null) and defs lists
 * [{ name, line }] of its functions in source order.
 */
export function analyze(source) {
  let ast;
  try { ast = parse(source); } catch (e) {
    if (!(e instanceof CogError)) throw e;
    return { error: e, warnings: [], defs: [] };
  }
  const defs = Object.values(ast.functions).map((f) => ({ name: f.name, line: f.line })).sort((a, b) => a.line - b.line);
  return { error: null, warnings: lint(ast), defs };
}
