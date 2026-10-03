// Boot, loop, scenes.

import { Screen, W, H, code } from './pixel.mjs';
import { CHARGED, DYING, FIRED, SETS, validate, collisions } from './palette.mjs';
import {
  newGame, step, reset, rewind, run, LOOP, TPS, CW, CH, CELL, WALL, DOOR,
  NONE, LEFT, RIGHT, UP, DOWN,
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
  // `e.repeat` guards the one-shots. Without it, holding Q abandoned the discharge once per
  // auto-repeat and stacked a dozen overlapping sounds on top of each other.
  if (!e.repeat && k !== 'left' && k !== 'right' && k !== 'up' && k !== 'down') buffered.push(k);
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
  if (cx < 0 || cy < 0 || cx >= CW || cy >= CH) return;
  if (state.level.tiles[cy * CW + cx] === WALL) return;       // a tap on a wall is not a destination
  walkTo = { x: cx, y: cy };
}, { passive: true });

/**
 * The first step of a real route to where the thumb pointed.
 *
 * This was greedy — horizontal until the columns matched, then vertical — with a comment claiming
 * that walking into a wall and stopping was "honest". It is not: `walkTo` was only ever cleared on
 * ARRIVAL, so a body that jammed went on pushing into the wall for the rest of the discharge. In
 * the first room, tapping the core (the obvious first tap) burned all ten seconds against a
 * bulkhead in silence. A path is cheap on a 24x16 grid; search it.
 */
function routeStep(from, target) {
  const w = state.world;
  const solidAt = (x, y) => {
    if (x < 0 || y < 0 || x >= CW || y >= CH) return true;
    const t = state.level.tiles[y * CW + x];
    if (t === WALL) return true;
    if (t === DOOR) return !w.open.has(y * CW + x);
    return false;
  };
  const start = from.y * CW + from.x, goal = target.y * CW + target.x;
  const prev = new Int32Array(CW * CH).fill(-1);
  const seen = new Uint8Array(CW * CH);
  seen[start] = 1;
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    if (q[h] === goal) break;
    const x = q[h] % CW, y = (q[h] / CW) | 0;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy, k = ny * CW + nx;
      if (nx < 0 || ny < 0 || nx >= CW || ny >= CH || seen[k] || solidAt(nx, ny)) continue;
      seen[k] = 1; prev[k] = q[h]; q.push(k);
    }
  }
  if (!seen[goal]) return null;                 // nowhere to walk: say so rather than shoving
  let cur = goal;
  while (prev[cur] !== start && prev[cur] !== -1) cur = prev[cur];
  if (prev[cur] === -1) return NONE;
  const nx = cur % CW, ny = (cur / CW) | 0;
  return nx < from.x ? LEFT : nx > from.x ? RIGHT : ny < from.y ? UP : DOWN;
}

function towards(target) {
  const b = state.world.bodies[state.world.bodies.length - 1];
  if (!b) return NONE;
  if (b.x === target.x && b.y === target.y) { walkTo = null; return NONE; }
  const d = routeStep(b, target);
  if (d === null) {
    // unreachable from here — drop the destination and SAY so, rather than leaning on a wall for
    // the rest of the discharge
    walkTo = null;
    audio.sfx.bump();
    say('no way through');
    return NONE;
  }
  return d;
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
    if (presses.includes('ok')) { scene = 'title'; room = 0; load(0); audio.music.start(); }
    return;
  }
  if (noteT > 0) noteT--;
  if (fired > 0) fired--;
  if (paused) return;

  // The win is resolved BEFORE restart and abandon are read. Handled the other way round, pressing
  // R inside the 1.2s whiteout threw away a room you had just finished and sent you back to the
  // first discharge — and the whiteout is exactly when a player reaches for a key.
  if (state.over === 'win') {
    if (fired === 0) {
      room++;
      if (room >= LEVELS.length) { scene = 'done'; audio.music.stop(); return; }
      load(room);
    }
    return;
  }

  if (presses.includes('restart')) { reset(state); walkTo = null; audio.sfx.spent(); say('room reset'); return; }
  if (presses.includes('rewind')) {
    rewind(state); walkTo = null; audio.sfx.spent();
    say('discharge abandoned');
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
  audio.music.start();                 // a no-op unless the hum was stopped by finishing the game
  state = newGame(LEVELS[i], i + 1);
  walkTo = null;
  fired = 0;
  wasHigh = 0; wasOpen = 0; wasMoving = false;
  audio.music.reset();
  // The name is already printed at the top of every frame. `say`ing it here put it on screen twice
  // and hid the `teaches` line — the game's only tutorial text — for the first two and a half
  // seconds of each room, which is exactly when it is wanted.
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
  // Advisory, not an error: two palettes sharing a colour is often deliberate. It is printed so
  // that somebody has to look, because the one time it was not deliberate it made the subject of
  // the game invisible for eight and a half seconds out of every ten.
  const clashes = Object.entries(SETS).flatMap(([k, s]) => collisions(s, k));
  if (clashes.length) console.warn('palette colour collisions', clashes);
  globalThis.__latch = {
    get state() { return state; },
    get room() { return room; },
    get scene() { return scene; },
    LEVELS, run,
  };
}

requestAnimationFrame(frame);
