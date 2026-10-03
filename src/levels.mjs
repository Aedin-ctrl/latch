// The rooms, written as text so a human can read one at a glance.
//
//   #  wall          .  floor        @  where you wake up
//   1234  plates     abcd  doors     O  the core
//   x  crate
//
// A door's letter names the plates that open it: door `a` opens when every plate listed in
// `wiring.a` is HIGH. The core lists its own plates the same way. Nothing is inferred from
// position, because a puzzle that depends on which plate happens to be nearest is a puzzle nobody
// can read.

import { CW, CH, FLOOR, WALL, PLATE, DOOR, CORE } from './sim.mjs';

function parse({ name, art, wiring, core, budget, teaches }) {
  const rows = art.trim().split('\n').map((r) => r.replace(/^\s+/, ''));
  if (rows.length !== CH) throw new Error(`${name}: ${rows.length} rows, want ${CH}`);

  const tiles = new Uint8Array(CW * CH);
  const plates = [], doors = [], crates = [];
  let start = null, coreCell = null;
  const plateKey = {};

  rows.forEach((row, y) => {
    if (row.length !== CW) throw new Error(`${name}: row ${y} is ${row.length} wide, want ${CW}`);
    [...row].forEach((ch, x) => {
      const k = y * CW + x;
      if (ch === '#') tiles[k] = WALL;
      else if (ch >= '1' && ch <= '9') { tiles[k] = PLATE; plates.push({ x, y, id: ch }); plateKey[ch] = k; }
      else if (ch >= 'a' && ch <= 'f') { tiles[k] = DOOR; doors.push({ x, y, id: ch }); }
      else if (ch === 'O') { tiles[k] = CORE; coreCell = { x, y }; }
      else {
        tiles[k] = FLOOR;
        if (ch === '@') start = [x, y];
        else if (ch === 'x') crates.push([x, y]);
      }
    });
  });

  if (!start) throw new Error(`${name}: no @`);
  if (!coreCell) throw new Error(`${name}: no core`);

  for (const d of doors) {
    const w = wiring[d.id];
    if (!w) throw new Error(`${name}: door ${d.id} is not wired to anything`);
    d.plates = [...w].map((p) => {
      if (plateKey[p] === undefined) throw new Error(`${name}: door ${d.id} wired to missing plate ${p}`);
      return plateKey[p];
    });
  }
  coreCell.plates = [...(core ?? '')].map((p) => {
    if (plateKey[p] === undefined) throw new Error(`${name}: core wired to missing plate ${p}`);
    return plateKey[p];
  });

  return { name, tiles, plates, doors, crates, start, core: coreCell, budget, teaches, art };
}

export const LEVELS = [
  parse({
    name: 'the discharge',
    teaches: 'you come back. so does the last',
    // One plate, one door, one core. You cannot stand on the plate and walk through the door, so
    // the room is a two-line proof that the game needs ghosts at all.
    art: `
      ########################
      #......................#
      #......................#
      #....@.................#
      #......................#
      #....1.................#
      #......................#
      #......................#
      ###########a############
      #......................#
      #......................#
      #......................#
      #...............O......#
      #......................#
      #......................#
      ########################
`,
    wiring: { a: '1' },
    core: '',
    budget: 2,
  }),

  parse({
    name: 'the crate',
    teaches: 'a crate can hold a plate',
    // The same shape, but there is a crate. One loop to push it onto the plate, one to walk
    // through — which looks like the room above until you notice the budget is still 2 and there
    // are now TWO doors.
    art: `
      ########################
      #......................#
      #......................#
      #.......x.......1......#
      #......................#
      #......................#
      #......................#
      #..@...................#
      #......................#
      #......................#
      #......................#
      #.................O....#
      #....2.................#
      #......................#
      #......................#
      ########################
`,
    wiring: {},
    core: '12',
    budget: 2,
  }),

  parse({
    name: 'two voices',
    teaches: 'two plates, on the same tick',
    // The core itself is wired. Nothing opens a way through: you simply have to be in two places
    // on one tick, which is three loops — one for each plate, and one to stand on the core.
    art: `
      ########################
      #......................#
      #..1................2..#
      #......................#
      #......................#
      #......................#
      #..........@...........#
      #......................#
      #......................#
      #..........O...........#
      #......................#
      #......................#
      #......................#
      #......................#
      #......................#
      ########################
`,
    wiring: {},
    core: '12',
    budget: 3,
  }),

  parse({
    name: 'the long room',
    teaches: 'the way out stays open too',
    // The far plate is a long walk. Holding it costs a whole discharge, and the crate is the only
    // way to buy the second signal back.
    art: `
      ########################
      #......................#
      #......................#
      #..@...................#
      #......................#
      #......1...............#
      #......................#
      #......................#
      ############a###########
      #......................#
      #......................#
      #...2..................#
      #..................O...#
      #......................#
      #......................#
      ########################
`,
    wiring: { a: '1' },
    core: '2',
    budget: 3,
  }),

  parse({
    name: 'the corridor',
    teaches: 'a door you come back through',
    art: `
      ########################
      #..........#...........#
      #..........#...........#
      #....1.....#......2....#
      #..........#...........#
      #..........a...........#
      #..........#...........#
      #..........#...........#
      #..........#...........#
      #...@......#...........#
      #..........#...........#
      #..........#.....O.....#
      #..........#...........#
      #..........#...........#
      #..........#...........#
      ########################
`,
    wiring: { a: '1' },
    core: '2',
    budget: 3,
  }),
  parse({
    name: 'two crates',
    teaches: 'two crates, and still a body short',
    art: `
      ########################
      #......................#
      #.@.x................1.#
      #......................#
      #......................#
      #......................#
      #......................#
      #......................#
      #.3..................O.#
      #......................#
      #......................#
      #......................#
      #......................#
      #......................#
      #...x................2.#
      ########################
`,
    wiring: {},
    core: '123',
    budget: 2,
  }),
  parse({
    name: 'the keeper',
    teaches: 'everything at once',
    art: `
      ########################
      #......................#
      #......................#
      #..@....x........1.....#
      #......................#
      #......................#
      #......................#
      ############a###########
      #......................#
      #......................#
      #..2................4..#
      #......................#
      #......O...............#
      #...........3..........#
      #......................#
      ########################`,
    wiring: { a: '1' },
    core: '234',
    budget: 4,
  }),
];

export const byName = (n) => LEVELS.find((l) => l.name === n);
