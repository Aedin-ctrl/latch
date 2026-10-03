// Play every room through the REAL game, start to finish.
//
//   node tools/play.mjs
//
// tools/solve.mjs proves each room can be finished by `run`, which is the pure function underneath
// everything. This proves it can be finished by `newGame` and `step` — the state machine the player
// actually drives, with its tape recording, its discharge boundaries and its budget. The Far Light
// has the same pair for the same reason: a solver can be right about the physics and the game can
// still be unplayable because the thing wrapping the physics is wrong.

import { LEVELS } from '../src/levels.mjs';
import { newGame, step, LOOP } from '../src/sim.mjs';
import { checkInvariants, checkReplay } from '../src/invariants.mjs';
import { candidates } from './solve.mjs';
import { run } from '../src/sim.mjs';

/** The same search as solve.mjs, returning the tapes rather than a verdict. */
function plan(level, limit) {
  const cands = candidates(level);
  const cores = cands.filter((c) => c.label.startsWith('core'));
  const holds = cands.filter((c) => !c.label.startsWith('core'));
  const chosen = [];
  const pick = (from) => {
    if (chosen.length === limit - 1) {
      for (const c of cores) {
        const tapes = [...chosen, c].map((q) => q.tape);
        if (run(level, tapes.slice(0, -1), tapes[tapes.length - 1]).done) {
          return { tapes, labels: [...chosen, c].map((q) => q.label) };
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
  return pick(0);
}

let bad = 0, totalTicks = 0;
for (let i = 0; i < LEVELS.length; i++) {
  const level = LEVELS[i];
  const p = plan(level, level.budget);
  if (!p) { console.log(`${level.name.padEnd(16)} *** no plan found ***`); bad++; continue; }

  // now press the buttons, one tick at a time, exactly as a player would
  const state = newGame(level, i + 1);
  let broke = null, ticks = 0;
  outer:
  for (const tape of p.tapes) {
    for (let t = 0; t < LOOP; t++) {
      step(state, tape[t]);
      ticks++; totalTicks++;
      const v = checkInvariants(state);
      if (v.length) { broke = { tick: state.world.tick, bad: v }; break outer; }
      if (state.live.length === 0) {
        const r = checkReplay(state);
        if (r.length) { broke = { tick: state.world.tick, bad: r }; break outer; }
      }
      if (state.failed) { broke = { tick: state.world.tick, bad: ['ran out of discharges'] }; break outer; }
      if (state.over === 'win') break outer;
    }
  }

  if (broke) {
    console.log(`${level.name.padEnd(16)} *** BROKE at tick ${broke.tick}: ${broke.bad[0]}`);
    bad++;
  } else if (state.over !== 'win') {
    console.log(`${level.name.padEnd(16)} *** the plan the solver certified does not finish the ` +
                `room when it is PLAYED (${state.tapes.length} discharges spent)`);
    bad++;
  } else {
    console.log(`${level.name.padEnd(16)} finished in ${state.tapes.length + 1} discharge` +
                `${state.tapes.length ? 's' : ''} of ${level.budget}, ` +
                `${(ticks / 60).toFixed(1)}s of real play`);
  }
}

console.log(`\n${(totalTicks / 60).toFixed(0)} seconds of play, every tick checked`);
console.log(bad ? `${bad} room(s) could not be played` : 'every room played through to the core');
process.exit(bad ? 1 : 0);
