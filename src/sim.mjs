// The station. No DOM, no canvas, no audio, no Date.now, no Math.random.
//
// The whole design rests on one decision, made before any of this was written: a ghost is a
// recording of INPUTS, not of positions. A recording of positions is film — faithful, and
// completely inert: it walks through closed doors and cannot push a crate, and the room stops being
// a simulation. A recording of inputs is an actor, which is what the game is about, but it only
// works if the world is bit-identical from tick 0 on every loop. The instant ghost 1 drifts because
// ghost 2 moved a crate, the player is watching their own past self do something they never did,
// and no amount of care afterwards repairs that.
//
// So this file does not hold a world that persists while ghosts accumulate. It holds a PURE
// FUNCTION of a level and a list of tapes, re-evaluated from tick 0 whenever a tape is added.
// Desync is not guarded against here; it is impossible to express.

import { makeRng } from './rng.mjs';

export const TPS = 60;
export const LOOP = 10 * TPS;            // ten seconds, and the whole unit of play

export const CW = 24, CH = 16;           // the room, in cells
export const CELL = 8;
export const SUB = 8;                    // sub-cell steps per cell, so position stays an integer

// one direction and one action, packed into a byte so a tape is a Uint8Array
export const NONE = 0, LEFT = 1, RIGHT = 2, UP = 3, DOWN = 4;
export const ACT = 8;                    // bit 3, OR'd onto the direction

const DX = [0, -1, 1, 0, 0];
const DY = [0, 0, 0, -1, 1];

// tiles
export const FLOOR = 0, WALL = 1, PLATE = 2, DOOR = 3, CORE = 4;

// Ticks to cross one cell: ten cells a second. Exported because anything generating input has to
// know it — a tool that held a direction for eight ticks against this six moved a body a third of
// a cell further than it meant to, every step, and every route it built overshot.
export const MOVE_TICKS = 6;

/**
 * A body — the player, or one afterimage of them. Position is a cell plus an integer sub-step, so
 * there is never a float anywhere in this simulation and two runs can be compared exactly.
 */
function newBody(x, y) {
  return { x, y, fromX: x, fromY: y, sub: 0, dir: NONE, moving: false, face: RIGHT, alive: true };
}

const inBounds = (x, y) => x >= 0 && x < CW && y >= 0 && y < CH;
const key = (x, y) => y * CW + x;

/**
 * The world at one instant. Derived entirely from the level and the tapes; never edited from
 * outside.
 */
function newWorld(level) {
  return {
    level,
    tick: 0,
    bodies: [],                                  // index 0.. are ghosts, last is the live player
    crates: level.crates.map(([x, y]) => ({ x, y, fromX: x, fromY: y, sub: 0, moving: false })),
    open: new Set(),                             // door cells currently open
    high: new Set(),                             // plate cells currently HIGH
    done: false,
    doneTick: -1,
    events: [],
  };
}

/** Is this cell solid right now? Doors are solid unless their plates are HIGH. */
function solid(w, x, y) {
  if (!inBounds(x, y)) return true;
  const t = w.level.tiles[key(x, y)];
  if (t === WALL) return true;
  if (t === DOOR) return !w.open.has(key(x, y));
  return false;
}

function crateAt(w, x, y) {
  for (const c of w.crates) {
    if (c.x === x && c.y === y) return c;
    if (c.moving && c.fromX === x && c.fromY === y) return c;   // still leaving the old cell
  }
  return null;
}

/**
 * Recompute every signal from scratch.
 *
 * From scratch, every tick, deliberately. A refcount that drifts by one leaves a door stuck open,
 * the room trivially solvable, and nothing at all in the console — and an invariant that checks the
 * refcount against itself would agree with it. There is nothing to drift from if the only
 * representation is recomputed each time.
 */
function resolveSignals(w) {
  w.high.clear();
  for (const p of w.level.plates) {
    const k = key(p.x, p.y);
    let pressed = false;
    for (const b of w.bodies) if (b.alive && b.x === p.x && b.y === p.y) { pressed = true; break; }
    if (!pressed) for (const c of w.crates) if (c.x === p.x && c.y === p.y) { pressed = true; break; }
    if (pressed) w.high.add(k);
  }
  w.open.clear();
  for (const d of w.level.doors) {
    // a door opens when EVERY plate it is wired to is HIGH
    if (d.plates.every((pk) => w.high.has(pk))) w.open.add(key(d.x, d.y));
  }
}

/** Can a body step into this cell — pushing a crate if one is there? */
function tryStep(w, b, dir, pushOrder) {
  const nx = b.x + DX[dir], ny = b.y + DY[dir];
  if (solid(w, nx, ny)) return false;

  const c = crateAt(w, nx, ny);
  if (c) {
    if (c.moving) return false;                       // a crate already in motion cannot be pushed
    if (c.pushedBy !== undefined && c.pushedBy !== pushOrder) return false;   // one pusher per tick
    const cx = c.x + DX[dir], cy = c.y + DY[dir];
    if (solid(w, cx, cy) || crateAt(w, cx, cy)) return false;
    // bodies do not collide with each other (an afterimage is light, not a body) but a crate
    // cannot be pushed into one, or a ghost could be shoved out of its own recorded path
    for (const o of w.bodies) if (o.alive && o.x === cx && o.y === cy) return false;
    c.fromX = c.x; c.fromY = c.y;
    c.x = cx; c.y = cy;
    c.sub = 0; c.moving = true; c.pushedBy = pushOrder;
  }

  b.fromX = b.x; b.fromY = b.y;
  b.x = nx; b.y = ny;
  b.sub = 0; b.moving = true;
  return true;
}

/** One tick of the world. */
function stepWorld(w, inputs) {
  // Crates settle FIRST.
  //
  // This used to run after the bodies, and the consequence was that a crate could never be pushed
  // more than one cell. A body and the crate it is pushing start moving on the same tick and finish
  // on the same tick; with the crate updated afterwards, the body completed its step, immediately
  // tried the next push, and found the crate still flagged as moving — so the push was refused,
  // every time, for ever. `pushedBy` had the same fault one tick later: it was cleared at the end
  // of the tick rather than the start, so a stale claim from the previous tick blocked a different
  // body from pushing a crate nobody was touching.
  for (const c of w.crates) {
    if (c.moving) {
      c.sub++;
      if (c.sub >= MOVE_TICKS) { c.sub = 0; c.moving = false; c.fromX = c.x; c.fromY = c.y; }
    }
    delete c.pushedBy;
  }

  // Oldest ghost first, the live player last. Written down before the code so that it could not be
  // settled by accident: a crate contested in the same tick belongs to the body that was there
  // first, in the past.
  for (let i = 0; i < w.bodies.length; i++) {
    const b = w.bodies[i];
    if (!b.alive) continue;
    const inp = inputs[i] ?? NONE;
    const dir = inp & 7;

    if (b.moving) {
      b.sub++;
      if (b.sub >= MOVE_TICKS) { b.sub = 0; b.moving = false; b.fromX = b.x; b.fromY = b.y; }
    }
    if (!b.moving) {
      if (dir !== NONE) { b.face = dir; tryStep(w, b, dir, i); }
      else { b.dir = NONE; }
    }
  }

  resolveSignals(w);

  // The core: you are standing on it, and everything it is wired to is HIGH, on the same tick.
  const live = w.bodies[w.bodies.length - 1];
  if (live && live.alive && !w.done) {
    const core = w.level.core;
    if (live.x === core.x && live.y === core.y && !live.moving &&
        core.plates.every((pk) => w.high.has(pk))) {
      w.done = true;
      w.doneTick = w.tick;
      w.events.push({ type: 'core' });
    }
  }

  w.tick++;
}

/**
 * Run a level from tick 0 with a list of complete tapes, plus an optional partial live tape.
 *
 * This is the whole game. Every frame the player sees is `run(level, tapes, liveSoFar)` — not a
 * world that was stepped forward and hoped to still agree with the past.
 *
 * Returns the world at the end of the live tape, plus the loop index and the position within it.
 */
export function run(level, tapes, live = null) {
  const w = newWorld(level);
  const total = tapes.length * LOOP + (live ? live.length : 0);

  for (let t = 0; t < total; t++) {
    const loopIndex = Math.floor(t / LOOP);
    const loopT = t % LOOP;

    if (loopT === 0) {
      // A discharge. Everything resets except the tapes — the crates go back, the doors shut, and
      // one more body wakes up at the entrance. The bodies are rebuilt rather than reused, so
      // nothing can survive a loop by accident.
      w.bodies = [];
      w.crates = level.crates.map(([x, y]) => ({ x, y, fromX: x, fromY: y, sub: 0, moving: false }));
      const n = Math.min(loopIndex + 1, tapes.length + (live ? 1 : 0));
      for (let i = 0; i < n; i++) w.bodies.push(newBody(level.start[0], level.start[1]));
      resolveSignals(w);
      if (t > 0) w.events.push({ type: 'discharge', loop: loopIndex });
    }

    const inputs = [];
    for (let i = 0; i <= loopIndex && i < w.bodies.length; i++) {
      const tape = i < tapes.length ? tapes[i] : live;
      inputs.push(tape ? (tape[loopT] ?? NONE) : NONE);
    }
    stepWorld(w, inputs);
    if (w.done) break;
  }

  w.loop = Math.floor(Math.max(0, w.tick - 1) / LOOP);
  w.loopT = w.tick % LOOP;
  return w;
}

/**
 * The live game: a level, the tapes recorded so far, and the tape being recorded now.
 *
 * `state.world` is always the result of a full `run` from tick 0. Advancing a tick appends to the
 * live tape and re-runs. That is more work than stepping a persistent world and it is the entire
 * reason ghosts cannot drift.
 */
export function newGame(level, seed = 1) {
  return {
    level,
    seed,
    rng: makeRng(seed),
    tapes: [],
    live: [],
    world: run(level, [], []),
    over: null,                       // 'win' | null
    failed: false,
    events: [],
  };
}

export function step(state, input = NONE) {
  if (state.over) return state;

  state.live.push(input & 15);
  const w = run(state.level, state.tapes, state.live);
  state.world = w;
  state.events.push(...w.events);

  if (w.done) { state.over = 'win'; return state; }

  if (state.live.length >= LOOP) {
    // the discharge dies: this loop becomes a ghost
    state.tapes.push(Uint8Array.from(state.live));
    state.live = [];
    state.events.push({ type: 'discharge', loop: state.tapes.length });
    if (state.tapes.length >= state.level.budget) {
      // out of discharges. The room restarts rather than ending the game — the budget is the
      // proven minimum, so running out means the plan was wrong, not that the player is finished.
      state.failed = true;
    }
    state.world = run(state.level, state.tapes, state.live);
  }
  return state;
}

/** Throw away the ghosts and start the room again. */
export function reset(state) {
  state.tapes = [];
  state.live = [];
  state.failed = false;
  state.over = null;
  state.events.length = 0;
  state.world = run(state.level, [], []);
  return state;
}

/** Drop only the loop in progress, keeping the ghosts. The one mercy the game offers. */
export function rewind(state) {
  if (state.over) return state;
  state.live = [];
  state.failed = false;
  state.world = run(state.level, state.tapes, []);
  return state;
}

export const loopsSpent = (state) => state.tapes.length;
export const loopT = (state) => state.live.length;
