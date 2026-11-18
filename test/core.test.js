import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { World, Track, SEC_ROWS, LANES, MID, VERSION, laneX, speedOf, mulberry } from '../public/core.js';

const DT = 1 / 60;

// A bot that keeps to the guaranteed path must never die: the generator promises the track is passable,
// including the jumps, which are planned from the section's speed with a margin.
function drive(seed, rows) {
  const w = new World(seed);
  while (w.state === 'run' && w.ball.z < rows) { w.ball.tx = w.autoTarget(); w.step(DT); }
  return w;
}

test('a bot on the guaranteed path survives up to the top speed on 30 tracks', () => {
  let jumps = 0, vMin = Infinity, vMax = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const w = drive(seed, SEC_ROWS * 22);
    assert.equal(w.state, 'run', `seed ${seed} died at row ${w.score}`);
    jumps += w.stats.jumps;
    vMin = Math.min(vMin, w.stats.vRatioMin); vMax = Math.max(vMax, w.stats.vRatioMax);
  }
  assert.ok(jumps >= 150, `only ${jumps} jumps on 30 tracks`);
  // hills really change the speed
  assert.ok(vMin < 0.85 && vMax > 1.15, `speed ratio ${vMin.toFixed(2)}..${vMax.toFixed(2)}`);
});

test('every row keeps its goal lane open', () => {
  const t = new Track(42);
  for (let i = 0; i < SEC_ROWS * 25; i++) {
    const r = t.get(i);
    const lanes = r.road.flatMap((on, l) => (on ? [l] : []));
    const wall = lanes.every((l) => r.block[l]), gap = lanes.every((l) => !r.floor[l]);
    if (wall || gap) continue;   // a jump set piece: the ramp before it is the way over
    assert.ok(r.floor[r.goal] && !r.block[r.goal], `row ${i}`);
  }
});

test('jump set pieces always have a ramp on the path lane', () => {
  const t = new Track(7);
  let pieces = 0;
  for (let i = 1; i < SEC_ROWS * 25; i++) {
    const r = t.get(i);
    if (!r.ramp.some(Boolean)) continue;
    pieces++;
    assert.ok(r.ramp[r.goal], `row ${i}: no ramp on lane ${r.goal}`);
  }
  assert.ok(pieces > 3);
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
    for (let i = 1; i < SEC_ROWS * 6; i++) {
      const r = t.get(i);
      const lane = r.ramp.indexOf(false);
      if (!r.ramp.some(Boolean) || lane < 0) continue;
      const w = new World(seed);
      while (w.state === 'run' && w.ball.z < i - 6) { w.ball.tx = w.autoTarget(); w.step(DT); }
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
      for (; i < SEC_ROWS * 10; i++) {
        const r = t.get(i);
        l = r.ramp.findIndex((x, k) => x && k + 1 < LANES && !r.ramp[k + 1] && r.floor[k + 1]);
        if (l >= 0) break;
      }
      if (l < 0) continue;
      const w0 = new World(seed);
      while (w0.state === 'run' && w0.ball.z < i - 3) { w0.ball.tx = w0.autoTarget(); w0.step(dt); }
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
    assert.ok(worst < 1.5, `dt 1/${Math.round(1 / dt)}: the ball went ${worst.toFixed(1)} above the ground`);
  }
});

test('a zero or negative frame time changes nothing and leaves no NaN', () => {
  const w = new World(9);
  for (let n = 0; n < 300; n++) { w.ball.tx = w.autoTarget(); w.step(n % 7 === 0 ? 0 : n % 11 === 0 ? -0.01 : 1 / 60); }
  for (const k of ['x', 'y', 'z', 'vy']) assert.ok(Number.isFinite(w.ball[k]), `ball.${k} = ${w.ball[k]}`);
});

test('rows hidden behind a crest have no obstacles', () => {
  let hiddenRows = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const t = new Track(seed);
    for (let i = 30; i < SEC_ROWS * 20; i++) {
      const r = t.get(i);
      const ahead = Math.max(5, Math.ceil((speedOf(r.sec) + 16 * 0.32 / 2 + 0.5) * 0.6) + 2);
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
    for (let i = 0; i < SEC_ROWS * 20; i++) {
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
    for (let i = 0; i < SEC_ROWS * 20; i++) {
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
    const w = new World(seed), rows = SEC_ROWS * 20, t = w.track;
    const before = [];
    for (let i = 0; i < rows; i++) {
      const r = t.get(i);
      before.push(r.star.slice());
      r.star.forEach((s, l) => { if (s > 1) arcs++; else if (s && l === r.goal) onPath++; });
    }
    while (w.state === 'run' && w.ball.z < rows) { w.ball.tx = w.autoTarget(); w.step(DT); }
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
  while (a.ball.z < 300) { a.ball.tx = a.autoTarget(); a.step(DT); }
  const b = World.fromSave(JSON.parse(JSON.stringify(a.toSave())));
  assert.ok(b);
  assert.equal(b.stars, a.stars);
  for (let n = 0; n < 1200; n++) {
    a.ball.tx = a.autoTarget(); a.step(DT);
    b.ball.tx = b.autoTarget(); b.step(DT);
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
    while (w.state === 'run' && w.ball.z < SEC_ROWS * 12) { w.ball.tx = w.autoTarget(); w.step(1 / 20); }
    assert.equal(w.state, 'run', `seed ${seed} died at row ${w.score}`);
  }
});

test('landing after a jump is reported with its strength', () => {
  const w = new World(3);
  let lands = 0;
  while (w.state === 'run' && w.ball.z < SEC_ROWS * 8) {
    w.ball.tx = w.autoTarget(); w.step(DT);
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

test('a lane change takes about a sixth of a second at the start and less at the top speed', () => {
  for (const [sec, max] of [[0, 0.2], [20, 0.14]]) {
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
    for (let i = 20; i < SEC_ROWS * 12; i++) {
      if (!(t.get(i).road[0] && !t.get(i + 1).road[0] && t.get(i + 1).road[1])) continue;   // the road narrows after row i
      for (const back of [0.5, 1.5, 3]) {
        const w = drive(seed, i + 1 - back);
        if (w.state !== 'run' || w.lane < 1 || w.lane > 2) continue;
        seen++;
        while (w.lane > 0 && w.move(-1));   // swipe left as far as it goes
        while (w.state === 'run' && w.ball.z < i + 6) w.step(DT);
        // falling is fair only from the middle of lane 0, reached in time before it ended — never half-way across
        if (w.state === 'fall') assert.equal(w.ball.x, laneX(0), `seed ${seed} row ${i} from ${back} rows back`);
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
    while (w.state === 'run' && w.ball.z < SEC_ROWS * 14) {
      if (n++ % 12 === 0) { const d = rnd() < 0.5 ? -1 : 1; for (let k = 1 + Math.floor(rnd() * 3); k > 0; k--) w.move(d); }   // 1–3 swipes at once
      const lane = w.lane, rz = Math.floor(w.ball.z);
      assert.ok(lane >= 0 && lane < LANES);
      w.step(DT);
      if (w.state === 'fall' && !w.track.get(w.ball.fallRow).road[Math.floor(w.ball.x + LANES / 2)]) {
        // off the road: only because the lane it was in came to an end, never by crossing the edge sideways
        assert.equal(Math.abs(w.ball.x - laneX(lane)) < 0.5, true, `seed ${seed} row ${rz}`);
        assert.equal(w.track.get(Math.max(0, rz - 3)).road[lane], true, `seed ${seed} row ${rz}`);
      }
    }
  }
});

test('a bot that steers with swipes alone survives up to the top speed', () => {
  // it swipes towards the path's lane as soon as the path under the ball has moved on
  for (let seed = 1; seed <= 30; seed++) {
    const w = new World(seed);
    while (w.state === 'run' && w.ball.z < SEC_ROWS * 20) {
      const goal = w.track.get(Math.max(0, Math.floor(w.ball.z - 0.27))).goal;
      if (goal !== w.lane) w.move(Math.sign(goal - w.lane));
      w.step(DT);
    }
    assert.equal(w.state, 'run', `seed ${seed}: ${w.state} at row ${Math.floor(w.ball.z)}`);
  }
});
