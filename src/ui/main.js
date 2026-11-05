// Browser entry point: the level screen. All run logic is in PlaySession
// (src/game/session.js); this file wires it to the DOM and the canvas.
import { LEVELS, WORLDS, levelPlace } from '../game/levels.js';
import { PlaySession, SPEEDS, resultBanner } from '../game/session.js';
import { describeGoal, normalizeLevel } from '../world/level.js';
import { formatError } from '../lang/errors.js';
import { draw } from './render.js';
import { Animator, tweenMs } from './art.js';
import { CodeEditor } from './editor.js';
import { starText, bestStars } from '../game/score.js';

const $ = (id) => document.getElementById(id);
const ctx = $('board').getContext('2d');
const store = {
  get: (k) => { try { return localStorage.getItem(`ferrolab.${k}`); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(`ferrolab.${k}`, v); } catch { /* storage full or blocked */ } },
};

let index = 0;
let session = null;
let shownResult = null; // result object the banner/status currently reflect
let dirty = true;
const anim = new Animator();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const editor = new CodeEditor($('editor-root'), {
  onChange(text) {
    store.set(`draft.${session.level.id}`, text);
    session.setSource(text);
    dirty = true;
  },
  onToggleBreakpoint(line) {
    session.toggleBreakpoint(line);
    editor.setBreakpoints(session.breakpoints);
    store.set(`bp.${session.level.id}`, JSON.stringify([...session.breakpoints]));
    dirty = true;
  },
});

function loadBreakpoints(id) {
  try { return JSON.parse(store.get(`bp.${id}`) || '[]').filter(Number.isInteger); } catch { return []; }
}

function loadLevel(i) {
  index = i;
  const level = LEVELS[i];
  const speed = store.get('speed') || 'normal';
  session = new PlaySession(level, { speed: SPEEDS.some((s) => s.id === speed) ? speed : 'normal' });
  const place = levelPlace(level);
  $('level-num').textContent = place ? `${worldTag(place.world)}-${place.n}` : String(i + 1);
  $('level-num').title = place ? place.world.name : '';
  $('level-name').textContent = level.name;
  setRichText($('brief'), level.brief);
  $('goal').textContent = `Goal: ${describeGoal(level)}`;
  const t = normalizeLevel(level).tools;
  const parts = [`commands: ${t.actions.join(' ')}`];
  if (t.blocks.length) parts.push(`blocks: ${t.blocks.join(' ')}`);
  if (t.sensors.length) parts.push(`sensors: ${t.sensors.join(' ')}`);
  $('tools').textContent = `Unlocked — ${parts.join(' · ')}`;
  showPar(level);
  $('level-select').value = String(i);
  editor.value = store.get(`draft.${level.id}`) ?? '';
  session.setBreakpoints(loadBreakpoints(level.id));
  editor.setBreakpoints(session.breakpoints);
  session.setSource(editor.value);
  shownResult = null;
  dirty = true;
}

/** Best stars so far for a level (0..3, kept in localStorage). */
const savedStars = (id) => Math.min(3, Math.max(0, Number(store.get(`stars.${id}`)) || 0));

/** "Par: 29 steps · size 8 · best ★★☆" under the goal. */
function showPar(level) {
  const el = $('par');
  if (!level.par) { el.textContent = ''; return; }
  const bits = [];
  if (level.par.steps) bits.push(`${level.par.steps} steps`);
  if (level.par.size) bits.push(`size ${level.par.size}`);
  const best = document.createElement('span');
  best.className = 'best';
  best.textContent = starText(savedStars(level.id));
  el.replaceChildren(`Par: ${bits.join(' · ')} — best `, best);
  el.title = 'One star for finishing, one for matching the step par, one for matching the size par';
}

/** Level picker labels, with best stars once a level has been won. */
function labelLevels() {
  for (const opt of $('level-select').options) {
    const l = LEVELS[Number(opt.value)];
    const n = savedStars(l.id);
    opt.textContent = `${opt.dataset.label}${n ? `  ${starText(n)}` : ''}`;
  }
}

/** Short world label for level numbers: 1..5, or P for the prototype bay. */
const worldTag = (w) => (w.id === 'lab' ? 'P' : String(WORLDS.indexOf(w) + 1));

/** Text with `backtick` spans shown as <code> (built with DOM nodes, never innerHTML). */
function setRichText(el, text) {
  el.replaceChildren(...String(text).split('`').map((part, i) => {
    if (i % 2 === 0) return document.createTextNode(part);
    const c = document.createElement('code');
    c.textContent = part;
    return c;
  }));
}

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status ${kind}`;
}

/** Draw the board with Pip's tweened pose; called every frame. */
function drawBoard(now, dt) {
  anim.sync(session.world, tweenMs(session.speed.ms, reducedMotion.matches));
  anim.update(dt);
  draw(ctx, session.world, {
    bump: anim.busy ? null : session.bump,
    pose: anim.pose(),
    time: reducedMotion.matches ? 0 : now,
  });
}

/** Sync every control, the HUD, the banner and the board with the session. */
function render() {
  const v = session.view();

  $('run').textContent = v.runLabel === 'Pause' ? '❚❚ Pause' : `▶ ${v.runLabel}`;
  $('step').disabled = !v.canStep;
  $('stop').disabled = !v.canStop;
  $('reset').disabled = !v.canReset;

  $('hud-state').textContent = v.state.toUpperCase();
  $('hud-state').className = `pill ${v.state}`;
  $('hud-steps').textContent = v.ticks;
  $('hud-battery').textContent = v.battery;
  $('hud-meter').value = Math.max(0, 1 - v.ticks / v.battery);
  $('hud-line').textContent = v.line || '–';
  $('debug').hidden = v.state === 'edit' || !session.runner?.vm;
  $('step-over').disabled = !v.canStep;
  $('step-out').disabled = !v.canStepOut;
  renderDebugger(v);
  const size = session.runner ? session.runner.size : 0;
  $('size').textContent = size ? `size ${size}` : '';

  renderFunctions(v);
  if (v.state === 'edit') {
    editor.clearMarks();
    if (v.warnings.length) {
      const more = v.warnings.length > 1 ? `\n(+${v.warnings.length - 1} more warning${v.warnings.length > 2 ? 's' : ''})` : '';
      setStatus(`Warning: ${formatError(editor.value, v.warnings[0])}${more}`, 'warn');
    } else setStatus('Ready. Press Run, or Step to go one action at a time.');
  }
  else if (v.state !== 'done') {
    editor.setActive(v.line, Boolean(v.atBreak));
    setStatus(v.atBreak ? `Paused before line ${v.atBreak} (breakpoint). Resume or Step to go on.`
      : v.state === 'paused' ? `Paused after line ${v.line || '…'}.` : `Running line ${v.line || '…'}`);
  }

  if (v.result !== shownResult) {
    shownResult = v.result;
    showResult(v.result);
  }
}

const li = (html, cls = '') => { const e = document.createElement('li'); e.innerHTML = html; e.className = cls; return e; };
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/** Debugger panel: call stack (innermost first) and active repeat blocks (innermost first). */
function renderDebugger(v) {
  const frames = [...v.frames].reverse();
  $('dbg-frames').replaceChildren(...frames.map((f, i) => li(f.line
    ? `<b>${esc(f.name)}</b> <span>called from line ${f.line}</span>`
    : '<b>main</b> <span>program</span>', i === 0 ? 'top' : '')));
  const loops = [...v.loops].reverse();
  $('dbg-loops').replaceChildren(...(loops.length
    ? loops.map((l, i) => li(`line ${l.line}: pass <b>${l.pass}</b> of ${l.total}`, i === 0 ? 'top' : ''))
    : [li('none running')]));
  $('dbg-break').textContent = v.atBreak ? `● paused at breakpoint, line ${v.atBreak}` : '';
}

/** Function panel: every def with its line, calls so far, and whether it is running. */
function renderFunctions(v) {
  $('fn-panel').hidden = !v.functions.length;
  const unused = new Set(v.warnings.filter((w) => w.code === 'unused').map((w) => w.line));
  $('fn-list').replaceChildren(...v.functions.map((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    const state = f.active ? ` · <span>running${f.active > 1 ? ` ×${f.active}` : ''}</span>`
      : unused.has(f.line) ? ' · <span class="warn">never called</span>' : '';
    const calls = v.state === 'edit' ? '' : ` · called ${f.calls}×`;
    b.innerHTML = `<b>${esc(f.name)}</b> line ${f.line}${calls}${state}`;
    b.onclick = () => editor.goToLine(f.line);
    const e = document.createElement('li');
    if (f.active) e.className = 'running';
    e.append(b);
    return e;
  }));
}

function showResult(result) {
  const banner = $('banner');
  const b = resultBanner(result, { hasNext: index < LEVELS.length - 1 });
  banner.hidden = !b;
  if (!result) return;
  if (result.result === 'stopped') { setStatus('Stopped. Reset to try again.'); editor.setActive(session.line); return; }
  banner.className = `banner ${b.kind}`;
  $('banner-title').textContent = b.title;
  $('banner-text').textContent = b.text;
  $('banner-next').hidden = !b.next;
  $('banner-stars').textContent = b.stars ? starText(b.stars) : '';
  $('banner-par').textContent = b.par || '';
  if (result.result === 'win' && result.score) {
    const id = session.level.id;
    const best = bestStars(savedStars(id), result.score);
    if (best > savedStars(id)) { store.set(`stars.${id}`, String(best)); showPar(session.level); labelLevels(); }
  }
  if (result.error) {
    setStatus(formatError(editor.value, result.error), 'error');
    editor.setActive(0);
    editor.showError(result.error);
  } else {
    setStatus(result.message, result.result === 'win' ? 'win' : 'error');
    editor.setActive(session.line);
  }
  (b.next ? $('banner-next') : $('banner-retry')).focus({ preventScroll: true });
}

// --- controls ---
const act = (fn) => () => { fn(); dirty = true; };
$('run').onclick = act(() => session.toggle());
$('step').onclick = act(() => session.step());
$('stop').onclick = act(() => session.stop());
$('reset').onclick = act(() => session.reset());
$('step-over').onclick = act(() => session.stepOver());
$('step-out').onclick = act(() => session.stepOut());
$('banner-retry').onclick = act(() => { session.reset(); editor.ta.focus(); });
$('banner-next').onclick = () => loadLevel(Math.min(index + 1, LEVELS.length - 1));

const speedSel = $('speed');
SPEEDS.forEach((s) => speedSel.add(new Option(s.label, s.id)));
speedSel.value = store.get('speed') || 'normal';
speedSel.onchange = () => { session.setSpeed(speedSel.value); store.set('speed', speedSel.value); };

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    (e.shiftKey ? $('step') : $('run')).click();
  } else if (e.key === 'F10' && !e.shiftKey) {
    e.preventDefault();
    $('step-over').click();
  } else if (e.key === 'F11' && e.shiftKey) {
    e.preventDefault();
    $('step-out').click();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    $('reset').click();
  }
});

const sel = $('level-select');
WORLDS.forEach((w) => {
  const group = document.createElement('optgroup');
  group.label = `${worldTag(w)}. ${w.name}`;
  w.levels.forEach((l, n) => {
    const opt = new Option('', LEVELS.indexOf(l));
    opt.dataset.label = `${worldTag(w)}-${n + 1} ${l.name}`;
    group.append(opt);
  });
  sel.append(group);
});
labelLevels();
sel.onchange = () => loadLevel(Number(sel.value));

// --- main loop ---
let last = performance.now();
function frame(now) {
  const dt = Math.min(now - last, 250); // don't burst after a background tab
  last = now;
  if (session.update(dt) > 0) dirty = true;
  if (dirty) { dirty = false; render(); }
  drawBoard(now, dt);
  requestAnimationFrame(frame);
}

// Dev URL params: ?level=N (1-based) opens a level; &run=1 takes one step;
// &run=all runs the program instantly; &solve=1 loads the level's known solution and runs it at instant speed.
const params = new URLSearchParams(location.search);
// &code=... (URL-encoded) loads that program instead of the saved draft.
const start = Math.min(LEVELS.length, Math.max(1, Number(params.get('level')) || 1)) - 1;
loadLevel(start);
if (params.has('code')) { editor.value = params.get('code'); session.setSource(editor.value); }
if (params.has('bp')) { // &bp=2,4 sets breakpoints (not saved)
  session.setBreakpoints(params.get('bp').split(',').map(Number).filter((n) => n > 0));
  editor.setBreakpoints(session.breakpoints);
}
if (params.get('solve') === '1') {
  editor.value = LEVELS[start].solution;
  session.setSource(editor.value);
  session.setSpeed('instant');
  session.run();
} else if (params.get('run') === '1') session.step();
else if (params.get('run') === 'all') { session.setSpeed('instant'); session.run(); }
// finish instant runs before the first paint so screenshots never race a frame
while (session.state === 'running' && session.speed.ms === 0) session.update(0);
render(); drawBoard(performance.now(), 0); dirty = false; // first paint without waiting for a frame
requestAnimationFrame(frame);
