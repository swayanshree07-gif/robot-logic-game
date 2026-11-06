// Browser entry point: the level screen. All run logic is in PlaySession
// (src/game/session.js); this file wires it to the DOM and the canvas.
import { LEVELS, WORLDS, ALL_LEVELS, levelPlace } from '../game/levels.js';
import { PlaySession, SPEEDS, resultBanner } from '../game/session.js';
import { describeGoal, normalizeLevel } from '../world/level.js';
import { formatError } from '../lang/errors.js';
import { draw } from './render.js';
import { Animator, tweenMs } from './art.js';
import { CodeEditor } from './editor.js';
import { BlockEditor } from './blocks-view.js';
import { toText } from '../lang/blocks.js';
import { enterBlocks, blockedMessage, blockMark } from './code-mode.js';
import { starText } from '../game/score.js';
import { SaveStore } from '../game/save.js';
import { mapModel, totals, continueIndex, isOpen } from '../game/progress.js';
import { renderMap } from './map-view.js';

const $ = (id) => document.getElementById(id);
const ctx = $('board').getContext('2d');
/** Versioned progress save (src/game/save.js); memory-only if localStorage is unavailable. */
const save = new SaveStore((() => { try { return window.localStorage; } catch { return null; } })());

let index = 0;
let session = null;
let shownResult = null; // result object the banner/status currently reflect
let dirty = true;
const anim = new Animator();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

let mode = 'text'; // 'text' | 'blocks' (remembered in localStorage)
let notice = ''; // one-off message for the status line while editing (cleared on the next edit)

/** The program changed (from either editor): save the draft and hand it to the session. */
function applySource(text) {
  notice = '';
  save.setDraft(session.level.id, text);
  session.setSource(text);
  dirty = true;
}

function toggleBreakpoint(line) {
  session.toggleBreakpoint(line);
  editor.setBreakpoints(session.breakpoints);
  blockEditor.setBreakpoints(session.breakpoints);
  save.setBreakpoints(session.level.id, session.breakpoints);
  dirty = true;
}

const editor = new CodeEditor($('editor-root'), { onChange: applySource, onToggleBreakpoint: toggleBreakpoint });
const blockEditor = new BlockEditor($('blocks-root'), {
  // blocks only ever reach the session as Cog text, so both editors stay in sync
  onChange(blocks) { const text = toText(blocks); editor.value = text; applySource(text); },
  onProblem(msg) { notice = msg; dirty = true; },
  onToggleBreakpoint: toggleBreakpoint,
});

/**
 * Switch editors. Blocks need a program that parses; if it doesn't, stay in
 * (or fall back to) text mode and point at the error. Returns the mode in use.
 */
function setMode(next, { remember = true } = {}) {
  if (next === 'blocks') {
    const r = enterBlocks(editor.value);
    if (r.ok) {
      if (r.text !== editor.value) { editor.value = r.text; applySource(r.text); } // tidy layout; lines unchanged
      blockEditor.set(r.blocks, normalizeLevel(session.level).tools);
      blockEditor.setBreakpoints(session.breakpoints);
    } else {
      next = 'text';
      notice = blockedMessage(formatError(editor.value, r.error));
      editor.showError(r.error);
    }
  }
  mode = next;
  $('editor-root').hidden = mode !== 'text';
  $('blocks-root').hidden = mode !== 'blocks';
  $('mode-text').setAttribute('aria-pressed', String(mode === 'text'));
  $('mode-blocks').setAttribute('aria-pressed', String(mode === 'blocks'));
  if (remember) save.setSetting('mode', mode);
  dirty = true;
  return mode;
}

/** Replace the whole program (level load, dev params), keeping the block view in step. */
function setProgram(text) {
  editor.value = text;
  session.setSource(text);
  if (mode === 'blocks') setMode('blocks', { remember: false });
}

/** Open level `i` of LEVELS (or, for dev URLs, any level object, e.g. a prototype fixture). */
function loadLevel(i, level = LEVELS[i]) {
  index = i;
  if (LEVELS.includes(level)) save.last = level.id;
  showScreen('level');
  const speed = save.setting('speed', 'normal');
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
  buildFloors();
  $('level-select').value = String(i);
  notice = '';
  session.setBreakpoints(save.breakpoints(level.id));
  editor.setBreakpoints(session.breakpoints);
  setProgram(save.draft(level.id) ?? '');
  shownResult = null;
  dirty = true;
}

/** Test-floor buttons ("Test floor 1 2 3"), only for levels that have extra floors. */
function buildFloors() {
  const box = $('floors');
  const n = session.floors;
  box.hidden = n < 2;
  if (n < 2) { box.replaceChildren(); return; }
  const label = document.createElement('span');
  label.textContent = 'Test floor';
  box.replaceChildren(label, ...Array.from({ length: n }, (_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = String(i + 1);
    b.title = i === 0 ? 'Main floor (stars are scored here)' : `Watch the program on test floor ${i + 1}`;
    b.onclick = () => watchFloor(i);
    return b;
  }));
  const note = document.createElement('small');
  note.textContent = `the program must work on all ${n}`;
  box.append(note);
}

function watchFloor(i) {
  session.setFloor(i);
  shownResult = undefined; // force the banner to refresh
  dirty = true;
}

const savedStars = (id) => save.stars(id);

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
    const i = Number(opt.value);
    const l = LEVELS[i];
    const n = savedStars(l.id);
    opt.disabled = !isOpen(LEVELS, save, i) && i !== index;
    opt.textContent = `${opt.dataset.label}${n ? `  ${starText(n)}` : ''}`;
  }
}

/** Short world label for level numbers: 1..5. */
const worldTag = (w) => String(WORLDS.indexOf(w) + 1);

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

  [...$('floors').querySelectorAll('button')].forEach((b, i) => {
    b.setAttribute('aria-pressed', String(i === v.floor));
    b.classList.toggle('failed', v.result?.floorFail === i);
  });
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
  if (mode === 'blocks') { const m = blockMark(v); blockEditor.setMark(m.line, m.kind); }
  if (v.state === 'edit') {
    editor.clearMarks();
    if (notice) setStatus(notice, 'warn');
    else if (v.warnings.length) {
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
    b.onclick = () => (mode === 'blocks' ? blockEditor.selectLine(f.line) : editor.goToLine(f.line));
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
  $('banner-floor').hidden = b.floor === undefined;
  if (b.floor !== undefined) { $('banner-floor').textContent = `Watch floor ${b.floor + 1} ▶`; $('banner-floor').dataset.floor = String(b.floor); }
  $('banner-stars').textContent = b.stars ? starText(b.stars) : '';
  $('banner-par').textContent = b.par || '';
  if (result.result === 'win' && result.score) {
    const id = session.level.id;
    const { before, after } = save.recordRun(id, result.score);
    if (after > before) { showPar(session.level); labelLevels(); }
  }
  if (result.error) {
    setStatus(formatError(editor.value, result.error), 'error');
    editor.setActive(0);
    editor.showError(result.error);
  } else {
    setStatus(result.message, result.result === 'win' ? 'win' : 'error');
    editor.setActive(session.line);
  }
  (b.next ? $('banner-next') : b.floor !== undefined ? $('banner-floor') : $('banner-retry')).focus({ preventScroll: true });
}

// --- world map ---
let screen = 'level';
function showScreen(which) {
  screen = which;
  $('map').hidden = which !== 'map';
  $('level-screen').hidden = which !== 'level';
  $('open-map').setAttribute('aria-pressed', String(which === 'map'));
}

const SAVE_NOTES = {
  imported: 'Progress from an older version of the game was carried over.',
  corrupt: 'The saved progress was damaged and could not be read, so a fresh save was started (the old data is kept as ferrolab.save.bad).',
  newer: 'This save was made by a newer version of the game; progress made now will not be saved.',
  memory: 'This browser does not allow saving, so progress lasts only until the page is closed.',
};

function openMap() {
  if (session && session.state === 'running') session.pause();
  const cont = continueIndex(LEVELS, save, save.last);
  const note = [save.notes.map((n) => SAVE_NOTES[n]).filter(Boolean).join(' '), save.lastError || ''].filter(Boolean).join(' ');
  const model = mapModel(WORLDS, save, { current: save.last });
  renderMap($('map'), model, totals(model), {
    continueLabel: save.won(LEVELS[cont].id) ? `Back to ${levelLabel(cont)}` : `${save.last ? 'Continue' : 'Start'}: ${levelLabel(cont)}`,
    note,
    onContinue: () => loadLevel(cont),
    onPick: (i) => loadLevel(i),
    onReset() {
      // eslint-disable-next-line no-alert
      if (!confirm('Forget all stars, saved programs and breakpoints? Settings are kept.')) return;
      save.resetProgress();
      labelLevels();
      openMap();
    },
  });
  showScreen('map');
  $('map-continue').focus({ preventScroll: true });
  dirty = true;
}

/** "1-3 Turnaround" for LEVELS[i]. */
function levelLabel(i) {
  const place = levelPlace(LEVELS[i]);
  return place ? `${worldTag(place.world)}-${place.n} ${LEVELS[i].name}` : LEVELS[i].name;
}

$('open-map').onclick = () => (screen === 'map' ? showScreen('level') : openMap());

// --- controls ---
const act = (fn) => () => { fn(); dirty = true; };
$('run').onclick = act(() => session.toggle());
$('step').onclick = act(() => session.step());
$('stop').onclick = act(() => session.stop());
$('reset').onclick = act(() => session.reset());
$('step-over').onclick = act(() => session.stepOver());
$('step-out').onclick = act(() => session.stepOut());
$('banner-retry').onclick = act(() => { session.reset(); if (mode === 'text') editor.ta.focus(); });
$('mode-text').onclick = () => setMode('text');
$('mode-blocks').onclick = () => setMode('blocks');
$('banner-floor').onclick = act(() => { watchFloor(Number($('banner-floor').dataset.floor)); session.run(); });
$('banner-next').onclick = () => loadLevel(Math.min(index + 1, LEVELS.length - 1));

const speedSel = $('speed');
SPEEDS.forEach((s) => speedSel.add(new Option(s.label, s.id)));
speedSel.value = save.setting('speed', 'normal');
speedSel.onchange = () => { session.setSpeed(speedSel.value); save.setSetting('speed', speedSel.value); };

document.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLElement && /^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName);
  if (screen === 'map') {
    if (e.key === 'Escape' || ((e.key === 'm' || e.key === 'M') && !typing)) { e.preventDefault(); showScreen('level'); }
    return; // level-screen shortcuts are off while the map is open
  }
  if ((e.key === 'm' || e.key === 'M') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openMap(); return; }
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
// &floor=N (1-based) watches that test floor.
const start = Math.min(LEVELS.length, Math.max(1, Number(params.get('level')) || 1)) - 1;
// &mode=text|blocks picks the editor (not saved); otherwise the saved choice.
mode = params.get('mode') === 'blocks' || (!params.has('mode') && save.setting('mode') === 'blocks') ? 'blocks' : 'text';
// &id=<level id> opens any level by id, including test-fixture prototypes (dev only).
const byId = params.has('id') ? ALL_LEVELS.find((l) => l.id === params.get('id')) : null;
// With no dev params the game opens on the map (and the board behind it holds the level "Continue" goes to).
const devStart = params.has('level') || params.has('id');
loadLevel(byId && LEVELS.includes(byId) ? LEVELS.indexOf(byId) : devStart ? start : continueIndex(LEVELS, save, save.last), byId || undefined);
setMode(mode, { remember: false });
if (params.has('code')) setProgram(params.get('code'));
if (Number(params.get('floor')) > 1 && Number(params.get('floor')) <= session.floors) watchFloor(Number(params.get('floor')) - 1);
if (params.has('bp')) { // &bp=2,4 sets breakpoints (not saved)
  session.setBreakpoints(params.get('bp').split(',').map(Number).filter((n) => n > 0));
  editor.setBreakpoints(session.breakpoints);
  blockEditor.setBreakpoints(session.breakpoints);
}
if (params.get('solve') === '1') {
  setProgram(session.level.solution);
  session.setSpeed('instant');
  session.run();
} else if (params.get('run') === '1') session.step();
else if (params.get('run') === 'all') { session.setSpeed('instant'); session.run(); }
// finish instant runs before the first paint so screenshots never race a frame
while (session.state === 'running' && session.speed.ms === 0) session.update(0);
// &map=1 opens the map (dev); no params at all also starts on the map
if (params.get('map') === '1' || !devStart) openMap();
render(); drawBoard(performance.now(), 0); dirty = false; // first paint without waiting for a frame
requestAnimationFrame(frame);
