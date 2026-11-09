// The Lab: level editor screen. All edits go through the pure reducer
// (src/game/level-editor.js); test-play gating and the library are in
// src/game/custom-levels.js; palette clicks map to actions in src/game/lab-tools.js.
import { createEditor, blankLevel, editorReducer, editedMap, canUndo, canRedo, editorProblems, MAX_W, MAX_H, MIN_SIZE } from '../game/level-editor.js';
import { testPlay, shareCheck, draftPrograms, CustomLibrary } from '../game/custom-levels.js';
import { LAB_TOOLS, toolAction, cellAt, winFromForm } from '../game/lab-tools.js';
import { World, winRules } from '../world/world.js';
import { MAX_CREW, robotName, floorCount, WIN_TYPES } from '../world/level.js';
import { draw } from './render.js';
import { layout } from './art.js';

const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter((k) => k !== null && k !== undefined));
  return el;
};

/** Build the Lab inside `root`. Returns { show() }. */
export function createLab(root, storage) {
  const lib = new CustomLibrary(storage);
  let state = lib.list()[0] ? lib.open(lib.list()[0].level.id) : null;
  if (!state) state = freshDraft();
  let tool = 'wall';
  let robot = 0; // solution tab
  let message = '';
  let painting = false;

  function freshDraft() {
    const id = lib.nextId();
    return createEditor({ ...blankLevel(id), name: `Custom ${id.split('-')[1]}` });
  }

  function dispatch(action, { quiet = false } = {}) {
    const next = editorReducer(state, action);
    if (next === state) return;
    state = next;
    if (!quiet) message = '';
    render();
  }

  // --- static layout ---
  const canvas = h('canvas', { id: 'lab-board', width: 640, height: 440 });
  canvas.setAttribute('aria-label', 'Level being edited');
  const ctx = canvas.getContext('2d');
  const palette = h('div', { className: 'lab-palette', role: 'radiogroup' });
  palette.setAttribute('aria-label', 'Paint tool');
  const floorTabs = h('div', { className: 'floors lab-floors', role: 'group' });
  const status = h('pre', { id: 'lab-status', className: 'status', role: 'status' });
  const problemsEl = h('ul', { id: 'lab-problems', className: 'lab-problems' });
  const form = h('div', { className: 'lab-form' });
  const solTabs = h('div', { className: 'crew-tabs', role: 'tablist' });
  const solution = h('textarea', { id: 'lab-solution', rows: 10, spellcheck: false, wrap: 'off' });
  solution.setAttribute('aria-label', 'Known solution program');
  const libList = h('ul', { id: 'lab-library', className: 'lab-library' });

  const btn = (label, title, fn, cls = '') => {
    const b = h('button', { type: 'button', textContent: label, title, className: cls });
    b.onclick = fn;
    return b;
  };
  const undoBtn = btn('↶ Undo', 'Undo (Ctrl+Z)', () => dispatch({ type: 'undo' }));
  const redoBtn = btn('↷ Redo', 'Redo (Ctrl+Y)', () => dispatch({ type: 'redo' }));
  const playBtn = btn('▶ Test-play', 'Run the known solution on every floor', onTestPlay, 'primary');
  const saveBtn = btn('💾 Save', 'Save to your custom level library', onSave);
  const shareBtn = btn('⇪ Share', 'Make a share code (needs a solved level)', onShare);

  root.replaceChildren(
    h('div', { className: 'lab-head' },
      h('h2', { textContent: 'The Lab — level editor' }),
      h('p', { className: 'brief', textContent: 'Paint a floor, write a program that solves it, test-play it, then save or share. A level can only be shared after it is solved in test-play since the last edit.' })),
    h('div', { className: 'lab-grid' },
      h('section', { className: 'lab-stage' },
        palette, floorTabs, h('div', { className: 'board-wrap' }, canvas),
        h('div', { className: 'controls' }, undoBtn, redoBtn, playBtn, saveBtn, shareBtn),
        status, problemsEl),
      h('section', { className: 'lab-side' },
        form,
        h('h3', { textContent: 'Known solution' }), solTabs, solution,
        h('h3', { textContent: 'Your levels' }),
        h('div', { className: 'controls' }, btn('＋ New level', 'Start a new blank level', () => { state = freshDraft(); robot = 0; message = 'New level.'; render(); })),
        libList)),
  );

  for (const t of LAB_TOOLS) {
    const b = h('button', { type: 'button', textContent: t.label, className: 'lab-tool' });
    b.dataset.tool = t.id;
    b.setAttribute('role', 'radio');
    b.onclick = () => { tool = t.id; render(); };
    palette.append(b);
  }

  // --- form fields ---
  const field = (label, input) => h('label', { className: 'lab-field' }, h('span', { textContent: label }), input);
  const nameIn = h('input', { type: 'text', maxLength: 40 });
  const briefIn = h('textarea', { rows: 2, maxLength: 300 });
  const wIn = h('input', { type: 'number', min: MIN_SIZE, max: MAX_W });
  const hIn = h('input', { type: 'number', min: MIN_SIZE, max: MAX_H });
  const winIn = h('select', {}, ...WIN_TYPES.map((t) => h('option', { value: t, textContent: t })));
  const countIn = h('input', { type: 'number', min: 0, placeholder: 'all' });
  const capIn = h('input', { type: 'number', min: 1, max: 9, placeholder: '1' });
  const stepsIn = h('input', { type: 'number', min: 1, max: 10000, placeholder: 'auto' });
  nameIn.onchange = () => dispatch({ type: 'meta', name: nameIn.value.trim() || 'Untitled' });
  briefIn.onchange = () => dispatch({ type: 'meta', brief: briefIn.value });
  wIn.onchange = hIn.onchange = () => dispatch({ type: 'resize', width: Number(wIn.value), height: Number(hIn.value) });
  winIn.onchange = countIn.onchange = () => dispatch({ type: 'win', rules: winFromForm(winIn.value, countIn.value) });
  const num = (v) => (v === '' ? null : Number(v));
  capIn.onchange = () => dispatch({ type: 'capacity', value: num(capIn.value) });
  stepsIn.onchange = () => dispatch({ type: 'maxSteps', value: num(stepsIn.value) });
  form.append(
    field('Name', nameIn), field('Brief', briefIn),
    h('div', { className: 'lab-row' }, field('Width', wIn), field('Height', hIn)),
    h('div', { className: 'lab-row' }, field('Win', winIn), field('Count', countIn)),
    h('div', { className: 'lab-row' }, field('Gripper', capIn), field('Battery', stepsIn)),
  );
  solution.oninput = () => dispatch({ type: 'solution', robot, source: solution.value }, { quiet: true });

  // --- canvas painting ---
  function cellFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) * (canvas.width / r.width), py = (e.clientY - r.top) * (canvas.height / r.height);
    const rows = editedMap(state);
    return cellAt(layout({ width: rows[0].length, height: rows.length }, canvas.width, canvas.height), rows[0].length, rows.length, px, py);
  }
  function useTool(e) {
    const c = cellFromEvent(e);
    if (!c) return;
    const a = toolAction(state, tool, c.x, c.y);
    if (a) dispatch(a);
  }
  canvas.onpointerdown = (e) => { painting = tool !== 'robot'; canvas.setPointerCapture(e.pointerId); useTool(e); };
  canvas.onpointermove = (e) => { if (painting) useTool(e); };
  canvas.onpointerup = canvas.onpointercancel = () => { painting = false; };

  root.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (typing || !(e.ctrlKey || e.metaKey)) return;
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'undo' }); }
    if (e.key === 'y' || (e.key === 'Z' && e.shiftKey)) { e.preventDefault(); dispatch({ type: 'redo' }); }
  });

  // --- actions ---
  function onTestPlay() {
    const r = testPlay(state);
    state = r.state;
    message = r.message;
    render();
  }
  function onSave() {
    message = lib.put(state) ? `Saved "${state.level.name}" (${state.solved ? 'solved' : 'not solved yet'}).` : lib.error;
    render();
  }
  function onShare() {
    const c = shareCheck(state);
    // Share codes arrive on Day 24; for now the gate itself is what is checked.
    message = c.ok ? 'Ready to share. (Share codes are coming next.)' : c.reason;
    render();
  }

  // --- render ---
  function render() {
    const lv = state.level;
    const rows = editedMap(state);
    for (const b of palette.children) b.setAttribute('aria-checked', String(b.dataset.tool === tool));

    floorTabs.replaceChildren(...Array.from({ length: floorCount(lv) }, (_, i) => {
      const b = btn(i ? `Floor ${i + 1}` : 'Main', i ? 'Extra test floor' : 'Main map', () => dispatch({ type: 'selectFloor', index: i }));
      b.setAttribute('aria-pressed', String(i === state.floor));
      return b;
    }),
    btn('＋ Floor', 'Copy this map as an extra test floor', () => dispatch({ type: 'addFloor' })),
    ...(state.floor ? [btn('✕ Remove floor', 'Delete this test floor', () => dispatch({ type: 'removeFloor', index: state.floor }))] : []));

    try {
      const world = new World({ ...lv, map: rows }, { maxRobots: MAX_CREW });
      draw(ctx, world, { time: performance.now() });
    } catch (err) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ff9a9a';
      ctx.font = '16px monospace';
      ctx.fillText(String(err.message || err), 12, 24);
    }

    undoBtn.disabled = !canUndo(state);
    redoBtn.disabled = !canRedo(state);
    const share = shareCheck(state);
    shareBtn.classList.toggle('primary', share.ok);

    const set = (el, v) => { if (document.activeElement !== el) el.value = v ?? ''; };
    set(nameIn, lv.name); set(briefIn, lv.brief);
    set(wIn, lv.map[0].length); set(hIn, lv.map.length);
    const rule = winRules(lv.win)[0] || { type: 'reach' };
    set(winIn, rule.type); set(countIn, rule.count ?? '');
    countIn.disabled = rule.type !== 'deliver';
    set(capIn, lv.capacity); set(stepsIn, lv.maxSteps);

    const progs = draftPrograms(lv);
    if (robot >= progs.length) robot = 0;
    solTabs.hidden = progs.length < 2;
    solTabs.replaceChildren(...progs.map((_, i) => {
      const b = btn(`${i + 1} ${robotName(lv, i)}`, 'Program for this robot', () => { robot = i; render(); });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i === robot));
      return b;
    }));
    set(solution, progs[robot]);

    const problems = editorProblems(state);
    problemsEl.replaceChildren(...problems.slice(0, 6).map((p) => h('li', { textContent: p })));
    status.textContent = message || (problems.length ? 'Level has problems (see below).'
      : state.solved ? 'Solved in test-play — ready to share.' : 'Valid level. Test-play it to unlock sharing.');

    libList.replaceChildren(...lib.list().map((e) => h('li', {},
      h('span', { textContent: `${e.solved ? '✔' : '·'} ${e.level.name} ` }),
      btn('Open', 'Open in the editor', () => { state = lib.open(e.level.id); robot = 0; message = `Opened "${e.level.name}".`; render(); }),
      btn('Delete', 'Delete from the library', () => {
        // eslint-disable-next-line no-alert
        if (confirm(`Delete "${e.level.name}"?`)) { lib.remove(e.level.id); render(); }
      }))));
    if (!lib.list().length) libList.append(h('li', { textContent: 'No saved levels yet.' }));
  }

  return { show() { render(); } };
}
