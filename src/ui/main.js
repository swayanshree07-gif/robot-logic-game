// Browser entry point: the level screen. All run logic is in PlaySession
// (src/game/session.js); this file wires it to the DOM and the canvas.
import { LEVELS } from '../game/levels.js';
import { PlaySession, SPEEDS, resultBanner } from '../game/session.js';
import { describeGoal, normalizeLevel } from '../world/level.js';
import { formatError } from '../lang/errors.js';
import { draw } from './render.js';
import { CodeEditor } from './editor.js';

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

const editor = new CodeEditor($('editor-root'), {
  onChange(text) {
    store.set(`draft.${session.level.id}`, text);
    session.setSource(text);
    dirty = true;
  },
});

function loadLevel(i) {
  index = i;
  const level = LEVELS[i];
  const speed = store.get('speed') || 'normal';
  session = new PlaySession(level, { speed: SPEEDS.some((s) => s.id === speed) ? speed : 'normal' });
  $('level-num').textContent = `${String(i + 1).padStart(2, '0')}`;
  $('level-name').textContent = level.name;
  $('brief').textContent = level.brief;
  $('goal').textContent = `Goal: ${describeGoal(level)}`;
  const t = normalizeLevel(level).tools;
  const parts = [`commands: ${t.actions.join(' ')}`];
  if (t.blocks.length) parts.push(`blocks: ${t.blocks.join(' ')}`);
  if (t.sensors.length) parts.push(`sensors: ${t.sensors.join(' ')}`);
  $('tools').textContent = `Unlocked — ${parts.join(' · ')}`;
  $('level-select').value = String(i);
  editor.value = store.get(`draft.${level.id}`) ?? '';
  session.setSource(editor.value);
  shownResult = null;
  dirty = true;
}

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status ${kind}`;
}

/** Sync every control, the HUD, the banner and the board with the session. */
function render() {
  const v = session.view();
  draw(ctx, session.world, { bump: session.bump });

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
  const size = session.runner ? session.runner.size : 0;
  $('size').textContent = size ? `size ${size}` : '';

  if (v.state === 'edit') { editor.clearMarks(); setStatus('Ready. Press Run, or Step to go one action at a time.'); }
  else if (v.state !== 'done') { editor.setActive(v.line); setStatus(`Running line ${v.line || '…'}`); }

  if (v.result !== shownResult) {
    shownResult = v.result;
    showResult(v.result);
  }
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
  } else if (e.key === 'Escape') {
    e.preventDefault();
    $('reset').click();
  }
});

const sel = $('level-select');
LEVELS.forEach((l, i) => sel.add(new Option(`${i + 1}. ${l.name}`, i)));
sel.onchange = () => loadLevel(Number(sel.value));

// --- main loop ---
let last = performance.now();
function frame(now) {
  const dt = Math.min(now - last, 250); // don't burst after a background tab
  last = now;
  if (session.update(dt) > 0) dirty = true;
  if (dirty) { dirty = false; render(); }
  requestAnimationFrame(frame);
}

// Dev URL params: ?level=N (1-based) opens a level; &run=1 takes one step;
// &run=all runs the program instantly; &solve=1 loads the level's known solution and runs it at instant speed.
const params = new URLSearchParams(location.search);
// &code=... (URL-encoded) loads that program instead of the saved draft.
const start = Math.min(LEVELS.length, Math.max(1, Number(params.get('level')) || 1)) - 1;
loadLevel(start);
if (params.has('code')) { editor.value = params.get('code'); session.setSource(editor.value); }
if (params.get('solve') === '1') {
  editor.value = LEVELS[start].solution;
  session.setSource(editor.value);
  session.setSpeed('instant');
  session.run();
} else if (params.get('run') === '1') session.step();
else if (params.get('run') === 'all') { session.setSpeed('instant'); session.run(); }
render(); dirty = false; // first paint without waiting for a frame
requestAnimationFrame(frame);
