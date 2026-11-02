// Cog language parser: source text -> AST.
//
// Cog is line based. One statement per line, blocks are closed with `end`.
// `#` starts a comment.
//
//   move [N]            left   right   grab   drop   wait
//   repeat N ... end
//   while COND ... end
//   if COND ... [elif COND ...] [else ...] end
//   def NAME ... end    (top level only)
//   NAME                call a function
//
// COND := OR ;  OR := AND ('or' AND)* ; AND := NOT ('and' NOT)* ;
// NOT := 'not' NOT | '(' OR ')' | 'true' | 'false' | SENSOR

export const ACTIONS = ['move', 'left', 'right', 'grab', 'drop', 'wait'];
export const SENSORS = ['clear', 'wall', 'clear_left', 'clear_right', 'goal', 'item', 'holding'];
const KEYWORDS = ['repeat', 'while', 'if', 'elif', 'else', 'end', 'def', 'and', 'or', 'not', 'true', 'false', 'times'];
export const MAX_REPEAT = 999;
export const MAX_MOVE = 99;

export class CogError extends Error {
  constructor(message, line) {
    super(line ? `Line ${line}: ${message}` : message);
    this.name = 'CogError';
    this.line = line;
    this.detail = message;
  }
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

function tokenizeLine(text) {
  const out = [];
  const re = /\s*([A-Za-z_][A-Za-z0-9_]*|\d+|[()]|\S)/y;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

function parseCond(tokens, line) {
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  function or() {
    let left = and();
    while (peek() === 'or') { next(); left = { type: 'or', left, right: and() }; }
    return left;
  }
  function and() {
    let left = not();
    while (peek() === 'and') { next(); left = { type: 'and', left, right: not() }; }
    return left;
  }
  function not() {
    const t = next();
    if (t === undefined) throw new CogError('condition is incomplete', line);
    if (t === 'not') return { type: 'not', arg: not() };
    if (t === '(') {
      const e = or();
      if (next() !== ')') throw new CogError("missing ')'", line);
      return e;
    }
    if (t === 'true' || t === 'false') return { type: 'const', value: t === 'true' };
    if (SENSORS.includes(t)) return { type: 'sensor', name: t };
    throw new CogError(`unknown sensor '${t}' (sensors: ${SENSORS.join(', ')})`, line);
  }
  const e = or();
  if (i < tokens.length) throw new CogError(`unexpected '${tokens[i]}' in condition`, line);
  return e;
}

function parseCount(tok, line, max, what) {
  if (tok === undefined || !/^\d+$/.test(tok)) throw new CogError(`${what} needs a number`, line);
  const n = Number(tok);
  if (n < 1 || n > max) throw new CogError(`${what} count must be between 1 and ${max}`, line);
  return n;
}

/** Parse Cog source into { main: Stmt[], functions: { name: {body, line} } }. */
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

  lines.forEach((raw, idx) => {
    const line = idx + 1;
    const text = raw.replace(/#.*/, '').trim();
    if (!text) return;
    const toks = tokenizeLine(text.toLowerCase());
    const [head, ...rest] = toks;

    switch (head) {
      case 'repeat': {
        const args = rest[rest.length - 1] === 'times' ? rest.slice(0, -1) : rest;
        if (args.length > 1) throw new CogError(`unexpected '${args[1]}' after repeat count`, line);
        const node = { type: 'repeat', count: parseCount(args[0], line, MAX_REPEAT, 'repeat'), body: [], line };
        body().push(node);
        stack.push({ kind: 'repeat', node, body: node.body, line });
        return;
      }
      case 'while': {
        const node = { type: 'while', cond: parseCond(rest, line), body: [], line };
        body().push(node);
        stack.push({ kind: 'while', node, body: node.body, line });
        return;
      }
      case 'if': {
        const node = { type: 'if', branches: [{ cond: parseCond(rest, line), body: [], line }], elseBody: null, line };
        body().push(node);
        stack.push({ kind: 'if', node, branches: node.branches, line });
        return;
      }
      case 'elif': {
        const b = top();
        if (b.kind !== 'if') throw new CogError("'elif' without a matching 'if'", line);
        b.branches.push({ cond: parseCond(rest, line), body: [], line });
        return;
      }
      case 'else': {
        const b = top();
        if (b.kind !== 'if') throw new CogError("'else' without a matching 'if'", line);
        if (rest.length) throw new CogError("'else' takes no condition (use 'elif')", line);
        b.node.elseBody = [];
        stack[stack.length - 1] = { kind: 'else', node: b.node, elseBody: b.node.elseBody, line: b.line };
        return;
      }
      case 'end': {
        if (rest.length) throw new CogError(`unexpected '${rest[0]}' after 'end'`, line);
        if (stack.length === 1) throw new CogError("'end' without an open block", line);
        stack.pop();
        return;
      }
      case 'def': {
        if (stack.length !== 1) throw new CogError("'def' is only allowed at the top level", line);
        const name = rest[0];
        if (!name || !IDENT.test(name)) throw new CogError('def needs a function name', line);
        if (rest.length > 1) throw new CogError(`unexpected '${rest[1]}' after function name`, line);
        if (KEYWORDS.includes(name) || ACTIONS.includes(name) || SENSORS.includes(name)) {
          throw new CogError(`'${name}' is a reserved word`, line);
        }
        if (functions[name]) throw new CogError(`function '${name}' is already defined`, line);
        const fn = { name, body: [], line };
        functions[name] = fn;
        stack.push({ kind: 'def', body: fn.body, line });
        return;
      }
      default:
        break;
    }

    if (ACTIONS.includes(head)) {
      if (head === 'move' && rest.length) {
        if (rest.length > 1) throw new CogError(`unexpected '${rest[1]}' after move count`, line);
        body().push({ type: 'action', name: 'move', count: parseCount(rest[0], line, MAX_MOVE, 'move'), line });
      } else {
        if (rest.length) throw new CogError(`'${head}' takes no arguments`, line);
        body().push({ type: 'action', name: head, count: 1, line });
      }
      return;
    }
    if (KEYWORDS.includes(head)) throw new CogError(`'${head}' cannot start a line`, line);
    if (IDENT.test(head)) {
      if (rest.length) throw new CogError(`unexpected '${rest[0]}' after '${head}'`, line);
      body().push({ type: 'call', name: head, line });
      return;
    }
    throw new CogError(`I don't understand '${head}'`, line);
  });

  if (stack.length > 1) {
    const open = top();
    const what = open.kind === 'else' ? 'if' : open.kind;
    throw new CogError(`'${what}' block opened here is missing its 'end'`, open.line);
  }

  // Check that every call refers to a known function.
  const checkCalls = (stmts) => {
    for (const s of stmts) {
      if (s.type === 'call' && !functions[s.name]) {
        throw new CogError(`unknown command or function '${s.name}'`, s.line);
      }
      if (s.body) checkCalls(s.body);
      if (s.branches) s.branches.forEach((b) => checkCalls(b.body));
      if (s.elseBody) checkCalls(s.elseBody);
    }
  };
  checkCalls(root.body);
  Object.values(functions).forEach((f) => checkCalls(f.body));

  return { main: root.body, functions };
}
