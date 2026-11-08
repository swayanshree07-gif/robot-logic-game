// Cog language parser: source text -> AST.
//
// Cog is line based. One statement per line, blocks are closed with `end`.
// `#` starts a comment. Keywords are case-insensitive.
//
//   move [N]            left   right   grab   drop   wait
//   repeat N [times] ... end
//   while COND ... end
//   if COND ... [elif COND ...] [else ...] end
//   def NAME ... end    (top level only)
//   NAME                call a function
//   set REG VAL   add REG VAL   sub REG VAL     memory registers (no tick)
//   send NAME           raise signal NAME for the crew (no tick)
//   wait NAME           block until a signal NAME is pending, then use it up
//                       (plain `wait` with no name is still the idle action)
//
// COND := OR ;  OR := AND ('or' AND)* ; AND := NOT ('and' NOT)* ;
// NOT := 'not' NOT | '(' OR ')' | 'true' | 'false' | SENSOR | VAL CMP VAL
// VAL := integer (-999..999) | REG      CMP := == != < > <= >=
//
// Registers are Pip's memory cells: named integers that start at 0. They are
// created by being written (set/add/sub); reading one that is never written
// anywhere is an error (almost always a typo). At most MAX_REGISTERS names.
//
// Every AST node carries `line` and `col` (1-based) of its first token so the
// UI can highlight it and errors can point at it.

import { CogError, didYouMean } from './errors.js';

export { CogError };
export const ACTIONS = ['move', 'left', 'right', 'grab', 'drop', 'wait'];
export const SENSORS = [
  'clear', 'wall', 'clear_left', 'clear_right', // range finders
  'goal', 'item', 'holding', 'bin',             // tile / gripper
  'red', 'yellow', 'blue',                      // floor colour under Pip
  'scan',                                       // path planner: ahead is closer to the target
  'signal',                                     // crews: some signal is pending
];
export const SIGNAL_OPS = ['send', 'wait']; // `wait NAME`; plain `wait` is an action
export const MEMORY_OPS = ['set', 'add', 'sub'];
export const COMPARE_OPS = ['==', '!=', '<', '>', '<=', '>='];
const BLOCK_WORDS = ['repeat', 'while', 'if', 'elif', 'else', 'end', 'def'];
const KEYWORDS = [...BLOCK_WORDS, 'and', 'or', 'not', 'true', 'false', 'times'];
export const RESERVED = [...new Set([...KEYWORDS, ...ACTIONS, ...SENSORS, ...MEMORY_OPS, ...SIGNAL_OPS])];
export const MAX_REPEAT = 999;
export const MAX_MOVE = 99;
export const MAX_VALUE = 999; // registers hold -MAX_VALUE..MAX_VALUE
export const MAX_REGISTERS = 8;

const IDENT = /^[a-z_][a-z0-9_]*$/;

// Words people coming from other languages type, with what to write instead.
const FOREIGN = {
  for: "Cog loops with 'repeat N' or 'while COND'",
  loop: "Cog loops with 'repeat N' or 'while COND'",
  until: "use 'while not COND'",
  function: "functions start with 'def NAME'",
  func: "functions start with 'def NAME'",
  fn: "functions start with 'def NAME'",
  procedure: "functions start with 'def NAME'",
  endif: "every block closes with a plain 'end'",
  endwhile: "every block closes with a plain 'end'",
  done: "every block closes with a plain 'end'",
  forward: "to drive forward, use 'move'",
  turn: "use 'left' or 'right' to turn",
  pick: "use 'grab' to pick up a part",
  put: "use 'drop' to put a part down",
  let: "store a number with 'set NAME 3'",
  var: "store a number with 'set NAME 3'",
  inc: "count up with 'add NAME 1'",
  dec: "count down with 'sub NAME 1'",
};
const OPERATORS = { '!': 'not', '&': 'and', '|': 'or', '&&': 'and', '||': 'or', '=': null, '+': null, '*': null, '/': null };
const operatorError = (t, line) => {
  if (t.v === '=') return err("'=' is not part of Cog", line, t, "compare with '==', store with 'set NAME VALUE'");
  if (t.v === '+' || t.v === '*' || t.v === '/') return err(`'${t.raw}' is not part of Cog`, line, t, "do arithmetic on its own line with 'add' or 'sub'");
  if (COMPARE_OPS.includes(t.v)) return err(`'${t.raw}' needs a number or register on its left`, line, t, 'for example \'n < 3\'');
  return err(`'${t.raw}' is not part of Cog`, line, t,
    OPERATORS[t.v] ? `write '${OPERATORS[t.v]}' instead` : 'conditions are sensor names or comparisons combined with not / and / or');
};

/** Split one line into tokens with 1-based columns. Comment already removed. */
function tokenizeLine(text) {
  const out = [];
  const re = /\s*([A-Za-z_][A-Za-z0-9_]*|\d+|&&|\|\||==|!=|<=|>=|=<|=>|\S)/y;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1];
    const col = m.index + m[0].length - raw.length + 1;
    out.push({ v: raw.toLowerCase(), raw, col, len: raw.length });
  }
  return out;
}

const err = (msg, line, tok, hint = '') =>
  new CogError(msg, line, { col: tok ? tok.col : 0, length: tok ? tok.len : 1, hint });

const isNum = (t) => t && /^\d+$/.test(t.v);
const isRegName = (t) => t && IDENT.test(t.v) && !RESERVED.includes(t.v);

/**
 * Read a value (integer or register name) starting at tokens[j].
 * Returns { node, len } or null when tokens[j] can't start a value.
 * Value nodes: { type: 'num', value } | { type: 'reg', name, col, len }.
 */
function readOperand(tokens, j, line) {
  const t = tokens[j];
  if (!t) return null;
  let neg = false, at = t, k = j;
  if (t.v === '-' && isNum(tokens[j + 1])) { neg = true; k = j + 1; }
  const n = tokens[k];
  if (isNum(n)) {
    const value = (neg ? -1 : 1) * Number(n.v);
    if (Math.abs(value) > MAX_VALUE) {
      throw err(`${value} is too big for a register`, line, { col: at.col, len: n.col + n.len - at.col },
        `values go from -${MAX_VALUE} to ${MAX_VALUE}`);
    }
    return { node: { type: 'num', value }, len: k - j + 1 };
  }
  if (isRegName(t)) return { node: { type: 'reg', name: t.v, col: t.col, len: t.len }, len: 1 };
  return null;
}

const FLIPPED = { '=<': '<=', '=>': '>=' };

function parseCond(tokens, line, after, reads = null) {
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  function or() {
    let left = and();
    while (peek() && peek().v === 'or') { next(); left = { type: 'or', left, right: and() }; }
    return left;
  }
  function and() {
    let left = not();
    while (peek() && peek().v === 'and') { next(); left = { type: 'and', left, right: not() }; }
    return left;
  }
  function compare() {
    const left = readOperand(tokens, i, line);
    if (!left) return null;
    const opTok = tokens[i + left.len];
    if (!opTok) return null;
    if (FLIPPED[opTok.v]) throw err(`'${opTok.raw}' is not part of Cog`, line, opTok, `write '${FLIPPED[opTok.v]}' instead`);
    if (opTok.v === '=') throw err("'=' is not part of Cog", line, opTok, "compare with '=='");
    if (!COMPARE_OPS.includes(opTok.v)) return null;
    const start = tokens[i];
    i += left.len + 1;
    const right = readOperand(tokens, i, line);
    if (!right) {
      const bad = tokens[i];
      if (bad && SENSORS.includes(bad.v)) throw err(`sensor '${bad.raw}' can't be compared`, line, bad, 'sensors are just true or false');
      throw err(`'${opTok.raw}' needs a number or register on its right`, line,
        bad || { col: opTok.col + opTok.len + 1, len: 1 }, `for example '${start.raw} ${opTok.raw} 3'`);
    }
    i += right.len;
    for (const o of [left.node, right.node]) if (o.type === 'reg' && reads) reads.push({ name: o.name, line, col: o.col, len: o.len });
    return { type: 'cmp', op: opTok.v, left: left.node, right: right.node, col: start.col };
  }
  function not() {
    const cmp = compare();
    if (cmp) return cmp;
    const t = next();
    if (t === undefined) {
      const prev = tokens[tokens.length - 1] || after;
      const at = { col: prev.col + prev.len + 1, len: 1 };
      throw err(tokens.length ? `condition is incomplete after '${prev.raw}'` : `'${after.raw}' needs a condition`,
        line, at, tokens.length ? '' : `for example '${after.v} clear'`);
    }
    const v = t.v;
    if (v === 'not') return { type: 'not', arg: not() };
    if (v === '(') {
      const e = or();
      const close = next();
      if (!close || close.v !== ')') {
        const at = close || { col: t.col, len: 1 };
        throw err("missing ')'", line, at, close ? '' : `the '(' at col ${t.col} is never closed`);
      }
      return e;
    }
    if (v === 'true' || v === 'false') return { type: 'const', value: v === 'true' };
    if (SENSORS.includes(v)) {
      if (peek() && COMPARE_OPS.includes(peek().v)) throw err(`sensor '${t.raw}' can't be compared`, line, t, `sensors are just true or false: write 'if ${v}' or 'if not ${v}'`);
      return { type: 'sensor', name: v, col: t.col };
    }
    if (v in OPERATORS || COMPARE_OPS.includes(v) || FLIPPED[v]) throw operatorError(t, line);
    if (/^\d/.test(v) || v === '-') throw err(`a number can't be a condition`, line, t, `compare it with a register, e.g. 'n == ${/^\d/.test(v) ? v : 3}'`);
    throw err(`unknown sensor '${t.raw}'`, line, t, didYouMean(v, [...SENSORS, 'true', 'false'])
      || `sensors are: ${SENSORS.join(', ')}`);
  }
  const e = or();
  if (i < tokens.length) {
    const t = tokens[i];
    if (t.v === ':') throw err("Cog doesn't use ':'", line, t, "start the block body on the next line and close it with 'end'");
    if (t.v === ')') throw err("unexpected ')'", line, t, "there is no '(' for it to close");
    if (COMPARE_OPS.includes(t.v)) throw err(`can't compare here`, line, t, "compare a register or number, e.g. 'n < 3'");
    if (t.v in OPERATORS || FLIPPED[t.v]) throw operatorError(t, line);
    if (ACTIONS.includes(t.v)) throw err(`unexpected '${t.raw}' in condition`, line, t, 'put the commands of the block on their own lines');
    if (SENSORS.includes(t.v)) throw err(`unexpected '${t.raw}' in condition`, line, t, "join sensors with 'and' or 'or'");
    throw err(`unexpected '${t.raw}' in condition`, line, t);
  }
  return e;
}

function parseCount(tok, line, max, what, head) {
  if (tok === undefined) {
    throw err(`'${what}' needs a number`, line, { col: head.col + head.len + 1, len: 1 }, `for example '${what} 3'`);
  }
  if (what === 'repeat' && (tok.v === 'forever' || tok.v === 'always')) {
    throw err(`'repeat' needs a number`, line, tok, "to loop forever use 'while true'");
  }
  if (tok.v === '-') throw err(`${what} count can't be negative`, line, tok);
  if (!/^\d+$/.test(tok.v)) {
    throw err(`'${what}' needs a number, not '${tok.raw}'`, line, tok, what === 'repeat' ? "use 'while COND' to loop on a sensor" : '');
  }
  const n = Number(tok.v);
  if (n < 1 || n > max) throw err(`${what} count must be between 1 and ${max}`, line, tok);
  return n;
}

function blockOpener(kind) { return kind === 'else' ? 'if' : kind; }

/** Parse Cog source into { main: Stmt[], functions: { name: {name, body, line, col} } }. */
export function parse(source) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const root = { kind: 'root', body: [], line: 0 };
  const stack = [root]; // open blocks
  const functions = {};
  const top = () => stack[stack.length - 1];
  const body = () => {
    const b = top();
    if (b.kind === 'if') return b.branches[b.branches.length - 1].body;
    if (b.kind === 'else') return b.elseBody;
    return b.body;
  };
  const calls = [];
  const reads = [];  // register reads: { name, line, col, len }
  const writes = []; // memory statements, in source order

  lines.forEach((raw, idx) => {
    const line = idx + 1;
    const hash = raw.indexOf('#');
    const toks = tokenizeLine(hash >= 0 ? raw.slice(0, hash) : raw);
    if (!toks.length) return;
    const [head, ...rest] = toks;
    const h = head.v;
    const pos = { line, col: head.col };

    // Characters that signal another language's block syntax.
    const brace = toks.find((t) => t.v === '{' || t.v === '}');
    if (brace) throw err(`Cog doesn't use '${brace.v}'`, line, brace, "blocks are closed with 'end'");
    const colon = rest.find((t) => t.v === ':');
    if (colon && BLOCK_WORDS.includes(h)) {
      throw err("Cog doesn't use ':'", line, colon, "start the block body on the next line and close it with 'end'");
    }

    switch (h) {
      case 'repeat': {
        const args = rest.length && rest[rest.length - 1].v === 'times' ? rest.slice(0, -1) : rest;
        const count = parseCount(args[0], line, MAX_REPEAT, 'repeat', head);
        if (args.length > 1) {
          throw err(`unexpected '${args[1].raw}' after repeat count`, line, args[1],
            ACTIONS.includes(args[1].v) ? 'put the commands to repeat on the next lines' : '');
        }
        const node = { type: 'repeat', count, body: [], ...pos };
        body().push(node);
        stack.push({ kind: 'repeat', node, body: node.body, ...pos });
        return;
      }
      case 'while': {
        const node = { type: 'while', cond: parseCond(rest, line, head, reads), body: [], ...pos };
        body().push(node);
        stack.push({ kind: 'while', node, body: node.body, ...pos });
        return;
      }
      case 'if': {
        const node = { type: 'if', branches: [{ cond: parseCond(rest, line, head, reads), body: [], ...pos }], elseBody: null, ...pos };
        body().push(node);
        stack.push({ kind: 'if', node, branches: node.branches, ...pos });
        return;
      }
      case 'elif': {
        const b = top();
        if (b.kind === 'else') throw err("'elif' must come before 'else'", line, head);
        if (b.kind !== 'if') throw err("'elif' without a matching 'if'", line, head);
        b.branches.push({ cond: parseCond(rest, line, head, reads), body: [], ...pos });
        return;
      }
      case 'else': {
        const b = top();
        if (rest.length && rest[0].v === 'if') throw err("write 'elif' instead of 'else if'", line, { col: head.col, len: rest[0].col + rest[0].len - head.col });
        if (b.kind === 'else') throw err("this 'if' already has an 'else'", line, head, `it was opened on line ${b.line}`);
        if (b.kind !== 'if') throw err("'else' without a matching 'if'", line, head);
        if (rest.length) throw err("'else' takes no condition", line, rest[0], "use 'elif COND' for another test");
        b.node.elseBody = [];
        stack[stack.length - 1] = { kind: 'else', node: b.node, elseBody: b.node.elseBody, line: b.line, col: b.col };
        return;
      }
      case 'end': {
        if (stack.length === 1) throw err("'end' without an open block", line, head, 'remove it, or check the blocks above');
        if (rest.length) {
          throw err(`unexpected '${rest[0].raw}' after 'end'`, line, rest[0], "a plain 'end' closes any block");
        }
        stack.pop();
        return;
      }
      case 'def': {
        if (stack.length !== 1) {
          throw err("'def' is only allowed at the top level", line, head,
            `the '${blockOpener(top().kind)}' from line ${top().line} is still open`);
        }
        const nameTok = rest[0];
        if (!nameTok) throw err("'def' needs a function name", line, { col: head.col + head.len + 1, len: 1 }, "for example 'def hop'");
        const name = nameTok.v;
        if (!IDENT.test(name)) throw err(`'${nameTok.raw}' can't be a function name`, line, nameTok, 'use letters, digits and _, starting with a letter');
        if (RESERVED.includes(name)) throw err(`'${name}' is a reserved word`, line, nameTok, 'pick another function name');
        if (rest.length > 1) {
          const t = rest[1];
          throw err(`unexpected '${t.raw}' after function name`, line, t,
            t.v === '(' ? 'Cog functions take no parameters, so no brackets are needed' : '');
        }
        if (functions[name]) throw err(`function '${name}' is already defined`, line, nameTok, `first defined on line ${functions[name].line}`);
        const fn = { name, body: [], line, col: nameTok.col };
        functions[name] = fn;
        stack.push({ kind: 'def', body: fn.body, ...pos });
        return;
      }
      case 'set': case 'add': case 'sub': {
        const nameTok = rest[0];
        const eg = h === 'set' ? 0 : 1;
        if (!nameTok) throw err(`'${h}' needs a register name`, line, { col: head.col + head.len + 1, len: 1 }, `for example '${h} n ${eg}'`);
        const name = nameTok.v;
        if (RESERVED.includes(name)) throw err(`'${name}' is a reserved word`, line, nameTok, 'pick another register name');
        if (!IDENT.test(name)) throw err(`'${nameTok.raw}' can't be a register name`, line, nameTok, 'use letters, digits and _, starting with a letter');
        const vt = rest[1];
        if (vt && (vt.v === '=' || vt.v === 'to' || vt.v === ',')) {
          const shown = rest[2] ? rest.slice(2).map((t) => t.raw).join('') : eg;
          throw err(`'${h}' doesn't use '${vt.raw}'`, line, vt, `write '${h} ${name} ${shown}'`);
        }
        const val = readOperand(rest, 1, line);
        if (!val) {
          throw err(vt ? `'${vt.raw}' is not a value` : `'${h} ${name}' needs a value`, line,
            vt || { col: nameTok.col + nameTok.len + 1, len: 1 }, vt && SENSORS.includes(vt.v)
              ? "sensors can't be stored; use 'if' to act on them" : `a number or a register, for example '${h} ${name} ${eg}'`);
        }
        const extra = rest[1 + val.len];
        if (extra) {
          throw err(`unexpected '${extra.raw}' after the value`, line, extra,
            ['+', '-', '*', '/'].includes(extra.v) ? 'do one add or sub per line' : 'one command per line');
        }
        if (val.node.type === 'reg') reads.push({ name: val.node.name, line, col: val.node.col, len: val.node.len });
        const node = { type: 'memory', op: h, name, value: val.node, ...pos, nameCol: nameTok.col, len: nameTok.len };
        body().push(node);
        writes.push(node);
        return;
      }
      case 'send': case 'wait': {
        if (h === 'wait' && (!rest.length || /^\d/.test(rest[0].v) || rest[0].v === '(')) break; // idle action
        const nameTok = rest[0];
        if (!nameTok) throw err("'send' needs a signal name", line, { col: head.col + head.len + 1, len: 1 }, "for example 'send ready'");
        const name = nameTok.v;
        if (RESERVED.includes(name)) throw err(`'${name}' is a reserved word`, line, nameTok, 'pick another signal name');
        if (!IDENT.test(name)) throw err(`'${nameTok.raw}' can't be a signal name`, line, nameTok, 'use letters, digits and _, starting with a letter');
        if (rest[1]) throw err(`unexpected '${rest[1].raw}' after the signal name`, line, rest[1], 'one signal per line');
        body().push({ type: 'signal', op: h, name, ...pos, nameCol: nameTok.col, len: nameTok.len });
        return;
      }
      default:
        break;
    }

    if (ACTIONS.includes(h)) {
      if (rest.length && rest[0].v === '(') {
        throw err(`'${h}' doesn't need brackets`, line, rest[0], h === 'move' ? "write 'move' or 'move 3'" : `just write '${h}'`);
      }
      if (h === 'move' && rest.length) {
        const n = parseCount(rest[0], line, MAX_MOVE, 'move', head);
        if (rest.length > 1) throw err(`unexpected '${rest[1].raw}' after move count`, line, rest[1], 'one command per line');
        body().push({ type: 'action', name: 'move', count: n, ...pos });
      } else {
        if (rest.length) {
          throw err(`'${h}' takes no arguments`, line, rest[0],
            /^\d+$/.test(rest[0].v) ? `use 'repeat ${rest[0].v}' around it` : 'one command per line');
        }
        body().push({ type: 'action', name: h, count: 1, ...pos });
      }
      return;
    }
    if (KEYWORDS.includes(h)) throw err(`'${head.raw}' can't start a line`, line, head);
    if (SENSORS.includes(h)) throw err(`'${head.raw}' is a sensor, not a command`, line, head, `use it in a condition, e.g. 'if ${h}'`);
    if (FOREIGN[h]) throw err(`Cog has no '${head.raw}' command`, line, head, FOREIGN[h]);
    if (/^\d/.test(h)) throw err("a line can't start with a number", line, head, `write 'repeat ${h}' or 'move ${h}'`);
    if (IDENT.test(h)) {
      if (rest.length) {
        const t = rest[0];
        const typo = didYouMean(h, ACTIONS);
        if (typo) throw err(`unknown command '${head.raw}'`, line, head, typo);
        throw err(`unexpected '${t.raw}' after '${head.raw}'`, line, t,
          t.v === '(' ? 'call a function by its name alone, without brackets' : 'one command per line');
      }
      const node = { type: 'call', name: h, ...pos, len: head.len };
      body().push(node);
      calls.push(node);
      return;
    }
    throw err(`unexpected character '${head.raw}'`, line, head);
  });

  if (stack.length > 1) {
    const open = top();
    const what = blockOpener(open.kind);
    throw new CogError(`'${what}' block opened here is missing its 'end'`, open.line,
      { col: open.col, length: what.length, hint: "add 'end' after the last line of the block" });
  }

  // Registers: created by writes, in first-write order.
  const registers = [];
  for (const w of writes) {
    if (functions[w.name]) {
      throw new CogError(`'${w.name}' is already a function name`, w.line,
        { col: w.nameCol, length: w.len, hint: 'registers and functions need different names' });
    }
    if (!registers.includes(w.name)) {
      if (registers.length >= MAX_REGISTERS) {
        throw new CogError(`Pip only has ${MAX_REGISTERS} memory registers`, w.line,
          { col: w.nameCol, length: w.len, hint: `already used: ${registers.join(', ')}` });
      }
      registers.push(w.name);
    }
  }
  const firstProblem = [];
  for (const r of reads) {
    if (!registers.includes(r.name)) {
      const hint = didYouMean(r.name, registers) || `create it first with 'set ${r.name} 0'`;
      firstProblem.push(new CogError(`register '${r.name}' is never set`, r.line, { col: r.col, length: r.len, hint }));
    }
  }

  // Every call must refer to a known function.
  for (const c of calls) {
    if (!functions[c.name]) {
      const hint = registers.includes(c.name)
        ? `'${c.name}' is a register; change it with set, add or sub`
        : didYouMean(c.name, [...ACTIONS, ...Object.keys(functions), ...BLOCK_WORDS, ...MEMORY_OPS]);
      firstProblem.push(new CogError(`unknown command or function '${c.name}'`, c.line, { col: c.col, length: c.len, hint }));
    }
  }
  if (firstProblem.length) {
    firstProblem.sort((a, b) => a.line - b.line || a.col - b.col);
    throw firstProblem[0];
  }

  return { main: root.body, functions, registers };
}

/** Parse just a condition (e.g. from a block editor field). Errors report line 1, columns within `text`. */
export function parseCondition(text) {
  const head = { v: 'if', raw: 'if', col: 0, len: 0 };
  if (String(text).includes('#')) throw err("conditions can't contain '#'", 1, { col: String(text).indexOf('#') + 1, len: 1 });
  return parseCond(tokenizeLine(String(text)), 1, head);
}

/** Parse just a register value (number or register name), e.g. from a block field. */
export function parseValue(text) {
  const toks = tokenizeLine(String(text));
  const v = readOperand(toks, 0, 1);
  if (!v) throw err('expected a number or a register name', 1, toks[0] || { col: 1, len: 1 });
  if (toks[v.len]) throw err(`unexpected '${toks[v.len].raw}'`, 1, toks[v.len]);
  return v.node;
}
