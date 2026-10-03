// Does each candidate plan actually do the thing its label says?
//
// A search that reports "no solution" is only as honest as its candidates. If the tape labelled
// "push the crate onto plate 1 and then go to plate 2" leaves the body somewhere else, the search
// is not telling you the room is unsolvable, it is telling you it never really tried.
import { LEVELS } from '../src/levels.mjs';
import { run, CW } from '../src/sim.mjs';
import { candidates } from './solve.mjs';

const want = process.argv[2] ?? 'the crate';
const level = LEVELS.find((l) => l.name === want);
if (!level) { console.error(`no room called "${want}"`); process.exit(1); }

const cell = (k) => `${k % CW},${Math.floor(k / CW)}`;
console.log(`${level.name}: start ${level.start}  core ${level.core.x},${level.core.y}` +
            `  plates ${level.plates.map((p) => `${p.id}@${p.x},${p.y}`).join(' ')}` +
            `  crates ${level.crates.map((c) => c.join(',')).join(' ') || 'none'}\n`);

for (const c of candidates(level)) {
  const w = run(level, [], c.tape);
  const b = w.bodies[0];
  console.log(`${c.label.padEnd(36)} body ends ${String(b.x + ',' + b.y).padEnd(7)}` +
              ` crate ${w.crates.map((q) => `${q.x},${q.y}`).join(' ') || '-'}`.padEnd(14) +
              ` HIGH ${[...w.high].map(cell).join(' ') || 'none'}`);
}
