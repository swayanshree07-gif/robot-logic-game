// Code editor component: a plain <textarea> with a line-number gutter and a
// highlight band for the running line / error line. Logic lives in editor-model.js.
import { lineCount, lineStart, lineAt, gutterRows, errorRange, editKey } from './editor-model.js';

export class CodeEditor {
  /** @param {HTMLElement} root  element containing .gutter, .band and textarea */
  constructor(root, { onChange = () => {}, onToggleBreakpoint = null } = {}) {
    this.root = root;
    this.ta = root.querySelector('textarea');
    this.gutter = root.querySelector('.gutter');
    this.band = root.querySelector('.band');
    this.marks = { active: 0, error: 0 };
    this.onChange = onChange;
    this.breakpoints = new Set();
    this.onToggleBreakpoint = onToggleBreakpoint;
    // click a line number (or press F9 on a line) to toggle a breakpoint
    this.gutter.addEventListener('click', (e) => {
      const n = Number(e.target.dataset && e.target.dataset.line);
      if (n && this.onToggleBreakpoint) this.onToggleBreakpoint(n);
    });
    this.ta.addEventListener('input', () => { this.marks.error = 0; this.refresh(); this.onChange(this.value); });
    this.ta.addEventListener('scroll', () => this.syncScroll());
    this.ta.addEventListener('keydown', (e) => this.key(e));
    this.refresh();
  }

  get value() { return this.ta.value; }
  set value(v) { this.ta.value = v; this.marks = { active: 0, error: 0 }; this.refresh(); }

  /** Put the caret at the start of `line` (1-based), select its text and scroll it into view. */
  goToLine(line) {
    const start = lineStart(this.ta.value, line);
    const nl = this.ta.value.indexOf('\n', start);
    this.ta.focus();
    this.ta.setSelectionRange(start, nl < 0 ? this.ta.value.length : nl);
    const top = (line - 1) * this.lineHeight();
    if (top < this.ta.scrollTop || top > this.ta.scrollTop + this.ta.clientHeight - this.lineHeight()) {
      this.ta.scrollTop = Math.max(0, top - this.ta.clientHeight / 3);
      this.syncScroll();
    }
  }

  key(e) {
    if (e.key === 'F9' && this.onToggleBreakpoint) {
      e.preventDefault();
      this.onToggleBreakpoint(lineAt(this.ta.value, this.ta.selectionStart));
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const r = editKey(e.key, this.ta.value, this.ta.selectionStart, this.ta.selectionEnd, { shift: e.shiftKey });
    if (!r) return;
    e.preventDefault();
    this.ta.value = r.text;
    this.ta.setSelectionRange(r.start, r.end);
    this.marks.error = 0;
    this.refresh();
    this.onChange(this.value);
  }

  /** Highlight the line being executed (0 = none); atBreak = paused at a breakpoint there. */
  setActive(line, atBreak = false) {
    if (line === this.marks.active && atBreak === !!this.marks.atBreak) return;
    this.marks.active = line;
    this.marks.atBreak = atBreak;
    this.refresh();
  }

  /** Mark and select an error position. */
  showError(err) {
    this.marks.error = err && err.line ? err.line : 0;
    this.refresh();
    const r = errorRange(this.ta.value, err);
    if (!r) return;
    this.ta.focus();
    this.ta.setSelectionRange(r[0], r[1]);
  }

  setBreakpoints(set) { this.breakpoints = new Set(set); this.refresh(); }

  clearMarks() { this.marks = { active: 0, error: 0 }; this.refresh(); }

  lineHeight() { return parseFloat(getComputedStyle(this.ta).lineHeight) || 21; }

  refresh() {
    const rows = gutterRows(lineCount(this.ta.value), { active: this.marks.active, error: this.marks.error, breakpoints: this.breakpoints });
    this.gutter.replaceChildren(...rows.map(({ n, mark, bp }) => {
      const d = document.createElement('div');
      d.textContent = n;
      d.dataset.line = n;
      d.title = bp ? 'Breakpoint (click to remove)' : 'Click to pause here (F9)';
      d.className = `${mark === 'active' && this.marks.atBreak ? 'break' : mark}${bp ? ' bp' : ''}`;
      return d;
    }));
    const line = this.marks.error || this.marks.active;
    this.band.hidden = !line;
    this.band.className = `band ${this.marks.error ? 'error' : this.marks.atBreak ? 'break' : 'active'}`;
    this.bandLine = line;
    this.syncScroll();
  }

  syncScroll() {
    this.gutter.scrollTop = this.ta.scrollTop;
    if (this.bandLine) {
      const pad = parseFloat(getComputedStyle(this.ta).paddingTop) || 0;
      this.band.style.top = `${pad + (this.bandLine - 1) * this.lineHeight() - this.ta.scrollTop}px`;
      this.band.style.height = `${this.lineHeight()}px`;
    }
  }
}
