// Block model for Cog: the structure the block editor edits, with a lossless
// round trip to Cog text. Pure, no DOM.
//
// A program is a list of blocks (the top-level list may also hold `def`s):
//   { kind: 'action', name: 'move', count: 3 }        move/left/right/grab/drop/wait
//   { kind: 'call', name: 'hop' }
//   { kind: 'repeat', count: 4, body: [...] }
//   { kind: 'while', cond, body: [...] }              cond = parser condition AST
//   { kind: 'if', branches: [{ cond, body }], elseBody: [...] | null }
//   { kind: 'def', name: 'hop', body: [...] }
//   { kind: 'set' | 'add' | 'sub', name: 'n', value }  value = { type: 'num', value } | { type: 'reg', name }
//   { kind: 'note', text: ' a comment line' }         full-line `#` comment
//   { kind: 'blank' }                                  empty line
// Any line-like part may carry `comment` (text after a trailing `#`):
// blocks (on their header line), branches (`elif` lines), `elseComment`, `endComment`.
//
// "Lossless" means: toText(toBlocks(src)) === format(src), where format only
// normalises layout (2-space indent, lowercase words, one space before a trailing
// comment, `repeat N times` -> `repeat N`, `move 1` -> `move`, redundant
// parentheses, trailing blank lines). Comments, blank lines, statement order
// and meaning are kept exactly; format(format(s)) === format(s).
import { parse, parseCondition, parseValue, ACTIONS, SENSORS, RESERVED, MAX_REPEAT, MAX_MOVE, MEMORY_OPS } from './parser.js';

export { parseCondition, parseValue };
const IDENT = /^[a-z_][a-z0-9_]*$/;
export const INDENT = '  ';

// ---------- text -> blocks ----------

/** Build the block list for Cog source. Throws the parser's CogError for invalid code. */
export function toBlocks(source) {
  const ast = parse(source);
  const byLine = new Map();
  const index = (stmts) => {
    for (const s of stmts) {
      byLine.set(s.line, s);
      if (s.body) index(s.body);
      if (s.branches) s.branches.forEach((b) => index(b.body));
      if (s.elseBody) index(s.elseBody);
    }
  };
  index(ast.main);
  for (const f of Object.values(ast.functions)) { byLine.set(f.line, { type: 'def', ...f }); index(f.body); }

  const root = [];
  const stack = [{ list: root }];
  const top = () => stack[stack.length - 1];
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((raw, i) => {
    const line = i + 1;
    const hash = raw.indexOf('#');
    const code = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    const comment = hash >= 0 ? raw.slice(hash + 1).trimEnd() : undefined;
    const list = top().list;
    if (!code) { list.push(comment === undefined ? { kind: 'blank' } : { kind: 'note', text: comment }); return; }
    const head = code.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0].toLowerCase();
    const node = byLine.get(line);
    const withComment = (b) => (comment === undefined ? b : { ...b, comment });
    switch (head) {
      case 'elif': {
        const t = top();
        t.branch += 1;
        const br = withComment({ cond: t.node.branches[t.branch].cond, body: [] });
        t.block.branches.push(br);
        t.list = br.body;
        return;
      }
      case 'else': {
        const t = top();
        t.block.elseBody = [];
        if (comment !== undefined) t.block.elseComment = comment;
        t.list = t.block.elseBody;
        return;
      }
      case 'end': {
        if (comment !== undefined) top().block.endComment = comment;
        stack.pop();
        return;
      }
      default: break;
    }
    let b;
    switch (node.type) {
      case 'action': b = { kind: 'action', name: node.name, count: node.count }; break;
      case 'call': b = { kind: 'call', name: node.name }; break;
      case 'repeat': b = { kind: 'repeat', count: node.count, body: [] }; break;
      case 'while': b = { kind: 'while', cond: node.cond, body: [] }; break;
      case 'if': b = { kind: 'if', branches: [{ cond: node.branches[0].cond, body: [] }], elseBody: null }; break;
      case 'def': b = { kind: 'def', name: node.name, body: [] }; break;
      case 'memory': b = { kind: node.op, name: node.name, value: node.value }; break;
      default: throw new Error(`blocks: unexpected node ${node.type} on line ${line}`);
    }
    b = withComment(b);
    list.push(b);
    if (b.kind === 'if') stack.push({ block: b, node, branch: 0, list: b.branches[0].body });
    else if (b.body) stack.push({ block: b, list: b.body });
  });
  while (root.length && root[root.length - 1].kind === 'blank') root.pop();
  return stripCols(root);
}

/** Condition/value ASTs from the parser carry `col`/`len`; blocks don't need positions. */
function stripCols(v) {
  if (Array.isArray(v)) return v.map(stripCols);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (k !== 'col' && k !== 'len') o[k] = stripCols(x);
    return o;
  }
  return v;
}

// ---------- blocks -> text ----------

const PREC = { or: 1, and: 2, not: 3, sensor: 4, const: 4, cmp: 4 };

/** Register value AST -> text: '3', '-1' or a register name. */
export const valueText = (v) => (v.type === 'num' ? String(v.value) : v.name);

/** Condition AST -> Cog text with only the parentheses the parser needs. */
export function condText(c, min = 0) {
  let s;
  switch (c.type) {
    case 'or': s = `${condText(c.left, 1)} or ${condText(c.right, 2)}`; break;
    case 'and': s = `${condText(c.left, 2)} and ${condText(c.right, 3)}`; break;
    case 'not': s = `not ${condText(c.arg, 3)}`; break;
    case 'sensor': s = c.name; break;
    case 'const': s = c.value ? 'true' : 'false'; break;
    case 'cmp': s = `${valueText(c.left)} ${c.op} ${valueText(c.right)}`; break;
    default: throw new Error(`blocks: unknown condition ${c.type}`);
  }
  return PREC[c.type] < min ? `(${s})` : s;
}

/** One block's header line, without indent or comment. */
export function headerText(b) {
  switch (b.kind) {
    case 'action': return b.name === 'move' && b.count > 1 ? `move ${b.count}` : b.name;
    case 'call': return b.name;
    case 'repeat': return `repeat ${b.count}`;
    case 'while': return `while ${condText(b.cond)}`;
    case 'if': return `if ${condText(b.branches[0].cond)}`;
    case 'def': return `def ${b.name}`;
    case 'set': case 'add': case 'sub': return `${b.kind} ${b.name} ${valueText(b.value)}`;
    default: return '';
  }
}

/**
 * Blocks -> canonical Cog text. Also returns `lines`: for every block, keyed by
 * its path joined with '.', the 1-based line of its header (used to highlight
 * the running block).
 */
export function render(blocks) {
  const out = [];
  const lines = new Map();
  const tail = (c) => (c === undefined ? '' : ` #${c}`);
  const emit = (list, depth, path) => {
    const ind = INDENT.repeat(depth);
    list.forEach((b, i) => {
      const p = [...path, i];
      if (b.kind === 'blank') { out.push(''); return; }
      if (b.kind === 'note') { out.push(`${ind}#${b.text}`); return; }
      lines.set(p.join('.'), out.length + 1);
      out.push(ind + headerText(b) + tail(b.comment));
      if (b.kind === 'if') {
        b.branches.forEach((br, k) => {
          if (k > 0) out.push(`${ind}elif ${condText(br.cond)}${tail(br.comment)}`);
          emit(br.body, depth + 1, [...p, 'branches', k, 'body']);
        });
        if (b.elseBody) {
          out.push(`${ind}else${tail(b.elseComment)}`);
          emit(b.elseBody, depth + 1, [...p, 'elseBody']);
        }
      } else if (b.body) emit(b.body, depth + 1, [...p, 'body']);
      if (b.body || b.branches) out.push(`${ind}end${tail(b.endComment)}`);
    });
  };
  emit(blocks, 0, []);
  while (out.length && out[out.length - 1] === '') out.pop();
  return { text: out.join('\n'), lines };
}

export const toText = (blocks) => render(blocks).text;

/** Canonical layout of valid Cog source (throws CogError if invalid). */
export const format = (source) => toText(toBlocks(source));

// ---------- editing (all return a new block list; inputs are never mutated) ----------
// A path addresses a block: [3] is the 4th top-level block, [3, 'body', 0] the
// first block inside it, [2, 'branches', 1, 'body', 0] / [2, 'elseBody', 0] for ifs.
// A list path is the path of a list (without the final index): [] is the top level.

const clone = (v) => structuredClone(v);

export function getAt(blocks, path) {
  let v = blocks;
  for (const k of path) { v = v?.[k]; }
  return v;
}

const isPrefix = (a, b) => a.length <= b.length && a.every((k, i) => b[i] === k);

/** Why `block` can't go into the list at `listPath` ('' when it can). */
export function placementProblem(blocks, listPath, block) {
  const list = getAt(blocks, listPath);
  if (!Array.isArray(list)) return 'no such list';
  if (block.kind === 'def' && listPath.length) return "a 'def' can only sit at the top level";
  return '';
}

/** Insert `block` into the list at `listPath` before `index` (default: at the end). */
export function insertBlock(blocks, listPath, index, block) {
  const problem = placementProblem(blocks, listPath, block);
  if (problem) throw new Error(problem);
  const next = clone(blocks);
  const list = getAt(next, listPath);
  list.splice(index ?? list.length, 0, clone(block));
  return next;
}

export function removeBlock(blocks, path) {
  const next = clone(blocks);
  getAt(next, path.slice(0, -1)).splice(path[path.length - 1], 1);
  return next;
}

/** Shallow-merge `patch` into the block at `path`. */
export function updateBlock(blocks, path, patch) {
  const next = clone(blocks);
  Object.assign(getAt(next, path), clone(patch));
  return next;
}

/**
 * Move the block at `from` so it lands before `toIndex` in the list at `toList`
 * (indices as they are *before* the move). Returns null for impossible moves
 * (into itself or one of its own children, def below the top level).
 */
export function moveBlock(blocks, from, toList, toIndex) {
  const block = getAt(blocks, from);
  if (!block || isPrefix(from, toList)) return null;
  if (placementProblem(blocks, toList, block)) return null;
  const fromList = from.slice(0, -1);
  const fromIndex = from[from.length - 1];
  const target = [...toList];
  let at = toIndex;
  // removing the block shifts later siblings (and anything inside them) up by one
  if (isPrefix(fromList, target) && target.length > fromList.length && target[fromList.length] > fromIndex) {
    target[fromList.length] -= 1;
  }
  if (fromList.length === target.length && isPrefix(fromList, target) && at > fromIndex) at -= 1;
  return insertBlock(removeBlock(blocks, from), target, at, block);
}

/** Add an `elif` (before any else) or the `else` branch to the if at `path`. */
export function addBranch(blocks, path, which, cond = { type: 'sensor', name: 'clear' }) {
  const next = clone(blocks);
  const b = getAt(next, path);
  if (which === 'else') { if (!b.elseBody) b.elseBody = []; } else b.branches.push({ cond, body: [] });
  return next;
}

/** Remove branch k (k >= 1) or the else ('else') of the if at `path`, with its blocks. */
export function removeBranch(blocks, path, which) {
  const next = clone(blocks);
  const b = getAt(next, path);
  if (which === 'else') { b.elseBody = null; delete b.elseComment; } else if (which > 0) b.branches.splice(which, 1);
  return next;
}

/** Names of every def, in order. */
export const functionNames = (blocks) => blocks.filter((b) => b.kind === 'def').map((b) => b.name);

/** Why `name` can't be a (new) function name ('' if fine). */
export function nameProblem(blocks, name, except = null) {
  if (!IDENT.test(name)) return 'use lowercase letters, digits and _, starting with a letter';
  if (RESERVED.includes(name)) return `'${name}' is a reserved word`;
  if (name !== except && functionNames(blocks).includes(name)) return `'${name}' already exists`;
  return '';
}

/** Rename a def and every call to it. */
export function renameFunction(blocks, from, to) {
  const walk = (list) => list.map((b) => {
    const c = { ...b };
    if ((c.kind === 'def' || c.kind === 'call') && c.name === from) c.name = to;
    if (c.body) c.body = walk(c.body);
    if (c.branches) c.branches = c.branches.map((br) => ({ ...br, body: walk(br.body) }));
    if (c.elseBody) c.elseBody = walk(c.elseBody);
    return c;
  });
  return walk(clone(blocks));
}

/** Register names written anywhere in the program, in first-use order. */
export function registerNames(blocks) {
  const out = [];
  const walk = (list) => {
    for (const b of list) {
      if (MEMORY_OPS.includes(b.kind) && !out.includes(b.name)) out.push(b.name);
      if (b.body) walk(b.body);
      if (b.branches) b.branches.forEach((br) => walk(br.body));
      if (b.elseBody) walk(b.elseBody);
    }
  };
  walk(blocks);
  return out;
}

/** Why `name` can't be a register name ('' if fine). */
export function registerProblem(blocks, name) {
  if (!IDENT.test(name)) return 'use lowercase letters, digits and _, starting with a letter';
  if (RESERVED.includes(name)) return `'${name}' is a reserved word`;
  if (functionNames(blocks).includes(name)) return `'${name}' is a function name`;
  return '';
}

/** A fresh name for a new function: fn, fn2, fn3, … */
export function freshName(blocks, base = 'job') {
  const used = new Set(functionNames(blocks));
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) if (!used.has(`${base}${n}`)) return `${base}${n}`;
}

/** Clamp a typed count for repeat / move. */
export const clampCount = (kind, n) => Math.min(kind === 'repeat' ? MAX_REPEAT : MAX_MOVE, Math.max(1, Math.round(Number(n)) || 1));

/**
 * Palette entries allowed by a level's tools (normalised or partial:
 * a missing list allows everything). Each: { id, label, group, make(blocks) }.
 */
export function palette(tools = {}, blocks = []) {
  const allow = (k, w) => !tools[k] || tools[k].includes(w);
  const sensors = SENSORS.filter((s) => allow('sensors', s));
  const cond = () => (sensors.length ? { type: 'sensor', name: sensors.includes('clear') ? 'clear' : sensors[0] } : { type: 'const', value: true });
  const out = [];
  for (const a of ACTIONS) {
    if (allow('actions', a)) out.push({ id: a, label: a, group: 'action', make: () => ({ kind: 'action', name: a, count: 1 }) });
  }
  if (allow('blocks', 'repeat')) out.push({ id: 'repeat', label: 'repeat N', group: 'loop', make: () => ({ kind: 'repeat', count: 2, body: [] }) });
  if (allow('blocks', 'while')) out.push({ id: 'while', label: 'while …', group: 'loop', make: () => ({ kind: 'while', cond: cond(), body: [] }) });
  if (allow('blocks', 'if')) out.push({ id: 'if', label: 'if …', group: 'branch', make: () => ({ kind: 'if', branches: [{ cond: cond(), body: [] }], elseBody: null }) });
  if (allow('blocks', 'memory')) {
    const reg = () => registerNames(blocks)[0] || 'n';
    out.push({ id: 'set', label: 'set n V', group: 'memory', make: () => ({ kind: 'set', name: reg(), value: { type: 'num', value: 0 } }) });
    out.push({ id: 'add', label: 'add n V', group: 'memory', make: () => ({ kind: 'add', name: reg(), value: { type: 'num', value: 1 } }) });
    out.push({ id: 'sub', label: 'sub n V', group: 'memory', make: () => ({ kind: 'sub', name: reg(), value: { type: 'num', value: 1 } }) });
  }
  if (allow('blocks', 'def')) {
    out.push({ id: 'def', label: 'def name', group: 'function', make: (bs) => ({ kind: 'def', name: freshName(bs), body: [] }) });
    for (const name of functionNames(blocks)) {
      out.push({ id: `call:${name}`, label: name, group: 'function', make: () => ({ kind: 'call', name }) });
    }
  }
  return out;
}
