// Walk one specific plan through the real simulation and print what the bodies actually did.
// Reasoning about why a plan fails is how you end up fixing the wrong thing.
import { LEVELS } from '../src/levels.mjs';
import { run, LOOP, MOVE_TICKS, CW, LEFT, RIGHT, UP, DOWN, NONE } from '../src/sim.mjs';

const level = LEVELS[1];                       // the crate
const D = { l: LEFT, r: RIGHT, u: UP, d: DOWN, '.': NONE };

/** a tape from a compact string like "rrrr dddd" — each letter is one cell of movement */
function tape(str) {
  const t = new Uint8Array(LOOP);
  let i = 0;
  for (const ch of str.replace(/\s/g, '')) {
    const d = D[ch];
    if (d === undefined) throw new Error(`bad move ${ch}`);
    for (let k = 0; k < MOVE_TICKS; k++) t[i++] = d;
  }
  return t;
}

// start (4,3), crate (9,3), plate1 (15,3), door a (11,8), plate2 (5,12), core (18,12)
// discharge 1: get behind the crate, push it six cells onto plate 1, then go and hold plate 2
const one = tape('rrrr' + 'rrrrrr' + 'lll' + 'ddddddddd' + 'llllll');
// discharge 2: down through the door the crate is holding open, and across to the core
const two = tape('rrrrrrr' + 'ddddddddd' + 'rrrrrrr');

for (const [label, tapes, live] of [['one alone', [], one], ['one then two', [one], two]]) {
  const w = run(level, tapes, live);
  const where = w.bodies.map((b, i) => `body${i} ${b.x},${b.y}`).join('  ');
  const crate = w.crates.map((c) => `${c.x},${c.y}`).join(' ');
  console.log(`${label.padEnd(14)} tick ${w.tick}  done=${w.done}  ${where}  crate ${crate}  ` +
              `high ${[...w.high].map((k) => `${k % CW},${Math.floor(k / CW)}`).join(' ') || 'none'}  ` +
              `open ${[...w.open].map((k) => `${k % CW},${Math.floor(k / CW)}`).join(' ') || 'none'}`);
}
