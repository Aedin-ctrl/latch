// An indexed-colour framebuffer, the way the hardware did it.
//
// Nothing in this file ever stores or draws an RGB colour. The buffer holds a *palette code* per
// pixel — four bits of sub-palette and two bits of entry — and the colours are only resolved at
// present time, through a lookup table built from whichever palette set is active.
//
// That indirection is the whole point, and it is why this had to be written before anything else:
//
//   * The 25-colour rule holds BY CONSTRUCTION. You cannot draw an illegal colour, because you
//     cannot name one. There is no frame-scanning validator because there is nothing to validate.
//   * Night is a palette swap, not a dark overlay. Dusk rotates one LUT. It costs nothing.
//   * A lamp rotates a *region* back toward daylight, which is impossible with fillRect and is
//     exactly what the hardware's attribute table did.
//
// Retro-fitting this at hour eight would have meant rewriting every draw call in the project.

import { MASTER, colour } from './palette.mjs';

export const W = 256;
export const H = 240;

/** A palette code: which sub-palette (0-3 background, 4-7 sprite) and which of its 3 entries. */
export const code = (pal, entry) => (pal << 2) | entry;
export const BACKDROP = code(0, 0);

/** Entry 0 of a sprite palette is transparent; this is the one value draws skip. */
const isTransparent = (c) => c >= 16 && (c & 3) === 0;

function buildLut(set) {
  // 32 possible codes -> packed little-endian RGBA, ready to drop straight into a Uint32Array
  // view of the ImageData. Rebuilt only when a palette set is first seen, so a swap is free.
  const lut = new Uint32Array(32);
  for (let pal = 0; pal < 8; pal++) {
    const which = pal < 4 ? 'bg' : 'spr';
    for (let entry = 0; entry < 4; entry++) {
      const css = colour(set, which, pal & 3, entry);
      if (css === null) { lut[code(pal, entry)] = 0; continue; }   // transparent, never presented
      const r = parseInt(css.slice(1, 3), 16);
      const g = parseInt(css.slice(3, 5), 16);
      const b = parseInt(css.slice(5, 7), 16);
      lut[code(pal, entry)] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }
  }
  return lut;
}

export class Screen {
  constructor() {
    this.fb = new Uint8Array(W * H);          // palette codes
    this.lit = new Uint8Array(W * H);         // 0 dark, 1 inside a lamp pool
    this.luts = new Map();                    // palette set -> Uint32Array
    this.dark = null;                         // the set used where lit === 0
    this.light = null;                        // the set used where lit === 1
    this.flash = 0;     // frames of white-out remaining; set by whoever wants one
  }

  /** Both palette sets for this frame. Swapping these IS the day/night transition. */
  setPalettes(darkSet, lightSet) {
    this.dark = darkSet;
    this.light = lightSet ?? darkSet;
    for (const s of [this.dark, this.light]) {
      if (!this.luts.has(s)) this.luts.set(s, buildLut(s));
    }
  }

  clear(c = BACKDROP) {
    this.fb.fill(c);
    this.lit.fill(0);
  }

  // --- primitives. Every one takes integers; nothing here accepts a float position. ---

  px(x, y, c) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    if (isTransparent(c)) return;
    this.fb[y * W + x] = c;
  }

  rect(x, y, w, h, c) {
    x |= 0; y |= 0; w |= 0; h |= 0;
    if (isTransparent(c)) return;
    const x0 = Math.max(0, x), x1 = Math.min(W, x + w);
    const y0 = Math.max(0, y), y1 = Math.min(H, y + h);
    for (let yy = y0; yy < y1; yy++) this.fb.fill(c, yy * W + x0, yy * W + x1);
  }

  hline(x, y, w, c) { this.rect(x, y, w, 1, c); }
  vline(x, y, h, c) { this.rect(x, y, 1, h, c); }

  /** Checkerboard of two codes — how the hardware faked a tone between two colours. */
  dither(x, y, w, h, a, b, phase = 0) {
    x |= 0; y |= 0;
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        this.px(x + xx, y + yy, ((x + xx + y + yy + phase) & 1) ? b : a);
      }
    }
  }

  /**
   * A sprite is rows of entry values 0-3; 0 is transparent. The palette is chosen at draw time,
   * so the same eight bytes of art can be a person, an enemy or a ghost of itself.
   */
  sprite(x, y, rows, pal, flipX = false) {
    x |= 0; y |= 0;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let i = 0; i < row.length; i++) {
        const e = row[flipX ? row.length - 1 - i : i];
        if (!e) continue;
        this.px(x + i, y + r, code(pal, e));
      }
    }
  }

  /**
   * Mark a lamp pool. The rim is dithered over two cells so the edge reads as a gradient the
   * hardware could actually have produced, rather than as a hard circle.
   */
  lamp(cx, cy, r) {
    cx |= 0; cy |= 0; r |= 0;
    if (r <= 0) return;
    const r2 = r * r, inner = (r - 5) * (r - 5), mid = (r - 2) * (r - 2);
    const x0 = Math.max(0, cx - r), x1 = Math.min(W, cx + r + 1);
    const y0 = Math.max(0, cy - r), y1 = Math.min(H, cy + r + 1);
    for (let y = y0; y < y1; y++) {
      const dy = y - cy, dy2 = dy * dy;
      for (let x = x0; x < x1; x++) {
        const dx = x - cx, d2 = dx * dx + dy2;
        if (d2 > r2) continue;
        if (d2 <= inner) this.lit[y * W + x] = 1;
        else if (d2 <= mid) { if (((x + y) & 1) === 0) this.lit[y * W + x] = 1; }
        else if (((x & 1) === 0) && ((y & 1) === 0)) this.lit[y * W + x] = 1;
      }
    }
  }

  /**
   * Forget any lamplight over a region. Panels and titles need to resolve through one palette, or
   * the letters that happen to fall inside a lamp pool come out a different colour from the rest
   * of the sentence.
   */
  clearLit(x, y, w, h) {
    x |= 0; y |= 0;
    const x0 = Math.max(0, x), x1 = Math.min(W, x + w);
    const y0 = Math.max(0, y), y1 = Math.min(H, y + h);
    for (let yy = y0; yy < y1; yy++) this.lit.fill(0, yy * W + x0, yy * W + x1);
  }

  text(x, y, str, c) {
    x |= 0; y |= 0;
    let cx = x;
    for (const ch of str.toUpperCase()) {
      const g = FONT[ch];
      if (g) {
        for (let r = 0; r < 8; r++) {
          const bits = g[r];
          for (let i = 0; i < 8; i++) if (bits & (0x80 >> i)) this.px(cx + i, y + r, c);
        }
      }
      cx += 8;
    }
    return cx - x;
  }

  textWidth(str) { return str.length * 8; }

  centre(y, str, c) { this.text(((W - this.textWidth(str)) / 2) | 0, y, str, c); }

  /** Centred inside a box rather than inside the screen — for text on a card. */
  centreIn(x, w, y, str, c) { this.text((x + (w - this.textWidth(str)) / 2) | 0, y, str, c); }

  /** Resolve the whole buffer through the two LUTs and hand it to the canvas. */
  present(ctx, imageData) {
    // hoisted: this was allocating a fresh view over the same buffer sixty times a second
    if (this._out === undefined || this._outFor !== imageData.data.buffer) {
      this._out = new Uint32Array(imageData.data.buffer);
      this._outFor = imageData.data.buffer;
    }
    const out = this._out;
    const dark = this.luts.get(this.dark);
    const light = this.luts.get(this.light);
    const fb = this.fb, lit = this.lit;

    if (this.flash > 0) {
      // A white-out is a palette event, not an overlay: every code resolves to the same colour.
      const white = 0xfffefeff | 0;
      out.fill(white >>> 0);
    } else if (dark === light) {
      for (let i = 0; i < fb.length; i++) out[i] = dark[fb[i]];
    } else {
      for (let i = 0; i < fb.length; i++) out[i] = (lit[i] ? light : dark)[fb[i]];
    }
    ctx.putImageData(imageData, 0, 0);
  }
}

// ---------------------------------------------------------------------------------------------
// An 8x8 font. Uppercase, digits and the handful of marks the game actually prints — which is the
// title, three signposts and the ending, and nothing else.
// ---------------------------------------------------------------------------------------------
const F = (...rows) => rows;
export const FONT = {
  'A': F(0x18,0x3c,0x66,0x66,0x7e,0x66,0x66,0x00),
  'B': F(0x7c,0x66,0x66,0x7c,0x66,0x66,0x7c,0x00),
  'C': F(0x3c,0x66,0x60,0x60,0x60,0x66,0x3c,0x00),
  'D': F(0x78,0x6c,0x66,0x66,0x66,0x6c,0x78,0x00),
  'E': F(0x7e,0x60,0x60,0x7c,0x60,0x60,0x7e,0x00),
  'F': F(0x7e,0x60,0x60,0x7c,0x60,0x60,0x60,0x00),
  'G': F(0x3c,0x66,0x60,0x6e,0x66,0x66,0x3e,0x00),
  'H': F(0x66,0x66,0x66,0x7e,0x66,0x66,0x66,0x00),
  'I': F(0x3c,0x18,0x18,0x18,0x18,0x18,0x3c,0x00),
  'J': F(0x1e,0x0c,0x0c,0x0c,0x0c,0x6c,0x38,0x00),
  'K': F(0x66,0x6c,0x78,0x70,0x78,0x6c,0x66,0x00),
  'L': F(0x60,0x60,0x60,0x60,0x60,0x60,0x7e,0x00),
  'M': F(0x63,0x77,0x7f,0x6b,0x63,0x63,0x63,0x00),
  'N': F(0x66,0x76,0x7e,0x7e,0x6e,0x66,0x66,0x00),
  'O': F(0x3c,0x66,0x66,0x66,0x66,0x66,0x3c,0x00),
  'P': F(0x7c,0x66,0x66,0x7c,0x60,0x60,0x60,0x00),
  'Q': F(0x3c,0x66,0x66,0x66,0x6e,0x6c,0x36,0x00),
  'R': F(0x7c,0x66,0x66,0x7c,0x78,0x6c,0x66,0x00),
  'S': F(0x3e,0x60,0x60,0x3c,0x06,0x06,0x7c,0x00),
  'T': F(0x7e,0x18,0x18,0x18,0x18,0x18,0x18,0x00),
  'U': F(0x66,0x66,0x66,0x66,0x66,0x66,0x3c,0x00),
  'V': F(0x66,0x66,0x66,0x66,0x66,0x3c,0x18,0x00),
  'W': F(0x63,0x63,0x63,0x6b,0x7f,0x77,0x63,0x00),
  'X': F(0x66,0x66,0x3c,0x18,0x3c,0x66,0x66,0x00),
  'Y': F(0x66,0x66,0x66,0x3c,0x18,0x18,0x18,0x00),
  'Z': F(0x7e,0x06,0x0c,0x18,0x30,0x60,0x7e,0x00),
  '0': F(0x3c,0x66,0x6e,0x7e,0x76,0x66,0x3c,0x00),
  '1': F(0x18,0x38,0x18,0x18,0x18,0x18,0x7e,0x00),
  '2': F(0x3c,0x66,0x06,0x0c,0x18,0x30,0x7e,0x00),
  '3': F(0x3c,0x66,0x06,0x1c,0x06,0x66,0x3c,0x00),
  '4': F(0x0c,0x1c,0x3c,0x6c,0x7e,0x0c,0x0c,0x00),
  '5': F(0x7e,0x60,0x7c,0x06,0x06,0x66,0x3c,0x00),
  '6': F(0x1c,0x30,0x60,0x7c,0x66,0x66,0x3c,0x00),
  '7': F(0x7e,0x06,0x0c,0x18,0x30,0x30,0x30,0x00),
  '8': F(0x3c,0x66,0x66,0x3c,0x66,0x66,0x3c,0x00),
  '9': F(0x3c,0x66,0x66,0x3e,0x06,0x0c,0x38,0x00),
  ' ': F(0,0,0,0,0,0,0,0),
  '.': F(0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x00),
  ',': F(0x00,0x00,0x00,0x00,0x18,0x18,0x30,0x00),
  '-': F(0x00,0x00,0x00,0x7e,0x00,0x00,0x00,0x00),
  "'": F(0x18,0x18,0x30,0x00,0x00,0x00,0x00,0x00),
  '!': F(0x18,0x18,0x18,0x18,0x18,0x00,0x18,0x00),
  '?': F(0x3c,0x66,0x06,0x0c,0x18,0x00,0x18,0x00),
  ':': F(0x00,0x18,0x18,0x00,0x00,0x18,0x18,0x00),
  '/': F(0x06,0x0c,0x18,0x18,0x18,0x30,0x60,0x00),
  '+': F(0x00,0x18,0x18,0x7e,0x18,0x18,0x00,0x00),
  '(': F(0x0c,0x18,0x30,0x30,0x30,0x18,0x0c,0x00),
  ')': F(0x30,0x18,0x0c,0x0c,0x0c,0x18,0x30,0x00),
};
