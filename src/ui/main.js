// Browser entry point (prototype UI; the full game shell arrives on Day 4).
import { LEVELS } from '../game/levels.js';
import { World } from '../world/world.js';
import { Runner } from '../game/run.js';
import { formatError } from '../lang/errors.js';
import { draw } from './render.js';

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');
const editor = $('editor');
const statusEl = $('status');

let level = LEVELS[0];
let world, runner, timer = null, bump = null, done = false;

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

function reset() {
  clearInterval(timer); timer = null;
  world = new World(level); runner = null; bump = null; done = false;
  draw(ctx, world);
  setStatus('Ready.');
}

function loadLevel(i) {
  level = LEVELS[i];
  $('brief').textContent = level.brief;
  editor.value = localStorage.getItem(`ferrolab.draft.${level.id}`) ?? '';
  reset();
}

/** Show an error with its source snippet and select the offending text. */
function showError(err) {
  setStatus(formatError(editor.value, err), 'error');
  if (!err.line) return;
  const lines = editor.value.split('\n');
  let start = 0;
  for (let i = 0; i < err.line - 1; i++) start += lines[i].length + 1;
  const lineLen = (lines[err.line - 1] || '').length;
  const from = start + (err.col ? err.col - 1 : 0);
  const to = err.col ? from + err.length : start + lineLen;
  editor.focus();
  editor.setSelectionRange(from, to);
}

function ensureRunner() {
  if (runner) return true;
  reset();
  runner = new Runner(editor.value, level);
  world = runner.world;
  if (runner.done) { showError(runner.error); done = true; return false; }
  return true;
}

/** Advance one tick; returns false when the run is over. */
function advance() {
  const ev = runner.tick();
  const last = world.log[world.log.length - 1];
  if (ev.type !== 'end') {
    draw(ctx, world);
    setStatus(`Step ${runner.ticks} — line ${ev.line}`);
    return true;
  }
  if (ev.error && last && last.type === 'bump') bump = last;
  draw(ctx, world, { bump });
  if (ev.result === 'win') setStatus(`Level complete in ${runner.ticks} steps!`, 'win');
  else if (ev.result === 'fail') setStatus('Program finished, but the job is not done yet.', 'error');
  else showError(ev.error);
  return false;
}

function finish() { clearInterval(timer); timer = null; done = true; }

$('run').onclick = () => {
  if (done) reset();
  if (!ensureRunner()) return;
  clearInterval(timer);
  timer = setInterval(() => { if (!advance()) finish(); }, 250);
};
$('step').onclick = () => {
  if (done) reset();
  clearInterval(timer); timer = null;
  if (!ensureRunner()) return;
  if (!advance()) finish();
};
$('stop').onclick = reset;
editor.addEventListener('input', () => {
  localStorage.setItem(`ferrolab.draft.${level.id}`, editor.value);
  if (runner) reset();
});

const sel = $('level-select');
LEVELS.forEach((l, i) => sel.add(new Option(`${i + 1}. ${l.name}`, i)));
sel.onchange = () => loadLevel(Number(sel.value));
// ?level=N (1-based) opens a level directly — handy for testing.
const start = Math.min(LEVELS.length, Math.max(1, Number(new URLSearchParams(location.search).get('level')) || 1)) - 1;
sel.value = String(start);
loadLevel(start);
if (new URLSearchParams(location.search).get('run') === '1') $('step').click();
