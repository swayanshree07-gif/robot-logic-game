// Pure helpers for the code editor (no DOM): line numbers, line/col <-> offset,
// indentation keys. Tested in test/editor.test.js; used by src/ui/editor.js.

export const INDENT = '  ';

export function lineCount(text) {
  return text.split('\n').length;
}

/** Character offset of the start of 1-based `line` (clamped to the text). */
export function lineStart(text, line) {
  const lines = text.split('\n');
  const n = Math.max(1, Math.min(line, lines.length));
  let off = 0;
  for (let i = 0; i < n - 1; i++) off += lines[i].length + 1;
  return off;
}

/** 1-based line containing character offset `off`. */
export function lineAt(text, off) {
  let line = 1;
  for (let i = 0; i < Math.min(off, text.length); i++) if (text[i] === '\n') line++;
  return line;
}

/**
 * Selection range for an error: [from, to). col 0 selects the whole line.
 * @param {string} text  @param {{line:number, col?:number, length?:number}} err
 */
export function errorRange(text, err) {
  if (!err || !err.line) return null;
  const lines = text.split('\n');
  if (err.line > lines.length) return [text.length, text.length];
  const start = lineStart(text, err.line);
  const len = lines[err.line - 1].length;
  if (!err.col) return [start, start + len];
  const from = start + Math.min(err.col - 1, len);
  return [from, Math.min(start + len, from + Math.max(1, err.length || 1))];
}

/**
 * Gutter rows: one per line, with a CSS-ish mark.
 * @param {number} count  @param {{active?:number, error?:number}} marks
 * @returns {{n:number, mark:''|'active'|'error'}[]}
 */
export function gutterRows(count, { active = 0, error = 0 } = {}) {
  const rows = [];
  for (let n = 1; n <= count; n++) rows.push({ n, mark: n === error ? 'error' : n === active ? 'active' : '' });
  return rows;
}

/**
 * Apply an editing key to (text, selStart, selEnd). Returns the new
 * { text, start, end } or null if the key isn't handled.
 *   Tab        indent selected lines (or insert INDENT at the caret)
 *   Shift+Tab  unindent selected lines
 *   Enter      newline keeping the current indent, one more after a block opener
 */
export function editKey(key, text, start, end, { shift = false } = {}) {
  if (key === 'Tab') {
    const multi = text.slice(start, end).includes('\n');
    if (!shift && !multi) {
      return { text: text.slice(0, start) + INDENT + text.slice(end), start: start + INDENT.length, end: start + INDENT.length };
    }
    const a = lineStart(text, lineAt(text, start));
    const lines = text.slice(a, end).split('\n');
    let delta0 = 0, total = 0;
    const out = lines.map((l, i) => {
      if (!shift) { if (i === 0) delta0 = INDENT.length; total += INDENT.length; return INDENT + l; }
      const cut = l.startsWith(INDENT) ? INDENT.length : l.startsWith(' ') ? 1 : 0;
      if (i === 0) delta0 = -cut;
      total -= cut;
      return l.slice(cut);
    });
    const next = text.slice(0, a) + out.join('\n') + text.slice(end);
    return { text: next, start: Math.max(a, start + delta0), end: end + total };
  }
  if (key === 'Enter') {
    const ls = lineStart(text, lineAt(text, start));
    const cur = text.slice(ls, start);
    let indent = cur.match(/^\s*/)[0];
    if (/^\s*(repeat|while|if|elif|else|def)\b/.test(cur)) indent += INDENT;
    const ins = `\n${indent}`;
    const pos = start + ins.length;
    return { text: text.slice(0, start) + ins + text.slice(end), start: pos, end: pos };
  }
  return null;
}
