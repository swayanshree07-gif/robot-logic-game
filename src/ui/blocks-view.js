// Block editor component (browser only). Edits a block list from
// src/lang/blocks.js; every change goes back as Cog text through onChange, so
// text stays the single source of truth for the session.
//
// Click a palette tile to add it after the selected block (or at the end);
// drag tiles or blocks (by their header) onto the gaps between blocks.
// Selected block: Delete removes it, Alt+↑/↓ moves it within its list,
// F9 toggles a breakpoint on its line (shown as a red dot on the block).
import {
  render as renderText, palette, insertBlock, removeBlock, updateBlock, moveBlock, addBranch, removeBranch,
  renameFunction, nameProblem, clampCount, condText, parseCondition, getAt, placementProblem,
} from '../lang/blocks.js';

const MIME_PATH = 'application/x-cog-path';
const MIME_NEW = 'application/x-cog-new';
const el = (tag, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const key = (path) => path.join('.');

export class BlockEditor {
  /** @param {HTMLElement} root  element with .blk-palette and .blk-program children */
  constructor(root, { onChange = () => {}, onProblem = () => {}, onToggleBreakpoint = null } = {}) {
    this.root = root;
    this.paletteEl = root.querySelector('.blk-palette');
    this.programEl = root.querySelector('.blk-program');
    this.onChange = onChange;
    this.onProblem = onProblem;
    this.onToggleBreakpoint = onToggleBreakpoint;
    this.breakpoints = new Set();
    this.blocks = [];
    this.tools = {};
    this.selected = null; // path
    this.headers = new Map(); // path key -> header element
    this.lineOf = new Map(); // path key -> line
    this.mark = { line: 0, kind: '' };
    this.dragging = null;
    root.addEventListener('keydown', (e) => this.key(e));
    root.addEventListener('dragend', () => this.endDrag());
  }

  /** Show a program (block list) with the palette for these level tools. */
  set(blocks, tools = this.tools) {
    this.blocks = blocks;
    this.tools = tools;
    if (this.selected && !getAt(blocks, this.selected)) this.selected = null;
    this.draw();
  }

  /** Highlight the block on `line` (0 = none); kind: 'active' | 'break' | 'error'. */
  setMark(line, kind = 'active') {
    if (line === this.mark.line && kind === this.mark.kind) return;
    this.mark = { line, kind };
    for (const [k, h] of this.headers) {
      h.classList.toggle('mark-active', line > 0 && this.lineOf.get(k) === line && kind === 'active');
      h.classList.toggle('mark-break', line > 0 && this.lineOf.get(k) === line && kind === 'break');
      h.classList.toggle('mark-error', line > 0 && this.lineOf.get(k) === line && kind === 'error');
      if (line > 0 && this.lineOf.get(k) === line) h.scrollIntoView({ block: 'nearest' });
    }
  }

  /** Show breakpoint dots on the blocks whose header line is in `set`. */
  setBreakpoints(set) {
    this.breakpoints = new Set(set);
    for (const [k, h] of this.headers) h.classList.toggle('bp', this.breakpoints.has(this.lineOf.get(k)));
  }

  /** Select (and scroll to) the block whose header is on `line`; false if none. */
  selectLine(line) {
    for (const [k, l] of this.lineOf) {
      if (l !== line) continue;
      const path = k.split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : x));
      this.select(path);
      this.headers.get(k)?.scrollIntoView({ block: 'nearest' });
      return true;
    }
    return false;
  }

  /** Line of the selected block's header (0 = none). */
  selectedLine() { return this.selected ? this.lineOf.get(key(this.selected)) || 0 : 0; }

  commit(next) {
    if (!next) return;
    this.blocks = next;
    this.draw();
    this.onChange(next);
  }

  // ---------- drawing ----------

  draw() {
    const { lines } = renderText(this.blocks);
    this.lineOf = lines;
    this.headers = new Map();
    this.drawPalette();
    const list = this.list(this.blocks, []);
    list.classList.add('top');
    if (!this.blocks.length) list.prepend(el('p', 'blk-empty', 'Drag commands here, or click them in the tray above.'));
    this.programEl.replaceChildren(list);
    const m = this.mark;
    this.mark = { line: -1, kind: '' };
    this.setMark(m.line, m.kind);
  }

  drawPalette() {
    const items = palette(this.tools, this.blocks).map((p) => {
      const b = el('button', `tile ${p.group}`, p.label);
      b.type = 'button';
      b.draggable = true;
      b.title = p.group === 'function' && p.id.startsWith('call:') ? `Call ${p.label}` : `Add ${p.label} (click or drag)`;
      b.onclick = () => this.addFromPalette(p);
      b.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData(MIME_NEW, p.id);
        e.dataTransfer.effectAllowed = 'copy';
        this.startDrag({ kind: p.id === 'def' ? 'def' : 'other' });
      });
      return b;
    });
    this.paletteEl.replaceChildren(...items);
  }

  /** A list of blocks with drop slots between them. */
  list(blocks, listPath) {
    const box = el('div', 'blk-list');
    blocks.forEach((b, i) => {
      box.append(this.slot(listPath, i), this.block(b, [...listPath, i]));
    });
    box.append(this.slot(listPath, blocks.length));
    return box;
  }

  slot(listPath, index) {
    const s = el('div', 'slot');
    s.dataset.list = JSON.stringify(listPath);
    s.addEventListener('dragover', (e) => {
      if (!this.dragging || (this.dragging.kind === 'def' && listPath.length)) return;
      e.preventDefault();
      s.classList.add('over');
    });
    s.addEventListener('dragleave', () => s.classList.remove('over'));
    s.addEventListener('drop', (e) => {
      e.preventDefault();
      s.classList.remove('over');
      const path = e.dataTransfer.getData(MIME_PATH);
      const id = e.dataTransfer.getData(MIME_NEW);
      this.endDrag();
      if (path) {
        const next = moveBlock(this.blocks, JSON.parse(path), listPath, index);
        if (!next) { this.onProblem("That block can't go there."); return; }
        this.selected = null;
        this.commit(next);
      } else if (id) {
        const p = palette(this.tools, this.blocks).find((x) => x.id === id);
        if (p) this.insert(listPath, index, p.make(this.blocks));
      }
    });
    return s;
  }

  startDrag(info) { this.dragging = info; this.root.classList.add('dragging'); }
  endDrag() { this.dragging = null; this.root.classList.remove('dragging'); }

  insert(listPath, index, block) {
    const problem = placementProblem(this.blocks, listPath, block);
    if (problem) { this.onProblem(problem); return; }
    this.selected = [...listPath, index];
    this.commit(insertBlock(this.blocks, listPath, index, block));
  }

  addFromPalette(p) {
    const block = p.make(this.blocks);
    const sel = this.selected;
    if (!sel || block.kind === 'def') { this.insert([], block.kind === 'def' ? undefined : this.blocks.length, block); return; }
    const target = getAt(this.blocks, sel);
    // into an empty container block, otherwise right after the selected block
    if (target && target.body && !target.body.length && target.kind !== 'if') this.insert([...sel, 'body'], 0, block);
    else this.insert(sel.slice(0, -1), sel[sel.length - 1] + 1, block);
  }

  block(b, path) {
    const wrap = el('div', `blk k-${b.kind}${b.kind === 'action' ? ` a-${b.name}` : ''}`);
    const head = this.header(b, path);
    wrap.append(head);
    if (b.kind === 'if') {
      b.branches.forEach((br, k) => {
        if (k > 0) wrap.append(this.branchHeader(path, k, br));
        wrap.append(this.list(br.body, [...path, 'branches', k, 'body']));
      });
      if (b.elseBody) {
        wrap.append(this.branchHeader(path, 'else'));
        wrap.append(this.list(b.elseBody, [...path, 'elseBody']));
      }
      const add = el('div', 'blk-foot');
      add.append(this.button('+ elif', 'Add another test', () => this.commit(addBranch(this.blocks, path, 'elif', this.defaultCond()))));
      if (!b.elseBody) add.append(this.button('+ else', 'Add an else branch', () => this.commit(addBranch(this.blocks, path, 'else'))));
      add.append(el('span', 'kw', 'end'));
      wrap.append(add);
    } else if (b.body) {
      wrap.append(this.list(b.body, [...path, 'body']));
      const foot = el('div', 'blk-foot');
      foot.append(el('span', 'kw', 'end'));
      wrap.append(foot);
    }
    return wrap;
  }

  defaultCond() {
    const s = this.tools.sensors;
    return !s || s.includes('clear') ? { type: 'sensor', name: 'clear' } : s.length ? { type: 'sensor', name: s[0] } : { type: 'const', value: true };
  }

  header(b, path) {
    const h = el('div', 'blk-head');
    const k = key(path);
    this.headers.set(k, h);
    h.tabIndex = 0;
    if (this.selected && key(this.selected) === k) h.classList.add('selected');
    if (this.breakpoints.has(this.lineOf.get(k))) h.classList.add('bp');
    h.draggable = true;
    h.addEventListener('dragstart', (e) => {
      if (e.target !== h) return;
      e.dataTransfer.setData(MIME_PATH, JSON.stringify(path));
      e.dataTransfer.effectAllowed = 'move';
      this.startDrag({ kind: b.kind });
      e.stopPropagation();
    });
    h.addEventListener('click', (e) => {
      if (e.target.closest('input,button')) return;
      this.select(path);
    });
    h.append(el('span', 'grip', '⠿'));
    switch (b.kind) {
      case 'action':
        h.append(el('span', 'kw', b.name));
        if (b.name === 'move') h.append(this.count(b, path, 'move'));
        break;
      case 'call': h.append(el('span', 'kw call', `▸ ${b.name}`)); break;
      case 'repeat': h.append(el('span', 'kw', 'repeat'), this.count(b, path, 'repeat'), el('span', 'dim', 'times')); break;
      case 'while': h.append(el('span', 'kw', 'while'), this.cond(b.cond, (cond) => updateBlock(this.blocks, path, { cond }))); break;
      case 'if': h.append(el('span', 'kw', 'if'), this.cond(b.branches[0].cond, (cond) => {
        const branches = structuredClone(b.branches);
        branches[0].cond = cond;
        return updateBlock(this.blocks, path, { branches });
      })); break;
      case 'def': h.append(el('span', 'kw', 'def'), this.defName(b)); break;
      case 'note': h.append(this.text(b.text, 'note', (text) => updateBlock(this.blocks, path, { text }))); break;
      case 'blank': h.append(el('span', 'dim', 'blank line')); break;
      default: break;
    }
    if (b.comment !== undefined) h.append(el('span', 'cmt', `#${b.comment}`));
    h.append(this.button('×', 'Remove this block', () => { this.selected = null; this.commit(removeBlock(this.blocks, path)); }, 'del'));
    return h;
  }

  branchHeader(path, which, br) {
    const h = el('div', 'blk-head branch');
    if (which === 'else') {
      h.append(el('span', 'kw', 'else'));
    } else {
      h.append(el('span', 'kw', 'elif'), this.cond(br.cond, (cond) => {
        const b = getAt(this.blocks, path);
        const branches = structuredClone(b.branches);
        branches[which].cond = cond;
        return updateBlock(this.blocks, path, { branches });
      }));
    }
    h.append(this.button('×', `Remove this ${which === 'else' ? 'else' : 'elif'} and its blocks`,
      () => this.commit(removeBranch(this.blocks, path, which)), 'del'));
    return h;
  }

  button(label, title, fn, cls = 'mini') {
    const b = el('button', cls, label);
    b.type = 'button';
    b.title = title;
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    return b;
  }

  count(b, path, kind) {
    const i = el('input', 'num');
    i.type = 'number';
    i.min = '1';
    i.max = kind === 'repeat' ? '999' : '99';
    i.value = String(b.count);
    i.setAttribute('aria-label', kind === 'repeat' ? 'Repeat count' : 'Tiles to move');
    i.onchange = () => {
      const n = clampCount(kind, i.value);
      if (n !== b.count) this.commit(updateBlock(this.blocks, path, { count: n }));
      else i.value = String(n);
    };
    return i;
  }

  cond(c, apply) {
    const i = el('input', 'cond');
    i.value = condText(c);
    i.spellcheck = false;
    i.setAttribute('aria-label', 'Condition');
    i.size = Math.max(5, i.value.length + 1);
    const check = () => {
      try { const parsed = parseCondition(i.value); i.classList.remove('invalid'); i.title = ''; return parsed; }
      catch (e) { i.classList.add('invalid'); i.title = e.message.replace(/^Line 1, /, ''); return null; }
    };
    i.oninput = () => { i.size = Math.max(5, i.value.length + 1); check(); };
    i.onchange = () => {
      const parsed = check();
      if (!parsed) { this.onProblem(`Condition: ${i.title}`); return; }
      if (condText(parsed) !== condText(c)) this.commit(apply(parsed));
    };
    return i;
  }

  defName(b) {
    const i = el('input', 'name');
    i.value = b.name;
    i.spellcheck = false;
    i.setAttribute('aria-label', 'Function name');
    i.size = Math.max(4, b.name.length + 1);
    i.oninput = () => {
      const p = nameProblem(this.blocks, i.value.trim().toLowerCase(), b.name);
      i.classList.toggle('invalid', Boolean(p));
      i.title = p;
    };
    i.onchange = () => {
      const name = i.value.trim().toLowerCase();
      const p = nameProblem(this.blocks, name, b.name);
      if (p) { this.onProblem(`Function name: ${p}`); return; }
      if (name !== b.name) this.commit(renameFunction(this.blocks, b.name, name));
    };
    return i;
  }

  text(value, cls, apply) {
    const i = el('input', cls);
    i.value = `#${value}`;
    i.spellcheck = false;
    i.setAttribute('aria-label', 'Comment');
    i.onchange = () => {
      const t = i.value.replace(/^#/, '').replace(/\n/g, ' ');
      if (t !== value) this.commit(apply(t));
    };
    return i;
  }

  select(path) {
    this.selected = path;
    for (const [k, h] of this.headers) h.classList.toggle('selected', k === key(path));
    this.headers.get(key(path))?.focus({ preventScroll: true });
  }

  key(e) {
    if (!this.selected || e.target.closest('input')) return;
    if (e.key === 'F9' && this.onToggleBreakpoint) {
      e.preventDefault();
      const line = this.selectedLine();
      if (line) this.onToggleBreakpoint(line);
      return;
    }
    const path = this.selected;
    const i = path[path.length - 1];
    const listPath = path.slice(0, -1);
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.selected = null;
      this.commit(removeBlock(this.blocks, path));
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const len = getAt(this.blocks, listPath).length;
      const to = e.key === 'ArrowUp' ? i - 1 : i + 2;
      if (to < 0 || to > len) return;
      const next = moveBlock(this.blocks, path, listPath, to);
      this.selected = [...listPath, e.key === 'ArrowUp' ? i - 1 : i + 1];
      this.commit(next);
      this.headers.get(key(this.selected))?.focus({ preventScroll: true });
    }
  }
}
