// Browser entry point (Day 1 prototype UI).
import { LEVELS } from '../game/levels.js';
import { World } from '../world/world.js';
import { compileSource } from '../lang/compiler.js';
import { VM } from '../lang/vm.js';
import { draw } from './render.js';

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');
const editor = $('editor');
const statusEl = $('status');

let level = LEVELS[0];
let world, vm, timer = null, bump = null, done = false;

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

function reset() {
  clearInterval(timer); timer = null;
  world = new World(level); vm = null; bump = null; done = false;
  draw(ctx, world);
  setStatus('Ready.');
}

function loadLevel(i) {
  level = LEVELS[i];
  $('brief').textContent = level.brief;
  editor.value = localStorage.getItem(`ferrolab.draft.${level.id}`) ?? '';
  reset();
}

function ensureVM() {
  if (vm) return true;
  reset();
  try {
    vm = new VM(compileSource(editor.value), world);
    return true;
  } catch (e) {
    setStatus(e.message, 'error');
    return false;
  }
}

/** Advance one tick; returns false when the run is over. */
function advance() {
  const ev = vm.tick();
  const last = world.log[world.log.length - 1];
  if (ev.type === 'error') {
    if (last && last.type === 'bump') bump = last;
    draw(ctx, world, { bump });
    setStatus(ev.error.message, 'error');
    return false;
  }
  draw(ctx, world);
  if (world.isWon()) { setStatus(`Level complete in ${vm.ticks} steps!`, 'win'); return false; }
  if (ev.type === 'halt') { setStatus('Program finished, but the job is not done yet.', 'error'); return false; }
  setStatus(`Step ${vm.ticks} — line ${ev.line}`);
  return true;
}

function finish() { clearInterval(timer); timer = null; done = true; }

$('run').onclick = () => {
  if (done) reset();
  if (!ensureVM()) return;
  clearInterval(timer);
  timer = setInterval(() => { if (!advance()) finish(); }, 250);
};
$('step').onclick = () => {
  if (done) reset();
  clearInterval(timer); timer = null;
  if (!ensureVM()) return;
  if (!advance()) finish();
};
$('stop').onclick = reset;
editor.addEventListener('input', () => {
  localStorage.setItem(`ferrolab.draft.${level.id}`, editor.value);
  if (vm) reset();
});

const sel = $('level-select');
LEVELS.forEach((l, i) => sel.add(new Option(`${i + 1}. ${l.name}`, i)));
sel.onchange = () => loadLevel(Number(sel.value));
loadLevel(0);
