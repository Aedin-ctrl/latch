// Is each room even physically sane?
//
// Before asking "can this be solved", ask "can anything be reached". The solver returning NO
// SOLUTION for all five rooms at once is not a statement about the puzzles, it is a statement that
// something structural is wrong — and the first room has two devices in it.
import { LEVELS } from '../src/levels.mjs';
import { CW, CH, WALL, DOOR } from '../src/sim.mjs';

const key = (x, y) => y * CW + x;

function reach(level, doorsOpen) {
  const seen = new Uint8Array(CW * CH);
  const q = [level.start];
  seen[key(...level.start)] = 1;
  for (let h = 0; h < q.length; h++) {
    const [x, y] = q[h];
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) continue;
      const k = key(nx, ny);
      if (seen[k]) continue;
      const t = level.tiles[k];
      if (t === WALL) continue;
      if (t === DOOR && !doorsOpen) continue;
      seen[k] = 1; q.push([nx, ny]);
    }
  }
  return seen;
}

let bad = 0;
for (const l of LEVELS) {
  const open = reach(l, true), shut = reach(l, false);
  const notes = [];
  if (!open[key(l.core.x, l.core.y)]) notes.push('CORE UNREACHABLE even with every door open');
  for (const p of l.plates) if (!open[key(p.x, p.y)]) notes.push(`plate ${p.id} UNREACHABLE`);
  for (const [cx, cy] of l.crates) if (!open[key(cx, cy)]) notes.push(`a crate is walled in`);
  // a door is pointless if what is past it can be reached without it
  if (l.doors.length && shut[key(l.core.x, l.core.y)] && l.core.plates.length === 0) {
    notes.push('the core can be reached with every door SHUT — the doors do nothing');
  }
  for (const d of l.doors) {
    const past = [[d.x + 1, d.y], [d.x - 1, d.y], [d.x, d.y + 1], [d.x, d.y - 1]]
      .filter(([x, y]) => x >= 0 && y >= 0 && x < CW && y < CH)
      .filter(([x, y]) => l.tiles[key(x, y)] !== WALL);
    if (past.length < 2) notes.push(`door ${d.id} at ${d.x},${d.y} is a door into a wall ` +
                                    `(only ${past.length} open side${past.length === 1 ? '' : 's'})`);
  }
  console.log(`${l.name.padEnd(16)} ${notes.length ? notes.join('; ') : 'sane'}`);
  bad += notes.length ? 1 : 0;
}
process.exit(bad ? 1 : 0);
