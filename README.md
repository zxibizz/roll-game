# Roll (roll-game)

A ball rolls down an endless track over space: steer it, don't fall off and don't crash. No ads, works offline (PWA).
Site: `https://roll.games.bubas.cc`.

## How it plays

- The ball rolls forward by itself; drag a finger (or the mouse) left and right to steer, or use ← → / A D.
- The track is 5 lanes wide and comes in sections of 48 rows. Every section has its own colour and is 6 % faster
  (9 → 24 rows per second, the top speed from section 18). The first 8 rows of a section are free of obstacles; the first sections are sparse.
- Hills: downhill speeds the ball up, uphill slows it down; on flat ground it settles back to the section's speed.
- Ramps: a light tile with chevrons. Behind it a block wall or a gap spans the whole width — the only way over is to jump.
  In the first two sections every lane has a ramp, later only the path lane is sure to have one. The ball can be steered
  in the air; its shadow shows where it lands.
- Falling into a hole or off the edge, or hitting a block ends the run. The score is the number of rows covered;
  the best score is kept on the device (`localStorage`, key `roll.best`).
- The sky changes with the distance: day, then sunset (from section 3), night (from section 5) and open space
  with nebulas and a ringed planet from section 10. The ball leaves a short trail, the track and hole edges have
  light rims, and speed lines show up at the screen edges on fast sections.
- There are no words in the game, only numbers and icons, so there is nothing to translate.

## Track generator

`public/core.js`, no DOM. A guaranteed path runs through every row; when it shifts by a lane, both lanes stay open for
long enough to move sideways even at the fastest downhill speed. Obstacle patterns (scatter, walls, bridge, slalom,
strips) fill only cells outside the path. Jumps are set pieces placed on flat ground after at least 6 flat rows: where the
wall or the gap goes is computed from the ramp's physics with a ±25 % margin on the section's speed.
The tests drive a bot along the path on 30 tracks up to the top speed and expect no deaths.

## Layout

- `public/` — the game: `index.html`, `client.js` (drawing and input), `core.js` (world), `sw.js` (offline cache),
  `manifest.webmanifest`, `icons/`.
- `server/server.js` — Node 22 without dependencies: static files and `/healthz`.
- `test/` — `node --test test/*.test.js`.

## Releasing

1. Change something, bump `VERSION` in `public/core.js` and `public/sw.js` (a test checks they match), run the tests.
2. Push a `vX.Y.Z` tag: GitHub Actions runs the tests and publishes `ghcr.io/zxibizz/roll-game:X.Y.Z`;
   Flux in the home cluster picks up `0.x` tags by itself.
