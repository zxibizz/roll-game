# Roll (roll-game)

A ball rolls down an endless track, lane by lane: swipe it left and right, collect stars, don't fall in and don't crash. No ads, works offline (PWA).
Site: `https://roll.games.bubas.cc`.

## How it plays

- The ball rolls forward by itself along the middle of a lane. One touch is one swipe, and one swipe is one move,
  however long it is:
  - left / right (← → / A D) — the next lane, also in the air. A lane change takes about 0.17 s at any speed;
  - up (↑ / W / Space), or a tap — a short touch (up to 0.3 s) that lets go before it becomes a swipe — a jump: about 1.05 of a lane high, 0.65 s long, the same up and down a slope. It clears
    anything on the road — a log, a rock or a bush, the walker, a row or two of them (more at higher speeds) — with
    a window of at least 0.15 s to start it in (a log: about 0.45 s). A ramp passed over in a jump still throws the
    ball on. Asked for up to 0.15 s before landing, it happens on landing;
  - down (↓ / S) — out of the air straight to the ground, also off a ramp.
  A swipe counts as soon as the finger has gone 6 % of the screen's shorter side (18 to 28 px: on a tablet 6 % was a finger's travel of about 9 mm), without waiting for it
  to lift.
- Frame times on a phone: open the game with `?perf` in the address (e.g. `/?perf`) — a strip at the bottom shows the
  last two seconds of frames and the worst frame of the last ten seconds with what happened in it. A frame used to
  make close to a megabyte of garbage; colours are now made once and kept, projected points come from a ring of
  arrays, finished sounds leave the audio graph, the HUD is not re-laid out every frame, and the scene stands still
  under the pause and the results.
- Updates: a new version downloads in the background and waits; the home screen then shows a yellow update button
  next to the globe, and a tap on it reloads into the new version. The game asks for a new version itself on start,
  when it comes back to the screen on the home screen, and on the way home — at most once a minute. Untapped, the new
  version takes over once every window of the game is closed. Versions before 0.21.0 had no button and took over at
  once; the first update from one of them still does.
- Tablets: the canvas has at most 2.5 million pixels (a tablet at full density cost two to three times a phone's
  frame); if frames still come slower than about 45 a second while the drawing itself is heavy, the resolution steps
  down by 15 % (to 60 % at most) for the rest of the visit, and a step that did not help is taken back. The counters,
  the top bar and the cards grow with the screen, up to 1.5 times, as long as the tallest card fits.
- There is no swiping off the road: at its edge the ball leans out, thuds and stays in its lane. It still falls
  where the lane itself ends — into the gap when the road splits, or off the outer lane when the road narrows.
- The track is usually 5 lanes wide and comes in sections of 5 seconds each (45 rows at the start, 120 at the top speed).
  Every section has its own colour and is 3 % faster (9 → 24 rows per second, the top speed from section 35). The first 8 rows of a section are free of obstacles; the first sections are sparse.
- Hills: downhill speeds the ball up, uphill slows it down; on flat ground it settles back to the section's speed.
- Ramps: a bright orange springboard, the same in every biome, glowing on the grass, with white arrows running up
  it — so it does not read as an obstacle. It throws the ball higher and farther than a jump (the camera rises
  with it). Behind it a wall of obstacles spans the whole width: the ramp is the easy way over, a jump works too.
  In the first two sections every lane has a ramp, later every lane has one or has one right next to it. The ball
  can change lanes in the air; its shadow shows where it lands.
- Logs: a low barrier across a lane, sometimes across the whole road. The only way past is to jump (from section 1).
- Faint dashes run between the lanes, so one's own lane can be followed ahead through a bend.
  During the first five runs a hand shows the swipe up before a log in the ball's lane.
- Hitting an obstacle or rolling off where a lane ends finishes the run. There are no pits on the track (the world
  and the page still know how to handle and draw one, for tracks built by hand). The hit boxes are smaller than the
  drawn obstacles, with rounded corners, so changing lanes right past an obstacle is fine. The score is the number of rows covered;
  the best score is kept on the device.
- The road is a strip of grass with wavy edges; it bends like a snake now and then (just the look: the ball keeps
  to the road on its own). The bends are gentle — up to 0.7 of a lane aside, as long in time at any speed — or
  at speed one could not tell which lane a thing ahead lay in. Its shape changes in two ways. It widens from 5 to 7 lanes and splits: the centre lane
  becomes a gap between two 3-lane roads. Or it narrows to 3 lanes and zigzags, stepping one lane sideways every
  0.6 s or more (at the fastest downhill speed). The only obstacle on a zigzag is a
  log right across it here and there, in the middle of a stretch twice as long. The road changes shape often:
  every 60–120 rows, a little more often into a zigzag than into a split.
- Nine biomes follow one another, and a tenth one made of them all (see below).
- For developers, hidden from everyone else: seven quick taps on the version on the home screen turn developer mode
  on (`save.devMode`, kept; the version shows `<>`), seven more turn it off and put the start back to the first
  biome. Then the settings have one more line, `<>`, which opens a menu of its own (`#dev`): the biome a run starts
  at — its sky over its ground and its number, arrows either side (`save.dev`, `World.skipTo`: the start of that
  biome, its speed, on the path, a second in which nothing can hit; such a run banks its stars but sets no record) —
  and the stars in the bank and the record, typed in (the balls the bank reaches open at once and stay open).
  Check: `~/scripts/roll-dev/dev.py <url> <outdir> [WxH]`, the cards in landscape: `land.py <url> <out.png> [WxH]`. The track is cut by time, not by length: a section lasts 5 s at its own speed
  (`SEC_T`; the speed steps up 3 % at each section start, from 9 to 24 rows a second), so a faster section is longer
  in rows, and a biome is 6 sections (`BIOME_SECS`) — half a minute at any speed. A biome stays as it is for most of
  that and turns into the next one over the last three quarters of a section (`BIOME_BLEND`). Space is reached
  after 4 minutes (row 4276), the last biome half a minute later (row 4996), and that one never ends. The walker of a biome crosses the road at least twice in it.
  To add a biome: a name in `THEMES`, a key frame in `PAL` at the same place (hues blend the short way, layers
  like snow or bubbles it leaves out are off), and an entry under that name in
  `MOVERS`, `SIDE`, `FLY` and `OBSTACLES` in `client.js` (checked when the page starts); the lengths and speeds need
  no change. The last name stays `glitch`: the end of the world, where it all comes apart. It has nothing of its
  own to stand on its road: obstacles, walkers, islands and what flies by are taken from all the other biomes
  (and wear its colours). Its ground is its own: violet tiles whose colour wanders along and across the road
  (`glitchHue`; always about as light, so nothing flickers at speed), bright cracks and stray pixels on them. Its sky
  is in shards, each a piece of another biome's sky, with a sun, a moon, a rainbow, northern
  lights, a volcano and a city all at once. And its road is a roller coaster in the sky, as on a rainbow track:
  between straight stretches it rises into a loop, rolls over in a slow barrel roll or swings into a banked turn
  (`nextFig`, `growCurve`: one fixed shape for the whole road, built once). The camera keeps to the ball's own up and
  forward, so the road under the ball looks level, the shape ahead comes closer as it is, and the world turns round
  it: the horizon tilts and rolls over (`skyBegin`). A stretch seen from below shows its underside: the same tiles, darker. That is for the eye
  only (`buildWarp`, `proj`): the world in `core.js` knows nothing of it. Nothing ahead is hidden: a loop is seen from
  inside, the road never bends down over a crest, a roll turns slowly. Every figure closes exactly, so the road is
  level again after it. 20 more rows are drawn there. Shots of it:
  `~/scripts/roll-endgame/shots.py <url> <outdir> [z,...] [WxH]`, where the figures are: `figs.py <url> [from] [to]`,
  that the curve has no crest, is level before every figure and does not drift: `curve.py <url> [from] [to]`,
  frames every few rows: `scan.py <url> <out.png> from to step`, a flight and a crash in a loop and a roll: `states.py`,
  a reload mid-run: `restore.py`, the bot playing it live: `live.py <url> <out.png> [seconds]`, the cost of a frame: `perf.py`.
  The bends are laid round the point the camera follows (not the ball: after a crash or in a fall the camera stops).
  Its far rows fade in by their transparency (`FADE_ROWS`, `rowAlpha`), the same bent or not: the fog's colour is not
  the sky's behind them, so fogged rows popped up as dark shapes. Frame-to-frame jumps: `jumps.py <url> from to step`.
  Each of the nine has its own colours and sky, things on
  the road, someone who walks across it, islands beside the road and things in the air:

  | Biome | On the road | Walks across | Islands | In the air, sky |
  |---|---|---|---|---|
  | Summer farm | rocks, bushes, leafy trees, firs, haystacks, sunflowers, scarecrows | a cow | trees, a house, a windmill, a barn, a cow | birds, balloons, butterflies, a rainbow |
  | Autumn | orange trees, pumpkins, haystacks, toadstools, scarecrows; fallen leaves | a fox | a house, a barn, pumpkins, toadstools | falling leaves, birds, balloons |
  | Winter evening | snowmen (one arm waves), snowy firs, blocks of ice, a sled of presents, rocks under snow | a penguin sliding on its belly | a house with snow on the roof, an igloo, a skating rink, snowmen | bullfinches, a sleigh with reindeer; snowfall, northern lights, the moon |
  | Halloween night | pumpkins, graves, dead trees, a skeleton, a zombie | a ghost | a haunted house, dead trees, graves | bats, a witch; the moon |
  | Magic land (pink) | mint trees, lollipops, glowing mushrooms, crystals; sparkles | a unicorn | a castle with flags, lollipops, mushrooms | fairies, butterflies, balloons, a rainbow |
  | Bottom of the sea | corals, big shells that open on a pearl, an anchor, a treasure chest; sand, shells, starfish | a crab, sideways | a sunken ship, kelp, corals, chests | fish, jellyfish, a turtle; light from the surface, bubbles |
  | Dinosaurs | ferns, palms, dinosaur eggs (a baby looks out), a big bone | a triceratops | a brontosaurus eating a tree top, a nest, palms | pterodactyls, dragonflies; a smoking volcano |
  | Land of robots | robots, antenna masts, batteries; steel plates with neon seams | a rover with a beacon | a factory, a dish, robots, a rocket | drones, rockets; a city on the horizon |
  | Space | crystals, alien mushrooms | a flying saucer | crystals, a glass dome, a rocket | comets, rockets; nebulas, a ringed planet |

  All of it but the walker is looks only (the hit box is the same block) and is placed by the row number, so it is
  the same every time for the same track. Nothing in the air or on the islands looks like a walker, but for the
  farm's cow, which also grazes on islands well away from the road.
- The walker sets off two lanes away when the ball is 30 rows from it and stands in its lane from 6 rows on, so
  nothing moves any more when the ball is close; it moves with the ball's approach, not with the clock. Every
  other lane in its row is free. It can be jumped like anything else.
- Obstacles come in waves — a line across the road, one to four rows deep, never deeper than a jump clears — with free road in between: at least
  0.6 s plus a lane change at the fastest downhill speed (10 rows at the start, 20 at the top speed). In a wave every
  lane is free, has a free lane right next to it, or holds a log. So from any lane one swipe or one jump per wave is
  enough, never two in a hurry. Lanes that end get the same warning, with no waves around.
- Waves stay sparse all the way: the speed alone makes later sections harder. Rows hidden behind a crest have no
  obstacles.
- There are no words in the game, only numbers and icons — the name aside. The name, the install description and the
  labels screen readers read for the buttons come in 13 languages (`public/i18n.js`, `public/lang/*.js`, a manifest
  per language): the device's language by default, the globe on the home screen picks another one (`roll.lang`,
  `?lang=xx`, `?lang=auto`). Each language has a name of its own for the game: Roll, Kugel, Bolita, Boule, Pallina,
  Balletje, Kulka, Bolinha, Yuvarlan, a Russian one, コロコロ, 데굴데굴, 滚滚球. The title's size follows its length.
- Bonuses: a bubble with an icon lies on the track about every 100–150 rows, on the path or one lane off it, in a
  free stretch with time to come back. Never the same kind twice in a row: they come out of a shuffled bag of all
  three (`Track.nextBonus`). What is at work shows as icons in rings under the pause button.
  - Magnet: for 8 s stars come to the ball from every lane of the road, the lines off the path included.
  - Shield: a bubble round the ball for four sections (20 s), the ring under the pause button runs down and the
    bubble blinks in its last two seconds. The first thing the ball hits meanwhile flies apart instead, the bubble
    bursts, and nothing can hit the ball for 0.7 s after. It does not save from rolling off where a lane ends.
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
- Stars come in stretches of 1.2–2 s with breaks of 2.5–4.5 s and no stars between. In a stretch a line lies on the
  safe path and lines in about half of the other lanes alongside: a ball takes one lane of them, a magnet all. In a
  line a star lies every few rows, 3 a second at any speed (`STAR_RATE`; about 4 a second along a flight, 8 along an arc), the lanes in step,
  so a faster section pays no more than a slow one. An arc hangs over most jumps, and one hangs over most logs on the
  path. A bot on the path takes about 75–80 stars a minute, early or late in a run. They add up over all
  runs and open ball colours and pets between them (`SKINS` in `client.js`: 100, a hamster at 250, 450, 700, a kitten
  at 1000, 1500, 2200, a chick at 3200, 4800, 7000) — a good run opens one or two, not all of them. An opened one
  stays open (`open` in `roll.save`); a save from before 0.18 keeps what the old prices (50 … 1800) had opened.
  A pet runs inside a clear tinted ball: from behind in a run, its feet taking turns, its head turning with a lane
  change (the hamster's cheeks puff up with a star); face on at home. The score stays the distance.

## Screens

- **Home**: the title, the star bank, the best score, the language (a globe) and the settings, a big play button. The ball in the scene is the colour or pet on show:
  arrows beside it (or ← →) turn through them, a locked one shows `have/need` stars over it.
- **In the game**: pause, the score (it turns gold once the record is beaten), stars taken. The first three runs a
  hand shows the swipe.
- **Pause** (the button, Esc / P, or the game going into the background): resume, home, start over, settings.
  Resuming counts 3-2-1 first. Leaving a run from here banks its stars and score. A run in progress is stored (`roll.run`: the seed and the ball) whenever it is paused
  or hidden, and opens on pause the next time the game is started, even after the phone unloaded it.
- **Results**: the score counts up, a cup if it is a new record, the record, stars earned, colours and pets just opened.
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
free neighbour is opened again, and the shut ones become things to go round (one row deep, or a grove of up to four rows, as deep as a jump clears at the slowest speed there — `hopRows`) or logs. A guaranteed path (`row.goal`) runs
through every row and moves by at most one lane, right after a wave; stars lie along it. Jumps are set pieces placed
on flat ground after at least 6 flat rows: where the wall goes is computed from the ramp's physics with a
±25 % margin on the section's speed; the wall is no deeper than a jump clears. The road widens and narrows over at least K rows with no waves.
The tests drive three bots on 30–40 tracks up to the top speed and expect no deaths: one keeps to the path
(`World.auto`), one stays in whatever lane it is in and makes a single move — a swipe to the next lane or a
jump — only when something is 0.75 s ahead, and one never steers round anything and jumps it all, ramps included.

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

## Icons

`public/icons/`: the coral ball on a green road winding up through the sky to the horizon, three stars ahead of it, a
rainbow and the sun (`icon-512`, `icon-192` — maskable, everything that matters inside the middle 80 %;
`apple-touch-icon` 180 px; `favicon-64` — the ball alone, large, for a browser tab). They are drawn on a canvas by a
script outside the repository; to change them, redraw all four at once.
