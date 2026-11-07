// Sound module, tested with a stub AudioContext that records every node.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUES, Sound, SoundCues, cuesForEvents, cueForResult, masterLevel, cleanVolume,
  MAX_VOICES, MIN_GAP, SOUND_DEFAULTS,
} from '../src/ui/audio.js';
import { PlaySession } from '../src/game/session.js';
import { LEVELS } from '../src/game/levels.js';
import { SaveStore, MemoryStorage } from '../src/game/save.js';

class Param {
  constructor(v = 0) { this.value = v; this.calls = []; }
  setValueAtTime(v, t) { this.calls.push(['set', v, t]); this.value = v; }
  linearRampToValueAtTime(v, t) { this.calls.push(['lin', v, t]); this.value = v; }
  exponentialRampToValueAtTime(v, t) {
    if (!(v > 0)) throw new RangeError('exponential ramp needs a positive value');
    this.calls.push(['exp', v, t]); this.value = v;
  }
  cancelScheduledValues(t) { this.calls.push(['cancel', t]); }
}
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.out = []; ctx.nodes.push(this); }
  connect(n) { this.out.push(n); return n; }
}
class StubContext {
  constructor({ state = 'suspended' } = {}) {
    this.nodes = []; this.currentTime = 10; this.sampleRate = 8000; this.state = state;
    this.destination = { kind: 'destination' }; this.resumed = 0;
  }
  createGain() { const n = new Node(this, 'gain'); n.gain = new Param(1); return n; }
  createOscillator() {
    const n = new Node(this, 'osc'); n.frequency = new Param(440); n.type = 'sine';
    n.start = (t) => { n.started = t; }; n.stop = (t) => { n.stopped = t; };
    return n;
  }
  createBufferSource() {
    const n = new Node(this, 'buffer'); n.start = (t) => { n.started = t; }; n.stop = (t) => { n.stopped = t; };
    return n;
  }
  createBiquadFilter() { const n = new Node(this, 'filter'); n.frequency = new Param(350); n.Q = new Param(1); return n; }
  createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
  resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}

/** Does node `n` eventually reach the destination? */
function reaches(n, dest, seen = new Set()) {
  if (n === dest) return true;
  if (seen.has(n) || !n.out) return false;
  seen.add(n);
  return n.out.some((m) => reaches(m, dest, seen));
}

const make = (opt = {}) => {
  const ctx = new StubContext();
  let made = 0;
  const s = new Sound({ createContext: () => { made++; return ctx; }, hum: false, ...opt });
  return { s, ctx, made: () => made };
};

test('cue table is well-formed', () => {
  const waves = new Set(['sine', 'square', 'triangle', 'sawtooth', 'noise']);
  for (const [name, voices] of Object.entries(CUES)) {
    assert.ok(voices.length > 0 && voices.length <= 4, name);
    for (const v of voices) {
      assert.ok(waves.has(v.wave), `${name}: wave ${v.wave}`);
      assert.ok(v.dur > 0 && v.dur <= 0.5, `${name}: dur`);
      assert.ok(v.gain > 0 && v.gain <= 0.3, `${name}: gain (keeps the mix from clipping)`);
      if (v.wave !== 'noise') assert.ok(v.f >= 20 && v.f <= 5000 && (!v.f2 || v.f2 > 0), `${name}: pitch`);
    }
  }
});

test('no context until unlock; unlock resumes a suspended context once created', () => {
  const { s, ctx, made } = make();
  assert.equal(s.play('step'), 0);
  assert.equal(made(), 0);
  assert.equal(s.unlock(), true);
  assert.equal(made(), 1);
  assert.equal(ctx.resumed, 1);
  s.unlock();
  assert.equal(made(), 1, 'context is created only once');
  assert.ok(reaches(s.master, ctx.destination));
});

test('without WebAudio the engine stays silent and never throws', () => {
  for (const createContext of [() => null, () => { throw new Error('blocked'); }]) {
    const s = new Sound({ createContext });
    assert.equal(s.unlock(), false);
    assert.equal(s.play('win'), 0);
    s.setVolume(0.3); s.setMuted(true); s.setHum(true); s.suspend(); s.resume();
    assert.equal(s.ready, false);
  }
});

test('playing a cue builds one source per voice, all routed through the master gain', () => {
  const { s, ctx } = make();
  s.unlock();
  const before = ctx.nodes.length;
  assert.equal(s.play('step'), CUES.step.length);
  const fresh = ctx.nodes.slice(before);
  const sources = fresh.filter((n) => n.kind === 'osc' || n.kind === 'buffer');
  assert.equal(sources.length, CUES.step.length);
  for (const src of sources) {
    assert.ok(reaches(src, s.master), 'source reaches master');
    assert.ok(src.started >= ctx.currentTime && src.stopped > src.started);
  }
  const osc = sources.find((n) => n.kind === 'osc');
  assert.equal(osc.type, 'triangle');
  assert.deepEqual(osc.frequency.calls[0], ['set', 180, 10]);
  assert.deepEqual(osc.frequency.calls[1].slice(0, 2), ['exp', 140]);
  assert.ok(fresh.some((n) => n.kind === 'filter' && n.type === 'bandpass'), 'noise is band-passed');
  // a delayed cue starts later
  ctx.currentTime = 20;
  s.play('win', 0.5);
  const winOsc = ctx.nodes.filter((n) => n.kind === 'osc').at(-4);
  assert.equal(winOsc.started, 20.5);
  assert.throws(() => s.play('nope'), /unknown sound cue/);
});

test('every cue plays on a stub without errors', () => {
  const { s, ctx } = make();
  s.unlock();
  for (const name of Object.keys(CUES)) { ctx.currentTime += 1; assert.ok(s.play(name) > 0, name); }
});

test('rate limit and voice cap', () => {
  const { s, ctx } = make();
  s.unlock();
  assert.ok(s.play('turn') > 0);
  assert.equal(s.play('turn'), 0, 'same cue within MIN_GAP is dropped');
  assert.ok(s.play('grab') > 0, 'other cues still play');
  ctx.currentTime += MIN_GAP + 0.001;
  assert.ok(s.play('turn') > 0);
  // fill up the voices with delayed cues that haven't ended
  let total = 0;
  for (let i = 0; i < 40; i++) total += s.play('click', i * 0.05);
  const sounding = s.voices.length;
  assert.ok(sounding <= MAX_VOICES, `${sounding} voices`);
  assert.ok(total < 40, 'some clicks were dropped');
  ctx.currentTime += 5; // everything has ended
  assert.ok(s.play('win') > 0, 'room again once voices end');
});

test('volume, mute and the master level', () => {
  assert.equal(masterLevel(0.5, false), 0.25);
  assert.equal(masterLevel(1, true), 0);
  assert.equal(cleanVolume(7), 1);
  assert.equal(cleanVolume(-1), 0);
  assert.equal(cleanVolume('loud'), SOUND_DEFAULTS.volume);
  const { s, ctx } = make({ volume: 0.5 });
  s.unlock();
  assert.equal(s.master.gain.value, 0.25);
  s.setVolume(1);
  assert.equal(s.master.gain.value, 1);
  assert.equal(s.master.gain.calls.at(-1)[0], 'lin', 'volume changes ramp (no clicks)');
  s.setMuted(true);
  assert.equal(s.master.gain.value, 0);
  const n = ctx.nodes.length;
  assert.equal(s.play('win'), 0, 'muted: no nodes are made at all');
  assert.equal(ctx.nodes.length, n);
  s.setMuted(false);
  s.setVolume(0);
  assert.equal(s.play('win'), 0, 'volume 0 also skips work');
});

test('ambient hum follows the hum setting and mute, and fades out', () => {
  const { s, ctx } = make({ hum: true });
  assert.equal(s.humming, false, 'no hum before unlock');
  s.unlock();
  assert.equal(s.humming, true);
  const { out, oscs } = s.humNodes;
  assert.ok(reaches(out, ctx.destination));
  assert.ok(oscs.every((o) => o.started !== undefined && o.stopped === undefined));
  s.unlock();
  assert.equal(s.humNodes.out, out, 'unlock twice does not start a second hum');
  s.setMuted(true);
  assert.equal(s.humming, false);
  assert.ok(oscs.every((o) => o.stopped > ctx.currentTime), 'stopped after a fade');
  assert.deepEqual(out.gain.calls.at(-1).slice(0, 2), ['lin', 0]);
  s.setMuted(false);
  assert.equal(s.humming, true);
  s.setHum(false);
  assert.equal(s.humming, false);
  s.suspend();
  assert.equal(ctx.state, 'suspended');
  s.resume();
  assert.equal(ctx.state, 'running');
});

test('world events map to cues; fast speeds only voice bumps', () => {
  const ev = [{ type: 'move' }, { type: 'turn' }, { type: 'move' }, { type: 'grab' }, { type: 'drop', bin: false }, { type: 'drop', bin: true }];
  assert.deepEqual(cuesForEvents(ev, 300), ['turn', 'step', 'grab', 'drop', 'deliver']);
  assert.deepEqual(cuesForEvents([...ev, { type: 'bump' }], 30), ['bump']);
  assert.deepEqual(cuesForEvents([{ type: 'wait' }], 600), ['wait']);
  assert.deepEqual(cueForResult(null), []);
  assert.deepEqual(cueForResult({ result: 'stopped' }), []);
  assert.deepEqual(cueForResult({ result: 'win', score: { stars: 2 } }).map((c) => c.cue), ['win', 'star', 'star']);
  assert.deepEqual(cueForResult({ result: 'fail' }).map((c) => c.cue), ['fail']);
  assert.deepEqual(cueForResult({ result: 'error', ticks: 0, error: { message: 'x' } }).map((c) => c.cue), ['error']);
  assert.deepEqual(cueForResult({ result: 'timeout' }).map((c) => c.cue), ['fail']);
});

test('SoundCues follows a real PlaySession: steps, win fanfare with stars, silence on reset', () => {
  const level = LEVELS[0];
  const s = new PlaySession(level, { speed: 'normal' });
  s.setSource(level.solution);
  const cues = new SoundCues();
  assert.deepEqual(cues.sync(s), [], 'a fresh board is silent');
  s.step();
  assert.deepEqual(cues.sync(s).map((c) => c.cue), ['step']);
  assert.deepEqual(cues.sync(s), [], 'nothing new, nothing played');
  s.setSpeed('instant');
  s.run();
  while (s.state === 'running') s.update(16);
  const end = cues.sync(s).map((c) => c.cue);
  assert.equal(end[0], 'win', 'instant speed skips the steps but keeps the fanfare');
  assert.equal(end.filter((c) => c === 'star').length, s.result.score.stars);
  s.reset();
  assert.deepEqual(cues.sync(s), [], 'reset is silent');
});

test('SoundCues: a bump replaces the fail cue; a breakpoint pause chimes once', () => {
  const level = LEVELS[1]; // 1-2: a wall ahead of Pip
  const s = new PlaySession(level, { speed: 'normal' });
  s.setSource('move 30');
  const cues = new SoundCues();
  cues.sync(s);
  s.setSpeed('turbo');
  s.run();
  while (s.state === 'running') s.update(1000);
  assert.deepEqual(cues.sync(s).map((c) => c.cue), ['bump']);
  s.reset();
  s.setSource(level.solution);
  s.setBreakpoints([1]);
  s.setSpeed('normal');
  s.run();
  s.update(0);
  assert.equal(s.atBreak, 1);
  assert.deepEqual(cues.sync(s).map((c) => c.cue), ['break']);
  assert.deepEqual(cues.sync(s), []);
});

test('sound settings persist through SaveStore and survive a progress reset', () => {
  const storage = new MemoryStorage();
  const save = new SaveStore(storage);
  save.setSetting('volume', 0.3);
  save.setSetting('muted', true);
  save.setSetting('hum', false);
  save.resetProgress();
  const again = new SaveStore(storage);
  const s = new Sound({
    createContext: () => new StubContext(),
    volume: again.setting('volume'), muted: again.setting('muted'), hum: again.setting('hum'),
  });
  assert.equal(s.volume, 0.3);
  assert.equal(s.muted, true);
  assert.equal(s.humOn, false);
  s.unlock();
  assert.equal(s.humming, false);
  assert.equal(s.master.gain.value, 0);
});
