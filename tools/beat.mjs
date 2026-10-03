// Hand-built plans that the solver's family cannot express, run through the real simulation.
//
// The solver's lower bound is "no plan in the family I can describe does better". That is a much
// weaker statement than "no plan does better", and this file exists to keep the difference honest:
// if a hand-built plan beats a budget, the budget was never a minimum.
import { LEVELS } from '../src/levels.mjs';
import { run, LOOP, MOVE_TICKS, LEFT, RIGHT, UP, DOWN, NONE } from '../src/sim.mjs';

const D = { l: LEFT, r: RIGHT, u: UP, d: DOWN };

/** "r3 u4 r10" — a direction and a count of cells, or "w120" to wait that many ticks. */
function tape(spec) {
  const t = new Uint8Array(LOOP);
  let i = 0;
  for (const tok of spec.trim().split(/\s+/)) {
    const n = Number(tok.slice(1));
    if (tok[0] === 'w') { i += n; continue; }
    for (let c = 0; c < n; c++) for (let k = 0; k < MOVE_TICKS && i < LOOP; k++) t[i++] = D[tok[0]];
  }
  return t;
}

const CASES = [
  { room: 'two crates', claim: 1,
    note: 'one body shoves both crates onto both plates and then stands on the core',
    tapes: ['r3 u4 r10 l10 d8 r10 u4 r3'] },
  { room: 'the corridor', claim: 2,
    note: 'a ghost holds plate 1, then RELOCATES to plate 2 inside the same discharge',
    tapes: ['r1 u6 w78 r1 d9', 'u4 r7 r6 d6'] },
];

// These two plans DID beat their budgets, in the build that shipped. They are kept as regression
// cases: both rooms were changed so that the plan cannot work — "two crates" gained a third plate
// no crate can reach, and "the corridor" moved its second plate to the far side of the door, so a
// ghost that relocates has to cross the door it is itself holding open. If either ever finishes
// again, the room has drifted back.
let beaten = 0;
for (const c of CASES) {
  const level = LEVELS.find((l) => l.name === c.room);
  if (!level) { console.log(`${c.room}: no such room any more`); continue; }
  const tapes = c.tapes.map(tape);
  const w = run(level, tapes.slice(0, -1), tapes[tapes.length - 1]);
  const used = tapes.length;
  const ok = w.done && used < level.budget;
  console.log(`${c.room.padEnd(14)} budget ${level.budget}  |  ${c.note}`);
  console.log(`  finished: ${w.done}${w.done ? ` at tick ${w.doneTick} (${(w.doneTick / 60).toFixed(1)}s)` : ''}` +
              `  discharges used: ${used}`);
  console.log(`  ${ok ? `*** BUDGET BEATEN: ${used} < ${level.budget} ***`
                      : w.done ? 'does not beat the budget' : 'does not finish the room'}\n`);
  if (ok) beaten++;
}
process.exit(beaten ? 1 : 0);
