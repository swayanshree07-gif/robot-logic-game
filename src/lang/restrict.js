// Per-level allow-lists ("tools"). Early levels unlock commands one at a time,
// so a program that uses something not yet unlocked gets a positioned error.
//
// tools = { actions?: string[], sensors?: string[], blocks?: string[] }
// A missing list means "everything of that kind is allowed".
// blocks: 'repeat', 'while', 'if' (covers elif/else), 'def' (covers calls).
import { CogError } from './errors.js';

const lockedErr = (what, word, node, hint) => {
  const e = new CogError(`${what} '${word}' isn't unlocked on this level`, node.line,
    { col: node.col || 0, length: node.len || word.length, hint });
  e.code = 'locked';
  return e;
};

/** Throw a CogError for the first (in source order) statement or sensor not allowed by `tools`. */
export function checkTools(ast, tools) {
  if (!tools) return;
  const found = [];
  const allowed = (k, w) => !tools[k] || tools[k].includes(w);
  const listHint = (k) => (tools[k].length ? `available here: ${tools[k].join(', ')}` : '');

  const cond = (c, line) => {
    if (c.type === 'not') return cond(c.arg, line);
    if (c.type === 'and' || c.type === 'or') { cond(c.left, line); cond(c.right, line); return; }
    if (c.type === 'sensor' && !allowed('sensors', c.name)) {
      found.push(lockedErr('sensor', c.name, { line, col: c.col }, listHint('sensors')));
    }
  };
  const block = (stmts) => {
    for (const s of stmts) {
      switch (s.type) {
        case 'action':
          if (!allowed('actions', s.name)) found.push(lockedErr('command', s.name, s, listHint('actions')));
          break;
        case 'repeat':
          if (!allowed('blocks', 'repeat')) found.push(lockedErr('block', 'repeat', s, listHint('blocks')));
          block(s.body);
          break;
        case 'while':
          if (!allowed('blocks', 'while')) found.push(lockedErr('block', 'while', s, listHint('blocks')));
          cond(s.cond, s.line);
          block(s.body);
          break;
        case 'if':
          if (!allowed('blocks', 'if')) found.push(lockedErr('block', 'if', s, listHint('blocks')));
          for (const br of s.branches) { cond(br.cond, br.line); block(br.body); }
          if (s.elseBody) block(s.elseBody);
          break;
        case 'call':
          if (!allowed('blocks', 'def')) found.push(lockedErr('block', 'def', s, 'functions are not unlocked on this level'));
          break;
        default:
          break;
      }
    }
  };
  for (const fn of Object.values(ast.functions)) {
    if (!allowed('blocks', 'def')) found.push(lockedErr('block', 'def', { line: fn.line, col: fn.col, len: fn.name.length }, 'functions are not unlocked on this level'));
    block(fn.body);
  }
  block(ast.main);
  if (found.length) {
    found.sort((a, b) => a.line - b.line || a.col - b.col);
    throw found[0];
  }
}
