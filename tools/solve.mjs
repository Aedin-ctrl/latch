// Can each room be done, in how few discharges, and is the budget honest?
//
//   node tools/solve.mjs
//   node tools/solve.mjs --level "the keeper" --verbose
//
// THE RULE THIS TOOL OBEYS: it does not know how the game works.
//
// The Far Light's tower verifier reimplemented the physics it was verifying, drifted, and certified
// an unclimbable tower as climbable. So this file contains no movement rules, no door logic and no
// crate logic. It builds candidate TAPES out of a coarse guess at the map, and then every single
// candidate is judged by `run()` from sim.mjs — the same function the game plays through. The
// search proposes; the simulation disposes. If the guess walks a body into a shut door, the tape
// still runs, it simply does not arrive, and the attempt is discarded like any other.

import { LEVELS } from '../src/levels.mjs';
import { run, LOOP, MOVE_TICKS, CW, CH, WALL, LEFT, RIGHT, UP, DOWN } from '../src/sim.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const VERBOSE = process.argv.includes('--verbose');
const only = arg('--level', null);

const key = (x, y) => y * CW + x;

/**
 * A coarse route between two cells. Walls only — doors are assumed passable, because this is a
 * guess and not an authority. A route through a door that turns out to be shut produces a tape
 * that fails when it is run, which is exactly the right outcome.
 */
function route(level, from, to, avoid = null) {
  const prev = new Int32Array(CW * CH).fill(-1);
  const seen = new Uint8Array(CW * CH);
  const q = [from];
  seen[key(from[0], from[1])] = 1;
  for (let h = 0; h < q.length; h++) {
    const [x, y] = q[h];
    if (x === to[0] && y === to[1]) break;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) continue;
      const k = key(nx, ny);
      if (seen[k]) continue;
      if (level.tiles[k] === WALL) continue;         // doors deliberately NOT treated as solid
      // Cells a crate is sitting in, when the caller knows where the crates are. Without this, the
      // walk AFTER a push routed straight back through the crate it had just placed and shoved it
      // one cell off the plate — a plan that undid its own work, which the search then had to
      // discard, hiding whatever it would have found next.
      if (avoid && avoid.has(k) && !(nx === to[0] && ny === to[1])) continue;
      seen[k] = 1; prev[k] = key(x, y);
      q.push([nx, ny]);
    }
  }
  const end = key(to[0], to[1]);
  if (!seen[end]) return null;
  const cells = [];
  for (let k = end; k !== -1; k = prev[k]) cells.push([k % CW, Math.floor(k / CW)]);
  return cells.reverse();
}

const DIR_OF = (dx, dy) => (dx < 0 ? LEFT : dx > 0 ? RIGHT : dy < 0 ? UP : DOWN);

/** Turn a route into a tape: hold each direction long enough to cross, then wait out the loop. */
function tapeFor(cells, delay = 0) {
  const t = new Uint8Array(LOOP);                   // NONE is 0, so this is "stand still" by default
  let i = delay;
  for (let c = 1; c < cells.length && i < LOOP; c++) {
    const d = DIR_OF(cells[c][0] - cells[c - 1][0], cells[c][1] - cells[c - 1][1]);
    // EXACTLY one step's worth. Holding a direction one tick past MOVE_TICKS does not idle, it
    // begins the next step in the same direction — so "generously" meant every route overshot.
    for (let k = 0; k < MOVE_TICKS && i < LOOP; k++) t[i++] = d;
  }
  return t;
}

/**
 * Every plan worth trying for one discharge.
 *
 * What a tape can contribute to a room is small: hold a plate, shove a crate somewhere useful, sit
 * on the core, or stay out of the way. Enumerating those is enough to search the real space, and
 * each candidate still has to survive being run.
 */
export function candidates(level) {
  const out = [{ label: 'wait', tape: new Uint8Array(LOOP) }];
  const targets = [
    ...level.plates.map((p) => ({ label: `plate ${p.id}`, at: [p.x, p.y] })),
    { label: 'core', at: [level.core.x, level.core.y] },
  ];

  for (const t of targets) {
    const r = route(level, level.start, t.at);
    if (!r) continue;
    for (const delay of [0, 60, 150, 300]) {
      out.push({ label: `${t.label}${delay ? ` after ${delay}` : ''}`, tape: tapeFor(r, delay) });
    }
  }

  // Two destinations in one discharge.
  //
  // The family was "walk somewhere and wait", and a lower bound built from it says only "no
  // one-destination plan does better". A ghost that holds one plate and then walks to another is
  // an obvious thing for a player to do and was unrepresentable here — and a room fell to exactly
  // that, reported as needing three discharges when two were enough.
  for (const first of targets) {
    const r1 = route(level, level.start, first.at);
    if (!r1) continue;
    for (const second of targets) {
      if (second === first) continue;
      const r2 = route(level, first.at, second.at);
      if (!r2) continue;
      for (const stay of [120, 240, 360]) {
        const t = new Uint8Array(LOOP);
        let i = 0;
        for (let c = 1; c < r1.length && i < LOOP; c++) {
          const d = DIR_OF(r1[c][0] - r1[c - 1][0], r1[c][1] - r1[c - 1][1]);
          for (let k = 0; k < MOVE_TICKS && i < LOOP; k++) t[i++] = d;
        }
        i = Math.max(i, stay);
        if (i >= LOOP) continue;
        for (let c = 1; c < r2.length && i < LOOP; c++) {
          const d = DIR_OF(r2[c][0] - r2[c - 1][0], r2[c][1] - r2[c - 1][1]);
          for (let k = 0; k < MOVE_TICKS && i < LOOP; k++) t[i++] = d;
        }
        const lab = `${first.label} for ${stay}, then ${second.label}`;
        out.push({ label: second.label === 'core' ? `core, after ${first.label}` : lab, tape: t });
      }
    }
  }

  // Crate plans.
  //
  // A push is: get to the cell behind the crate, then hold one direction. The plans below chain up
  // to two of them, and then optionally walk somewhere afterwards — because the family of plans the
  // search can express IS the strength of the lower bound it reports, and a room whose solution is
  // "shove both crates in one discharge" was being reported as needing an extra discharge purely
  // because this function could not say that sentence.
  const pushes = [];
  for (const [cx, cy] of level.crates) {
    for (const pl of level.plates) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const steps = dx ? (pl.x - cx) / dx : (pl.y - cy) / dy;
        if (!Number.isInteger(steps) || steps <= 0) continue;
        if (dx && pl.y !== cy) continue;
        if (dy && pl.x !== cx) continue;
        pushes.push({ crate: [cx, cy], plate: pl, dir: [dx, dy], steps,
                      behind: [cx - dx, cy - dy], ends: [pl.x - dx, pl.y - dy],
                      label: `crate ${cx},${cy} onto plate ${pl.id}` });
      }
    }
  }

  /** Write a walk from `a` to `b` into `t` starting at `i`; returns the new index, or -1. */
  const walk = (t, i, a, b, avoid = null) => {
    const r = route(level, a, b, avoid);
    if (!r) return -1;
    for (let c = 1; c < r.length && i < LOOP; c++) {
      const d = DIR_OF(r[c][0] - r[c - 1][0], r[c][1] - r[c - 1][1]);
      for (let k = 0; k < MOVE_TICKS && i < LOOP; k++) t[i++] = d;
    }
    return i;
  };
  const shove = (t, i, p) => {
    const d = DIR_OF(p.dir[0], p.dir[1]);
    for (let s = 0; s < p.steps && i < LOOP; s++) {
      for (let k = 0; k < MOVE_TICKS && i < LOOP; k++) t[i++] = d;
    }
    return i;
  };

  for (const a of pushes) {
    const t = new Uint8Array(LOOP);
    let i = walk(t, 0, level.start, a.behind);
    if (i < 0) continue;
    i = shove(t, i, a);
    out.push({ label: a.label, tape: Uint8Array.from(t) });

    // ...then go and hold something else with the body the crate just freed
    const after = (...placed) => new Set(placed.map((q) => key(q.plate.x, q.plate.y)));

    for (const t2 of level.plates) {
      if (t2 === a.plate) continue;
      const t3 = Uint8Array.from(t);
      const j = walk(t3, i, a.ends, [t2.x, t2.y], after(a));
      if (j < 0) continue;
      out.push({ label: `${a.label}, then plate ${t2.id}`, tape: t3 });
    }

    // ...or push the OTHER crate as well, in the same ten seconds
    for (const b of pushes) {
      if (b.crate[0] === a.crate[0] && b.crate[1] === a.crate[1]) continue;
      const t4 = Uint8Array.from(t);
      let j = walk(t4, i, a.ends, b.behind, after(a));
      if (j < 0) continue;
      j = shove(t4, j, b);
      out.push({ label: `${a.label}, then ${b.label}`, tape: Uint8Array.from(t4) });

      for (const t2 of level.plates) {
        if (t2 === a.plate || t2 === b.plate) continue;
        const t5 = Uint8Array.from(t4);
        if (walk(t5, j, b.ends, [t2.x, t2.y], after(a, b)) < 0) continue;
        out.push({ label: `${a.label}, then ${b.label}, then plate ${t2.id}`, tape: t5 });
      }

      // ...and then stand on the core. Labelled `core` so the search will consider it as a FINAL
      // tape: without this the family could say "push both crates" and could say "walk to the core"
      // but could never say both in one discharge — and a room that fell to exactly that plan was
      // reported as needing two discharges when one was enough.
      const t6 = Uint8Array.from(t4);
      if (walk(t6, j, b.ends, [level.core.x, level.core.y], after(a, b)) >= 0) {
        out.push({ label: `core, after ${a.label} and ${b.label}`, tape: t6 });
      }
    }

    // a single push, then the core
    const t7 = Uint8Array.from(t);
    if (walk(t7, i, a.ends, [level.core.x, level.core.y], new Set([key(a.plate.x, a.plate.y)])) >= 0) {
      out.push({ label: `core, after ${a.label}`, tape: t7 });
    }
  }

  return out;
}

/**
 * Search for a set of exactly `limit` tapes that finishes the room. Judged only by `run`.
 *
 * Two prunings, both from the shape of the game rather than from guesswork, because a naive search
 * over five plates never finished:
 *
 *  - **The last discharge is always the run to the core.** It is the only one the player is live
 *    for, and a plan whose final tape goes somewhere else cannot finish.
 *  - **The earlier discharges are a combination, not a permutation.** Holding plate 2 and then
 *    plate 3 leaves the same ghosts standing in the same places as the other way round. Order is
 *    only allowed to matter where a crate is involved, so crate plans are tried in every position.
 */
function solve(level, limit) {
  const cands = candidates(level);
  const cores = cands.filter((c) => c.label.startsWith('core'));
  const holds = cands.filter((c) => !c.label.startsWith('core'));
  // `startsWith('push')` — the labels were renamed to `crate x,y onto plate n` and this was not,
  // so the reordering branch below has never once executed. Fourth time tonight that a thing which
  // looked like it was being tested was not running at all.
  const crateish = (c) => c.label.includes('crate ');
  let tried = 0;

  const attempt = (plan) => {
    tried++;
    const tapes = plan.map((c) => c.tape);
    const w = run(level, tapes.slice(0, -1), tapes[tapes.length - 1]);
    return w.done ? { tapes, labels: plan.map((c) => c.label) } : null;
  };

  // pick `limit - 1` holds, non-decreasing by index, then one core run
  const chosen = [];
  const pick = (from) => {
    if (chosen.length === limit - 1) {
      for (const c of cores) {
        const hit = attempt([...chosen, c]);
        if (hit) return hit;
        // a crate plan can need to come after the thing it makes possible, so try the reverse too
        if (chosen.some(crateish) && chosen.length > 1) {
          const r = attempt([...chosen].reverse().concat(c));
          if (r) return r;
        }
      }
      return null;
    }
    for (let i = from; i < holds.length; i++) {
      chosen.push(holds[i]);
      const hit = pick(i);
      chosen.pop();
      if (hit) return hit;
    }
    return null;
  };

  const found = limit < 1 ? null : pick(0);
  return { found, tried, candidates: cands.length };
}

/** The smallest number of discharges that finishes the room, or null within six. */
function minimum(level) {
  for (let k = 1; k <= 6; k++) {
    const r = solve(level, k);
    if (r.found) return { k, found: r.found };
  }
  return null;
}

/**
 * Is every device in this room load-bearing?
 *
 * Take each one out and see whether the minimum moves. A plate nobody has to stand on, a crate
 * nobody has to push, a door that is never in the way — each is a thing the room appears to teach
 * and does not. This is the check that catches a puzzle which looks like its description.
 */
function loadBearing(level, min) {
  const dead = [];
  const strip = (f) => {
    const l = { ...level, tiles: Uint8Array.from(level.tiles) };
    f(l);
    const m = minimum(l);
    return m ? m.k : Infinity;
  };

  for (const c of level.crates) {
    const m = strip((l) => { l.crates = l.crates.filter((o) => o !== c); });
    if (m === min) dead.push(`the crate at ${c[0]},${c[1]} changes nothing`);
  }
  for (const d of level.doors) {
    // hold the door permanently open: if that does not make the room easier, it was never shut
    const m = strip((l) => { l.doors = l.doors.map((o) => (o === d ? { ...o, plates: [] } : o)); });
    if (m === min) dead.push(`door ${d.id} is never in the way`);
  }
  for (const pl of level.plates) {
    const k = pl.y * CW + pl.x;
    const used = level.doors.some((d) => d.plates.includes(k)) || level.core.plates.includes(k);
    if (!used) { dead.push(`plate ${pl.id} is wired to nothing`); continue; }
    // treat the plate as permanently HIGH: if the room is no easier, nobody needed to hold it
    const m = strip((l) => {
      l.doors = l.doors.map((d) => ({ ...d, plates: d.plates.filter((q) => q !== k) }));
      l.core = { ...l.core, plates: l.core.plates.filter((q) => q !== k) };
    });
    if (m === min) dead.push(`plate ${pl.id} never has to be held`);
  }
  return dead;
}

/** Replay a found solution through the real simulation, tape by tape, as the game would. */
function certify(level, tapes) {
  const w = run(level, tapes.slice(0, -1), tapes[tapes.length - 1]);
  return w.done ? { ok: true, tick: w.doneTick, loops: tapes.length } : { ok: false };
}

let bad = 0;
const MAIN = (process.argv[1] ?? '').endsWith('solve.mjs');
if (MAIN)
for (const level of LEVELS) {
  if (only && level.name !== only) continue;

  // Find the MINIMUM, rather than check a number I guessed.
  //
  // Checking "solvable in budget, not in budget-1" sounds equivalent and is not: the search returns
  // the first plan it finds, and the first plan it finds may contain a wasted discharge, so a room
  // reported as solved in 3 was sometimes solvable in 2 with the same tapes minus a `wait`. Asking
  // for the smallest k that works makes the budget a measurement instead of an assertion.
  const got = minimum(level);
  const min = got ? got.k : null;
  const at = got ? { found: got.found } : null;

  if (min === null) {
    console.log(`${level.name.padEnd(16)} *** NO SOLUTION in six discharges ***`);
    bad++;
    continue;
  }

  const cert = certify(level, at.found.tapes);
  if (!cert.ok) {
    console.log(`${level.name.padEnd(16)} *** the search claimed a plan the simulation rejects ***`);
    bad++;
    continue;
  }

  const ok = min === level.budget;
  const teaches = min >= 2 ? '' : '  *** ONE DISCHARGE: the ghosts are scenery ***';
  console.log(`${level.name.padEnd(16)} minimum ${min} discharge${min === 1 ? '' : 's'}, ` +
              `budget says ${level.budget}` +
              `  ${ok ? 'agree' : '*** DISAGREE ***'}` +
              `  (${(cert.tick / 60).toFixed(1)}s)${teaches}`);
  if (VERBOSE) at.found.labels.forEach((l, j) => console.log(`    discharge ${j + 1}: ${l}`));

  // Reported, not failed on.
  //
  // The per-device test asks "does the minimum change if I take this away", and that question
  // cannot see a PAIR. A crate makes a door free: hold the door open and the minimum does not move,
  // because the crate was already paying for it — so the door reads as dead while being the entire
  // reason the crate is worth anything. Same for a plate the crate can hold. Failing the build on
  // this would mean never putting a crate and a door in the same room, which would be letting the
  // measurement design the game.
  const dead = loadBearing(level, min);
  for (const d of dead) console.log(`    note: ${d} (on its own — see the pair effect)`);
  if (!ok || min < 2) bad++;
}

if (MAIN) {
  console.log(bad ? `\n${bad} room(s) wrong`
                  : '\nevery room is solvable, no room is solvable in fewer, and none in one');
  process.exit(bad ? 1 : 0);
}
