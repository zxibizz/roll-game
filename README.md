# Roll (roll-game)

A ball rolls down an endless track, lane by lane: swipe it left and right, collect stars, don't fall in and don't crash. No ads, works offline (PWA).
Site: `https://roll.games.bubas.cc`.

## How it plays

- The ball rolls forward by itself along the middle of a lane. A swipe left or right (or ← → / A D) sends it to the
  next lane, also in the air; swipes add up, so two quick ones cross two lanes. A short flick (6 % of the screen
  width) is enough for the first lane; dragging on without lifting the finger takes 15 % for every further one.
  A lane change takes about 0.15 s at the start and gets quicker with the speed.
- There is no swiping off the road: at its edge the ball leans out, thuds and stays in its lane. It still falls
  where the lane itself ends — into the gap when the road splits, or off the outer lane when the road narrows.
- The track is usually 5 lanes wide and comes in sections of 48 rows. Every section has its own colour and is 6 % faster
  (9 → 24 rows per second, the top speed from section 18). The first 8 rows of a section are free of obstacles; the first sections are sparse.
- Hills: downhill speeds the ball up, uphill slows it down; on flat ground it settles back to the section's speed.
- Ramps: a light tile with chevrons. Behind it a block wall or a gap spans the whole width — the only way over is to jump.
  In the first two sections every lane has a ramp, later only the path lane is sure to have one. The ball can change
  lanes in the air; its shadow shows where it lands.
- Falling into a pit or hitting an obstacle ends the run. The hit boxes are smaller than the drawn obstacles, with
  rounded corners, and a pit holds the ball until its centre is 0.2 of a lane past the rim, so changing lanes right
  past an obstacle is fine. The score is the number of rows covered;
  the best score is kept on the device.
- The road is a strip of grass with wavy edges; it bends like a snake now and then (just the look: the ball keeps
  to the road on its own). Sometimes it widens from 5 to 7 lanes and splits: the centre lane becomes a gap between
  two 3-lane roads, and the safe path moves to one side beforehand. Holes are pits with ragged edges; ramps are wooden.
- What stands on the road follows the sky: rocks and bushes of different shapes by day and at sunset; at night
  (from section 5) Halloween — pumpkins with flickering faces, gravestones, dead trees, a waving skeleton, a swaying
  zombie, fallen leaves and glowing toadstools; in space (from section 10) glowing crystals and alien mushrooms on
  teal grass under nebulas and a ringed planet. They all move in place only; the hit box is the same block.
- Obstacles stay sparse all the way: their density barely grows, the speed alone makes later sections harder, and
  there are empty stretches between patterns. Rows hidden behind a crest have no obstacles.
- There are no words in the game, only numbers and icons, so there is nothing to translate.
- Stars: runs of them lie along the safe path, an arc hangs over most jumps, and now and then a lone one sits off
  the path (about 95 per 500 rows for a careful player). They add up over all runs and open ball colours
  (`SKINS` in `client.js`: 50, 150, 300, 500, 800, 1200, 1800). The score stays the distance.

## Screens

- **Home**: the title, the star bank, the best score, a big play button. The ball in the scene is the colour on show:
  arrows beside it (or ← →) turn through the colours, a locked one shows `have/need` stars over it.
- **In the game**: pause, the score (it turns gold once the record is beaten), stars taken. The first three runs a
  hand shows the swipe.
- **Pause** (the button, Esc / P, or the game going into the background): resume, home, start over, settings.
  Resuming counts 3-2-1 first. Leaving a run from here banks its stars and score. A run in progress is stored (`roll.run`: the seed and the ball) whenever it is paused
  or hidden, and opens on pause the next time the game is started, even after the phone unloaded it.
- **Results**: the score counts up, a cup if it is a new record, the record, stars earned, colours just opened.
  The buttons ignore taps for the first 0.6 s.
- **Settings** (home and pause): volume, music volume, vibration (Android only; hidden elsewhere).
- Settings and progress live in `localStorage` under `roll.save`.

## Feel

- Landing squashes the ball, raises dust and shakes the camera a little; a crash stops the world for a moment, then
  the ball bursts into shards with a ring and a flash; a star gives a few sparks and a pop of the counter.
- The camera follows 60 % of the ball's sideways move, more on a narrow screen, so the ball never leaves the screen
  in the outer lanes.
- The world advances in steps of at most 1/60 s, so on a slow frame the ball can't skip an obstacle or a star.
- Sound (`public/audio.js`): everything is synthesized and kept low (150–800 Hz) — a hum of the rolling ball that
  follows the speed, jump, landing, crash, fall, a rising note for stars taken in a row, section, countdown, record.
  Music: five CC0 tracks in `public/music/` (32 kHz, 64 kbps), a random one after another, played through Web Audio
  without an `<audio>` element (no "now playing" card on the lock screen, the iPhone silent switch is obeyed), kept
  in their own cache `roll-music-1`. Sources (OpenGameArt, CC0): "Free Run [8 bit(ish)]" (TAD), "Happy Adventure
  (Loop)" (TinyWorlds), "Magic Space" (CodeManu), and "super action stage 6" and "retro sports stage 3" from
  "12 Music Loops" (SubspaceAudio).

## Track generator

`public/core.js`, no DOM. A guaranteed path runs through every row; when it shifts by a lane, both lanes stay open for
long enough to change lanes even at the fastest downhill speed. Obstacle patterns (scatter, walls, bridge, slalom,
strips) fill only cells outside the path. Jumps are set pieces placed on flat ground after at least 6 flat rows: where the
wall or the gap goes is computed from the ramp's physics with a ±25 % margin on the section's speed.
The tests drive a bot along the path on 30 tracks up to the top speed and expect no deaths, and the same for a bot
that steers with swipes only (`World.move`).

## Layout

- `public/` — the game: `index.html` (screens), `client.js` (drawing, input, screens), `core.js` (world), `audio.js`
  (sound, music, vibration), `music/`, `sw.js` (offline cache),
  `manifest.webmanifest`, `icons/`.
- `server/server.js` — Node 22 without dependencies: static files and `/healthz`.
- `test/` — `node --test test/*.test.js`.

## Releasing

1. Change something, bump `VERSION` in `public/core.js` and `public/sw.js` (a test checks they match), run the tests.
2. Push a `vX.Y.Z` tag: GitHub Actions runs the tests and publishes `ghcr.io/zxibizz/roll-game:X.Y.Z`;
   Flux in the home cluster picks up `0.x` tags by itself.
