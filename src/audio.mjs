// The same four-voice APU as the other three.
//
// The sound that matters here is the DISCHARGE. The room is on a ten-second power cycle, and the
// player's whole plan is timed against it — so the bank has to be audible without being looked at:
// a hum that holds, sags over the last second and a half, and dies. If you can hear how long you
// have, you can keep your eyes on the room.

const A4 = 440;
const note = (n) => A4 * Math.pow(2, (n - 69) / 12);
const CPU = 1789773;
const nesPitch = (hz) => {
  const p = Math.max(8, Math.min(0x7ff, Math.round(CPU / (16 * hz) - 1)));
  return CPU / (16 * (p + 1));
};

let ctx = null, master = null, started = false, muted = false, noiseBuf = null, shortBuf = null;
const waves = new Map();
try { muted = localStorage.getItem('latch.mute') === '1'; } catch { muted = false; }

function pulseWave(duty) {
  if (waves.has(duty)) return waves.get(duty);
  const n = 32, real = new Float32Array(n), imag = new Float32Array(n);
  for (let i = 1; i < n; i++) imag[i] = (2 / (i * Math.PI)) * Math.sin(Math.PI * i * duty);
  const w = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  waves.set(duty, w);
  return w;
}

function makeNoise(short) {
  const len = short ? 1024 : ctx.sampleRate;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let reg = 1;
  for (let i = 0; i < len; i++) {
    const bit = (reg ^ (reg >> (short ? 6 : 1))) & 1;
    reg = (reg >> 1) | (bit << 14);
    d[i] = (reg & 1) ? 0.6 : -0.6;
  }
  return b;
}

export function start() {
  // re-arm on every gesture: WebKit's 'interrupted' state can only be left from one
  if (started) { if (ctx && ctx.state !== 'running') ctx.resume(); return; }
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.25;
  master.connect(ctx.destination);
  noiseBuf = makeNoise(false);
  shortBuf = makeNoise(true);
  started = true;
  if (ctx.state === 'suspended') ctx.resume();
  room();
  music.start();
}

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('latch.mute', muted ? '1' : '0'); } catch {}
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.25, ctx.currentTime, 0.008);
  return muted;
}
export const isMuted = () => muted;

function tone({ hz, duty = 0.5, at = 0, dur = 0.1, vol = 0.2, type = 'pulse', slideTo = null, steps = 1 }) {
  if (!started || muted) return;
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  if (type === 'tri') o.type = 'triangle'; else o.setPeriodicWave(pulseWave(duty));
  if (slideTo && steps > 1) {
    for (let i = 0; i < steps; i++) {
      o.frequency.setValueAtTime(nesPitch(hz + (slideTo - hz) * (i / (steps - 1))), t0 + (dur * i) / steps);
    }
  } else o.frequency.setValueAtTime(nesPitch(hz), t0);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.004);
  g.gain.setValueAtTime(vol, t0 + Math.max(0.006, dur * 0.5));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
  o.onended = () => { try { o.disconnect(); g.disconnect(); } catch {} };
}

function noise({ at = 0, dur = 0.08, vol = 0.25, short = false, filter = 0 }) {
  if (!started || muted) return;
  const t0 = ctx.currentTime + at;
  const s = ctx.createBufferSource();
  s.buffer = short ? shortBuf : noiseBuf;
  s.loop = true;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let tail = g;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = filter; f.Q.value = 1.3;
    g.connect(f); tail = f;
  }
  s.connect(g); tail.connect(master);
  s.start(t0); s.stop(t0 + dur + 0.02);
  s.onended = () => { try { s.disconnect(); g.disconnect(); if (tail !== g) tail.disconnect(); } catch {} };
}

/** Under everything: water against the legs of the rig. */
let roomGain = null;
function room() {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 220;
  const g = ctx.createGain();
  g.gain.value = 0.014;
  s.connect(f); f.connect(g); g.connect(master);
  s.start();
  roomGain = g;
}

export const sfx = {
  /** The bank fires. A low thump and the hum coming up underneath it. */
  discharge() {
    if (!started) return;
    tone({ hz: note(29), type: 'tri', dur: 0.5, vol: 0.4 });
    tone({ hz: note(41), duty: 0.5, dur: 0.18, vol: 0.16, slideTo: note(53), steps: 6 });
    noise({ dur: 0.22, vol: 0.2, filter: 420 });
  },

  /** A plate taking weight. Short, mechanical, and the most-heard sound in the game. */
  plate() {
    noise({ dur: 0.035, vol: 0.16, short: true, filter: 3200 });
    tone({ hz: note(69), duty: 0.25, dur: 0.05, vol: 0.12 });
  },
  /** And coming off it, a tone lower, so you can hear a signal drop without looking. */
  plateOff() {
    noise({ dur: 0.03, vol: 0.1, short: true, filter: 2000 });
    tone({ hz: note(62), duty: 0.25, dur: 0.05, vol: 0.09 });
  },

  /** A door retracting into its frame. */
  door() {
    noise({ dur: 0.16, vol: 0.14, filter: 900 });
    tone({ hz: note(50), duty: 0.125, dur: 0.14, vol: 0.1, slideTo: note(62), steps: 5 });
  },
  shut() {
    noise({ dur: 0.1, vol: 0.14, filter: 600 });
    tone({ hz: note(55), duty: 0.125, dur: 0.1, vol: 0.09, slideTo: note(43), steps: 4 });
  },

  /** Steel on deck plating. */
  push() { noise({ dur: 0.07, vol: 0.12, filter: 1500 }); },
  step() { noise({ dur: 0.018, vol: 0.05, filter: 1100 }); },
  bump() { noise({ dur: 0.04, vol: 0.09, filter: 700 }); },

  /** The last second and a half: the bank sagging. */
  dying() {
    tone({ hz: note(41), type: 'tri', dur: 1.4, vol: 0.3, slideTo: note(29), steps: 10 });
  },

  /** The core takes. Everything the room has been building to, in one chord. */
  core() {
    [0, 7, 12, 19, 24].forEach((n, i) => {
      tone({ hz: note(53 + n), duty: 0.5, dur: 0.5 - i * 0.05, vol: 0.17, at: i * 0.07 });
      tone({ hz: note(29 + n), type: 'tri', dur: 0.7, vol: 0.3, at: i * 0.07 });
    });
    noise({ dur: 0.3, vol: 0.12, filter: 2400 });
  },

  /** Out of discharges. Not a failure sting — the room simply starts again. */
  spent() {
    tone({ hz: note(45), type: 'tri', dur: 0.6, vol: 0.3, slideTo: note(33), steps: 6 });
    noise({ dur: 0.3, vol: 0.12, filter: 300 });
  },
  select() { tone({ hz: note(72), duty: 0.25, dur: 0.04, vol: 0.12 }); },
};

// -------------------------------------------------------------------------------------------
// The hum.
//
// Not a tune. A capacitor bank holding, which rises when it fires and sags as it runs down — so
// the ten-second clock is audible without being looked at. `setCharge` is driven straight from how
// much of the discharge is left.
// -------------------------------------------------------------------------------------------
let humOsc = null, humGain = null, humSub = null;

export const music = {
  charge: 1,

  /**
   * Bring the hum up. Safe to call again after `stop()`.
   *
   * `stop()` nulls the oscillators, and nothing ever started them again: `audio.start()` returns
   * early once the context exists, and `setCharge` bails when there is no oscillator. So finishing
   * the game killed the capacitor-bank hum for the rest of the session — and the hum is how the
   * ten-second clock is audible without being looked at.
   */
  start() {
    if (!started || humOsc) return;
    humOsc = ctx.createOscillator();
    humOsc.setPeriodicWave(pulseWave(0.5));
    humOsc.frequency.value = nesPitch(note(41));
    humGain = ctx.createGain();
    humGain.gain.value = 0.05;
    humOsc.connect(humGain); humGain.connect(master);
    humOsc.start();

    humSub = ctx.createOscillator();
    humSub.type = 'triangle';
    humSub.frequency.value = nesPitch(note(29));
    const g2 = ctx.createGain();
    g2.gain.value = 0.1;
    humSub.connect(g2); g2.connect(master);
    humSub.start();
    humSub.gainNode = g2;
  },

  stop() {
    for (const o of [humOsc, humSub]) {
      if (!o) continue;
      try { o.stop(); o.disconnect(); } catch {}
    }
    try { humGain?.disconnect(); humSub?.gainNode?.disconnect(); } catch {}
    humOsc = null; humGain = null; humSub = null;
  },

  /** 1 at the start of a discharge, 0 as it dies. */
  setCharge(c) {
    this.charge = Math.max(0, Math.min(1, c));
    if (!started || !humOsc) return;
    const sag = 0.55 + this.charge * 0.45;
    humOsc.frequency.setTargetAtTime(nesPitch(note(41) * sag), ctx.currentTime, 0.08);
    humSub.frequency.setTargetAtTime(nesPitch(note(29) * sag), ctx.currentTime, 0.08);
    humGain.gain.setTargetAtTime(0.02 + this.charge * 0.045, ctx.currentTime, 0.1);
  },

  reset() { this.setCharge(1); },
};

export function suspend() { if (started && ctx.state === 'running') ctx.suspend(); }
export function resume() { if (started && ctx.state !== 'running') ctx.resume(); }
