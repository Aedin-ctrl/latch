# Latch

**[Play it](https://www.aedinlai.com/latch/)** · [all four games](https://www.aedinlai.com/games/)

A station on a drowned rig, wired to a capacitor bank that fires, holds for ten seconds, and
dies. Every discharge you come back — and so does an afterimage of everything you did in the last
one.

You can stand on a plate to hold a door open, or you can walk through the door. Not both. So you
spend this discharge standing on the plate, and when the light comes back there is a *you* standing
on it.

**The whole design rests on one decision:** `run(level, tapes)` is a pure function re-evaluated from
tick 0 every single tick. A ghost cannot drift from what it recorded, because no state survives a
frame — the failure that would destroy a time-loop game is not guarded against, it is impossible to
express. That costs 4% of one frame in the worst room.

Every room prints a discharge budget, and that number is **measured, not chosen**: a solver searches
upward from one discharge until it finds the fewest that finish the room. Two rooms shipped beatable
and `tools/beat.mjs` keeps both exploits as permanent regression cases.

```sh
node tools/solve.mjs   # the minimum per room
node tools/play.mjs    # every room played through the real state machine
node tools/beat.mjs    # the two plans that once beat their budgets
```

## Run it

No build step and no dependencies. Serve the folder and open it:

```sh
python3 -m http.server 8000
```

Add `?dev` for a state hook on `window` and palette validation in the console.

## How it is checked

`tools/` holds the harnesses. They are the point of the project as much as the game is, and
`DESIGN.md` records what each of them caught.

```sh
node tools/stress.mjs     # soak, with invariants on every tick
node tools/robust.mjs     # restarts, resizes, backgrounding, audio-node leaks
```

One lesson is worth stating here rather than only in the design document: **a test that passes may
simply never have run.** Several harnesses in this project reported success while exercising almost
nothing — one pressed no buttons for three hundred runs, another never climbed past the first of
eleven screens. They now report how much they actually did, and fail loudly when that is near zero.


## The design document

[`DESIGN.md`](DESIGN.md) is the real record: the plot, the decisions and the reasoning behind them, and a candid log of every bug with the check that now prevents it. Most of those bugs were found by review rather than by the test suite, because **no tool in this repository imports `render.mjs` or `main.mjs`** — the simulation is well covered and the half of the code a player actually experiences is not.
