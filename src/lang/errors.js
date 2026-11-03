// Friendly errors for Cog: positions, "did you mean" suggestions and a
// caret-style snippet. Pure module, shared by parser, VM and UI.

export class CogError extends Error {
  /**
   * @param {string} message  short description (no position)
   * @param {number} line     1-based source line (0 = unknown)
   * @param {object} [opt]    { col, length, hint, kind }
   *   col    1-based column of the offending text (0 = whole line)
   *   length how many characters to underline
   *   hint   optional extra advice ("did you mean 'move'?")
   *   kind   'syntax' (found before running) or 'runtime'
   */
  constructor(message, line, opt = {}) {
    const { col = 0, length = 1, hint = '', kind = 'syntax' } = opt;
    const where = line ? (col ? `Line ${line}, col ${col}: ` : `Line ${line}: `) : '';
    super(`${where}${message}${hint ? ` — ${hint}` : ''}`);
    this.name = 'CogError';
    this.line = line;
    this.col = col;
    this.length = length;
    this.detail = message;
    this.hint = hint;
    this.kind = kind;
  }
}

/**
 * Edit distance where a swap of two neighbouring letters counts as one edit
 * (optimal string alignment), so 'mvoe' is 1 away from 'move'.
 */
export function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * Closest candidate to `word`, or null if nothing is plausibly a typo.
 * Allows 1 edit for short words, 2 for words of 5+ letters; ties go to the
 * earlier candidate so results are deterministic.
 */
export function suggest(word, candidates) {
  const limit = word.length >= 5 ? 2 : 1;
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    if (c === word) continue;
    const d = editDistance(word, c);
    if (d < bestD) { best = c; bestD = d; }
  }
  return bestD <= limit ? best : null;
}

/** "did you mean 'x'?" or '' */
export function didYouMean(word, candidates) {
  const s = suggest(word, candidates);
  return s ? `did you mean '${s}'?` : '';
}

/**
 * Multi-line description with the source line and a caret under the problem:
 *
 *   Line 2, col 3: unknown sensor 'clera' — did you mean 'clear'?
 *      2 | while clera
 *        |       ^^^^^
 */
export function formatError(source, err) {
  if (!err || !err.line) return err ? err.message : '';
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const text = (lines[err.line - 1] ?? '').replace(/\t/g, ' ');
  const num = String(err.line);
  const pad = ' '.repeat(num.length);
  let out = `${err.message}\n ${num} | ${text}`;
  if (err.col) {
    out += `\n ${pad} | ${' '.repeat(err.col - 1)}${'^'.repeat(Math.max(1, err.length))}`;
  }
  return out;
}
