// A drowned rig, lit by a capacitor bank that fires, holds for ten seconds, and dies.
//
// The dying is a PALETTE SWAP, not an overlay. The room is drawn once and the colours it resolves
// through change — which is how an NES did it, costs nothing, and means the ten-second countdown is
// legible from across the room without a single number on screen.
//
// Same hard budget as the other three: 1 backdrop + 4 background sub-palettes of 3 + 4 sprite
// sub-palettes of 3, 25 colours on screen.
//
// NOTE, for the third project running: $0F is black and $00 is a MID GREY, and several palettes
// below hold the backdrop's black in an entry. Anything drawn with such an entry is painted black
// on black and is silently not there. In Lockout that cost forty per cent of the frame.

export const MASTER = [
  '#656565', '#002d69', '#131f7f', '#3c137c', '#600b62', '#730a37', '#710f07', '#5a1a00',
  '#342800', '#0b3400', '#003c00', '#003d10', '#003448', '#000000', '#000000', '#000000',
  '#aeaeae', '#0f63b3', '#4051d0', '#7841cc', '#a736a9', '#c03470', '#bd3c30', '#9f4a00',
  '#6d5c00', '#366d00', '#077704', '#00793d', '#00727d', '#000000', '#000000', '#000000',
  '#fefeff', '#5db3ff', '#8fa1ff', '#c890ff', '#f785fa', '#ff83c0', '#ff8b7f', '#ef9a49',
  '#bdac25', '#89bc2a', '#5ec648', '#45c882', '#48c2c9', '#4e4e4e', '#000000', '#000000',
  '#fefeff', '#bcdfff', '#d1d8ff', '#e8cfff', '#fbc9ff', '#ffc9e9', '#ffd0c6', '#f8d7a8',
  '#e6e096', '#d1e695', '#bfeaa4', '#b3ecbf', '#b2e9e2', '#b8b8b8', '#000000', '#000000',
];

const C = {
  // $20 and $30 are BOTH #fefeff on this hardware, so a ramp written slate-grey-pale-white had
  // two identical steps at the bright end and `pale` was simply white under another name. $3D is
  // the light grey the ramp actually needs.
  black: 0x0f, slate: 0x00, grey: 0x10, pale: 0x3d, white: 0x30,
  navy: 0x01, blue: 0x11, sky: 0x21, ice: 0x31,
  indigo: 0x02, steel: 0x12, lilac: 0x22,
  deep: 0x0c, teal: 0x0b, cyan: 0x1c, jade: 0x1b, spring: 0x2b, mint: 0x3b,
  rust: 0x06, red: 0x16, salmon: 0x26,
  umber: 0x07, amber: 0x17, gold: 0x27, cream: 0x37,
  olive: 0x08, brass: 0x18, sand: 0x38,
};

const set = (name, backdrop, bg, spr) => ({ name, backdrop, bg, spr });

// bg0 the deck plating · bg1 the sea beyond · bg2 a device at rest · bg3 a device carrying a signal
// spr0 you · spr1 an afterimage · spr2 a crate · spr3 the core
export const CHARGED = set('charged', C.black,
  [
    [C.navy,   C.indigo, C.steel],          // plating: deck dark, bulkheads brighter
    [C.deep,   C.teal,   C.cyan],           // the sea, below and around
    [C.olive,  C.brass,  C.sand],           // a plate or a door with nothing on it
    [C.jade,   C.spring, C.mint],           // and the same thing carrying a signal
  ],
  [
    [C.umber,  C.gold,   C.cream],          // you, warm, the only warm thing in the room
    [C.navy,   C.blue,   C.sky],            // an afterimage: light, not a body
    [C.rust,   C.amber,  C.sand],           // a crate
    [C.teal,   C.spring, C.white],          // the core
  ]);

/**
 * The last second and a half, as the bank runs down.
 *
 * Everything loses its blue and goes to iron. The afterimages stay visible because they are the one
 * thing that survives a discharge, which is both the mechanic and the only mercy in the room.
 */
export const DYING = set('dying', C.black,
  [
    [C.slate,  C.grey,   C.pale],
    [C.navy,   C.slate,  C.grey],      // the sea. This was C.black — the backdrop — so as the
                                       // bank died the water simply stopped existing.
    [C.umber,  C.olive,  C.brass],
    [C.olive,  C.brass,  C.sand],
  ],
  [
    [C.rust,   C.umber,  C.amber],
    [C.navy,   C.indigo, C.steel],
    [C.umber,  C.olive,  C.brass],
    [C.slate,  C.grey,   C.pale],
  ]);

/**
 * The tick the core takes: the room blows out.
 *
 * Written first as white on white, which is a flash that deletes the picture — and the one frame
 * the player most wants to see is the one where every plate is HIGH at once. It is a photographic
 * negative instead: the backdrop goes white and everything drawn on it goes dark, so the room is
 * still legible, inverted, for the moment the station fires.
 */
export const FIRED = set('fired', C.white,
  [
    [C.pale,   C.grey,   C.slate],
    [C.grey,   C.slate,  C.black],
    [C.pale,   C.grey,   C.slate],
    [C.ice,    C.sky,    C.blue],
  ],
  [
    [C.gold,   C.amber,  C.umber],
    [C.sky,    C.blue,   C.navy],
    [C.sand,   C.brass,  C.olive],
    [C.mint,   C.spring, C.teal],
  ]);

export const SETS = { CHARGED, DYING, FIRED };

/** Resolve one palette code. Entry 0 of a background palette is the backdrop; of a sprite, clear. */
export function colour(s, which, pal, entry) {
  if (entry === 0) return which === 'bg' ? MASTER[s.backdrop] : null;
  return MASTER[s[which][pal][entry - 1]];
}

export function onScreen(s) {
  const out = new Set([MASTER[s.backdrop]]);
  for (const p of s.bg) for (const e of p) out.add(MASTER[e]);
  for (const p of s.spr) for (const e of p) out.add(MASTER[e]);
  return out;
}

export const MAX_ON_SCREEN = 25;

export function validate(s, name = s.name) {
  const bad = [];
  if (s.bg.length !== 4) bad.push(`${name}: ${s.bg.length} bg palettes`);
  if (s.spr.length !== 4) bad.push(`${name}: ${s.spr.length} spr palettes`);
  for (const p of [...s.bg, ...s.spr]) {
    if (p.length !== 3) bad.push(`${name}: a palette has ${p.length} entries`);
    for (const e of p) if (!Number.isInteger(e) || e < 0 || e > 0x3f) bad.push(`${name}: ${e} invalid`);
  }
  const n = onScreen(s).size;
  if (n > MAX_ON_SCREEN) bad.push(`${name}: ${n} colours, hardware allows ${MAX_ON_SCREEN}`);

  // The trap that has cost this project a frame-and-a-half of work across three games: an entry
  // holding the backdrop colour makes anything drawn with it invisible. Legal, and almost never
  // intended, so it is worth saying out loud rather than discovering in a screenshot.
  const bd = MASTER[s.backdrop];
  s.bg.forEach((p, i) => p.forEach((e, j) => {
    if (MASTER[e] === bd) bad.push(`${name}: bg${i} entry ${j + 1} is the backdrop colour — ` +
                                   `anything drawn with it is invisible`);
  }));
  return bad;
}
