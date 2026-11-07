// Synthesized sound for the game: every effect is made from oscillators and
// filtered noise at play time (no audio files). Host-agnostic: the AudioContext
// comes from a factory, so tests pass a stub and Node never needs WebAudio.
//
//   CUES          data: each cue is a list of voices (wave, pitch sweep, envelope)
//   cuesForEvents world.log events -> cue names (pure)
//   cueForResult  run result -> cue names (pure)
//   SoundCues     tracks a PlaySession like the Animator and returns new cues
//   Sound         the engine: lazy context, master volume, mute, ambient hum,
//                 per-cue rate limit and a voice cap
//
// Browsers only allow audio after a user gesture, so the context is created
// (or resumed) by unlock(), which the page calls on the first click/key.

/**
 * Voice fields: wave ('sine'|'square'|'triangle'|'sawtooth'|'noise'),
 * f (Hz), f2 (Hz at the end, optional sweep), at (start offset s),
 * dur (s), gain (peak, 0..1), q/filter (noise: band-pass centre Hz).
 */
export const CUES = {
  step: [{ wave: 'triangle', f: 180, f2: 140, dur: 0.06, gain: 0.18 }, { wave: 'noise', filter: 2400, dur: 0.03, gain: 0.05 }],
  turn: [{ wave: 'square', f: 420, f2: 520, dur: 0.05, gain: 0.06 }],
  wait: [{ wave: 'sine', f: 300, dur: 0.08, gain: 0.06 }],
  bump: [{ wave: 'square', f: 90, f2: 45, dur: 0.18, gain: 0.25 }, { wave: 'noise', filter: 500, dur: 0.12, gain: 0.25 }],
  grab: [{ wave: 'square', f: 660, f2: 990, dur: 0.07, gain: 0.08 }, { wave: 'noise', filter: 5000, dur: 0.02, gain: 0.06 }],
  drop: [{ wave: 'triangle', f: 520, f2: 260, dur: 0.09, gain: 0.14 }],
  deliver: [{ wave: 'triangle', f: 523, dur: 0.08, gain: 0.14 }, { wave: 'triangle', f: 784, at: 0.07, dur: 0.12, gain: 0.14 }],
  break: [{ wave: 'sine', f: 880, dur: 0.07, gain: 0.12 }, { wave: 'sine', f: 660, at: 0.08, dur: 0.1, gain: 0.12 }],
  win: [
    { wave: 'square', f: 523, dur: 0.1, gain: 0.08 }, { wave: 'square', f: 659, at: 0.09, dur: 0.1, gain: 0.08 },
    { wave: 'square', f: 784, at: 0.18, dur: 0.1, gain: 0.08 }, { wave: 'triangle', f: 1047, at: 0.27, dur: 0.35, gain: 0.16 },
  ],
  star: [{ wave: 'sine', f: 1568, f2: 2093, dur: 0.12, gain: 0.1 }],
  fail: [{ wave: 'sawtooth', f: 220, f2: 150, dur: 0.25, gain: 0.08 }, { wave: 'sawtooth', f: 165, f2: 110, at: 0.2, dur: 0.35, gain: 0.08 }],
  error: [{ wave: 'square', f: 110, dur: 0.12, gain: 0.12 }, { wave: 'square', f: 110, at: 0.16, dur: 0.12, gain: 0.12 }],
  click: [{ wave: 'square', f: 1200, dur: 0.02, gain: 0.04 }],
};

/** Action cues are skipped at speeds faster than this (ms per tick): too many to hear. */
export const ACTION_CUE_MIN_MS = 100;
/** The same cue never starts twice within this many seconds. */
export const MIN_GAP = 0.04;
/** At most this many voices sound at once; extra cues are dropped. */
export const MAX_VOICES = 12;
/** Star chimes after a win: first one this long after the fanfare, then every STAR_GAP. */
export const STAR_DELAY = 0.45;
export const STAR_GAP = 0.14;

const EVENT_CUE = { move: 'step', turn: 'turn', wait: 'wait', bump: 'bump', grab: 'grab' };

/**
 * Cues for new world.log events. At fast speeds only a bump is voiced (it
 * ends the run, so it's worth hearing); several events in one go keep only
 * the last one of each kind.
 */
export function cuesForEvents(events, speedMs) {
  const out = [];
  for (const e of events) {
    const cue = e.type === 'drop' ? (e.bin ? 'deliver' : 'drop') : EVENT_CUE[e.type];
    if (!cue) continue;
    if (speedMs < ACTION_CUE_MIN_MS && cue !== 'bump') continue;
    const i = out.indexOf(cue);
    if (i >= 0) out.splice(i, 1);
    out.push(cue);
  }
  return out;
}

/** Cues for a finished run: [{cue, at}] (at = delay in seconds). 'stopped' is silent. */
export function cueForResult(result) {
  if (!result) return [];
  switch (result.result) {
    case 'win': {
      const stars = result.score ? result.score.stars : 1;
      const out = [{ cue: 'win', at: 0 }];
      for (let i = 0; i < stars; i++) out.push({ cue: 'star', at: STAR_DELAY + i * STAR_GAP });
      return out;
    }
    case 'error': return [{ cue: result.error && !result.ticks ? 'error' : 'fail', at: 0 }];
    case 'stopped': return [];
    default: return [{ cue: 'fail', at: 0 }]; // fail, timeout, loop, calibration failed
  }
}

/**
 * Watches a PlaySession (world log, result, breakpoint pauses) and reports
 * what to play since the last call. A new world (reset / new run / other
 * level) starts silently from where it is.
 */
export class SoundCues {
  constructor() { this.world = null; this.result = null; this.atBreak = 0; }

  /** @returns {{cue: string, at: number}[]} */
  sync(session) {
    const out = [];
    const w = session.world;
    if (w !== this.world) { this.world = w; this.seen = 0; } // a fresh world's log starts empty (Step may have acted already)
    if (w.log.length > this.seen) {
      // a bump is already voiced as the action that ended the run
      for (const cue of cuesForEvents(w.log.slice(this.seen), session.speed.ms)) out.push({ cue, at: 0 });
      this.seen = w.log.length;
    }
    if (session.result !== this.result) {
      this.result = session.result;
      const bumped = out.some((c) => c.cue === 'bump');
      for (const c of cueForResult(session.result)) {
        if (bumped && c.cue === 'fail') continue; // the bump says it already
        out.push(c);
      }
    }
    if (session.atBreak && session.atBreak !== this.atBreak) out.push({ cue: 'break', at: 0 });
    this.atBreak = session.atBreak;
    return out;
  }
}

/** Default settings; the page stores them with SaveStore.setSetting. */
export const SOUND_DEFAULTS = { volume: 0.6, muted: false, hum: true };

/** Clamp a stored volume to 0..1 (anything odd falls back to the default). */
export function cleanVolume(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : SOUND_DEFAULTS.volume;
}

/** Master gain actually applied: perceptual (squared) curve, 0 when muted. */
export function masterLevel(volume, muted) {
  return muted ? 0 : cleanVolume(volume) ** 2;
}

const HUM_LEVEL = 0.05;

export class Sound {
  /**
   * @param {{createContext?: () => AudioContext|null, volume?: number, muted?: boolean, hum?: boolean}} [opt]
   * createContext defaults to window.AudioContext (null when there is none).
   */
  constructor({ createContext = defaultContext, volume, muted, hum } = {}) {
    this.createContext = createContext;
    this.ctx = null;
    this.failed = false; // no WebAudio here: stay silent, never throw
    this.volume = cleanVolume(volume ?? SOUND_DEFAULTS.volume);
    this.muted = muted ?? SOUND_DEFAULTS.muted;
    this.humOn = hum ?? SOUND_DEFAULTS.hum;
    this.humNodes = null;
    this.lastStart = new Map(); // cue -> ctx time it last started
    this.voices = []; // end times of sounding voices
    this.noiseBuf = null;
  }

  /** Create/resume the context (call from a user gesture). Returns true if audio works. */
  unlock() {
    if (this.failed) return false;
    if (!this.ctx) {
      try { this.ctx = this.createContext(); } catch { this.ctx = null; }
      if (!this.ctx) { this.failed = true; return false; }
      this.master = this.ctx.createGain();
      this.master.gain.value = masterLevel(this.volume, this.muted);
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume().catch?.(() => {});
    this.updateHum();
    return true;
  }

  get ready() { return !!this.ctx; }

  setVolume(v) { this.volume = cleanVolume(v); this.applyLevel(); }
  setMuted(m) { this.muted = !!m; this.applyLevel(); this.updateHum(); }
  setHum(on) { this.humOn = !!on; this.updateHum(); }

  applyLevel() {
    if (!this.ctx) return;
    const g = this.master.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(masterLevel(this.volume, this.muted), t + 0.05);
  }

  /** Pause/resume everything (e.g. tab hidden). */
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  /**
   * Play a cue `at` seconds from now. Returns the number of voices started
   * (0 when muted, not unlocked, rate-limited or over the voice cap).
   */
  play(name, at = 0) {
    const spec = CUES[name];
    if (!spec) throw new Error(`unknown sound cue '${name}'`);
    if (!this.ctx || this.muted || this.volume === 0) return 0;
    const now = this.ctx.currentTime;
    const t0 = now + Math.max(0, at);
    const prev = this.lastStart.get(name);
    if (prev !== undefined && Math.abs(t0 - prev) < MIN_GAP) return 0;
    this.voices = this.voices.filter((end) => end > now);
    if (this.voices.length + spec.length > MAX_VOICES) return 0;
    this.lastStart.set(name, t0);
    for (const v of spec) this.voice(v, t0 + (v.at || 0));
    return spec.length;
  }

  /** Play a list from SoundCues.sync. */
  playAll(cues) { let n = 0; for (const c of cues) n += this.play(c.cue, c.at); return n; }

  voice(v, t) {
    const ctx = this.ctx;
    const env = ctx.createGain();
    const end = t + v.dur;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v.gain, t + Math.min(0.005, v.dur / 4));
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    let src;
    if (v.wave === 'noise') {
      src = ctx.createBufferSource();
      src.buffer = this.noise();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = v.filter || 1000;
      bp.Q.value = v.q || 1.5;
      src.connect(bp); bp.connect(env);
    } else {
      src = ctx.createOscillator();
      src.type = v.wave;
      src.frequency.setValueAtTime(v.f, t);
      if (v.f2) src.frequency.exponentialRampToValueAtTime(v.f2, end);
      src.connect(env);
    }
    env.connect(this.master);
    src.start(t);
    src.stop(end + 0.02);
    this.voices.push(end);
  }

  /** 0.5 s of white noise, made once. */
  noise() {
    if (!this.noiseBuf) {
      const n = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      let seed = 1234567; // fixed seed: same hiss every time, no Math.random in tests
      for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) >>> 0; d[i] = (seed / 2 ** 31) - 1; }
    }
    return this.noiseBuf;
  }

  /** Ambient factory hum: two detuned low saws through a slowly wobbling low-pass. */
  updateHum() {
    const want = !!this.ctx && this.humOn && !this.muted;
    if (want && !this.humNodes) {
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(HUM_LEVEL, t + 1.5);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 220;
      lp.Q.value = 4;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.13;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 80;
      lfo.connect(lfoAmt); lfoAmt.connect(lp.frequency);
      const oscs = [55, 55.4, 110.3].map((f, i) => {
        const o = ctx.createOscillator();
        o.type = i === 2 ? 'sine' : 'sawtooth';
        o.frequency.value = f;
        o.connect(lp);
        return o;
      });
      lp.connect(out); out.connect(this.master);
      for (const o of [...oscs, lfo]) o.start(t);
      this.humNodes = { out, oscs: [...oscs, lfo] };
    } else if (!want && this.humNodes) {
      const { out, oscs } = this.humNodes;
      this.humNodes = null;
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + 0.3);
      for (const o of oscs) o.stop(t + 0.35);
    }
  }

  get humming() { return !!this.humNodes; }
}

function defaultContext() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  return AC ? new AC() : null;
}
