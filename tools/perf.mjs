// `run(level, tapes, live)` is re-evaluated from tick 0 on EVERY tick. That is the design decision
// the whole game rests on — ghost desync is impossible because no state survives a frame — and it
// is also, obviously, quadratic in the number of discharges. This asks whether that matters.
//
// Worst case: the last room, at its budget, on the final tick of the final discharge.
import { LEVELS } from '../src/levels.mjs';
import { run, LOOP, RIGHT } from '../src/sim.mjs';

console.log('room                tapes   ticks simulated   per run     per frame at 60Hz');
for (const level of LEVELS) {
  const tape = new Uint8Array(LOOP).fill(RIGHT);
  for (let n = 1; n <= level.budget; n++) {
    const tapes = Array.from({ length: n - 1 }, () => tape);
    const live = new Uint8Array(LOOP).fill(RIGHT);      // the worst moment: a full final discharge
    const t0 = process.hrtime.bigint();
    const reps = 40;
    for (let i = 0; i < reps; i++) run(level, tapes, live);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / reps;
    if (n === level.budget) {
      console.log(`${level.name.padEnd(18)} ${String(n).padStart(3)}   ` +
                  `${String(n * LOOP).padStart(8)}        ${ms.toFixed(2)}ms    ` +
                  `${((ms / 16.67) * 100).toFixed(1)}% of a frame` +
                  (ms > 8 ? '   *** TOO SLOW ***' : ''));
    }
  }
}
