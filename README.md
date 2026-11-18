# Roll (roll-game)

A ball rolls down an endless track, lane by lane: swipe it left and right, collect stars, don't fall in and don't crash. No ads, works offline (PWA).
Site: `https://roll.games.bubas.cc`.

## How it plays

- The ball rolls forward by itself along the middle of a lane. One touch is one swipe, and one swipe is one move,
  however long it is:
  - left / right (← → / A D) — the next lane, also in the air. A lane change takes about 0.17 s at any speed;
  - up (↑ / W / Space) — a jump: about 0.65 of a lane high, 0.5 s long, the same up and down a slope. A log is
    cleared by a jump started anywhere from 0.37 to 0.1 s before it. It clears a log, not a rock or a bush. Asked for up to 0.15 s before landing, it happens on landing;
  - down (↓ / S) — out of the air straight to the ground, also off a ramp.
  A swipe counts as soon as the finger has gone 6 % of the screen width (18 px at least), without waiting for it
  to lift.
- There is no swiping off the road: at its edge the ball leans out, thuds and stays in its lane. It still falls
  where the lane itself ends — into the gap when the road splits, or off the outer lane when the road narrows.
- The track is usually 5 lanes wide and comes in sections of 48 rows. Every section has its own colour and is 6 % faster
  (9 → 24 rows per second, the top speed from section 18). The first 8 rows of a section are free of obstacles; the first sections are sparse.
- Hills: downhill speeds the ball up, uphill slows it down; on flat ground it settles back to the section's speed.
- Ramps: a light tile with chevrons. Behind it a wall of obstacles spans the whole width — the only way over is to jump.
  In the first two sections every lane has a ramp, later every lane has one or has one right next to it. The ball
  can change lanes in the air; its shadow shows where it lands.
- Logs: a low barrier across a lane, sometimes across the whole road. The only way past is to jump (from section 1).
  During the first five runs a hand shows the swipe up before a log in the ball's lane.
- Hitting an obstacle or rolling off where a lane ends finishes the run. There are no pits on the track (the world
  and the page still know how to handle and draw one, for tracks built by hand). The hit boxes are smaller than the
  drawn obstacles, with rounded corners, so changing lanes right past an obstacle is fine. The score is the number of rows covered;
  the best score is kept on the device.
- The road is a strip of grass with wavy edges; it bends like a snake now and then (just the look: the ball keeps
  to the road on its own). Its shape changes in two ways. It widens from 5 to 7 lanes and splits: the centre lane
  becomes a gap between two 3-lane roads. Or it narrows to 3 lanes and zigzags, stepping one lane sideways every
  0.6 s or more (at the fastest downhill speed) — a row of stars shows the way. The only obstacle on a zigzag is a
  log right across it here and there, in the middle of a stretch twice as long. The road changes shape often:
  every 60–120 rows, a little more often into a zigzag than into a split. Ramps are wooden.
- Six biomes follow one another with the distance, three sections (144 rows) each: a biome stays as it is for most
  of that and turns into the next one over the last three quarters of a section (`PAL`, `BIOME_LEN`, `BIOME_BLEND`,
  `THEMES` in `client.js`). Space is reached at 720 rows. Each has its own colours and sky, things on
  the road, someone who walks across it, islands beside the road and things in the air:

  | Biome | On the road | Walks across | Islands | In the air, sky |
  |---|---|---|---|---|
  | Summer farm | rocks, bushes, leafy trees, firs, haystacks, sunflowers, scarecrows | a cow | trees, a house, a windmill, a barn, a cow | birds, balloons, butterflies, a rainbow |
  | Autumn | orange trees, pumpkins, haystacks, toadstools, scarecrows; fallen leaves | a fox | a house, a barn, pumpkins, toadstools | falling leaves, birds, balloons |
  | Halloween night | pumpkins, graves, dead trees, a skeleton, a zombie | a ghost | a haunted house, dead trees, graves | bats, a witch; the moon |
  | Magic land (pink) | mint trees, lollipops, glowing mushrooms, crystals; sparkles | a unicorn | a castle with flags, lollipops, mushrooms | fairies, butterflies, balloons, a rainbow |
  | Land of robots | robots, antenna masts, batteries; steel plates with neon seams | a rover with a beacon | a factory, a dish, robots, a rocket | drones, rockets; a city on the horizon |
  | Space | crystals, alien mushrooms | a flying saucer | crystals, a glass dome, a rocket | comets, rockets; nebulas, a ringed planet |

  All of it but the walker is looks only (the hit box is the same block) and is placed by the row number, so it is
  the same every time for the same track. Nothing in the air or on the islands looks like a walker, but for the
  farm's cow, which also grazes on islands well away from the road.
- The walker sets off two lanes away when the ball is 30 rows from it and stands in its lane from 6 rows on, so
  nothing moves any more when the ball is close; it moves with the ball's approach, not with the clock. Every
  other lane in its row is free. It cannot be jumped.
- Obstacles come in waves — a line across the road, one to three rows deep — with free road in between: at least
  0.6 s plus a lane change at the fastest downhill speed (10 rows at the start, 20 at the top speed). In a wave every
  lane is free, has a free lane right next to it, or holds a log. So from any lane one swipe or one jump per wave is
  enough, never two in a hurry. Lanes that end get the same warning, with no waves around.
- Waves stay sparse all the way: the speed alone makes later sections harder. Rows hidden behind a crest have no
  obstacles.
- There are no words in the game, only numbers and icons, so there is nothing to translate.
- Bonuses: a bubble with an icon lies on the track about every 100–150 rows, on the path or one lane off it, in a
  free stretch with time to come back. What is at work shows as icons in rings under the pause button.
  - Magnet: for 8 s stars come to the ball from two lanes away on either side.
  - Shield: a bubble round the ball; the next thing it hits flies apart instead, the bubble bursts, and nothing can
    hit the ball for 0.7 s after. It does not save from rolling off where a lane ends.
  - Flight: a rest. For 7 s the ball grows wings and flies 2.2 above the road, over everything; the camera rises
    with it. The air has three lanes of its own (the one the flight started in, or the nearest of lanes 2–4, and
    the two beside it), whatever the road below is doing. The stars in the air lie in four long straight lines,
    each one lane over from the one before, with a pause between them: three swipes take them all. The stars and
    bonuses lying on the road are not shown meanwhile, and nothing else flies about. A swipe down, or the time
    running out, ends it: the ball goes over to the path by itself and comes down where the road goes on; nothing
    can hit it for 1.6 s from then. The show while it lasts: rings of light opening from the horizon, shooting
    stars, clouds (star dust where there are no clouds) rushing past well to the sides, sparks behind the wings,
    speed lines.
  - Stars are not spent on bonuses. A run saved mid-flight goes on mid-flight.
- Stars: runs of them lie along the safe path, an arc hangs over most jumps, and now and then a lone one sits off
  the path, and one hangs over most logs on the path (about 130 per 500 rows). They add up over all runs and open ball colours
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

- The ball has some weight. In a lane change it takes a moment to get going and slows down into its lane; meanwhile
  it leans a little (its top lags behind). Arriving in the lane it lands with a soft thud: a slight squash, a puff
  of dust, a low sound, a tick of vibration. Turning back mid-way it stops first. The view itself stays level.
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

`public/core.js`, no DOM. After every wave or jump the generator leaves K free rows (the time for one swipe at the
fastest downhill speed) plus a few more, then lays the next wave: lanes are shut at random, any shut lane without a
free neighbour is opened again, and the shut ones become things to go round (one row deep, or a grove of two to four rows) or logs. A guaranteed path (`row.goal`) runs
through every row and moves by at most one lane, right after a wave; stars lie along it. Jumps are set pieces placed
on flat ground after at least 6 flat rows: where the wall goes is computed from the ramp's physics with a
±25 % margin on the section's speed. The road widens and narrows over at least K rows with no waves.
The tests drive two bots on 30–40 tracks up to the top speed and expect no deaths: one keeps to the path
(`World.auto`), the other stays in whatever lane it is in and makes a single move — a swipe to the next lane or a
jump — only when something is 0.75 s ahead.

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
