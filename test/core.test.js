import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { World as GameWorld, Track, secStart, secOf, secPos, BIOME_SECS, SEC_T, LANES, MID, VERSION, HOP_VY, HOP_G, HOP_WIN, hopRows, slowOf, SPEED_TOL, BOX_H, R, CROSS_ROWS, CROSS_FAR, CROSS_END, FLY_T, FLY_H, MAGNET_T, SHIELD_T, laneX, speedOf, fastOf, mulberry, starStep, STAR_RATE, BONUS_KINDS, setFinalBiome, endOf } from '../public/core.js';

// Most tests look at the road and the ball alone: their world has no bonuses lying on it (the road is the same).
class World extends GameWorld {
  constructor(seed) { super(seed); this.track.noBonus = true; }
}
const DT = 1 / 60;

// A bot that keeps to the guaranteed path must never die: the generator promises the track is passable,
// including the jumps, which are planned from the section's speed with a margin.
function drive(seed, rows) {
  const w = new World(seed);
  while (w.state === 'run' && w.ball.z < rows) { w.auto(); w.step(DT); }
  return w;
}

test('a bot on the guaranteed path survives up to the top speed on 30 tracks', () => {
  let jumps = 0, vMin = Infinity, vMax = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const w = drive(seed, secStart(38));
    assert.equal(w.state, 'run', `seed ${seed} died at row ${w.score}`);
    jumps += w.stats.jumps;
    vMin = Math.min(vMin, w.stats.vRatioMin); vMax = Math.max(vMax, w.stats.vRatioMax);
  }
  assert.ok(jumps >= 80, `only ${jumps} jumps on 30 tracks`);
  // hills really change the speed
  assert.ok(vMin < 0.85 && vMax > 1.15, `speed ratio ${vMin.toFixed(2)}..${vMax.toFixed(2)}`);
});

test('every row keeps its goal lane open', () => {
  const t = new Track(42);
  for (let i = 0; i < secStart(38); i++) {
    const r = t.get(i);
    const lanes = r.road.flatMap((on, l) => (on ? [l] : []));
    const wall = lanes.every((l) => r.block[l]), gap = lanes.every((l) => !r.floor[l]);
    if (wall || gap) continue;   // a jump set piece: the ramp before it is the way over
    assert.ok(r.floor[r.goal] && !r.block[r.goal], `row ${i}`);
  }
});

test('jump set pieces always have a ramp on the path lane', () => {
  let pieces = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const t = new Track(seed);
    for (let i = 1; i < secStart(38); i++) {
      const r = t.get(i);
      if (!r.ramp.some(Boolean)) continue;
      pieces++;
      assert.ok(r.ramp[r.goal], `seed ${seed} row ${i}: no ramp on lane ${r.goal}`);
    }
  }
  assert.ok(pieces > 20);
});

test('the same seed builds the same track', () => {
  const a = new Track(5), b = new Track(5);
  for (let i = 0; i < 500; i++) assert.deepEqual(a.get(i), b.get(i));
});

test('steering off the edge drops the ball', () => {
  const w = new World(3);
  w.ball.tx = LANES;   // far to the right of the track
  for (let n = 0; n < 600 && w.state !== 'over'; n++) w.step(DT);
  assert.equal(w.state, 'over');
});

test('skipping a ramp means hitting the wall or falling into the gap', () => {
  // find a set piece where only some lanes have ramps and drive straight down a lane without one
  for (let seed = 1; seed < 200; seed++) {
    const t = new Track(seed);
    for (let i = 1; i < secStart(6); i++) {
      const r = t.get(i);
      const lane = r.ramp.indexOf(false);
      if (!r.ramp.some(Boolean) || lane < 0) continue;
      const w = new World(seed);
      while (w.state === 'run' && w.ball.z < i - 6) { w.auto(); w.step(DT); }
      if (w.state !== 'run') break;
      w.ball.tx = lane - LANES / 2 + 0.5;
      while (w.state === 'run' && w.ball.z < i + 40) w.step(DT);
      assert.notEqual(w.state, 'run', `seed ${seed}: passed the set piece at row ${i} without a ramp`);
      return;
    }
  }
  assert.fail('no set piece with a missing ramp found');
});

test('sw.js has the same VERSION as core.js', () => {
  const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.equal(/const VERSION = '([^']+)'/.exec(sw)[1], VERSION);
});

test('sw.js caches every file in public/', () => {
  const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const root = new URL('../public/', import.meta.url);
  const files = fs.readdirSync(root, { recursive: true }).filter((f) => fs.statSync(new URL(f, root)).isFile() && f !== 'sw.js' && !f.startsWith('music/'));   // music has its own cache
  for (const f of files) assert.ok(sw.includes(`'${f}'`), `${f} is not in ASSETS`);
});

// Regression: rolling onto a ramp from the side used to turn the step in the ground into a vertical
// speed of step / dt and launch the ball tens of rows up (behind the camera, the page froze).
test('rolling onto a ramp from the side does not launch the ball', () => {
  for (const dt of [1 / 60, 1 / 120]) {
    let tried = 0, worst = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const t = new Track(seed);
      let i = 20, l = -1;
      for (; i < secStart(10); i++) {
        const r = t.get(i);
        l = r.ramp.findIndex((x, k) => x && k + 1 < LANES && !r.ramp[k + 1] && r.floor[k + 1]);
        if (l >= 0) break;
      }
      if (l < 0) continue;
      const w0 = new World(seed);
      while (w0.state === 'run' && w0.ball.z < i - 3) { w0.auto(); w0.step(dt); }
      if (w0.state !== 'run') continue;
      for (let off = -1.2; off <= 0.4; off += 0.1) {
        const w = new World(seed);
        w.ball = { ...w0.ball, x: laneX(l + 1), tx: laneX(l + 1) }; w.v = w0.v; w.sec = w0.sec;
        while (w.state === 'run' && w.ball.z < i + off) w.step(dt);
        w.ball.tx = laneX(l);
        for (let n = 0; n < 200 && w.state === 'run'; n++) { w.step(dt); worst = Math.max(worst, w.ball.y - w.hAt(w.ball.z)); }
        tried++;
      }
    }
    assert.ok(tried > 50, `only ${tried} side entries tried`);
    assert.ok(worst < 1.9, `dt 1/${Math.round(1 / dt)}: the ball went ${worst.toFixed(1)} above the ground`);
  }
});

test('a zero or negative frame time changes nothing and leaves no NaN', () => {
  const w = new World(9);
  for (let n = 0; n < 300; n++) { w.auto(); w.step(n % 7 === 0 ? 0 : n % 11 === 0 ? -0.01 : 1 / 60); }
  for (const k of ['x', 'y', 'z', 'vy']) assert.ok(Number.isFinite(w.ball[k]), `ball.${k} = ${w.ball[k]}`);
});

test('rows hidden behind a crest have no obstacles', () => {
  let hiddenRows = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const t = new Track(seed);
    for (let i = 30; i < secStart(38); i++) {
      const r = t.get(i);
      const ahead = Math.max(5, Math.ceil(fastOf(r.sec) * 0.6) + 2);
      if (!t.hidden(i, r.h, ahead)) continue;
      hiddenRows++;
      assert.ok(r.road.every((on, l) => !on || r.floor[l]) && !r.block.some(Boolean), `seed ${seed} row ${i}`);
    }
  }
  assert.ok(hiddenRows > 20, `only ${hiddenRows} hidden rows: the check may not be wired in`);
});

test('the road splits now and then, and the path never runs into the gap or off the road', () => {
  let splits = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const t = new Track(seed);
    let inSplit = false;
    for (let i = 0; i < secStart(38); i++) {
      const r = t.get(i), split = !r.road[MID] && r.road[0];
      if (split && !inSplit) splits++;
      inSplit = split;
      assert.ok(r.road[r.goal] && (r.floor[r.goal] || r.road.every((on, l) => !on || !r.floor[l])), `seed ${seed} row ${i}`);
    }
  }
  assert.ok(splits >= 20, `only ${splits} splits on 20 tracks`);
});

test('steering arrives on the target without overshooting, at any frame rate', () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    for (const lanes of [1, 2, -2, 0.4]) {   // within the 5-lane road (edge lanes at ±2)
      const w = new World(1);
      w.ball.tx = lanes;
      let beyond = 0, t = 0, settled = null;
      for (let n = 0; n < 2 / dt; n++) {
        w.step(dt); t += dt;
        beyond = Math.max(beyond, Math.sign(lanes) * (w.ball.x - lanes));
        if (settled === null && Math.abs(w.ball.x - lanes) < 0.01) settled = t;
      }
      assert.ok(beyond <= 1e-9, `dt 1/${Math.round(1 / dt)}, ${lanes} lanes: went ${beyond.toFixed(3)} past the target`);
      assert.ok(settled !== null && settled < 0.45, `dt 1/${Math.round(1 / dt)}, ${lanes} lanes: settled after ${settled}`);
      assert.ok(Math.abs(w.ball.x - lanes) < 1e-6, 'it ends exactly on the target');
    }
  }
});

test('when the finger stops or turns back, the ball does at once', () => {
  const w = new World(1);
  w.ball.tx = 2;
  for (let n = 0; n < 12; n++) w.step(1 / 60);   // on its way, at speed
  const x = w.ball.x;
  w.ball.tx = x;                                  // the finger stops right where the ball is
  w.step(1 / 60);
  assert.ok(Math.abs(w.ball.x - x) < 1e-9, `the ball slid on by ${(w.ball.x - x).toFixed(3)}`);
  w.ball.tx = x - 1;                              // and turns back
  w.step(1 / 60);
  assert.ok(w.ball.x < x, 'the ball turned back on the next frame');
});

test('following a moving finger the ball stays close behind it, so little is left to roll once the finger stops', () => {
  const w = new World(1);
  let lag = 0;
  for (let n = 0; n < 30; n++) {          // the finger sweeps 2 lanes in half a second
    w.ball.tx = Math.min(2, n * (2 / 30));
    w.step(1 / 60);
    lag = Math.max(lag, w.ball.tx - w.ball.x);
  }
  assert.ok(lag < 0.25, `the ball fell ${lag.toFixed(2)} lanes behind the finger`);
});

// a stretch of plain road from row a to row b in lanes MID and MID + 1, everything else as generated
function plainRoad(w, a, b) {
  for (let i = a; i <= b; i++) {
    const r = w.track.get(i);
    for (const l of [MID, MID + 1]) { r.road[l] = true; r.floor[l] = true; r.block[l] = false; r.ramp[l] = false; }
    r.low.fill(false); r.movers = null; r.bonus = null;
  }
}
function rollAlong(w, x, rows) {
  w.ball.x = w.ball.tx = x;
  while (w.state === 'run' && w.ball.z < rows) { w.ball.tx = x; w.step(1 / 60); }
  return w.state;
}

test('the ball rolls along the rim of a pit, and drops in when it goes over', () => {
  const edge = laneX(MID) + 0.5;   // the border between the lane and the pit next to it
  for (const [into, falls] of [[0.15, false], [0.32, true]]) {
    const w = new World(3);
    plainRoad(w, 0, 60);
    for (let i = 30; i <= 34; i++) w.track.get(i).floor[MID + 1] = false;
    rollAlong(w, edge - 0.6, 20);
    assert.equal(rollAlong(w, edge + into, 50) !== 'run', falls, `${into} into the pit`);
  }
});

test('the ball may brush past an obstacle', () => {
  const edge = laneX(MID) + 0.5;
  for (const [x, hits] of [[edge - 0.05, false], [edge + 0.12, true]]) {
    const w = new World(3);
    plainRoad(w, 0, 60);
    w.track.get(40).block[MID + 1] = true;
    rollAlong(w, edge - 0.6, 20);
    assert.equal(rollAlong(w, x, 50) === 'crash' || w.state === 'over', hits, `ball at ${(x - edge).toFixed(2)} from the lane border`);
  }
});

test('stars lie only where the ball can be: on ground without obstacles, or in the air over a jump', () => {
  let ground = 0, air = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const t = new Track(seed);
    for (let i = 0; i < secStart(38); i++) {
      const r = t.get(i);
      r.star.forEach((s, l) => {
        if (!s) return;
        assert.ok(r.road[l], `seed ${seed} row ${i}: a star off the road`);
        if (s > 1) { air++; return; }
        ground++;
        assert.ok(r.floor[l] && !r.block[l], `seed ${seed} row ${i}: a star in an obstacle or over a pit`);
      });
    }
  }
  assert.ok(ground > 1000 && air > 100, `${ground} stars on the ground, ${air} in the air`);
});

test('a bot on the path picks up most of the stars along it, the arcs over jumps included', () => {
  let got = 0, onPath = 0, arcs = 0, arcGot = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const w = new World(seed), rows = secStart(38), t = w.track;
    const before = [];
    for (let i = 0; i < rows; i++) {
      const r = t.get(i);
      before.push(r.star.slice());
      r.star.forEach((s, l) => { if (s > 1) arcs++; else if (s && l === r.goal) onPath++; });
    }
    while (w.state === 'run' && w.ball.z < rows) { w.auto(); w.step(DT); }
    got += w.stars;
    for (let i = 0; i < rows - 2; i++) before[i].forEach((s, l) => { if (s > 1 && !t.get(i).star[l]) arcGot++; });
  }
  assert.ok(got >= onPath * 0.9, `${got} taken of ${onPath} on the path`);
  assert.ok(arcGot >= arcs * 0.8, `${arcGot} taken of ${arcs} in arcs`);
});

test('stars do not change the track: the same seed gives the same road with or without looking at them', () => {
  const a = new Track(11), b = new Track(11);
  for (let i = 0; i < 400; i++) {
    const r = a.get(i);
    assert.ok(Array.isArray(r.star) && r.star.length === LANES);
  }
  b.rs = () => 0.99;   // no lone stars, other runs
  for (let i = 0; i < 400; i++) {
    const x = a.get(i), y = b.get(i);
    assert.deepEqual([x.road, x.floor, x.block, x.ramp, x.h], [y.road, y.floor, y.block, y.ramp, y.h], `row ${i}`);
  }
});

test('a saved run continues exactly where it stopped', () => {
  const a = new World(21);
  while (a.ball.z < 300) { a.auto(); a.step(DT); }
  const b = World.fromSave(JSON.parse(JSON.stringify(a.toSave())));
  assert.ok(b);
  assert.equal(b.stars, a.stars);
  for (let n = 0; n < 1200; n++) {
    a.auto(); a.step(DT);
    b.auto(); b.step(DT);
  }
  assert.equal(b.state, 'run');
  assert.equal(b.ball.z, a.ball.z);
  assert.equal(b.ball.x, a.ball.x);
  assert.equal(b.stars, a.stars);
});

test('a broken or outdated save is refused', () => {
  const ok = new World(5).toSave();
  for (const bad of [null, {}, { ...ok, v: 0 }, { ...ok, seed: 'x' }, { ...ok, ball: null }, { ...ok, speed: NaN }, { ...ok, ball: { ...ok.ball, z: -1 } }])
    assert.equal(World.fromSave(bad), null);
  const odd = World.fromSave({ ...ok, ball: { ...ok.ball, x: 'left', y: null } });
  for (const k of ['x', 'y', 'z']) assert.ok(Number.isFinite(odd.ball[k]));
});

test('a slow frame is split into equal steps: the run goes the same at 20 frames a second', () => {
  for (const seed of [2, 3, 4]) {
    const w = new World(seed);
    while (w.state === 'run' && w.ball.z < secStart(12)) { w.auto(); w.step(1 / 20); }
    assert.equal(w.state, 'run', `seed ${seed} died at row ${w.score}`);
  }
});

test('landing after a jump is reported with its strength', () => {
  const w = new World(3);
  let lands = 0;
  while (w.state === 'run' && w.ball.z < secStart(38)) {
    w.auto(); w.step(DT);
    if (w.events.includes('land')) { lands++; assert.ok(w.impact > 0 && w.impact <= 1); }
    w.events.length = 0;
  }
  assert.ok(lands >= 3 && lands >= w.stats.jumps - 1, `${lands} landings for ${w.stats.jumps} jumps`);
});

test('a swipe moves the ball exactly one lane over, and two quick ones two lanes', () => {
  const w = new World(5);
  assert.equal(w.lane, MID);
  assert.equal(w.move(1), true);
  for (let n = 0; n < 30; n++) w.step(DT);
  assert.equal(w.ball.x, laneX(MID + 1));
  w.move(-1); w.move(-1);
  assert.deepEqual(w.events.filter((e) => e === 'move').length, 3);
  for (let n = 0; n < 40; n++) w.step(DT);
  assert.equal(w.ball.x, laneX(MID - 1));
  assert.equal(w.state, 'run');
});

test('a lane change takes about a fifth of a second at any speed', () => {
  for (const [sec, max] of [[0, 0.21], [20, 0.21]]) {
    const w = new World(5);
    w.v = speedOf(sec); w.move(1);
    let t = 0;
    while (w.ball.x < laneX(MID + 1) - 0.05 && t < 1) { w.tick(1 / 240); t += 1 / 240; }
    assert.ok(t < max, `section ${sec}: ${t.toFixed(3)} s`);
  }
});

test('a swipe towards a lane that ends before the ball would get there is refused, a double swipe too: the ball never slides off sideways', () => {
  let seen = 0;
  for (let seed = 1; seed <= 40 && seen < 6; seed++) {
    const t = new Track(seed);
    for (let i = 20; i < secStart(12); i++) {
      if (!(t.get(i).road[0] && !t.get(i + 1).road[0] && t.get(i + 1).road[1])) continue;   // the road narrows after row i
      for (const back of [0.5, 1.5, 3]) {
        const w = drive(seed, i + 1 - back);
        if (w.state !== 'run' || w.lane < 1 || w.lane > 2) continue;
        seen++;
        while (w.lane > 0 && w.move(-1));   // swipe left as far as it goes
        while (w.state === 'run' && w.ball.z < i + 6) w.step(DT);
        // falling is fair only from lane 0, reached in time before it ended — never half-way across
        if (w.state === 'fall') assert.ok(Math.abs(w.ball.x - laneX(0)) < 0.1, `seed ${seed} row ${i} from ${back} rows back: fell at ${w.ball.x.toFixed(2)}`);
      }
      break;
    }
  }
  assert.ok(seen >= 3, `only ${seen} cases found`);
});

test('a swipe off the road is refused: the ball stays in its lane and rolls on', () => {
  const w = new World(3);
  assert.equal(w.move(1), true); assert.equal(w.move(1), true);   // lane 5, the last one of a 5-lane road
  w.events.length = 0;
  for (let k = 0; k < 5; k++) assert.equal(w.move(1), false);
  assert.deepEqual(w.events, Array(5).fill('bump'));
  assert.equal(w.side, 1);
  for (let n = 0; n < 60; n++) w.step(DT);
  assert.equal(w.ball.x, laneX(5));
  assert.equal(w.state, 'run');
});

test('swiping at random never takes the ball off the side of the road', () => {
  // whatever is swiped, the ball leaves the road only where the road itself ends under it (a split or a narrowing)
  for (let seed = 1; seed <= 20; seed++) {
    const w = new World(seed), rnd = mulberry(seed);
    let n = 0;
    while (w.state === 'run' && w.ball.z < secStart(14)) {
      if (n++ % 12 === 0) { const d = rnd() < 0.5 ? -1 : 1; for (let k = 1 + Math.floor(rnd() * 3); k > 0; k--) w.move(d); }   // 1–3 swipes at once
      const lane = w.lane, rz = Math.floor(w.ball.z);
      assert.ok(lane >= 0 && lane < LANES);
      w.step(DT);
      if (w.state === 'fall' && !w.track.get(w.ball.fallRow).road[Math.floor(w.ball.x + LANES / 2)]) {
        // off the road: only because the lane it was in came to an end, never by crossing the edge sideways
        // (a late swipe out of an ending lane may not make it: then the ball is still over where that lane was)
        assert.equal(w.track.get(Math.max(0, rz - 3)).road[Math.floor(w.ball.x + LANES / 2)], true, `seed ${seed} row ${rz}`);
        // and never over a lane it was let into but had not reached yet: such a swipe must be refused
        const cell = Math.floor(w.ball.x + LANES / 2);
        assert.ok(cell !== lane || Math.abs(w.ball.x - laneX(lane)) <= 0.1, `seed ${seed} row ${rz}: fell at ${w.ball.x.toFixed(2)} on the way to lane ${lane}`);
      }
    }
  }
});

// ---- waves, jumping ----
const walks = (r, l) => !!r.movers && r.movers.some((m) => m.lane === l);
const shut = (r, l) => !r.road[l] || !r.floor[l] || r.block[l] || walks(r, l);           // no way through on the ground or by a jump
const clear = (r, l) => l >= 0 && l < LANES && !shut(r, l) && !r.low[l];
const busy = (r) => r.ramp.some(Boolean) || r.low.some(Boolean) || !!r.movers || r.road.some((on, l) => on && shut(r, l));

test('in a wave every lane is free, has a free lane next to it, or can be jumped', () => {
  let waves = 0, hurdles = 0, lows = 0, wide = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const t = new Track(seed);
    for (let i = 0; i < secStart(38); i++) {
      const r = t.get(i), lanes = r.road.flatMap((on, l) => (on ? [l] : []));
      if (!busy(r) || r.ramp.some(Boolean)) continue;
      if (lanes.every((l) => r.block[l]) || lanes.every((l) => !r.floor[l])) continue;   // a jump set piece
      waves++;
      // a log never takes more than two thirds of a stretch of road (each side of a split one): there is a way round
      for (const part of lanes.reduce((o, l) => { if (o.length && o.at(-1).at(-1) === l - 1) o.at(-1).push(l); else o.push([l]); return o; }, [])) {
        const logs = part.filter((l) => r.low[l]).length;
        assert.ok(logs <= Math.floor(part.length * 2 / 3), `seed ${seed} row ${i}: logs over ${logs} of ${part.length} lanes side by side`);
        if (logs && logs === Math.floor(part.length * 2 / 3)) hurdles++;
        if (logs >= 3) wide++;
      }
      for (const l of lanes) {
        if (r.low[l]) lows++;
        assert.ok(!shut(r, l) || clear(r, l - 1) || clear(r, l + 1), `seed ${seed} row ${i} lane ${l}`);
      }
    }
  }
  // (hurdles: logs as long as they get — the long ones of 'hurdle' waves, two of three lanes of a zigzag, some mixed waves)
  assert.ok(waves > 400 && hurdles > 30 && wide > 10 && lows > hurdles * 2, `${waves} wave rows, ${hurdles} hurdles, ${wide} three lanes long, ${lows} low barriers`);
});

test('between two waves there is time for a swipe: at least 0.6 s at the fastest downhill speed', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const t = new Track(seed);
    let last = -100, lastCells = '';
    for (let i = 0; i < secStart(38); i++) {
      const r = t.get(i);
      if (!busy(r)) continue;
      const cells = r.road.map((on, l) => (!on ? ' ' : r.block[l] ? '#' : r.low[l] ? '=' : !r.floor[l] ? 'o' : '.')).join('');
      const jumpPiece = r.ramp.some(Boolean) || !r.road.some((on, l) => on && !shut(r, l));   // ramp, wall or gap rows belong together
      const same = i - last === 1 && cells === lastCells;                               // a wave several rows deep
      if (!same && !(jumpPiece && i - last < 14)) {
        const vhi = fastOf(r.sec);
        assert.ok((i - last - 1) / vhi >= 0.6, `seed ${seed}: rows ${last} and ${i} are ${i - last - 1} free rows apart`);
      }
      last = i; lastCells = cells;
    }
  }
});

test('a ramp is never more than one lane away', () => {
  let pieces = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const t = new Track(seed);
    for (let i = 0; i < secStart(38); i++) {
      const r = t.get(i);
      if (!r.ramp.some(Boolean)) continue;
      pieces++;
      r.road.forEach((on, l) => { if (on) assert.ok(r.ramp[l] || r.ramp[l - 1] || r.ramp[l + 1], `seed ${seed} row ${i} lane ${l}`); });
    }
  }
  assert.ok(pieces > 40);
});

// A player who never plans: it stays in its lane until something is 0.75 s ahead, and then makes one move —
// a swipe to the lane next door or a jump. If the track keeps its promise, that is always enough.
function lazy(w) {
  const b = w.ball, t = w.track, lane = w.lane;
  if (Math.abs(b.x - laneX(lane)) > 0.01 || (b.air && !b.hop)) return;   // changing lanes or flying off a ramp
  const z = Math.floor(b.z);
  for (let r = z; r <= z + Math.ceil(w.v * 0.75); r++) {
    const row = t.get(r);
    if (row.ramp.some(Boolean)) {
      if (!row.ramp[lane] && r > z) w.move(row.ramp[lane - 1] ? -1 : 1);
      return;
    }
    if (row.low[lane]) {
      if (!b.air && r + 0.5 > b.z && r + 0.5 - b.z <= w.v * HOP_VY / HOP_G) w.jump();
      return;
    }
    if (!shut(row, lane)) continue;
    const d = [-1, 1].find((x) => clear(row, lane + x));
    if (d && r > z) w.move(d);
    return;
  }
}

test('one move per obstacle is enough from any lane, up to the top speed', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const w = new World(seed), rnd = mulberry(seed * 77);
    for (let k = Math.floor(rnd() * 5) - 2; k !== 0; k -= Math.sign(k)) w.move(Math.sign(k));   // start in any of the five lanes
    while (w.state === 'run' && w.ball.z < secStart(38)) { lazy(w); w.step(DT); }
    assert.equal(w.state, 'run', `seed ${seed}: ${w.state} at row ${Math.floor(w.ball.z)} in lane ${w.lane}`);
  }
});

const flatWorld = (rows = 120) => {
  const w = new World(1);
  for (let i = 0; i < rows; i++) {
    const r = w.track.get(i);
    r.h = 0; r.road = r.road.map((_, l) => l >= 1 && l <= 5); r.floor = r.road.slice();
    r.block.fill(false); r.low.fill(false); r.ramp.fill(false); r.star.fill(0); r.movers = null; r.bonus = null;
  }
  return w;
};

test('a jump is about 1.05 high and lasts 0.65 s; it clears whatever is on the road: a log, a block, a pit, someone walking across', () => {
  const air = (w) => { let top = 0, t = 0; while (w.ball.air && w.state === 'run') { w.step(DT); t += DT; top = Math.max(top, w.ball.y - R); } return [top, t]; };
  let w = flatWorld();
  for (let n = 0; n < 30; n++) w.step(DT);
  assert.equal(w.jump(), true);
  const [top, t] = air(w);
  assert.ok(top > 0.95 && top < 1.1 && Math.abs(t - 2 * HOP_VY / HOP_G) < 0.03, `${top.toFixed(2)} high, ${t.toFixed(2)} s`);
  for (const [what, fate] of [['low', 'run'], ['pit', 'run'], ['block', 'run'], ['mover', 'run'],
    ['none-low', 'crash'], ['none-pit', 'fall'], ['none-block', 'crash'], ['none-mover', 'crash']]) {
    w = flatWorld();
    const row = w.track.get(20);
    if (what.endsWith('low')) row.low[MID] = true; else if (what.endsWith('pit')) row.floor[MID] = false;
    else if (what.endsWith('mover')) row.movers = [{ lane: MID, from: MID }]; else row.block[MID] = true;
    while (w.state === 'run' && w.ball.z < 30) {
      if (!what.startsWith('none') && !w.ball.air && w.ball.z < 20.5 && 20.5 - w.ball.z <= w.v * HOP_VY / HOP_G) w.jump();
      w.step(DT);
    }
    assert.equal(w.state, fate, what);
  }
});

test('a log is cleared by a jump started anywhere from 0.37 to 0.1 s before it, at any speed', () => {
  for (const v of [5, 9, 16, 24, 27]) {
    // crawling uphill the ball takes longer to cross the log itself, so the window is a little shorter
    for (const [early, fate] of [[0.6, 'crash'], [v < 9 ? 0.33 : 0.37, 'run'], [0.3, 'run'], [0.2, 'run'], [v < 9 ? 0.15 : 0.1, 'run'], [0.01, 'crash']]) {
      const w = flatWorld(200);
      w.track.get(60).low[MID] = true;
      w.ball.z = 60.5 - v * early - 3;
      let done = false;
      while (w.state === 'run' && w.ball.z < 75) {
        w.v = v;
        if (!done && w.ball.z >= 60.5 - v * early) { done = true; w.jump(); }
        w.step(DT);
      }
      assert.equal(w.state, fate, `speed ${v}, a jump ${early} s before the log`);
    }
  }
});

test('a jump is the same up and down a slope', () => {
  for (const slope of [-0.3, 0.3]) {
    const w = flatWorld();
    for (let i = 0; i < 120; i++) w.track.get(i).h = Math.max(0, i - 10) * slope;
    while (w.ball.z < 20) w.step(DT);
    w.jump();
    let top = 0, t = 0;
    while (w.ball.air) { w.step(DT); t += DT; top = Math.max(top, w.ball.y - R - w.hAt(w.ball.z)); }
    assert.ok(top > 0.95 && top < 1.1 && Math.abs(t - 2 * HOP_VY / HOP_G) < 0.04, `slope ${slope}: ${top.toFixed(2)} high, ${t.toFixed(2)} s`);
  }
});

// how wide the window for a jump over n rows of blocks in a row is at speed v: the earliest and the latest start
// (seconds before the first block row) that get over
function blockWindow(v, n) {
  const ok = [];
  for (let early = 0; early <= 1; early += 0.005) {
    const w = flatWorld(200);
    for (let k = 0; k < n; k++) w.track.get(60 + k).block[MID] = true;
    w.ball.z = 60 - v * early - 3;
    let done = false;
    while (w.state === 'run' && w.ball.z < 75) {
      w.v = v;
      if (!done && w.ball.z >= 60 - v * early) { done = true; w.jump(); }
      w.step(DT);
    }
    if (w.state === 'run') ok.push(early);
  }
  return ok.length ? ok[ok.length - 1] - ok[0] : 0;
}

test('a jump clears as many rows of blocks as hopRows says, with a window of at least HOP_WIN, at any speed', () => {
  for (const v of [6, 9, 13, 18, 24]) {
    const n = hopRows(v), win = blockWindow(v, n);
    assert.ok(win >= HOP_WIN - 0.01, `speed ${v}: ${n} rows, a window of ${win.toFixed(3)} s`);
    if (v * (2 * HOP_VY / HOP_G) > n + 2) assert.ok(blockWindow(v, n + 2) < HOP_WIN, `speed ${v}: ${n + 2} rows are cleared too easily`);
  }
  assert.deepEqual([6, 9, 13, 18, 24].map(hopRows), [1, 1, 2, 3, 5]);
});

test('no obstacle is deeper than a jump clears: waves, groves and the walls behind ramps', () => {
  let deep = 0, walls = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const t = new Track(seed), run = Array(LANES).fill(0);
    for (let i = 0; i < secStart(38); i++) {
      const r = t.get(i), wall = r.road.every((on, l) => !on || r.block[l]);
      for (let l = 0; l < LANES; l++) {
        run[l] = r.block[l] ? run[l] + 1 : 0;
        if (!run[l]) continue;
        // a wall is planned at about the section's speed on flat ground, a wave for the slowest uphill
        const most = wall ? hopRows(speedOf(r.sec) * (1 - SPEED_TOL)) : hopRows(slowOf(Math.max(0, r.sec - 1)));
        assert.ok(run[l] <= most, `seed ${seed} row ${i} lane ${l}: ${run[l]} rows of blocks, a jump clears ${most}`);
        if (run[l] > 1) deep++;
      }
      if (wall) walls++;
    }
  }
  assert.ok(deep > 50 && walls > 50, `${deep} deep rows, ${walls} wall rows`);
});

// A player who never steers round anything: it keeps its lane (unless the road ends there) and jumps every
// obstacle, ramps included — it takes them for obstacles too.
function jumper(w) {
  const b = w.ball, t = w.track, lane = w.lane, z = Math.floor(b.z);
  for (let r = z; r <= z + Math.ceil(w.v * 0.8); r++) {   // the road ends in this lane: over to the path
    if (!t.get(r).road[lane]) { const g = t.get(r).goal; if (g !== lane) w.move(Math.sign(g - lane)); break; }
  }
  if (b.air) return;
  for (let r = z; r <= z + Math.ceil(w.v * 0.6); r++) {
    const row = t.get(r);
    if (!(row.block[lane] || row.low[lane] || row.ramp[lane] || walks(row, lane))) continue;
    if (r + 0.5 <= b.z) continue;
    let n = 1;
    while (t.get(r + n).block[lane] && row.block[lane]) n++;   // a row of blocks: aim for its middle
    if (r + n / 2 - b.z <= w.v * HOP_VY / HOP_G) w.jump();
    return;
  }
}

test('one who jumps everything instead of steering gets through too, up to the top speed', () => {
  let jumps = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const w = new World(seed);
    while (w.state === 'run' && w.ball.z < secStart(38)) { jumper(w); w.step(DT); jumps += w.events.filter((e) => e === 'jump').length; w.events.length = 0; }
    assert.equal(w.state, 'run', `seed ${seed}: ${w.state} at row ${Math.floor(w.ball.z)} in lane ${w.lane}`);
  }
  assert.ok(jumps > 1000, `${jumps} jumps`);
});

test('a swipe down throws the ball to the ground; on the ground it does nothing', () => {
  const w = flatWorld();
  for (let n = 0; n < 30; n++) w.step(DT);
  assert.equal(w.drop(), false);
  w.jump();
  for (let n = 0; n < 8; n++) w.step(DT);
  assert.ok(w.ball.air && w.ball.y > 0.6);
  assert.equal(w.drop(), true);
  let t = 0;
  while (w.ball.air) { w.step(DT); t += DT; }
  assert.ok(t < 0.08, `${t.toFixed(3)} s to the ground`);
  assert.ok(w.events.includes('drop') && w.events.includes('land'));
});

test('a jump asked for just before landing happens on landing, an earlier one is forgotten', () => {
  for (const [early, again] of [[0.1, true], [0.3, false]]) {
    const w = flatWorld();
    for (let n = 0; n < 30; n++) w.step(DT);
    w.jump();
    let t = 0, asked = false, jumps = 0;
    while (t < 2 * HOP_VY / HOP_G + 0.1) {
      if (!asked && t >= 2 * HOP_VY / HOP_G - early) { asked = true; assert.equal(w.jump(), false); }
      w.step(DT); t += DT;
    }
    jumps = w.events.filter((e) => e === 'jump').length;
    assert.equal(jumps, again ? 2 : 1, `asked ${early} s before landing`);
  }
});

test('a ramp throws the ball the same whether it rolled onto it or jumped onto it; on a ramp a swipe up does nothing', () => {
  let tried = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const t = new Track(seed);
    for (let i = 20; i < secStart(14); i++) {
      if (!t.get(i).ramp.some(Boolean)) continue;
      for (const back of [0.2, 1.5, 3, 4.5]) {     // on the ramp, and one to three rows before it
        const w = drive(seed, i + 0.5 - back);
        if (w.state !== 'run') continue;
        tried++;
        w.jump();
        while (w.state === 'run' && w.ball.z < i + 30) { w.auto(); w.step(DT); }
        assert.equal(w.state, 'run', `seed ${seed}, ramp at row ${i}, a jump ${back} rows before its end: ${w.state}`);
      }
    }
  }
  assert.ok(tried > 100);
});

test('someone walks across the road now and then, or two towards each other: they end in lanes off the path with free lanes beside them, and are there when the ball is', () => {
  let walkers = 0, early = 0, pairs = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const t = new Track(seed);
    for (let i = 0; i < secStart(38); i++) {
      const r = t.get(i), ms = r.movers;
      if (!ms) continue;
      walkers += ms.length;
      if (i < secStart(4)) early++;
      assert.ok(ms.length === 1 || ms.length === 2, `seed ${seed} row ${i}: ${ms.length} walkers`);
      assert.ok(!r.block.some(Boolean) && !r.low.some(Boolean) && r.road.every((on, l) => !on || r.floor[l]), `seed ${seed} row ${i}: something else in the row`);
      for (const m of ms) {
        assert.ok(m.lane !== r.goal && r.road[m.lane] && r.road[m.from], `seed ${seed} row ${i}`);
        // a free lane on the side it came from
        const back = m.lane + Math.sign(m.from - m.lane);
        assert.ok(r.road[back] && !walks(r, back), `seed ${seed} row ${i}: no way round the walker in lane ${m.lane}`);
      }
      if (ms.length === 1) assert.ok(Math.abs(ms[0].lane - ms[0].from) >= 2, `seed ${seed} row ${i}`);
      else {   // side by side at the end, each having come from its own edge of the road towards the other
        pairs++;
        const [a, b] = ms;
        assert.ok(b.lane === a.lane + 1 && a.from === 1 && b.from === 5 && a.from < a.lane && b.from > b.lane, `seed ${seed} row ${i}: ${JSON.stringify(ms)}`);
        if (i < secStart(2)) assert.fail(`seed ${seed} row ${i}: a pair in the first two sections`);
      }
      // a ball in a walker's lane is hit, a ball in the lane it came through is not
      for (const m of ms) {
        for (const [lane, fate] of [[m.lane, 'crash'], [m.lane + Math.sign(m.from - m.lane), 'run']]) {
          const w = drive(seed, i - 5);
          if (w.state !== 'run') continue;
          w.ball.x = w.ball.tx = laneX(lane);   // put the ball into the lane just before the row
          while (w.state === 'run' && w.ball.z < i + 2) w.step(DT);
          assert.equal(w.state, fate, `seed ${seed} row ${i} lane ${lane}`);
        }
      }
    }
  }
  assert.ok(walkers >= 90 && early >= 12 && pairs >= 20, `${walkers} walkers on 20 tracks, ${early} rows of them in the first four sections, ${pairs} pairs`);
});

test('sections and biomes are cut by time: a section takes SEC_T seconds at any speed, a biome half a minute, however many biomes there are', () => {
  for (let s = 0; s < BIOME_SECS * 12; s++) {
    const rows = secStart(s + 1) - secStart(s);
    assert.ok(Math.abs(rows / speedOf(s) - SEC_T) < 0.06, `section ${s}: ${rows} rows at ${speedOf(s).toFixed(2)}`);
    assert.equal(secOf(secStart(s)), s);
    assert.equal(secOf(secStart(s + 1) - 1), s);
    assert.ok(speedOf(s + 1) >= speedOf(s));
  }
  assert.equal(secOf(0), 0);
  assert.equal(secOf(-3), 0);
  assert.ok(Math.abs(secPos(secStart(7) + (secStart(8) - secStart(7)) / 2) - 7.5) < 0.02);
  // the bot's own clock, past the nine biomes the page has now
  const w = new World(3), t = [];
  while (w.state === 'run' && w.ball.z < secStart(BIOME_SECS * 12)) { const b = Math.floor(secOf(w.ball.z) / BIOME_SECS); t[b] = (t[b] || 0) + DT; w.auto(); w.step(DT); }
  assert.equal(w.state, 'run');
  t.forEach((x, b) => assert.ok(Math.abs(x - SEC_T * BIOME_SECS) < 1.5, `biome ${b}: ${x.toFixed(1)} s`));
});

test('the walker of a biome crosses the road at least twice in every biome', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const t = new Track(seed), n = Array(12).fill(0);
    for (let i = 0; i < secStart(BIOME_SECS * 12); i++) if (t.get(i).movers) n[Math.floor(secOf(i) / BIOME_SECS)]++;
    n.forEach((x, b) => assert.ok(x >= 2, `seed ${seed} biome ${b}: ${x}`));
  }
});

test('the road narrows to three lanes and zigzags: one lane at a time, with time for a swipe before every step', () => {
  let zigs = 0, steps = 0, logs = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const t = new Track(seed);
    let last = -100, lastLog = -100, prev = null;
    for (let i = 0; i < secStart(38); i++) {
      const r = t.get(i), lanes = r.road.flatMap((on, l) => (on ? [l] : []));
      const narrow = lanes.length === 3 && lanes[2] - lanes[0] === 2;
      if (narrow) {
        if (busy(r)) {   // nothing but a log over two of the three lanes from one edge, well away from the steps on both sides
          const logged = lanes.filter((l) => r.low[l]);
          assert.ok(logged.length === 2 && logged[1] - logged[0] === 1 && !r.block.some(Boolean) && !r.movers, `seed ${seed} row ${i}: an obstacle on the zigzag`);
          assert.ok((i - last) / fastOf(r.sec) >= 0.6, `seed ${seed} row ${i}: a log ${i - last} rows after a step`);
          logs++; lastLog = i;
        }
        if (!prev) { zigs++; last = i; }
        else if (prev[0] !== lanes[0]) {
          steps++;
          assert.equal(Math.abs(prev[0] - lanes[0]), 1, `seed ${seed} row ${i}`);
          assert.ok((i - last) / fastOf(r.sec) >= 0.6, `seed ${seed} row ${i}: only ${i - last} rows after the last step`);
          assert.ok((i - lastLog) / fastOf(r.sec) >= 0.6, `seed ${seed} row ${i}: a step ${i - lastLog} rows after a log`);
          last = i;
        }
      }
      prev = narrow ? lanes : null;
    }
  }
  assert.ok(zigs >= 20 && steps >= zigs * 2 && logs >= 10, `${zigs} zigzags, ${steps} steps, ${logs} logs`);
});

test('the ball has weight in a lane change: it speeds up, is fastest about half-way and slows down into its lane', () => {
  const w = new World(5), xs = [];
  w.move(1);
  for (let n = 0; n < 60; n++) { w.tick(1 / 240); xs.push(w.ball.x); }
  const v = xs.map((x, n) => (n ? x - xs[n - 1] : x) * 240), peak = v.indexOf(Math.max(...v)), xPeak = xs[peak];
  assert.ok(v[2] < Math.max(...v) * 0.5, 'it does not jump off at full speed');
  assert.ok(xPeak > 0.2 && xPeak < 0.8, `fastest at ${xPeak.toFixed(2)} of the way`);
  assert.ok(v[59] < Math.max(...v) * 0.15 && xs[59] > 0.95, `after a quarter of a second: at ${xs[59].toFixed(3)}, speed ${v[59].toFixed(2)}`);
});

test('there are no pits on the track: every road cell has ground', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const t = new Track(seed);
    for (let i = 0; i < secStart(38); i++) {
      const r = t.get(i);
      assert.ok(r.road.every((on, l) => !on || r.floor[l]), `seed ${seed} row ${i}`);
    }
  }
});

// ---- bonuses ----
test('bonuses lie on the track: all three kinds, on the path or next to it, in a free stretch with time to come back', () => {
  const kinds = {};
  let n = 0, off = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const t = new Track(seed);
    for (let i = 0; i < secStart(38); i++) {
      const r = t.get(i), bo = r.bonus;
      if (!bo) continue;
      n++; kinds[bo.kind] = (kinds[bo.kind] || 0) + 1;
      if (bo.lane !== r.goal) off++;
      assert.ok(Math.abs(bo.lane - r.goal) <= 1 && r.road[bo.lane] && !r.star[bo.lane], `seed ${seed} row ${i}`);
      const free = Math.ceil(fastOf(r.sec) * 0.6);
      for (let k = -Math.ceil(fastOf(r.sec) * 0.3); k <= free; k++) assert.ok(!busy(t.get(i + k)), `seed ${seed} row ${i}: something ${k} rows from a bonus`);
    }
  }
  assert.ok(n >= 100 && n <= 250 && off > n * 0.25 && off < n * 0.65, `${n} bonuses, ${off} off the path`);
  for (const k of ['magnet', 'shield', 'fly']) assert.ok(kinds[k] > n * 0.2, `${k}: ${kinds[k]} of ${n}`);
});

test('with bonuses on the track both bots still get through, and use them', () => {
  const seen = { bonus: 0, fly: 0, flyend: 0, pop: 0 };
  let flying = 0;   // runs that stop in the middle of a flight
  for (let seed = 1; seed <= 30; seed++) {
    for (const bot of ['path', 'lazy']) {
      const w = new GameWorld(seed);
      while (w.state === 'run' && w.ball.z < secStart(38)) {
        if (bot === 'path') w.auto(); else lazy(w);
        w.step(DT);
        for (const e of w.events) if (e in seen) seen[e]++;
        w.events.length = 0;
      }
      assert.equal(w.state, 'run', `seed ${seed}, ${bot} bot: ${w.state} at row ${Math.floor(w.ball.z)}`);
      if (w.ball.fly) flying++;
    }
  }
  assert.ok(seen.bonus > 75 && seen.fly > 15 && seen.flyend + flying === seen.fly, JSON.stringify({ ...seen, flying }));
});

test('stars come in stretches, lines on the path and in other lanes, with real breaks between', () => {
  let path = 0, all = 0, starRows = 0, rows = 0, breaks = 0, shortBreaks = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const t = new Track(seed);
    let last = -1;
    for (let i = 20; i < 1500; i++) {
      const r = t.get(i);
      rows++;
      const flat = r.star.some((x) => x === 1);   // (arcs over jumps and stars over logs are not part of the stretches)
      if (flat) {
        starRows += starStep(speedOf(r.sec));   // a star every few rows: the rows up to the next one are the line's too
        if (last >= 0 && i - last > starStep(speedOf(r.sec)) + 3) {
          // a jump or someone walking across interrupts a stretch: that is not a break
          let within = false;
          for (let k = last + 1; k < i; k++) { const q = t.get(k); if (q.movers || q.ramp.some(Boolean) || q.star.some((x) => x > 1)) within = true; }
          if (!within) { breaks++; if ((i - last) / speedOf(r.sec) < 1.5) shortBreaks++; }
        }
        last = i;
      }
      r.star.forEach((x, l) => { if (x === 1) { all++; if (l === r.goal) path++; } });   // the lines only
    }
  }
  assert.ok(starRows / rows > 0.2 && starRows / rows < 0.45, `stars in ${(100 * starRows / rows).toFixed(0)} % of rows`);
  // (a stretch may still have a gap of a few rows: behind a crest, or while the path moves over)
  // (about a quarter to 0.3 of them; on ten tracks alone it swung from 0.2 to 0.38, hence forty)
  assert.ok(breaks > 240 && shortBreaks < breaks * 0.33, `${breaks} breaks, ${shortBreaks} of them under 1.5 s`);
  assert.ok(path / all > 0.25 && path / all < 0.5, `${path} on the path of ${all}`);
});

test('a line of stars has STAR_RATE a second at any speed, its lanes in step: a faster section pays no more', () => {
  const perSec = [];
  for (const sec of [0, 12, 30]) {
    let stars = 0, rows = 0, off = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const t = new Track(seed);
      for (let i = secStart(sec); i < secStart(sec + 1); i++) {
        const r = t.get(i);
        rows++;
        if (r.star[r.goal] === 1) stars++;
        // the other lanes' stars stand in the same rows as the path's
        if (r.star.some((x, l) => x === 1 && l !== r.goal) && r.star[r.goal] !== 1 && !t.get(i - 1).ramp.some(Boolean)) off++;
      }
    }
    const v = speedOf(sec), s = stars / (rows / v);
    perSec.push(s);
    assert.ok(off < stars * 0.25, `section ${sec}: ${off} rows of stars off the path's beat, ${stars} on it`);
  }
  // (a little less later on: jumps and the walls before them take more of a faster section)
  assert.ok(perSec.every((x) => x <= perSec[0] * 1.1 && x > perSec[0] * 0.6) && perSec[0] < STAR_RATE,
    `path stars a second by section: ${perSec.map((x) => x.toFixed(2)).join(', ')}`);
});

test('a magnet brings in the stars of every lane for 16 s: a few times what a ball on the path gets', () => {
  let ratio = 0, n = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const got = [false, true].map((on) => {
      const w = new World(seed);   // (no bonuses on the way: a flight or a magnet picked up would muddle the count)
      while (w.ball.z < 150) { w.auto(); w.step(DT); }
      const s0 = w.stars;
      if (on) w.take('magnet');
      for (let k = 0; k < MAGNET_T * 60; k++) { w.auto(); w.step(DT); }
      return w.state === 'run' ? w.stars - s0 : null;
    });
    if (got.includes(null)) continue;
    ratio += got[1] / Math.max(1, got[0]); n++;
  }
  assert.ok(n >= 10 && ratio / n > 1.6 && ratio / n < 3.5, `${(ratio / n).toFixed(1)} times the stars with a magnet`);
  const w = flatWorld(300);
  for (let i = 30; i < 40; i++) for (let l = 1; l <= 5; l++) w.track.get(i).star[l] = 1;
  w.take('magnet');
  while (w.ball.z < 50) w.step(DT);
  assert.equal(w.stars, 50, 'every lane, from the edge to the edge');
});

test('a shield lasts eight sections if nothing is hit', () => {
  const w = flatWorld(800);
  w.take('shield');
  let t = 0;
  while (w.fx.shield > 0) { w.step(DT); t += DT; }
  assert.ok(Math.abs(t - SHIELD_T) < 0.05 && SHIELD_T === 40, `${t.toFixed(2)} s`);
  const z = Math.floor(w.ball.z) + 5;
  w.track.get(z).block[MID] = true;
  while (w.state === 'run' && w.ball.z < z + 3) w.step(DT);
  assert.equal(w.state, 'crash');
});

test('a shield breaks the first thing the ball hits and nothing after it', () => {
  for (const kind of ['block', 'low', 'mover']) {
    const w = flatWorld(200);
    const put = (i) => { const r = w.track.get(i); if (kind === 'mover') r.movers = [{ lane: MID, from: MID + 2 }]; else r[kind][MID] = true; };
    put(30); put(31); put(60);
    w.take('shield');
    while (w.state === 'run' && w.ball.z < 50) w.step(DT);
    assert.equal(w.state, 'run', `${kind}: the shield did not hold`);
    assert.ok(w.events.includes('pop') && w.fx.shield === 0 && w.popAt.z === 30.5);
    assert.ok(kind === 'mover' ? !w.track.get(30).movers : !w.track.get(30)[kind][MID], 'the thing is gone');
    while (w.state === 'run' && w.ball.z < 70) w.step(DT);
    assert.equal(w.state, 'crash', `${kind}: no shield any more`);
  }
});

test('a flight carries the ball over everything along a trail of stars and sets it down on the road', () => {
  const w = flatWorld(400);
  for (let i = 30; i < 330; i += 7) for (let l = 1; l <= 5; l++) w.track.get(i).block[l] = true;   // walls all the way
  for (let n = 0; n < 60; n++) w.step(DT);
  w.take('fly');
  assert.ok(w.ball.fly && w.sky.length > 12 && w.events.includes('fly'));
  assert.equal(w.jump(), false);
  const all = w.sky.length;
  let top = 0, t = 0, swipes = 0;
  while (w.ball.fly && w.state === 'run' && t < 20) {
    const s = w.sky.find((x) => !x.got && x.z + 0.5 > w.ball.z + 0.5);   // steer along the trail
    if (s && s.l !== w.lane && w.fx.fly > 0) { w.move(Math.sign(s.l - w.lane)); swipes++; }
    w.step(DT); t += DT; top = Math.max(top, w.ball.y - R);
  }
  assert.equal(w.state, 'run');
  assert.ok(Math.abs(top - FLY_H) < 0.1 && t >= FLY_T && t < FLY_T + 1.5, `${top.toFixed(2)} high for ${t.toFixed(2)} s`);
  assert.ok(w.stars >= all - 1 && swipes <= 3, `${w.stars} of ${all} stars with ${swipes} swipes`);
  assert.ok(w.events.includes('flyend') && w.sky.length === 0);
  for (let n = 0; n < 20 && w.state === 'run'; n++) w.step(DT);
  for (let i = Math.floor(w.ball.z); i < 400; i++) w.track.get(i).block.fill(false);   // clear the rest of the road
  while (w.ball.air && w.state === 'run') w.step(DT);
  assert.ok(w.state === 'run' && Math.abs(w.ball.y - R) < 0.01 && w.events.includes('land'), 'back on the ground');
});

test('the stars of a flight lie in four straight lines within three lanes, at any speed and from any lane', () => {
  for (const [seed, z, lane] of [[1, 40, 1], [2, 300, 5], [3, 700, 3], [4, 900, 2], [5, 150, 4]]) {
    const w = drive(seed, z);
    assert.equal(w.state, 'run');
    while (w.lane !== lane && w.move(Math.sign(lane - w.lane)));
    w.take('fly');
    const c = w.flyLane, lanes = w.sky.map((s) => s.l), turns = lanes.filter((l, i) => i && l !== lanes[i - 1]).length;
    assert.ok(c >= 2 && c <= 4 && lanes.every((l) => Math.abs(l - c) <= 1), `seed ${seed}: lanes ${[...new Set(lanes)]} round ${c}`);
    assert.equal(turns, 3, `seed ${seed}: ${turns} turns`);
    assert.ok(lanes.every((l, i) => !i || Math.abs(l - lanes[i - 1]) <= 1));
    assert.equal(lanes[0], w.lane, 'the first line starts where the ball is');
    // between two lines there is time for the swipe
    w.sky.forEach((s, i) => { if (i && s.l !== w.sky[i - 1].l) assert.ok((s.z - w.sky[i - 1].z) / speedOf(w.sec + 1) >= 0.4, `seed ${seed}: ${s.z - w.sky[i - 1].z} rows between lines`); });
    // and no swipe leaves the three lanes
    while (w.move(1));
    assert.equal(w.lane, c + 1);
    while (w.move(-1));
    assert.equal(w.lane, c - 1);
  }
});

test('a swipe down ends a flight: the ball goes over to the path and comes down fast, wherever it was', () => {
  const w = new GameWorld(3);
  while (w.ball.z < 120) { w.auto(); w.step(DT); }
  w.take('fly');
  for (let n = 0; n < 60; n++) w.step(DT);
  while (w.move(1));                         // as far from the middle as the air lets it
  for (let n = 0; n < 30; n++) w.step(DT);
  assert.equal(w.drop(), true);
  assert.equal(w.drop(), false);
  assert.equal(w.move(-1), false);           // it is on its way down: no more steering
  let t = 0;
  while (w.ball.air && w.state === 'run' && t < 3) { w.step(DT); t += DT; }
  const row = w.track.get(Math.floor(w.ball.z));
  assert.ok(w.state === 'run' && !w.ball.fly && t < 1.2, `${w.state} after ${t.toFixed(2)} s`);
  assert.equal(w.lane, row.goal, 'down on the path');
});

test('a flight ends on the road even when nobody steers and the road below narrows and zigzags', () => {
  let tried = 0;
  for (let seed = 1; seed <= 30 && tried < 12; seed++) {
    const t = new Track(seed);
    for (let i = 60; i < secStart(12); i++) {
      if (!(t.get(i - 1).road[1] && !t.get(i).road[1] && t.get(i).road[2])) continue;   // lane 1 ends at row i
      const w = drive(seed, i - 12);
      if (w.state !== 'run' || w.ball.air) continue;
      while (w.lane > 1 && w.move(-1));
      if (w.lane !== 1) continue;
      for (let n = 0; n < 12; n++) w.step(DT);
      tried++;
      w.take('fly');
      while (w.ball.fly && w.state === 'run') w.step(DT);            // nobody steers
      for (let n = 0; n < 30 && w.state === 'run'; n++) w.step(DT);   // and down
      assert.equal(w.state, 'run', `seed ${seed}: lane 1 ends at row ${i}, ${w.state} at ${w.ball.z.toFixed(1)}`);
      assert.ok(w.track.get(Math.floor(w.ball.z)).road[w.lane]);
      break;
    }
  }
  assert.ok(tried >= 8, `${tried} cases`);
});

test('a run saved in the middle of a flight, with a magnet and a shield, goes on the same', () => {
  const a = new World(9);   // no bonuses on the track: the flight is the one taken here
  while (a.ball.z < 200) { a.auto(); a.step(DT); }
  a.take('magnet'); a.take('shield'); a.take('fly');
  for (let n = 0; n < 90; n++) { a.auto(); a.step(DT); }
  const b = World.fromSave(JSON.parse(JSON.stringify(a.toSave())));
  assert.ok(b && b.ball.fly && b.fx.shield && b.fx.magnet > 0 && b.fx.fly > 0 && b.sky.length > 0);
  for (let n = 0; n < 900; n++) { a.auto(); a.step(DT); b.auto(); b.step(DT); }
  assert.equal(b.state, 'run');
  assert.equal(b.ball.z, a.ball.z);
  assert.equal(b.ball.x, a.ball.x);
  assert.equal(b.stars, a.stars);
  assert.deepEqual(b.fx, a.fx);
});

test('a flight taken in an outer lane of a wide road comes into its three lanes, and its trail is the same after a restore at another speed', () => {
  const w = flatWorld(300);
  for (let i = 0; i < 300; i++) { const r = w.track.get(i); r.road.fill(true); r.floor.fill(true); }
  for (let n = 0; n < 40; n++) w.step(DT);
  while (w.move(-1));
  for (let n = 0; n < 40; n++) w.step(DT);
  assert.equal(w.lane, 0);
  w.take('fly');
  assert.ok(w.flyLane === 2 && w.lane === 1 && w.sky[0].l === 1);
  const trail = w.sky.map((s) => [s.l, s.z]);
  for (let n = 0; n < 60; n++) w.step(DT);
  w.v *= 0.7;                                       // slowed down since take-off
  const b = World.fromSave(JSON.parse(JSON.stringify(w.toSave())));
  assert.deepEqual(b.sky.map((s) => [s.l, s.z]), trail.filter(([, z]) => z + 0.5 > w.ball.z + 0.65));
  assert.equal(w.move(1), true);
  w.drop();
  assert.equal(w.move(1), false);
  assert.ok(!w.events.slice(-1).includes('bump'), 'no bump while it comes down');
});

test('bonuses never repeat back to back, and each kind comes once in every three', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const t = new Track(seed), kinds = [];
    for (let i = 0; i < 12000; i++) { const b = t.get(i).bonus; if (b) kinds.push(b.kind); }
    assert.ok(kinds.length > 20, `seed ${seed}: ${kinds.length} bonuses`);
    for (let k = 1; k < kinds.length; k++) assert.notEqual(kinds[k], kinds[k - 1], `seed ${seed}: ${kinds[k]} twice in a row at ${k}`);
    for (let k = 0; k + 3 <= kinds.length; k += 3) assert.deepEqual([...kinds.slice(k, k + 3)].sort(), [...BONUS_KINDS].sort());
  }
});

test('a developer run starts at any biome, on the path at its speed, and the bot gets through', () => {
  for (const b of [1, 5, 9]) {
    for (let seed = 1; seed <= 15; seed++) {
      const w = new GameWorld(seed);
      w.track.noBonus = true;
      w.skipTo(b);
      const s = b * BIOME_SECS;
      assert.equal(secOf(w.ball.z), s);
      assert.equal(w.v, speedOf(s));
      assert.equal(w.dev, b);
      const end = w.ball.z + speedOf(s) * 20;
      while (w.state === 'run' && w.ball.z < end) { w.auto(); w.step(1 / 60); w.events.length = 0; }
      assert.equal(w.state, 'run', `biome ${b}, seed ${seed}: ${w.state} at ${w.ball.z.toFixed(1)}`);
    }
  }
  const w = new GameWorld(3);
  w.skipTo(0);
  assert.equal(w.dev, 0);
  assert.equal(w.ball.z, 2);
  w.skipTo(4);
  assert.equal(GameWorld.fromSave(JSON.parse(JSON.stringify(w.toSave()))).dev, 4);
});

// ---- the last biome: harder and harder for as long as the ball lasts ----
// (the page says which biome is the last one; here it is the seventh, where the speed has long reached its top)
function inEndgame(f) {
  setFinalBiome(6);
  try { f(6 * BIOME_SECS); } finally { setFinalBiome(Infinity); }
}

test('in the last biome the speed keeps going up section after section, the sections still take SEC_T seconds', () => {
  const before = Array.from({ length: 80 }, (_, s) => speedOf(s));
  inEndgame((E) => {
    for (let s = 0; s < E; s++) assert.equal(speedOf(s), before[s], `section ${s} before the last biome`);
    assert.equal(endOf(E - 1), -1); assert.equal(endOf(E), 0);
    for (let s = E; s < E + 30; s++) assert.ok(speedOf(s + 1) > speedOf(s) && speedOf(s) > before[s], `section ${s}: ${speedOf(s)}`);
    assert.ok(speedOf(E + 30) > 32 && speedOf(E + 200) <= 36, `${speedOf(E + 30)} .. ${speedOf(E + 200)}`);
    for (let s = E; s < E + 60; s++) {
      const rows = secStart(s + 1) - secStart(s);
      assert.ok(Math.abs(rows / speedOf(s) - SEC_T) < 0.06, `section ${s}: ${rows} rows at ${speedOf(s).toFixed(2)}`);
      assert.equal(secOf(secStart(s)), s);
    }
  });
  assert.equal(speedOf(70), before[70], 'back to normal');
});

test('in the last biome the road fills up: waves closer together, more walkers, more of them in pairs', () => {
  inEndgame((E) => {
    // per second of the first sections of the last biome and of the ones two minutes in
    const count = (a, b) => {
      let waves = 0, walkers = 0, pairs = 0, t = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const tr = new Track(seed);
        let prev = false;
        for (let i = secStart(a); i < secStart(b); i++) {
          const r = tr.get(i), on = busy(r);
          if (on && !prev) waves++;
          if (r.movers) { walkers += r.movers.length; if (r.movers.length === 2) pairs++; }
          prev = on;
        }
        t += (b - a) * SEC_T;
      }
      return { waves: waves / t, walkers: walkers / t, pairs: pairs / t };
    };
    const early = count(E, E + 4), late = count(E + 26, E + 34);
    // however fast, a walker stops in its lane as long before the ball gets there as at the top speed before
    const w = new World(1);
    for (const sec of [E, E + 20, E + 40]) {
      const tr = w.track;
      let i = secStart(sec);
      while (!tr.get(i).movers) i++;
      const m = tr.get(i).movers[0], v = speedOf(tr.get(i).sec);
      w.ball.z = i + 0.5 - (CROSS_END * Math.max(1, v / 24) - 0.01); assert.equal(w.moverX(m, i), laneX(m.lane), `section ${sec}: still walking`);
      w.ball.z = i + 0.5 - 0.24 * v; assert.equal(w.moverX(m, i), laneX(m.lane), `section ${sec}: still walking a quarter of a second before`);
    }
    assert.ok(late.waves > early.waves * 1.25 && late.walkers > early.walkers * 1.4 && late.pairs > early.pairs * 1.8,
      `waves ${early.waves.toFixed(2)} → ${late.waves.toFixed(2)} a second, walkers ${early.walkers.toFixed(2)} → ${late.walkers.toFixed(2)}, pairs ${early.pairs.toFixed(2)} → ${late.pairs.toFixed(2)}`);
  });
});

test('the last biome stays fair however far it goes: the bots get through to the top speed', () => {
  inEndgame((E) => {
    const end = secStart(E + 44);   // past END_VMAX
    for (let seed = 1; seed <= 8; seed++) {
      for (const bot of ['path', 'lazy', 'jumper']) {
        const w = new World(seed);
        w.skipTo(6);
        while (w.state === 'run' && w.ball.z < end) { if (bot === 'path') w.auto(); else if (bot === 'lazy') lazy(w); else jumper(w); w.step(DT); }
        assert.equal(w.state, 'run', `seed ${seed}, ${bot}: ${w.state} at row ${Math.floor(w.ball.z)}, section ${secOf(w.ball.z) - E} of the last biome, ${w.v.toFixed(1)} rows/s`);
      }
    }
    // and so they do with the bonuses lying about
    for (let seed = 1; seed <= 8; seed++) {
      const w = new GameWorld(seed);
      w.skipTo(6);
      while (w.state === 'run' && w.ball.z < end) { w.auto(); w.step(DT); }
      assert.equal(w.state, 'run', `seed ${seed} with bonuses: ${w.state} at row ${Math.floor(w.ball.z)}`);
    }
  });
});

test('a walker is already on its way when it comes into sight: it sets off beyond the farthest row the page draws', () => {
  const src = fs.readFileSync(new URL('../public/client.js', import.meta.url), 'utf8');
  const view = +(src.match(/\bVIEW = (\d+)/) || [])[1], far = +(src.match(/\bVIEW_FAR = (\d+)/) || [])[1];
  assert.ok(view > 0 && far > 0, 'VIEW and VIEW_FAR not found in client.js');
  assert.ok(CROSS_ROWS > view && CROSS_ROWS <= view + 4 && CROSS_FAR > view + far, `${CROSS_ROWS}, ${CROSS_FAR} rows against ${view} + ${far} drawn`);
  const m = { lane: 1, from: 3 };
  const at = (w, i, d) => { w.ball.z = i + 0.5 - d; return w.moverX(m, i); };
  const w = new World(1);
  assert.ok(at(w, 400, view) !== at(w, 400, view - 3), 'it stands still where it can be seen');
  inEndgame((E) => {
    const v = new World(1);
    for (const i of [secStart(E - 1) + 5, secStart(E + 3)]) assert.ok(at(v, i, view + far) !== at(v, i, view + far - 3), `row ${i}: it stands still where it can be seen`);
  });
});
