// Every random number in the game comes from here.
//
// Nothing calls Math.random(). That is not fussiness: the stress harness replays thousands of
// simulated hours and compares runs, and a single unseeded call anywhere makes a replay diverge
// and turns a reproducible bug into a ghost. The rule is enforced by a test that greps the source.
//
// mulberry32: 32 bits of state, good enough distribution for a game, and identical in every
// engine because it only uses operations JS defines exactly (>>> and Math.imul).

export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    /** float in [0,1) */
    next,
    /** float in [lo,hi) */
    range: (lo, hi) => lo + next() * (hi - lo),
    /** integer in [lo,hi] inclusive */
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    /** true with probability p */
    chance: (p) => next() < p,
    /** one element, or undefined for an empty list */
    pick: (arr) => (arr.length ? arr[Math.floor(next() * arr.length)] : undefined),
    /** in place, Fisher-Yates */
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    /** the whole state, so a run can be saved and resumed bit-for-bit */
    save: () => a,
    load: (v) => { a = v >>> 0; },
  };
}

// A second, independent stream for things that must NOT affect the simulation — screen shake,
// particle jitter, which blade of grass sways. Keeping them off the main stream means turning
// the juice up or down can never change where an enemy spawns.
export const cosmetic = makeRng(0x5eed1e55);
