// Text ⇄ Blocks editor mode logic (pure, no DOM), shared by main.js and tests.
// Cog text stays the single source of truth: the block editor only ever
// produces text through `toText`, so the session, breakpoints and line numbers
// work the same in both modes.
import { toBlocks, toText, palette } from '../lang/blocks.js';

export const MODES = ['text', 'blocks'];

/**
 * Try to show `text` as blocks. Returns { ok: true, blocks, text } where `text`
 * is the tidied (canonical) source the blocks print as, or { ok: false, error }
 * with the parser's CogError when the text doesn't parse.
 * Tidying only changes layout (indent, spacing, trailing blank lines), never
 * line numbers, so breakpoints stay on the same statements.
 */
export function enterBlocks(text) {
  try {
    const blocks = toBlocks(text);
    return { ok: true, blocks, text: toText(blocks) };
  } catch (error) {
    if (error && error.kind) return { ok: false, error };
    throw error;
  }
}

/** Message shown when the program can't be switched to blocks. */
export const blockedMessage = (formatted) =>
  `Can't show this program as blocks until it parses:\n${formatted}`;

/**
 * Which block line to highlight for a session view: { line, kind } with kind
 * 'active' | 'break' | 'error' (line 0 = none). Mirrors what the text editor shows.
 */
export function blockMark(view) {
  if (view.state === 'edit') return { line: 0, kind: 'active' };
  const err = view.result && view.result.error;
  if (err && err.line && view.result.result !== 'timeout' && view.result.result !== 'loop') return { line: err.line, kind: 'error' };
  if (view.state === 'done') return { line: view.line || 0, kind: 'active' };
  return { line: view.atBreak || view.line || 0, kind: view.atBreak ? 'break' : 'active' };
}

/** Palette id needed to build block `b` ('' for notes/blank lines, which need none). */
function paletteId(b) {
  switch (b.kind) {
    case 'action': return b.name;
    case 'call': return `call:${b.name}`;
    case 'repeat': case 'while': case 'if': case 'def': case 'set': case 'add': case 'sub': case 'send': case 'await': return b.kind;
    default: return '';
  }
}

/**
 * Palette ids a program needs that the level's palette doesn't offer
 * (empty when it could be built entirely by clicking tiles).
 */
export function missingTiles(blocks, tools) {
  const have = new Set(palette(tools, blocks).map((p) => p.id));
  const missing = new Set();
  const walk = (list) => {
    for (const b of list) {
      const id = paletteId(b);
      if (id && !have.has(id)) missing.add(id);
      if (b.body) walk(b.body);
      if (b.branches) b.branches.forEach((br) => walk(br.body));
      if (b.elseBody) walk(b.elseBody);
    }
  };
  walk(blocks);
  return [...missing];
}
