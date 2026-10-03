// Thousands of discharges of nonsense, with invariants on every tick.
//
//   node tools/stress.mjs --runs 400
//
// The policies here are adversarial on purpose. A puzzle game's bookkeeping is attacked hardest not
// by someone solving it but by someone mashing: walking into walls for ten seconds, shoving a crate
// into a corner, standing in a doorway at the exact tick its plate goes LOW.

import { LEVELS } from '../src/levels.mjs';
import { newGame, step, reset, rewind, LOOP, LEFT, RIGHT, UP, DOWN, NONE, ACT } from '../src/sim.mjs';
import { checkInvariants, checkReplay } from '../src/invariants.mjs';
import { makeRng } from '../src/rng.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const RUNS = Number(arg('--runs', 200));

const DIRS = [NONE, LEFT, RIGHT, UP, DOWN];
// rng.int is inclusive and takes (lo, hi). Called with one argument it returns NaN, DIRS[NaN] is
// undefined, and undefined & 15 is 0 — so three of the five policies below pressed nothing at all
// for three hundred runs while the harness cheerfully reported that no invariant had broken.
const dir = (rng) => DIRS[rng.int(0, DIRS.length - 1)];

/** Everything, as fast as possible. */
const mash = (rng) => dir(rng) | (rng.chance(0.2) ? ACT : 0);
/** One direction, for the whole ten seconds, into whatever is there. */
const press = (rng, memo) => (memo.d ??= DIRS[rng.int(1, 4)]);
/** Nothing at all. Every discharge wasted, for ever. */
const still = () => NONE;
/** Change direction every few ticks: the worst case for anything that assumes a step completes. */
const jitter = (rng, memo) => {
  memo.n = (memo.n ?? 0) + 1;
  if (memo.n % 3 === 0) memo.d = DIRS[rng.int(1, 4)];
  return memo.d ?? NONE;
};
/** Mash, and also hammer the two keys that throw away progress. */
const panic = (rng, memo) => { memo.panicking = true; return mash(rng); };

const POLICIES = { mash, press, still, jitter, panic };

let runs = 0, ticks = 0, fails = 0, wins = 0;
// Proof that the harness did something.
//
// Three times tonight a test has passed by never exercising the thing it was testing: a solver that
// said "no solution" because its plans were never really tried, and this file pressing nothing for
// three hundred runs. "No invariant broken" is a claim about the runs that happened. These counters
// are how the harness shows there were any.
const seenInput = new Set();
let cellsWalked = 0, cratesMoved = 0, platesPressed = 0, doorsOpened = 0;
const t0 = Date.now();

for (const [name, policy] of Object.entries(POLICIES)) {
  for (let seed = 1; seed <= RUNS; seed++) {
    const level = LEVELS[seed % LEVELS.length];
    const rng = makeRng(seed * 7919 + name.length);
    const state = newGame(level, seed);
    const memo = {};
    let broke = null;

    // six discharges' worth of abuse, which is past every budget in the game
    for (let t = 0; t < LOOP * 6 && !state.over; t++) {
      const inp = policy(rng, memo);
      const before = state.world.bodies.map((b) => `${b.x},${b.y}`).join('|');
      const cratesBefore = state.world.crates.map((c) => `${c.x},${c.y}`).join('|');
      step(state, inp);
      seenInput.add(inp & 15);
      if (state.world.bodies.map((b) => `${b.x},${b.y}`).join('|') !== before) cellsWalked++;
      if (state.world.crates.map((c) => `${c.x},${c.y}`).join('|') !== cratesBefore) cratesMoved++;
      platesPressed += state.world.high.size ? 1 : 0;
      doorsOpened += state.world.open.size ? 1 : 0;
      ticks++;

      if (memo.panicking && rng.chance(0.002)) rewind(state);
      if (memo.panicking && rng.chance(0.0008)) reset(state);
      if (state.failed) reset(state);

      const bad = checkInvariants(state);
      if (bad.length) { broke = { tick: state.world.tick, bad }; break; }

      // the replay check is expensive, so it runs at the seams where it could actually fail:
      // the tick a discharge ends and a ghost is born
      if (state.live.length === 0) {
        const r = checkReplay(state);
        if (r.length) { broke = { tick: state.world.tick, bad: r }; break; }
      }
    }

    runs++;
    if (state.over === 'win') wins++;
    if (broke) {
      fails++;
      console.log(`\nFAIL  ${name} on "${level.name}" seed ${seed} at tick ${broke.tick}`);
      for (const b of broke.bad.slice(0, 4)) console.log('   ' + b);
      if (fails >= 6) break;
    }
  }
  if (fails >= 6) break;
}

const secs = (Date.now() - t0) / 1000;
console.log(`\n${runs} runs, ${(ticks / 60 / 60).toFixed(1)} hours of discharges in ${secs.toFixed(1)}s`);
console.log(`  ${wins} of them finished a room by accident` +
            (wins ? '  *** a room falls to random input ***' : '  (none, which is right)'));
console.log(`  ${seenInput.size} distinct inputs issued, ${cellsWalked} steps taken, ` +
            `${cratesMoved} crate movements, plates held on ${platesPressed} ticks, ` +
            `doors open on ${doorsOpened}`);

// A soak that pressed nothing proves nothing, so say so out loud rather than reporting a pass.
const inert = [];
if (seenInput.size < 5) inert.push(`only ${seenInput.size} distinct inputs were ever issued`);
if (cellsWalked < 1000) inert.push(`only ${cellsWalked} steps were taken`);
if (cratesMoved < 100) inert.push(`only ${cratesMoved} crate movements happened`);
if (platesPressed < 100) inert.push(`plates were held on only ${platesPressed} ticks`);
if (doorsOpened < 100) inert.push(`doors were open on only ${doorsOpened} ticks`);
for (const i of inert) console.log(`  *** THE HARNESS BARELY RAN: ${i}`);

console.log(fails ? `\n${fails} FAILURES` : '\nno invariant broken');
process.exit(fails || wins || inert.length ? 1 : 0);
