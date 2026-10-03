# LATCH

*A latch is a thing that holds after the hand is gone.* That is the door, the flip-flop, and the
game.

The fourth game on this engine, and the first one that is a **puzzle**. Filament is continuous
resource management, The Far Light is continuous reactive physics, Lockout is stochastic per-turn
choice against an opponent. This is deterministic, perfect-information, and the player's input is a
**program** rather than a reaction.

---

## 0. The plot

The sun went out two generations ago, and what is left of the coast is strung along a copper line
that ends at a lighthouse. When the last of that line was relit the lighthouse threw its beam over
the water, and something out there answered — a station on a drowned rig, still signalling, ten
seconds at a time. Its keeper wired the whole place to a capacitor bank that fires, holds for ten
seconds, and dies, and he never found a way to be in four places inside one discharge. You are in
the station now; you come back with every discharge, and so does everything you did in the last one.

Filament ends with a light answered from across the water. The Far Light opens on that answer. This
is what was on the other end of it.

---

## 1. The shape of it

**You are in a room that reboots every ten seconds, and every reboot you come back with an
afterimage of everything you did in the last one.**

One screen, no scrolling: 24×16 cells of 8 pixels. A visible ten-second clock. You can stand on a
plate to hold a door open, or you can go through the door. You cannot do both — so you spend this
discharge standing on the plate, and when the light dies and comes back, there is a *you* standing
on that plate, and now you go through the door.

**The one verb is _commit_.** Mechanically it is a direction and one action button. But the unit of
play is a whole ten-second loop, and a loop cannot be paused, undone, or edited once begun. That is
Jump King's commitment and Kingdom's "the night starts whether or not you are ready", turned into a
puzzle: the loop ends whether or not you are ready.

### The devices

| | |
|---|---|
| **plate** | HIGH while any body or crate is on it |
| **door** | open while its plates are HIGH. Recomputed from scratch every tick, never refcounted. |
| **crate** | pushed one cell by walking into it. A crate on a plate is the only way to hold a signal **without spending a body**. Resets every loop. |
| **core** | the way out. Needs every plate it is wired to HIGH **on the same tick**, while you stand on it. |

### The budget

Each room prints a **discharge budget** as pips — and that number is also the *proven minimum*
number of loops the room takes. You cannot brute-force a room with eleven sloppy ghosts. Exceed the
budget and the room restarts.

The loop count is at once the constraint, the score, and the thing the solver proves. The mechanic
and the proof are the same integer, which is the best property this design has.

### Why it holds after ninety seconds

Because the *kind* of thinking changes on loop two. Loop one is exploration. Loop two is
collaboration with a stranger who is you and who will not deviate. By the last room you are
scheduling four voices on one clock, where the only instrument is a person who can be in exactly
one place.

And every room ends in a performance: there is no ghost for the final loop, so the last discharge is
played live against all the past ones, who must each arrive right. Three plates going HIGH on the
same tick under three afterimages is Lockout's double rendered as a puzzle — **simultaneity**, which
is the thing Lockout established and did not use up.

---

## 2. The council, before any code

Three ideas were rejected:

- **A logic-gate / signal-routing puzzler.** The obvious thing for an ECE student, and dead on
  arrival: **Gatecraft already exists** and is live as Projects 11. Combinational logic is taken.
  LATCH is the sequential half — latches and timing, not gates and truth tables.
- **A turn-based tactics roguelike.** Content-hungry, and its shape — pick the best of N options
  against an AI each turn — is Lockout with a map.
- **A rhythm / keying game.** Hold-and-release timing is The Far Light's exact skill, and its
  verification ceiling is low: "did the chart line up" is a far weaker claim than "is this room
  solvable at all, and in how few loops".

### 2.1 The one thing most likely to go wrong

Whether a ghost is a recording of **positions** or a recording of **inputs**. Both are defensible
for five minutes and only one survives, and the symptom of choosing wrong does not arrive until the
fourth room, when a crate first stands where a ghost was going to walk.

- Record **positions** and ghosts are perfectly faithful and completely inert — film, not actors.
  They walk through closed doors; they cannot push crates; the room stops being a simulation.
- Record **inputs** and ghosts are actors — but then the world must be bit-identical from tick 0 on
  every loop, or ghost 1 drifts the instant ghost 2 moves a crate, and the player watches their own
  past self do something they never did.

So the thing built first, before a single tile was drawn:

```js
run(level, tapes) -> history      // pure, deterministic, no partial state
```

The game is **not** a world that persists while ghosts accumulate. It is a pure function of a level
and a list of tapes, re-evaluated from tick 0 whenever a tape is added, with the live frame being
`run(level, tapes ++ liveSoFar)`. Shaped that way, **ghost desync is impossible by construction** —
the same move as `pixel.mjs` making an illegal colour impossible by construction, which is the
highest-value hour this project has ever spent.

Two rulings written down before the first line of code could settle them by accident:

- **Ghosts and the player do not collide with each other.** An afterimage is light, not a body.
  Both collide with crates and doors. This keeps the puzzle honest, stops a late player trapping a
  ghost into nonsense, and is diegetically free.
- **Crate pushes resolve in ghost order, oldest first, player last.**

### 2.2 The trap The Far Light already taught

The solver must not carry its own copy of the movement rules. The Far Light's tower verifier
reimplemented the physics it was verifying, drifted, and certified an unclimbable tower as
climbable. Here the solver searches a coarsened abstraction purely as a **heuristic**, and every
candidate solution is certified by replaying it through the real `run()`. One implementation of the
rules; the proof and the game use the same one.

---

## 3. Verification

**Per-tick invariants**

1. **Replay identity** — the one that matters. After every loop, re-run the whole scenario from tick
   0 and assert the world state at every tick equals what was observed live. This kills the entire
   class of "my past self did something it never did", which is the only bug that destroys trust in
   this genre.
2. **Tape ledger** — every tape is exactly `LOOP` ticks, `ghosts.length === loopsSpent`, nothing
   appended after a loop closes.
3. **Clock** — `tick === loopsSpent * LOOP + loopT`, `loopT` in `[0, LOOP)`. Integers only.
4. **Occupancy** — no body inside a wall or a closed door; no crate in a wall; no crate pushed by
   two bodies in one tick.
5. **Signal purity** — every door recomputed from scratch from plate occupancy each tick and
   asserted equal. A refcount that drifts leaves a door stuck open, the room trivially solvable, and
   nothing in the console.
6. **Ghosts may be blocked, never moved** — a ghost's position is always one its own tape could have
   produced.
7. No `Math.random`, no `Date.now` in the simulation, checked by grep as Filament does.

**What the solver proves**, in order of value:

- **(a)** solvable within the budget;
- **(b)** **not** solvable in budget − 1 — the lower bound;
- **(c)** every device is load-bearing: delete it and the minimum changes, or the room dies;
- **(d)** a recorded tape set, replayed through the real `sim.mjs`, finishes the room.

**The failure mode this is aimed at: a room that is solvable in one loop.** The ghosts become
scenery, the idea the game is about is never taught, and a harness that only asks "is it solvable"
passes it happily — which is exactly Lockout's dominated third of the deck and Filament's
unreachable dynamo. **(b)** is what catches it. The second-order version is a room solvable by N
*identical* tapes, where the ghosts are a difficulty slider rather than a mechanic; that is caught
by asserting the room is unsolvable when all tapes are required to be equal.

---

## 4. Log

Written as it happened. Entries are added when something is established or something breaks.

- **Concept settled**, with the council's reasoning above, before any code.

- **`run(level, tapes)` written first**, as planned. Nothing else was written until it existed.

- **Four bugs found before a single pixel was drawn**, all by the solver rather than by playing:

  1. **Crates could never be pushed more than one cell.** Bodies were advanced before crates, so a
     body finishing a step immediately tried the next push and found the crate it had just pushed
     still flagged as moving — refused, every time. `pushedBy` had the same fault one tick out of
     phase: cleared at the end of the tick instead of the start, so a stale claim blocked a
     different body from touching a crate nobody was pushing. Crates settle first now.
  2. **Two rooms had the door and the gap in the wall in different columns**, so you simply walked
     around the door. Found by `tools/lint.mjs`, which asks the much dumber question — can anything
     be reached at all — before the solver asks whether anything can be solved. Both rooms are now
     generated from coordinates rather than typed as ASCII, because I got the alignment wrong twice
     by hand.
  3. **Every generated route overshot.** A step takes six ticks, and the tape generator held each
     direction for eight — and holding a direction one tick past the end of a step does not idle, it
     starts the next step in the same direction. So every route walked a third of a cell too far,
     every time, and the solver reported five rooms unsolvable when the rooms were fine.
  4. **And then it was still wrong in one place.** The fix above was applied to three of the four
     loops that generate input; the fourth was missed and nothing noticed, because a solver that
     says "no solution" looks exactly the same whether the room is impossible or the plan was never
     really tried. `tools/plans.mjs` exists because of this: it runs every candidate on its own and
     prints what actually happened, so a plan labelled *push the crate onto plate 1* has to prove
     the crate ended up on plate 1.

- **Budgets are measured, not asserted.** The first version checked "solvable in `budget`, not in
  `budget - 1`", which sounds equivalent to finding the minimum and is not: the search returns the
  first plan it finds, and that plan sometimes contained a wasted discharge, so a room reported as
  needing three was doing it in two. The solver now searches upward from one and reports the
  smallest number that works. Two rooms had their budgets wrong by one, in opposite directions.

- **The pair effect**, which the device-by-device check cannot see. "Delete this device; does the
  minimum change?" is a good question about one device and a bad question about two. A crate makes
  a door *free* — hold the door permanently open and the minimum does not move, because the crate
  was already paying for it — so the door reads as dead while being the whole reason the crate is
  worth anything. The check reports it as a note rather than failing, because failing on it would
  mean never putting a crate and a door in the same room, which is letting the measurement design
  the game.

### The rooms, as measured

| room | teaches | minimum |
|---|---|---|
| the discharge | the loop, and that you come back | 2 |
| the crate | a crate holds a signal without spending a body | 2 |
| two voices | two plates HIGH on the same tick | 3 |
| the long room | a door on the way to the core must be held open at the end too | 3 |
| the keeper | all of it | 4 |

---

## 5. The half the harness cannot see

Every bug above was found by a tool. Everything below was found by looking at a screenshot, which
is the lesson this project keeps paying for: **no tool in any of these four repos imports
`render.mjs`**, so a soak harness proves the simulation is sound and proves nothing about the half
of the code a player experiences.

- **The palette check now refuses an entry that holds the backdrop colour**, and caught three faults
  before a single frame was drawn. The sea would have vanished as the bank died; the core's whiteout
  would have erased the room it was celebrating; and `C.pale` pointed at `$20`, which is the same
  `#fefeff` as `$30`, so the bright end of the ramp had two identical steps and `pale` was white
  under another name. Some version of this trap has now cost four games part of a frame. It is
  checked rather than remembered.
- **The sea was drawn behind the room as well as around it**, and the deck was filled from the same
  palette — so the floor and the water were the same darkness and the room had no inside.
- **The deck and the bulkheads were near-neighbour blues.** The structure of the room, which is the
  thing the entire game is planned against, was being carried by a one-pixel highlight along the top
  of each wall.
- **The afterimages were drawn solid**, which made four of them read as four more people in a
  slightly different colour. Dithered every frame, they read as light burned into the dark, and the
  live body becomes the only solid figure in the room.
- **The toast printed on top of the room's subtitle**, so both became unreadable at exactly the
  moment the toast had something to say. It takes the subtitle's place instead.
- **Labels ran off both edges of the screen.** `centre` does not wrap and has no ellipsis; five of
  the first five labels were too long. They are clipped, and the lengths are checked.

## 6. The touch bug, found the same way as the last three

`tools/mobile.mjs` drives the live game in a 390×844 touch context. It reported the room advancing
only 48 ticks over eighteen seconds of tapping — because the entire band below the room abandoned
the current discharge, and the test kept hitting it.

That is not a test artefact. On a phone it means a stray thumb throws away up to ten seconds of a
plan, with no warning and no undo, in a game whose unit of play is a plan. It is a 68×14 button now,
and **the hit box is exported by the renderer rather than restated in the input layer** — because
Lockout shipped with a hit box twelve pixels narrower than the card it was testing, and The Far
Light shipped a verifier that reimplemented the physics it was verifying. Two copies of a layout are
two layouts.

After the fix the same test accumulates 435 ticks and walks the body across the room.

## 7. Verification, as it stands

| | |
|---|---|
| `tools/lint.mjs` | can anything be reached at all — asked before anything harder |
| `tools/solve.mjs` | the minimum discharges per room, every plan judged by the real `run()` |
| `tools/plans.mjs` | does each candidate plan do what its label says |
| `tools/play.mjs` | every room played start to finish through `newGame`/`step`, every tick checked |
| `tools/stress.mjs` | 500 runs / 500 hours of adversarial input, and it reports how much it did |
| `tools/robust.mjs` | restarts, resizes, backgrounding, mute spam, audio-node leaks |
| `tools/mobile.mjs` | (in Filament) all four games on a phone |

**A harness that pressed nothing proves nothing.** Three separate times tonight a test passed by
never exercising the thing it tested: a solver reporting "no solution" because its plans were never
really tried, the same solver's push loop missed by a fix applied to three of its four sites, and
`stress.mjs` pressing `NONE` for three hundred runs because `rng.int` takes two arguments and was
given one — `DIRS[NaN]` is `undefined`, and `undefined & 15` is `0`. So the soak now counts the
distinct inputs it issued, the steps taken, the crates moved and the ticks on which a plate was held,
and says **THE HARNESS BARELY RAN** rather than reporting a pass.
