// One picture: the room, the afterimages, and a bar showing how much of the discharge is left.
// Reads the state, never writes it.

import { W, H, code } from './pixel.mjs';
import { CW, CH, CELL, LOOP, MOVE_TICKS, WALL, PLATE, DOOR, CORE, LEFT, RIGHT, UP } from './sim.mjs';
import { cosmetic } from './rng.mjs';

const PLATING = 0, SEA = 1, REST = 2, LIVE = 3;
const P_YOU = 4, P_GHOST = 5, P_CRATE = 6, P_CORE = 7;

// The room is 24x16 cells of 8px = 192x128, centred in the 256x240 screen, with the clock above
// and the discharge pips below.
const OX = (W - CW * CELL) / 2;            // 32
const OY = 44;

export const fx = { shake: 0 };
let shakeX = 0, shakeY = 0;

export function addShake(n) { fx.shake = Math.min(1, fx.shake + n); }

/** Where a body or a crate is on screen, including the part of a step it has completed. */
function at(b) {
  const t = b.moving ? b.sub / MOVE_TICKS : 0;
  const x = b.fromX + (b.x - b.fromX) * t;
  const y = b.fromY + (b.y - b.fromY) * t;
  return { px: OX + Math.round(x * CELL), py: OY + Math.round(y * CELL) };
}

export function draw(screen, state, view, t) {
  fx.shake = Math.max(0, fx.shake - 0.04);
  const amp = fx.shake * fx.shake;
  shakeX = Math.round(amp * 3 * (cosmetic.next() * 2 - 1));
  shakeY = Math.round(amp * 3 * (cosmetic.next() * 2 - 1));

  screen.clear(code(SEA, 1));
  drawSea(screen, t);
  drawRoom(screen, state);
  drawCrates(screen, state);
  drawBodies(screen, state, t);
  drawClock(screen, state, t);
}

/**
 * The water the rig stands in — AROUND the deck, not under it.
 *
 * Drawn across the whole screen first, it sat behind the room as well, and since the deck was
 * filled from the same palette the floor and the sea were the same darkness: the room had no inside.
 * The deck is opaque plating; the sea is only ever what you can see past the edge of it.
 */
function drawSea(screen, t) {
  const inRoom = (x, y) => x >= OX - 2 && x < OX + CW * CELL + 2 &&
                           y >= OY - 2 && y < OY + CH * CELL + 2;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (inRoom(x, y)) continue;
      screen.rect(x, y, 2, 2, code(SEA, 1));
    }
  }
  // swell: a few brighter crests drifting, so the water is alive without being busy
  for (let i = 0; i < 26; i++) {
    const x = Math.floor((i * 73 + t * 11) % W);
    const y = Math.floor((i * 97 + Math.sin(i + t * 0.6) * 6 + 20) % H);
    if (inRoom(x, y)) continue;
    screen.px(x, y, code(SEA, i % 3 ? 2 : 3));
    screen.px(x + 1, y, code(SEA, 2));
  }
}

function tilePal(state, x, y) {
  const k = y * CW + x;
  const w = state.world;
  const tile = state.level.tiles[k];
  if (tile === PLATE) return w.high.has(k) ? LIVE : REST;
  if (tile === DOOR) return w.open.has(k) ? LIVE : REST;
  return REST;
}

function drawRoom(screen, state) {
  const lv = state.level;
  const w = state.world;

  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const k = y * CW + x;
      const px = OX + x * CELL + shakeX, py = OY + y * CELL + shakeY;
      const tile = lv.tiles[k];

      if (tile === WALL) {
        // riveted bulkhead: the brightest structure in the room, so the shape of the room reads
        // before anything in it does
        screen.rect(px, py, CELL, CELL, code(PLATING, 2));
        screen.hline(px, py, CELL, code(PLATING, 3));
        screen.hline(px, py + CELL - 1, CELL, code(PLATING, 1));
        screen.px(px + 2, py + 3, code(PLATING, 3));
        screen.px(px + 5, py + 5, code(PLATING, 1));
        continue;
      }

      // the deck: dark plating, with a rivet at each corner so distances can be counted by eye
      screen.rect(px, py, CELL, CELL, code(PLATING, 1));
      screen.px(px, py, code(PLATING, 2));

      if (tile === PLATE) {
        const pal = tilePal(state, x, y);
        screen.rect(px + 1, py + 2, 6, 4, code(pal, 1));
        screen.hline(px + 1, py + 2, 6, code(pal, 3));
        screen.hline(px + 1, py + 5, 6, code(pal, 2));
        // which plate this is, as pips down the side, so two plates are never confused
        const n = Number(lv.plates.find((p) => p.x === x && p.y === y)?.id ?? 0);
        for (let i = 0; i < n && i < 4; i++) screen.px(px + 1 + i * 2, py + 7, code(pal, 3));
      } else if (tile === DOOR) {
        const open = w.open.has(k);
        if (open) {
          // retracted into the frame
          screen.hline(px, py, CELL, code(LIVE, 2));
          screen.hline(px, py + CELL - 1, CELL, code(LIVE, 2));
          screen.px(px, py + 3, code(LIVE, 3));
          screen.px(px + CELL - 1, py + 4, code(LIVE, 3));
        } else {
          screen.rect(px, py, CELL, CELL, code(REST, 1));
          for (let i = 0; i < CELL; i += 2) screen.hline(px, py + i, CELL, code(REST, 2));
          screen.hline(px, py, CELL, code(REST, 3));
        }
      } else if (tile === CORE) {
        // The way out, and the first version of it was a dim four-pixel dot that read as debris.
        // It is a hatch with a ring now, in its own palette whether or not it is ready, and it
        // CARRIES ITS WIRING: one pip per plate it needs, lit as that plate goes HIGH. In a room
        // with four plates and a core that wants three of them, nothing on screen said which three.
        const ready = lv.core.plates.every((pk) => w.high.has(pk));
        for (let dy = 0; dy < CELL; dy++) {
          for (let dx = 0; dx < CELL; dx++) {
            const d = Math.abs(dx - 3.5) + Math.abs(dy - 3.5);
            if (d > 4) continue;
            screen.px(px + dx, py + dy,
                      code(P_CORE, ready ? (d > 2.5 ? 2 : 3) : (d > 2.5 ? 1 : 2)));
          }
        }
        screen.hline(px + 2, py, 4, code(P_CORE, ready ? 3 : 1));
        screen.hline(px + 2, py + CELL - 1, 4, code(P_CORE, ready ? 3 : 1));

        const need = lv.core.plates;
        if (need.length) {
          const pw = 3, total = need.length * pw - 1;
          let qx = px + Math.round((CELL - total) / 2);
          const qy = py - 4;
          for (const pk of need) {
            const on = w.high.has(pk);
            screen.rect(qx, qy, 2, 2, code(on ? LIVE : REST, on ? 3 : 1));
            qx += pw;
          }
        }
      }
    }
  }
}

function drawCrates(screen, state) {
  for (const c of state.world.crates) {
    const { px, py } = at(c);
    const x = px + shakeX, y = py + shakeY;
    screen.rect(x, y + 1, CELL, CELL - 1, code(P_CRATE, 1));
    screen.hline(x, y + 1, CELL, code(P_CRATE, 3));
    screen.hline(x, y + CELL - 1, CELL, code(P_CRATE, 2));
    screen.vline(x, y + 1, CELL - 1, code(P_CRATE, 2));
    screen.vline(x + CELL - 1, y + 1, CELL - 1, code(P_CRATE, 2));
    // the diagonal brace, which is what makes it read as a crate and not a block
    for (let i = 1; i < CELL - 1; i++) screen.px(x + i, y + CELL - 1 - i, code(P_CRATE, 2));
  }
}

/** A person: four pixels wide, with a head, facing the way they last moved. */
function figure(screen, x, y, pal, face, walking, t) {
  const bob = walking && Math.floor(t * 10) % 2 ? 1 : 0;
  screen.rect(x + 2, y + 3 + bob, 4, 4, code(pal, 2));          // body
  screen.rect(x + 2, y + bob, 4, 3, code(pal, 3));              // head
  if (face === LEFT) screen.px(x + 2, y + 1 + bob, code(pal, 1));
  else if (face === RIGHT) screen.px(x + 5, y + 1 + bob, code(pal, 1));
  // legs, which alternate while walking so a body that is moving looks like it
  if (walking && Math.floor(t * 10) % 2) {
    screen.px(x + 1, y + 7, code(pal, 2)); screen.px(x + 6, y + 7, code(pal, 2));
  } else {
    screen.px(x + 2, y + 7, code(pal, 2)); screen.px(x + 5, y + 7, code(pal, 2));
  }
}

function drawBodies(screen, state, t) {
  const w = state.world;
  // ghosts first, so the live body is never hidden behind one of its own afterimages
  for (let i = 0; i < w.bodies.length; i++) {
    const b = w.bodies[i];
    if (!b.alive) continue;
    const live = i === w.bodies.length - 1 && state.live.length > 0;
    const { px, py } = at(b);
    const x = px + shakeX, y = py + shakeY;

    if (!live) {
      // An afterimage is light, not a body, and has to read as one at a glance — four of them can
      // be on screen at once and none of them is the person you are controlling. Drawn solid they
      // were simply four more people in different colours. Dithered every frame, they read as
      // something burned into the dark, and the live body is the only solid figure in the room.
      figure(screen, x, y, P_GHOST, b.face, b.moving, t);
      screen.dither(x + 1, y, CELL - 2, CELL, code(P_GHOST, 1), code(PLATING, 1),
                    (i + Math.floor(t * 8)) & 1);
    } else {
      figure(screen, x, y, P_YOU, b.face, b.moving, t);
    }
  }
}

/**
 * The clock: a bar that drains, and one pip per discharge spent.
 *
 * The bar is the only HUD. The palette swap already tells you the bank is dying; the bar tells you
 * how long you have before it does, which is the one number a plan depends on.
 */
function drawClock(screen, state, t) {
  const left = LOOP - state.live.length;
  const frac = left / LOOP;
  const barW = CW * CELL;
  const x0 = OX, y0 = OY - 12;

  screen.rect(x0, y0, barW, 5, code(REST, 1));
  screen.hline(x0, y0, barW, code(REST, 2));
  const fill = Math.round(barW * frac);
  const pal = frac < 0.15 ? REST : LIVE;
  if (fill > 0) {
    screen.rect(x0, y0 + 1, fill, 3, code(pal, frac < 0.15 ? 3 : 2));
    screen.hline(x0, y0 + 1, fill, code(pal, 3));
  }

  // discharges: one pip spent for each ghost, the rest still in the bank
  const budget = state.level.budget;
  const used = state.tapes.length;
  const pw = 7, gap = 3;
  const total = budget * pw + (budget - 1) * gap;
  let px = Math.round((W - total) / 2);
  for (let i = 0; i < budget; i++) {
    const spent = i < used;
    screen.rect(px, OY + CH * CELL + 6, pw, 5, code(spent ? REST : LIVE, spent ? 1 : 2));
    screen.hline(px, OY + CH * CELL + 6, pw, code(spent ? REST : LIVE, spent ? 2 : 3));
    px += pw + gap;
  }
}

/**
 * The one on-screen button, and the only place a tap may throw work away.
 *
 * The whole band below the room used to do this, which on a phone means a stray thumb discards up
 * to ten seconds of a plan with no warning and no undo. Exported rather than restated in the input
 * layer, because Lockout shipped with a hit box 12 pixels narrower than the card it was testing.
 */
export function abandonBox() {
  return { x: OX, y: OY + CH * CELL + 16, w: 68, h: 14 };
}

export function drawAbandon(screen, enabled) {
  const b = abandonBox();
  const pal = enabled ? REST : PLATING;
  screen.rect(b.x, b.y, b.w, b.h, code(pal, 1));
  screen.hline(b.x, b.y, b.w, code(pal, enabled ? 3 : 2));
  screen.hline(b.x, b.y + b.h - 1, b.w, code(pal, 2));
  screen.vline(b.x, b.y, b.h, code(pal, 2));
  screen.vline(b.x + b.w - 1, b.y, b.h, code(pal, 2));
  screen.centreIn(b.x, b.w, b.y + 4, 'abandon', code(pal, enabled ? 3 : 2));
}

export { OX, OY };
