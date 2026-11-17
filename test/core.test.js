import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { World, Track, SEC_ROWS, LANES, VERSION, laneX, speedOf } from '../public/core.js';

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
    const wall = r.block.every(Boolean), gap = !r.floor.some(Boolean);
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
  const files = fs.readdirSync(root, { recursive: true }).filter((f) => fs.statSync(new URL(f, root)).isFile() && f !== 'sw.js');
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
      assert.ok(r.floor.every(Boolean) && !r.block.some(Boolean), `seed ${seed} row ${i}`);
    }
  }
  assert.ok(hiddenRows > 20, `only ${hiddenRows} hidden rows: the check may not be wired in`);
});
