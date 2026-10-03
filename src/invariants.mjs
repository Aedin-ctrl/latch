// What must be true of the station at every single tick.
//
// The lesson this project keeps relearning is that an invariant can check that what happens is
// legal and can never check that anything happens at all. So these are deliberately about the
// bookkeeping — and the thing that proves the game is a game lives in tools/solve.mjs, which asks
// whether each room can be finished and in how few discharges.
//
// The first one is the one that matters here, and it is not a bookkeeping check.

import { LOOP, CW, CH, WALL, DOOR, MOVE_TICKS, run } from './sim.mjs';

const key = (x, y) => y * CW + x;

/** A compact fingerprint of everything that can be seen. Two runs agree or they do not. */
export function fingerprint(w) {
  const parts = [w.tick, w.done ? 1 : 0];
  for (const b of w.bodies) parts.push(b.x, b.y, b.sub, b.moving ? 1 : 0, b.alive ? 1 : 0);
  for (const c of w.crates) parts.push(c.x, c.y, c.sub, c.moving ? 1 : 0);
  parts.push(...[...w.high].sort((a, b) => a - b), -1, ...[...w.open].sort((a, b) => a - b));
  return parts.join(',');
}

export function checkInvariants(state) {
  const bad = [];
  const say = (ok, msg) => { if (!ok) bad.push(msg); };
  const w = state.world;
  const lv = state.level;

  // --- the clock ---------------------------------------------------------------------------
  say(Number.isInteger(w.tick) && w.tick >= 0, `tick ${w.tick}`);
  say(state.live.length <= LOOP, `the live tape is ${state.live.length} ticks, longer than a loop`);
  for (const t of state.tapes) {
    say(t.length === LOOP, `a finished tape is ${t.length} ticks, not ${LOOP}`);
  }
  if (!w.done) {
    say(w.tick === state.tapes.length * LOOP + state.live.length,
        `tick ${w.tick} disagrees with ${state.tapes.length} tapes and ${state.live.length} live`);
  }

  // --- bodies ------------------------------------------------------------------------------
  // one body per discharge so far, and never more than there are tapes to drive them
  say(w.bodies.length <= state.tapes.length + 1,
      `${w.bodies.length} bodies for ${state.tapes.length} finished tapes`);

  for (let i = 0; i < w.bodies.length; i++) {
    const b = w.bodies[i];
    say(Number.isInteger(b.x) && Number.isInteger(b.y) && Number.isInteger(b.sub),
        `body ${i} is at a fractional position`);
    say(b.sub >= 0 && b.sub < MOVE_TICKS, `body ${i} sub ${b.sub} outside [0,${MOVE_TICKS})`);
    say(b.x >= 0 && b.x < CW && b.y >= 0 && b.y < CH, `body ${i} is outside the room`);
    if (b.x >= 0 && b.x < CW && b.y >= 0 && b.y < CH) {
      const t = lv.tiles[key(b.x, b.y)];
      say(t !== WALL, `body ${i} is inside a wall at ${b.x},${b.y}`);
      // a body standing in a doorway is only legal while that door is open
      if (t === DOOR && !b.moving) {
        say(w.open.has(key(b.x, b.y)), `body ${i} is standing in a shut door at ${b.x},${b.y}`);
      }
    }
    // a body mid-step is always exactly one cell from where it came
    if (b.moving) {
      const d = Math.abs(b.x - b.fromX) + Math.abs(b.y - b.fromY);
      say(d === 1, `body ${i} is mid-step ${d} cells from where it started`);
    }
  }

  // --- crates ------------------------------------------------------------------------------
  say(w.crates.length === lv.crates.length,
      `${w.crates.length} crates, the room has ${lv.crates.length}`);
  const seen = new Set();
  for (const c of w.crates) {
    say(c.x >= 0 && c.x < CW && c.y >= 0 && c.y < CH, `a crate is outside the room`);
    if (c.x >= 0 && c.x < CW && c.y >= 0 && c.y < CH) {
      say(lv.tiles[key(c.x, c.y)] !== WALL, `a crate is inside a wall at ${c.x},${c.y}`);
    }
    say(!seen.has(key(c.x, c.y)), `two crates are in the cell ${c.x},${c.y}`);
    seen.add(key(c.x, c.y));
    if (c.moving) {
      const d = Math.abs(c.x - c.fromX) + Math.abs(c.y - c.fromY);
      say(d === 1, `a crate is mid-slide ${d} cells from where it started`);
    }
  }

  // --- the signals -------------------------------------------------------------------------
  // Recomputed here, independently, and compared. Not a refcount checked against itself: if the
  // only representation drifted, a door would hang open, the room would be trivially solvable,
  // and nothing at all would appear in the console.
  const high = new Set();
  for (const p of lv.plates) {
    const k = key(p.x, p.y);
    const onIt = w.bodies.some((b) => b.alive && b.x === p.x && b.y === p.y) ||
                 w.crates.some((c) => c.x === p.x && c.y === p.y);
    if (onIt) high.add(k);
  }
  say(high.size === w.high.size && [...high].every((k) => w.high.has(k)),
      `the plates that are HIGH disagree with what is standing on them`);
  for (const d of lv.doors) {
    const should = d.plates.every((pk) => high.has(pk));
    say(should === w.open.has(key(d.x, d.y)),
        `door ${d.id} is ${w.open.has(key(d.x, d.y)) ? 'open' : 'shut'} and should not be`);
  }

  return bad;
}

/**
 * The one that matters: replay the whole scenario from tick 0 and require it to be identical.
 *
 * Everything above is about one instant being legal. This is about the past staying what it was.
 * In a game whose entire subject is cooperating with a recording of yourself, a ghost that does
 * something it never did is not a glitch, it is the game being a lie — and it is the only bug here
 * that no amount of play would reliably reveal, because you would simply believe you misremembered.
 */
export function checkReplay(state) {
  const a = run(state.level, state.tapes, state.live);
  const b = run(state.level, state.tapes, state.live);
  if (fingerprint(a) !== fingerprint(b)) return ['the same tapes produced two different worlds'];
  if (fingerprint(a) !== fingerprint(state.world)) {
    return ['replaying the tapes from tick 0 does not reproduce the world on screen'];
  }
  return [];
}
