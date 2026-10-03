// Boot, loop, scenes.

import { Screen, W, H, code } from './pixel.mjs';
import { CHARGED, DYING, FIRED, SETS, validate } from './palette.mjs';
import {
  newGame, step, reset, rewind, run, LOOP, TPS, CW, CELL,
  NONE, LEFT, RIGHT, UP, DOWN, ACT,
} from './sim.mjs';
import { LEVELS } from './levels.mjs';
import { draw, addShake, fx, OX, OY, abandonBox, drawAbandon } from './render.mjs';
import * as audio from './audio.mjs';

const DEV = location.search.includes('dev');
const CALM = matchMedia('(prefers-reduced-motion: reduce)');
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;
const imageData = ctx.createImageData(W, H);
const screen = new Screen();

let room = 0;
let state = newGame(LEVELS[0], 1);
let scene = 'title';
let elapsed = 0;
let paused = false;
let fired = 0;                      // ticks left on the whiteout when the core takes
const view = { held: NONE };
let note = null, noteT = 0;

// what was true last tick, so a change can be heard
let wasHigh = 0, wasOpen = 0, wasMoving = false;

const held = new Set();
const buffered = [];
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  Space: 'ok', Enter: 'ok',
  KeyM: 'mute', KeyR: 'restart', KeyP: 'pause', Backspace: 'rewind', KeyQ: 'rewind',
};

addEventListener('keydown', (e) => {
  const k = KEYMAP[e.code];
  if (!k) return;
  e.preventDefault();
  audio.start();
  held.add(k);
  if (k !== 'left' && k !== 'right' && k !== 'up' && k !== 'down') buffered.push(k);
}, { passive: false });

addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) held.delete(k);
}, { passive: false });

addEventListener('blur', () => held.clear());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { paused = true; audio.suspend(); }
  else { paused = false; audio.resume(); prev = null; acc = 0; }
});

// ---------------------------------------------------------------------------------------------
// Touch: the room is a grid, so the thumb gets a grid.
//
// A virtual stick would be the obvious thing and is wrong for a game whose unit of play is a plan:
// you tap WHERE IN THE ROOM you want to go, and the body walks there. The direction is recomputed
// every tick from where it currently is, so a tap survives doors opening and ghosts pushing crates.
// ---------------------------------------------------------------------------------------------
let walkTo = null;

canvas.addEventListener('pointerdown', (e) => {
  audio.start();
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W;
  const y = ((e.clientY - r.top) / r.height) * H;
  if (scene !== 'play') { buffered.push('ok'); return; }
  // the abandon button, and nothing else outside the room, because a stray thumb must not be able
  // to discard ten seconds of a plan
  const ab = abandonBox();
  if (x >= ab.x && x < ab.x + ab.w && y >= ab.y - 4 && y < ab.y + ab.h + 4) {
    buffered.push('rewind');
    return;
  }
  const cx = Math.floor((x - OX) / CELL), cy = Math.floor((y - OY) / CELL);
  if (cx < 0 || cy < 0 || cx >= CW || cy >= 16) return;
  walkTo = { x: cx, y: cy };
}, { passive: true });

/** One step of the direction that reduces the distance to where the thumb pointed. */
function towards(target) {
  const b = state.world.bodies[state.world.bodies.length - 1];
  if (!b) return NONE;
  if (b.x === target.x && b.y === target.y) { walkTo = null; return NONE; }
  // horizontal first, which matches how the rooms are laid out; if blocked, the body simply
  // stands still and the player taps somewhere else, which is honest
  if (b.x !== target.x) return b.x < target.x ? RIGHT : LEFT;
  return b.y < target.y ? DOWN : UP;
}

const DT_MS = 1000 / TPS;
let prev = null, acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (prev === null) { prev = now; return; }
  let ft = now - prev;
  prev = now;
  if (ft > 250) ft = 250;
  acc += ft;
  let steps = 0;
  while (acc >= DT_MS && steps < 5) { tick(); acc -= DT_MS; steps++; }
  if (steps === 5) acc = 0;
  elapsed += ft / 1000;
  render();
}

function tick() {
  const presses = buffered.splice(0, buffered.length);
  for (const k of presses) {
    if (k === 'mute') say(audio.toggleMute() ? 'sound off' : 'sound on');
    else if (k === 'pause' && scene === 'play') paused = !paused;
  }

  if (scene === 'title') {
    if (presses.includes('ok')) { scene = 'play'; audio.sfx.select(); audio.music.reset(); }
    return;
  }
  if (scene === 'done') {
    if (presses.includes('ok')) { scene = 'title'; room = 0; load(0); }
    return;
  }
  if (noteT > 0) noteT--;
  if (fired > 0) fired--;
  if (paused) return;

  if (presses.includes('restart')) { reset(state); walkTo = null; audio.sfx.spent(); say('room reset'); return; }
  if (presses.includes('rewind')) {
    rewind(state); walkTo = null; audio.sfx.spent();
    say('discharge abandoned');
    return;
  }

  if (state.over === 'win') {
    if (fired === 0) {
      room++;
      if (room >= LEVELS.length) { scene = 'done'; audio.music.stop(); return; }
      load(room);
    }
    return;
  }

  // a key beats a tap: if the player is holding a direction, the tap is forgotten
  let input = NONE;
  if (held.has('left')) input = LEFT;
  else if (held.has('right')) input = RIGHT;
  else if (held.has('up')) input = UP;
  else if (held.has('down')) input = DOWN;
  if (input !== NONE) walkTo = null;
  else if (walkTo) input = towards(walkTo);
  if (held.has('ok')) input |= ACT;

  const before = state.tapes.length;
  step(state, input);
  consume(before);
}

function consume(tapesBefore) {
  const w = state.world;

  // the bank, heard rather than read
  audio.music.setCharge(1 - state.live.length / LOOP);
  const left = LOOP - state.live.length;
  if (left === Math.round(TPS * 1.5)) audio.sfx.dying();

  if (state.tapes.length !== tapesBefore) {
    audio.sfx.discharge();
    if (!CALM.matches) addShake(0.6);
    walkTo = null;
    say(`discharge ${state.tapes.length + 1}`);
  }

  if (w.high.size !== wasHigh) {
    (w.high.size > wasHigh ? audio.sfx.plate : audio.sfx.plateOff)();
    wasHigh = w.high.size;
  }
  if (w.open.size !== wasOpen) {
    (w.open.size > wasOpen ? audio.sfx.door : audio.sfx.shut)();
    wasOpen = w.open.size;
  }

  const live = w.bodies[w.bodies.length - 1];
  if (live && live.moving && !wasMoving) audio.sfx.step();
  wasMoving = live ? live.moving : false;
  if (w.crates.some((c) => c.moving && c.sub === 1)) audio.sfx.push();

  if (state.over === 'win' && fired === 0) {
    fired = Math.round(TPS * 1.2);
    audio.sfx.core();
    if (!CALM.matches) addShake(1);
  }

  if (state.failed) {
    reset(state);
    walkTo = null;
    audio.sfx.spent();
    say('out of discharges');
  }
  state.events.length = 0;
}

function load(i) {
  state = newGame(LEVELS[i], i + 1);
  walkTo = null;
  fired = 0;
  wasHigh = 0; wasOpen = 0; wasMoving = false;
  audio.music.reset();
  say(LEVELS[i].name);
}

function say(text) { note = clip(text); noteT = 150; }

/** The widest string this screen can hold, in a font with no wrapping and no ellipsis of its own. */
const MAX_CHARS = Math.floor(W / 8) - 1;
const clip = (t) => (t.length > MAX_CHARS ? t.slice(0, MAX_CHARS - 1) + '\u2026' : t);

// ---------------------------------------------------------------------------------------------
function render() {
  // The ten-second clock IS the palette. No overlay, no dimming pass: the room is drawn once and
  // the colours it resolves through change, which is how the hardware this imitates would do it.
  const left = LOOP - state.live.length;
  const dying = left < TPS * 1.5;
  screen.setPalettes(fired > 0 ? FIRED : dying ? DYING : CHARGED, CHARGED);

  if (scene === 'title') { drawTitle(); screen.present(ctx, imageData); return; }
  if (scene === 'done') { drawDone(); screen.present(ctx, imageData); return; }

  draw(screen, state, view, elapsed);
  drawChrome();
  if (paused) panel(['paused', '', 'press p']);
  screen.present(ctx, imageData);
}

function drawChrome() {
  const lv = state.level;
  // Clipped, because `centre` does not wrap and does not shrink: a label one character too long
  // simply runs off both edges of the screen, which is what the first five of these did.
  screen.centre(6, clip(lv.name), code(2, 3));
  // The note takes the subtitle's place rather than being printed near it. Drawn just below, the
  // two lines overlapped and both became unreadable at exactly the moment the note mattered.
  if (noteT > 0) screen.centre(16, note, code(3, 3));
  else screen.centre(16, clip(lv.teaches), code(2, 2));

  const n = state.level.budget - state.tapes.length;
  const word = `${n} left`;
  screen.text(W - 8 - screen.textWidth(word), H - 12, word, code(2, 2));
  screen.text(8, H - 12, `room ${room + 1}/${LEVELS.length}`, code(2, 2));
  drawAbandon(screen, state.live.length > 0);
}

function drawTitle() {
  screen.clear(code(1, 1));
  // the bank: two plates and an arc between them, firing on the same ten-second cycle as the game
  const cy = 72;
  const at = elapsed % 2.6;
  const on = at > 0.3 && at < 2.2;
  screen.rect(W / 2 - 40, cy - 20, 10, 40, code(2, on ? 3 : 1));
  screen.rect(W / 2 + 30, cy - 20, 10, 40, code(2, on ? 3 : 1));
  if (on) {
    for (let x = W / 2 - 30; x < W / 2 + 30; x += 2) {
      const d = Math.abs(x - W / 2) / 30;
      screen.px(x, cy + Math.round(Math.sin(x * 0.7 + elapsed * 9) * 5 * (1 - d)), code(3, 3));
    }
    screen.lamp(W / 2, cy, 34);
  }

  screen.clearLit(0, 104, W, 136);
  screen.rect(0, 104, W, 136, code(1, 1));
  screen.centre(112, 'LATCH', code(3, 3));
  screen.centre(130, 'the light holds for ten seconds.', code(2, 3));
  screen.centre(140, 'so does everything you did', code(2, 3));
  screen.centre(150, 'in the last ten.', code(2, 3));

  if (Math.floor(elapsed * 2) % 2) screen.centre(172, 'press space', code(3, 3));
  screen.centre(192, 'arrows move', code(2, 2));
  screen.centre(202, 'q abandons the discharge', code(2, 2));
  screen.centre(212, 'r starts the room again', code(2, 2));
  screen.centre(226, 'on a phone, tap where to go', code(2, 2));
}

function drawDone() {
  screen.clear(code(1, 1));
  screen.centre(70, 'the station is yours', code(3, 3));
  screen.centre(92, 'every room, and every one of them', code(2, 3));
  screen.centre(102, 'in as few discharges as it takes.', code(2, 3));
  screen.centre(124, 'somewhere across the water', code(2, 2));
  screen.centre(134, 'a lighthouse is still burning,', code(2, 2));
  screen.centre(144, 'and someone is climbing it.', code(2, 2));
  if (Math.floor(elapsed * 2) % 2) screen.centre(176, 'press space', code(3, 3));
}

function panel(lines) {
  const h = lines.length * 10 + 16;
  const y = Math.round((H - h) / 2);
  screen.clearLit(20, y, W - 40, h);
  screen.rect(20, y, W - 40, h, code(1, 1));
  screen.hline(20, y, W - 40, code(2, 3));
  screen.hline(20, y + h - 1, W - 40, code(2, 3));
  lines.forEach((l, i) => screen.centre(y + 9 + i * 10, l.slice(0, 30), code(2, 3)));
}

function fit() {
  // Reserve the instruction line's REAL measured height. Fixed to the bottom of the window against
  // a canvas sized to innerHeight - 8, it printed across the game at five of fourteen window
  // heights in the other three games, 728 and 740 and 760 among them.
  const hintEl = document.querySelector('.hint');
  const reserve = (hintEl ? hintEl.offsetHeight : 0) + 16;
  const dpr = Math.max(1, Math.min(4, window.devicePixelRatio || 1));
  const device = Math.max(1, Math.min(
    Math.floor((innerWidth * dpr) / W), Math.floor(((innerHeight - reserve) * dpr) / H)));
  canvas.style.width = `${(W * device) / dpr}px`;
  canvas.style.height = `${(H * device) / dpr}px`;
}
addEventListener('resize', fit);
fit();

if (DEV) {
  const problems = Object.entries(SETS).flatMap(([k, s]) => validate(s, k));
  console[problems.length ? 'error' : 'log']('palettes', problems.length ? problems : 'legal');
  globalThis.__latch = {
    get state() { return state; },
    get room() { return room; },
    get scene() { return scene; },
    LEVELS, run,
  };
}

requestAnimationFrame(frame);
