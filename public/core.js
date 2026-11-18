// Game world: the track generator and the ball physics. No DOM here: the page draws the world (client.js),
// the tests run it in Node (test/core.test.js).
// When any file in public/ changes, bump VERSION here and in sw.js (a test checks they match).
export const VERSION = '0.7.1';

// ---- Tuning ----
// The track has 7 lane slots. Usually the road takes the middle 5 (lanes 1..5); now and then it widens to all 7
// and then splits: the centre lane (MID) turns into a gap between two 3-lane roads. Slots outside the road are void.
export const LANES = 7, HALF = LANES / 2, MID = 3;
export const SEC_ROWS = 48;      // rows per section; the speed steps up at each section start
export const BREATH = 8;         // obstacle-free rows at the start of every section
export const START_OPEN = 16;    // obstacle-free, flat rows at the very start
export const R = 0.22;           // ball radius (lane width = 1)
export const INSET = 0.2;        // gap between an obstacle's hit box and its cell border (it is drawn bigger)
const CORNER = 0.15;             // the hit box has rounded corners: brushing past an obstacle is fine
// Near a pit the ball still rolls on the rim until its centre is this far past the edge of the ground;
// at the road edge (void) a little less, about as much as the drawn edge waves.
export const RIM_PIT = 0.2, RIM_EDGE = 0.12;
export const BOX_H = 0.7;        // block height: too tall to jump over
// A low barrier (a log across the lane): the only way past is to jump. It lies in the middle of its row.
export const LOW_H = 0.25, LOW_Z0 = 0.38, LOW_Z1 = 0.62;
export const RAMP_H = 0.3;       // ramp height at its far edge
const V0 = 9, VMUL = 1.06, VMAX = 24;
export const G = 30;             // gravity, rows/s²
const DRIVE = 2;                 // how fast the speed returns to the section's speed
const GS = 16;                   // how much a slope speeds up / slows down the ball
const SMAX = 0.32;               // steepest slope the terrain generator makes
const JUMP_VY = 7;               // vertical speed a ramp gives
// The ball's own jump (swipe up): about 0.65 high, 0.5 s long, and it follows the ground, so it is the same on a slope.
// It is floatier than a fall (HOP_G instead of G): a log is cleared by a jump started anywhere from 0.37 to 0.1 s
// before it. It clears a low barrier and a short pit, not a block. A swipe down in the air throws the ball to the ground.
export const HOP_VY = 5.5, HOP_G = 22, DROP_VY = 16;
const HOP_BUFFER = 0.15;         // a jump asked for this long before landing happens on landing
const REACT = 0.6;               // seconds a player gets for one swipe, on top of the lane change itself
const MAX_DT = 1 / 60;           // the world advances in steps no longer than this, however slow the frame
export const SAVE_V = 1;         // format of a saved run (World.toSave); bump when it changes
// Stars: runs of them lie along the guaranteed path, an arc of them hangs over most jumps, and now and then a lone
// one sits off the path. A star is taken when the ball's centre is this close to it (sideways / along / up).
const STAR_X = 0.5, STAR_Z = 0.55, STAR_Y = 0.75;
// Steering: the ball rolls along the middle of a lane, and a swipe sends it to the next one (World.move sets the
// target `tx` to that lane's centre). One swipe is one lane. On the way there speeding up is limited (STEER_ACC, no jerks), slowing down is
// not; close to the target the ball settles in at STEER_K per second and never steps past it.
const STEER_ACC = 150, STEER_K = 40;
export function steer(b, L, dt) {
  const d = b.tx - b.x, want = Math.sign(d) * Math.min(L, STEER_K * Math.abs(d));
  if (Math.sign(want) !== Math.sign(b.vx) || Math.abs(want) < Math.abs(b.vx)) b.vx = want;   // slow down / turn at once
  else b.vx += Math.min(Math.abs(want - b.vx), STEER_ACC * dt) * Math.sign(want);           // speed up gently
  const move = b.vx * dt;
  if (Math.abs(move) >= Math.abs(d) - 1e-3) { b.x = b.tx; b.vx = 0; } else b.x += move;   // the last hair: exactly on the lane
}
// how long moving over by one lane takes at forward speed v, until the ball is well inside the new lane
const SHIFT_T = new Map();
function shiftTime(v) {
  const key = Math.round(v * 4);
  if (!SHIFT_T.has(key)) {
    const b = { x: 0, tx: 1, vx: 0 }, dt = 1 / 240;
    let t = 0;
    while (1 - b.x > 0.1 && t < 2) { steer(b, latOf(v), dt); t += dt; }
    SHIFT_T.set(key, t + 0.05);
  }
  return SHIFT_T.get(key);
}
// The camera (client.js draws with these): it sits CAM_BACK rows behind the ball, CAM_H above the road.
export const CAM_H = 1.4, CAM_BACK = 1.9;
const SEE_AHEAD = 0.6;           // seconds of warning: an obstacle must be visible this long before the ball gets there
const LEAD = 6;                  // flat rows needed before a jump, so the speed is predictable
const SPEED_TOL = 0.25;          // speed spread the jump planner allows for

export const speedOf = (s) => Math.min(VMAX, V0 * Math.pow(VMUL, s));
export const fastOf = (s) => speedOf(s) + GS * SMAX / DRIVE + 0.5;   // the fastest the ball gets downhill in section s
export const latOf = (v) => 6 + v * 0.3;         // max sideways speed at forward speed v
export const laneX = (l) => l - HALF + 0.5;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Track ----
// Obstacles come in waves: a line of them across the road, one to three rows deep, then at least K free rows —
// the time for one swipe at the fastest downhill speed (REACT plus the lane change). In a wave every lane is either
// free, or has a free lane right next to it, or holds a low barrier to jump over. So whatever lane the ball is in,
// one swipe or one jump before each wave is enough, and never two in a hurry. A wave of low barriers across the
// whole road ('hurdle') can only be jumped.
// A guaranteed path (row.goal) runs through every row: it moves by at most one lane between waves, right after a
// wave, and stars lie along it. The jump set piece is the exception: a wall or a gap spans the full width and a
// ramp is the way over it; every lane has a ramp or one next to it.
// Lanes that end (the centre when the road splits, the outer ones when it narrows) get the same K rows of warning
// with no waves around.
const ROAD_LANES = {
  normal: (l) => l >= 1 && l <= 5,
  widen: () => true,
  split: (l) => l !== MID,
  close: () => true,
};
const WAVES = ['blocks', 'pits', 'mixed', 'lows', 'hurdle'];

export class Track {
  constructor(seed) {
    this.r = mulberry(seed);
    this.rs = mulberry((seed ^ 0x5bd1e995) >>> 0);   // stars draw from their own stream: the track stays the same
    this.starRun = 0; this.starCool = 4; this.starSkip = 0;
    this.rows = [];
    this.path = MID;
    this.sh = { mode: 'normal', i: 0, len: START_OPEN + 60 };       // road shape: normal → widen → split → close
    this.cur = { kind: 'straight', i: 0, len: START_OPEN + 10, A: 0, n: 1 };   // bends of the road (just looks)
    this.gap = START_OPEN;     // free rows still to come before the next wave or jump may start
    this.wave = null;          // the wave being laid: { cells: per lane '' | 'block' | 'pit' | 'low', left: rows to go }
    this.jump = null; this.ji = 0; this.wantJump = false;
    this.ter = { kind: 'flat', len: START_OPEN, i: 0, A: 0, base: 0 };
    this.flatRun = 0;
  }

  get(i) {
    while (this.rows.length <= i) this.gen();
    return this.rows[Math.max(0, i)];
  }

  // A wave for the current road. Each stretch of road is filled on its own (two of them when the road is split).
  makeWave(sec, road) {
    const r = this.r, w = [3, 2, 2, sec >= 1 ? 2 : 0, sec >= 1 ? 1.5 : 0];
    let x = r() * w.reduce((a, b) => a + b), kind = WAVES[0];
    for (let k = 0; k < w.length; k++) { x -= w[k]; if (x < 0) { kind = WAVES[k]; break; } }
    const cells = Array(LANES).fill('');
    if (kind === 'hurdle') {
      for (let l = 0; l < LANES; l++) if (road[l]) cells[l] = 'low';
      return { cells, left: 1 };
    }
    const p = Math.min(0.7, 0.58 + sec * 0.01), shut = Array(LANES).fill(false);
    for (let l = 0; l < LANES; l++) shut[l] = road[l] && l !== this.path && r() < p;
    const free = (l) => l >= 0 && l < LANES && road[l] && !shut[l];
    for (let l = 0; l < LANES; l++) if (shut[l] && !free(l - 1) && !free(l + 1)) shut[l] = false;   // always a free lane next door
    if (!shut.some(Boolean)) {   // nothing came out: shut a lane next to the path
      const ds = [-1, 1].filter((d) => road[this.path + d]);
      if (ds.length) shut[this.path + ds[Math.floor(r() * ds.length)]] = true;
    }
    for (let l = 0; l < LANES; l++) {
      if (!shut[l]) continue;
      cells[l] = kind === 'blocks' ? 'block' : kind === 'pits' ? 'pit' : kind === 'mixed' ? (r() < 0.5 ? 'block' : 'pit') : (r() < 0.65 ? 'low' : 'block');
    }
    return { cells, left: kind === 'pits' ? 1 + Math.floor(r() * 3) : kind === 'blocks' && r() < 0.25 ? 2 : 1 };
  }

  // After a wave or a jump: free rows to come, and now and then the path moves one lane over.
  // Obstacles stay sparse: the speed alone makes the later sections harder.
  rest(K, mode) {
    const r = this.r;
    this.gap = K + Math.floor(r() * 7) + (r() < 0.15 ? 8 + Math.floor(r() * 10) : 0);
    if ((mode === 'normal' || mode === 'split') && r() < 0.55) {
      const ds = [-1, 1].filter((d) => this.pathLane(mode, this.path + d));
      if (ds.length) this.shift(ds[Math.floor(r() * ds.length)]);
    }
    if (mode === 'normal' && r() < 0.25) this.wantJump = true;
  }

  shift(d) {
    this.path += d;
    this.starSkip = 3;   // no stars while a ball on the path is still crossing over
  }

  // Where a block row or a gap fits, given the ramp physics and a speed spread.
  // Distances are counted from the far edge of the ramp row.
  planJump(v, sec) {
    const r = this.r, vlo = v * (1 - SPEED_TOL), vhi = v * (1 + SPEED_TOL);
    const need = BOX_H + 0.08 - RAMP_H, disc = Math.sqrt(JUMP_VY ** 2 - 2 * G * need);
    const t1 = (JUMP_VY - disc) / G, t2 = (JUMP_VY + disc) / G;   // ball bottom above block tops
    const zlo = vhi * t1 + vhi / 30, zhi = vlo * t2;
    const tLand = (JUMP_VY + Math.sqrt(JUMP_VY ** 2 + 2 * G * RAMP_H)) / G;
    const valid = [];
    for (let d = 0; d + 1 - INSET + R <= zhi; d++) if (d + INSET - R >= zlo) valid.push(d);
    const gMax = Math.floor(vlo * tLand - 0.35) - 1;             // last gap row the shortest jump clears
    let kind = r() < 0.5 ? 'wall' : 'gap';
    if (kind === 'wall' && !valid.length) kind = 'gap';
    if (kind === 'gap' && gMax < 0) return null;
    const J = { kind, rampAt: 2, rows: [], gEnd: -1, ramps: [] };
    if (kind === 'wall') {
      const n = Math.min(valid.length, 1 + Math.floor(r() * 3));
      const s = valid[Math.floor((valid.length - n) / 2)];
      for (let k = 0; k < n; k++) J.rows.push(s + k);
    } else J.gEnd = gMax - Math.floor(r() * Math.min(3, gMax + 1));
    const landMax = vhi * tLand + vhi / 30 + 2;
    J.len = J.rampAt + 1 + Math.ceil(landMax) + 1;
    // jumps only on a normal road; a ramp is never more than one lane away
    const on = Array(LANES).fill(false);
    for (let l = 1; l <= 5; l++) on[l] = sec < 2 || l === this.path || r() < 0.3;
    for (let l = 1; l <= 5; l++) if (!on[l - 1] && !on[l] && !on[l + 1]) on[l < 5 && r() < 0.5 ? l + 1 : l] = true;
    for (let l = 1; l <= 5; l++) if (on[l]) J.ramps.push(l);
    return J;
  }

  terrain(flat) {
    const T = this.ter, r = this.r;
    if (T.i >= T.len) {
      T.base = this.heightOf(T, 1); T.i = 0;
      const x = r();
      if (flat) { T.kind = 'flat'; T.len = this.wantJump ? LEAD : 1; }
      else if (x < 0.3) { T.kind = 'flat'; T.len = 8 + Math.floor(r() * 14); }
      else if (x < 0.65) { T.kind = 'hill'; T.A = (r() < 0.6 ? 1 : -1) * (1.2 + r() * 1.8); T.len = 30 + Math.floor(r() * 14); }
      else {
        const dir = T.base > 3 ? -1 : T.base < -3 ? 1 : (r() < 0.5 ? -1 : 1);
        T.kind = 'climb'; T.A = dir * (1 + r() * 1.5); T.len = 16 + Math.floor(r() * 12);
      }
    }
    const h = this.heightOf(T, T.i / T.len);
    T.i++;
    this.flatRun = T.kind === 'flat' ? this.flatRun + 1 : 0;
    return h;
  }

  // Sideways offset of the road centre, for drawing only: the ball keeps to the road on its own.
  curve() {
    const C = this.cur, r = this.r;
    if (C.i >= C.len) {
      C.i = 0;
      if (r() < 0.4) { C.kind = 'straight'; C.len = 16 + Math.floor(r() * 30); }
      else { C.kind = 'snake'; C.n = 1 + Math.floor(r() * 3); C.len = C.n * (34 + Math.floor(r() * 12)); C.A = (r() < 0.5 ? -1 : 1) * (0.8 + r() * 0.8); }
    }
    const t = C.i / C.len;
    C.i++;
    return C.kind === 'snake' ? C.A * Math.sin(2 * Math.PI * C.n * t) * Math.sin(Math.PI * t) ** 2 : 0;
  }

  // Advance the road shape by a row. The widening before a split and the narrowing after it last at least K rows
  // and carry no waves: time to leave a lane that is about to end. The path is moved out of the way first
  // (see gen), off the centre lane before a split, back inside lanes 1..5 before the road narrows.
  shape(K, busy) {
    const S = this.sh, r = this.r;
    S.i++;
    if (S.mode === 'normal') {
      if (S.i >= S.len && !busy && !this.wave) { S.mode = 'widen'; S.i = 0; S.len = K + 3; }
    } else if (S.mode === 'widen') {
      if (S.i >= S.len && this.path !== MID) { S.mode = 'split'; S.i = 0; S.len = 24 + Math.floor(r() * 24); }
    } else if (S.mode === 'split') {
      if (S.i >= S.len && !this.wave) { S.mode = 'close'; S.i = 0; S.len = K + 3; }
    } else if (S.i >= S.len && this.path >= 1 && this.path <= 5) {
      S.mode = 'normal'; S.i = 0; S.len = 90 + Math.floor(r() * 110);
    }
    return S.mode;
  }

  // lanes the path may move to under the current shape
  pathLane(mode, l) {
    if (l < 0 || l >= LANES) return false;
    if (mode === 'normal' || mode === 'close') return l >= 1 && l <= 5;
    if (mode === 'widen') return l !== MID;
    return l !== MID && (l < MID) === (this.path < MID);   // split: stay on your side
  }

  heightOf(T, t) {
    if (T.kind === 'hill') return T.base + T.A * (1 - Math.cos(2 * Math.PI * t)) / 2;
    if (T.kind === 'climb') return T.base + T.A * (1 - Math.cos(Math.PI * t)) / 2;
    return T.base;
  }

  gen() {
    const i = this.rows.length, r = this.r, sec = Math.floor(i / SEC_ROWS), k = i % SEC_ROWS;
    // free rows are counted for the next section's speed: the next wave may already lie there
    const v = speedOf(sec), vhi = fastOf(sec), vK = fastOf(sec + 1), K = Math.ceil(vK * (REACT + shiftTime(vK)));
    const block = Array(LANES).fill(false), ramp = Array(LANES).fill(false), low = Array(LANES).fill(false);
    const star = Array(LANES).fill(0);   // 0 — none, otherwise 1 + its height above the spot where a resting ball would be
    // the ground is flat at the start, under a jump and while one is waiting for flat ground
    const h = this.terrain(i < START_OPEN || !!this.jump || this.wantJump), off = this.curve();
    const mode = this.shape(K, !!this.jump || this.wantJump);
    const road = Array.from({ length: LANES }, (_, l) => ROAD_LANES[mode](l)), floor = road.slice();
    // the shape needs the path somewhere else: move it at once, the shape waits K rows
    if (mode === 'widen' && this.path === MID) this.shift(r() < 0.5 ? -1 : 1);
    if (mode === 'close' && (this.path === 0 || this.path === LANES - 1)) this.shift(this.path === 0 ? 1 : -1);
    // a row hidden behind a crest until the last moment gets no obstacles
    const hidden = this.hidden(i, h, Math.max(5, Math.ceil(vhi * SEE_AHEAD) + 2));
    const open = i < START_OPEN || k < BREATH;   // nothing starts here
    if (!this.jump && !this.wave) {
      if (mode === 'widen' || mode === 'close') this.gap = Math.max(this.gap, K);
      if (this.gap > 0) this.gap--;
      else if (!open && !hidden) {
        if (this.wantJump) {
          // flat ground for a while, a normal road: build the jump; otherwise carry on with waves and try later
          const J = this.flatRun >= LEAD && this.ter.kind === 'flat' && mode === 'normal' ? this.planJump(v, sec) : null;
          if (J) { this.jump = J; this.ji = 0; this.wantJump = false; J.arc = this.rs() < 0.75; }
        }
        if (!this.jump && (mode === 'normal' || mode === 'split')) {
          this.wave = this.makeWave(sec, road);
          this.wave.left = Math.min(this.wave.left, SEC_ROWS - k);   // the start of the next section stays free
        }
      }
    }
    let piece = false;   // this row belongs to a wave or a jump
    if (this.jump) {
      const J = this.jump, j = this.ji++, d = j - J.rampAt - 1;
      piece = true;
      for (let l = 0; l < LANES; l++) {
        if (!road[l]) continue;
        if (j === J.rampAt && J.ramps.includes(l)) ramp[l] = true;
        if (hidden) continue;
        if (J.kind === 'wall' && J.rows.includes(d)) block[l] = true;
        if (J.kind === 'gap' && d >= 0 && d <= J.gEnd) floor[l] = false;
      }
      if (J.arc && d >= 0 && !hidden) {   // stars along the flight of a ball that left the ramp at the section's speed
        const t = (d + 0.5) / v, y = RAMP_H + JUMP_VY * t - G / 2 * t * t;
        if (y > 0.2) star[this.path] = 1 + y;
      }
      if (this.ji >= J.len) { this.jump = null; this.rest(K, mode); }
    } else if (this.wave) {
      const W = this.wave;
      piece = true;
      if (!hidden) {
        for (let l = 0; l < LANES; l++) {
          if (!road[l]) continue;
          if (W.cells[l] === 'block') block[l] = true; else if (W.cells[l] === 'pit') floor[l] = false; else if (W.cells[l] === 'low') low[l] = true;
        }
        if (low[this.path] && this.rs() < 0.8) star[this.path] = 1 + 0.55;   // a star over the barrier: jump here
      }
      if (--W.left <= 0 || hidden) { this.wave = null; this.rest(K, mode); }
    }
    const goal = piece && this.rows.length ? this.rows[i - 1].goal : this.path;   // the path moves only after the piece
    if (!this.jump && !star[goal]) {
      const rs = this.rs;
      if (this.starSkip > 0) this.starSkip--;
      else if (this.starRun > 0) {
        if (!hidden && !low[goal]) star[goal] = 1;
        if (--this.starRun === 0) this.starCool = 6 + Math.floor(rs() * 14);
      } else if (--this.starCool <= 0) this.starRun = 3 + Math.floor(rs() * 4);
      if (rs() < 0.06) {   // a lone star off the path: worth a detour, never inside an obstacle or over a pit
        const l = Math.floor(rs() * LANES);
        if (road[l] && floor[l] && !block[l] && !low[l] && l !== goal && !hidden) star[l] = 1;
      }
    }
    this.rows.push({ road, floor, block, ramp, low, star, h, off, sec, goal });
  }

  // Can the camera see the start of row i (height h) while the ball is still `ahead` rows before it?
  // The eye is CAM_BACK behind and CAM_H above the road under the ball; any row in between that rises
  // above the line of sight (a crest) hides row i.
  hidden(i, h, ahead) {
    const e = i - ahead;
    if (e < 1) return false;
    const ez = e - CAM_BACK, ey = this.rows[e].h + CAM_H;
    for (let j = e + 1; j < i; j++) {
      const sight = ey + (h - ey) * (j - ez) / (i - ez);
      if (this.rows[j].h > sight + 0.02) return true;
    }
    return false;
  }
}

// ---- World ----
// state: 'run' → 'fall' (off the track or into a hole) or 'crash' (into a block) → 'over'.
// The ball: `air` — off the ground; `fromRamp` — the flight was meant (a ramp or the ball's own jump), not a hop
// off a crest; `hop` — its own jump, which follows the ground below; `hopQ` — a jump waiting for the landing.
// events: 'section', 'jump', 'drop', 'land' (how hard — in `impact`, 0..1), 'star', 'move' and 'bump' (a lane change made
// or refused; which way it was refused — in `side`), 'fall', 'crash', 'over' — the page drains them for effects.
export class World {
  constructor(seed) {
    this.seed = seed;
    this.track = new Track(seed);
    this.ball = { x: 0, vx: 0, y: R, vy: 0, z: 2, tx: 0, roll: 0, fallRow: 0, air: false, airT: 0, fromRamp: false, hop: false, hopQ: 0 };
    this.v = speedOf(0);
    this.state = 'run';
    this.sec = 0;
    this.tOver = 0;
    this.events = [];
    this.stars = 0;      // stars taken in this run
    this.impact = 0;     // strength of the last landing
    this.side = 0;       // which way the last refused lane change went: -1 left, 1 right
    this.stats = { jumps: 0, hops: 0, vRatioMin: Infinity, vRatioMax: 0 };
  }

  get score() { return Math.floor(this.ball.z); }

  // sideways offset of the road centre at z (drawing only)
  offAt(z) {
    const zz = Math.max(0, z), i = Math.floor(zz), a = this.track.get(i).off, b = this.track.get(i + 1).off;
    return a + (b - a) * (zz - i);
  }

  // terrain height at z (linear between row starts)
  hAt(z) {
    const zz = Math.max(0, z), i = Math.floor(zz), a = this.track.get(i).h, b = this.track.get(i + 1).h;
    return a + (b - a) * (zz - i);
  }

  // surface under (x, z) including ramps, or null over a hole or off the track
  groundAt(x, z) {
    const lane = Math.floor(x + HALF), rz = Math.floor(z);
    if (rz < 0) return null;
    const row = this.track.get(rz);
    if (lane >= 0 && lane < LANES && row.floor[lane]) return this.hAt(z) + (row.ramp[lane] ? RAMP_H * (z - rz) : 0);
    return this.onRim(lane, rz, x + HALF - lane, z - rz) ? this.hAt(z) : null;
  }

  // Is a point over a pit or the void still close enough to the ground next to it to hold the ball?
  // fx, fz: where it is inside its cell, 0..1.
  onRim(lane, rz, fx, fz) {
    const t = this.track, row = t.get(rz);
    const isPit = lane >= 0 && lane < LANES && row.road[lane];
    const ground = (l, r) => l >= 0 && l < LANES && r >= 0 && t.get(r).floor[l];
    const rimFor = (l, r) => (isPit && t.get(r).road[l] ? RIM_PIT : RIM_EDGE);   // pit rim or road edge
    return (fx < rimFor(lane - 1, rz) && ground(lane - 1, rz)) || (fx > 1 - rimFor(lane + 1, rz) && ground(lane + 1, rz))
      || (fz < RIM_PIT && isPit && ground(lane, rz - 1)) || (fz > 1 - RIM_PIT && isPit && ground(lane, rz + 1));
  }

  hit() {
    const b = this.ball;
    for (let rz = Math.floor(b.z - R); rz <= Math.floor(b.z + R); rz++) {
      if (rz < 0) continue;
      const row = this.track.get(rz);
      for (let l = Math.floor(b.x + HALF - R); l <= Math.floor(b.x + HALF + R); l++) {
        if (l < 0 || l >= LANES || !row.block[l]) continue;
        // a rectangle with rounded corners: the inner rectangle grown by CORNER
        const x0 = l - HALF + INSET + CORNER, x1 = l - HALF + 1 - INSET - CORNER, z0 = rz + INSET + CORNER, z1 = rz + 1 - INSET - CORNER;
        const cx = clamp(b.x, x0, x1), cz = clamp(b.z, z0, z1);
        if ((cx - b.x) ** 2 + (cz - b.z) ** 2 >= (R + CORNER) ** 2) continue;
        if (b.y - R < this.hAt(cz) + BOX_H) return true;
      }
      for (let l = Math.floor(b.x + HALF - R); l <= Math.floor(b.x + HALF + R); l++) {
        if (l < 0 || l >= LANES || !row.low[l]) continue;
        // a low barrier: a bar across the whole lane
        const cx = clamp(b.x, l - HALF, l - HALF + 1), cz = clamp(b.z, rz + LOW_Z0, rz + LOW_Z1);
        if ((cx - b.x) ** 2 + (cz - b.z) ** 2 < R * R && b.y - R < this.hAt(cz) + LOW_H) return true;
      }
    }
    return false;
  }

  // A bot (and the tests): keep to the guaranteed path and jump the low barriers in the way.
  auto() {
    const b = this.ball, t = this.track, goal = t.get(Math.max(0, Math.floor(b.z - R - 0.05))).goal;
    if (goal !== this.lane) this.move(Math.sign(goal - this.lane));
    if (b.air) return;
    const reach = this.v * HOP_VY / HOP_G, at = Math.floor(b.x + HALF);   // half a jump: the barrier goes under the top of it
    for (let r = Math.floor(b.z); r + 0.5 - b.z <= reach; r++) {
      const row = t.get(r);
      if (r + 0.5 > b.z && (row.low[at] || row.low[this.lane])) { this.jump(); break; }
    }
  }

  // the lane the ball is in or heading for
  get lane() { return Math.round(this.ball.tx + HALF - 0.5); }

  // A swipe: head for the next lane to the left (-1) or to the right (1), also in the air. Swipes add up, so two
  // quick ones cross two lanes. There is no leaving the road sideways: at its edge the swipe is refused ('bump').
  // Pits are fair game, and so is staying in a lane that ends.
  move(dir) {
    if (this.state !== 'run') return false;
    const b = this.ball, to = this.lane + dir;
    // The road must be there all the way the ball rolls while it crosses over: from the moment it leaves its own
    // lane (the first quarter of a change it is still well inside) until it has arrived, counting every lane still
    // to cross and the speed a downhill may add.
    const T = shiftTime(this.v), n = Math.max(1, Math.ceil(Math.abs(laneX(to) - b.x) - 0.05));
    const z0 = Math.max(0, Math.floor(b.z + this.v * T * 0.25)), z1 = Math.floor(b.z + (this.v + GS * SMAX / DRIVE + 0.5) * T * n);
    let ok = to >= 0 && to < LANES;
    for (let r = z0; ok && r <= z1; r++) ok = this.track.get(r).road[to];
    if (ok) b.tx = laneX(to); else this.side = dir;
    this.events.push(ok ? 'move' : 'bump');
    return ok;
  }

  // A swipe up: the ball jumps. In the air the wish is kept for a moment and comes true on landing.
  jump() {
    if (this.state !== 'run') return false;
    const b = this.ball, lane = Math.floor(b.x + HALF);
    if (b.air) { b.hopQ = HOP_BUFFER; return false; }
    if (this.track.get(Math.max(0, Math.floor(b.z))).ramp[lane]) return false;   // on a ramp: it throws the ball itself
    this.hop();
    return true;
  }

  hop() {
    const b = this.ball;
    b.air = true; b.airT = 0; b.fromRamp = true; b.hop = true; b.hopQ = 0; b.vy = HOP_VY;
    this.events.push('jump');
  }

  // A swipe down: in the air the ball is thrown straight to the ground.
  drop() {
    const b = this.ball;
    if (this.state !== 'run' || !b.air) return false;
    b.vy = Math.min(b.vy, -DROP_VY); b.hopQ = 0;
    this.events.push('drop');
    return true;
  }

  fall() {
    const b = this.ball;
    this.state = 'fall'; b.tx = b.x; b.fallRow = Math.floor(b.z);
    this.events.push('fall');
  }

  // The ball takes the stars it touches. They hang where a resting or a jumping ball's centre passes.
  takeStars() {
    const b = this.ball, lane = Math.floor(b.x + HALF), rz = Math.floor(b.z);
    for (let r = Math.max(0, rz - 1); r <= rz + 1; r++) {
      const row = this.track.get(r);
      for (let l = Math.max(0, lane - 1); l <= Math.min(LANES - 1, lane + 1); l++) {
        const s = row.star[l];
        if (!s || Math.abs(b.x - laneX(l)) > STAR_X || Math.abs(b.z - r - 0.5) > STAR_Z) continue;
        if (Math.abs(b.y - (this.hAt(r + 0.5) + R + s - 1)) > STAR_Y) continue;
        row.star[l] = 0; this.stars++; this.events.push('star');
      }
    }
  }

  // A run in progress as plain data, and back. The track is rebuilt from the seed, so only the ball is stored.
  toSave() {
    return { v: SAVE_V, seed: this.seed, ball: { ...this.ball }, speed: this.v, sec: this.sec, stars: this.stars };
  }

  static fromSave(o) {
    if (!o || o.v !== SAVE_V || !Number.isFinite(o.seed) || !o.ball || !(o.ball.z >= 0 && o.ball.z < 2e5) || !(o.speed > 0 && o.speed < 100)) return null;
    const w = new World(o.seed), b = w.ball;
    for (const k in b) if (typeof o.ball[k] === typeof b[k] && (typeof b[k] !== 'number' || Number.isFinite(o.ball[k]))) b[k] = o.ball[k];
    w.v = o.speed; w.sec = Math.floor(b.z / SEC_ROWS); w.stars = Math.max(0, Math.floor(o.stars) || 0);
    // what is behind was taken or missed; so was the next row's star if the ball already reached it
    for (let r = 0; r <= Math.floor(b.z + 0.05); r++) w.track.get(r).star.fill(0);
    return w;
  }

  // Advance by dt in equal steps of at most MAX_DT: on a slow frame the ball still can't skip over an obstacle or
  // a star, and a jump stays close to the planned one.
  step(dt) {
    if (!(dt > 0)) return;   // a repeated or backwards frame time must not divide by zero below
    const n = Math.ceil(dt / MAX_DT - 1e-9);
    for (let k = 0; k < n; k++) this.tick(dt / n);
  }

  tick(dt) {
    const b = this.ball, t = this.track;
    if (this.state === 'run') {
      const sec = Math.floor(b.z / SEC_ROWS), target = speedOf(sec), rowPrev = Math.floor(b.z);
      if (!b.air) {
        const s = t.get(rowPrev + 1).h - t.get(rowPrev).h;
        this.v = Math.max(2.5, this.v + (DRIVE * (target - this.v) - GS * s) * dt);
      }
      const hPrev = this.hAt(b.z);
      b.z += this.v * dt; b.roll += this.v * dt / R;
      steer(b, latOf(this.v), dt);
      if (b.hopQ > 0) b.hopQ = Math.max(0, b.hopQ - dt);
      if (sec !== this.sec) { this.sec = sec; this.events.push('section'); }
      const lane = Math.floor(b.x + HALF), rz = Math.floor(b.z);
      const g = this.groundAt(b.x, b.z);
      // a ramp throws the ball the same way whether it rolled onto it or came down on it in a jump of its own
      const offRamp = rz !== rowPrev && lane >= 0 && lane < LANES && t.get(rowPrev).ramp[lane]
        && (!b.air || (b.hop && b.y - R < hPrev + RAMP_H + 0.45));
      if (!b.air || offRamp) {
        if (offRamp) {
          // left the ramp: launch as if exactly from its top edge
          const over = (b.z - rz) / this.v;
          b.air = true; b.airT = 0; b.fromRamp = true; b.hop = false; this.stats.jumps++;
          b.y = this.hAt(rz) + RAMP_H + R + JUMP_VY * over - G / 2 * over * over;
          b.vy = JUMP_VY - G * over;
          this.events.push('jump');
        } else if (g === null) this.fall();
        else {
          const yFree = b.y + b.vy * dt - G / 2 * dt * dt, yG = g + R;
          if (yFree > yG + 0.03) { b.air = true; b.airT = 0; b.fromRamp = false; b.vy -= G * dt; b.y = yFree; }
          else {
            // vertical speed from the slope under the ball, not from the height change this frame:
            // a step in the ground (rolling onto a ramp from the side) must not turn into a launch
            const slope = t.get(rz + 1).h - t.get(rz).h + (t.get(rz).ramp[lane] ? RAMP_H : 0);
            b.vy = slope * this.v; b.y = yG;
          }
        }
      } else {
        b.vy -= (b.hop ? HOP_G : G) * dt; b.y += b.vy * dt; b.airT += dt;
        if (b.hop) b.y += this.hAt(b.z) - hPrev;   // its own jump is counted from the ground below
        if (g !== null && b.y <= g + R) {
          if (!b.fromRamp && b.airT > 0.15) this.stats.hops++;
          if (b.airT > 0.12) { this.impact = clamp(-b.vy / 9, 0.15, 1); this.events.push('land'); }
          b.y = g + R; b.vy = 0; b.air = false; b.hop = false;
          if (b.hopQ > 0) this.hop();
        } else if (g === null && b.y < this.hAt(b.z) + R - 0.3) this.fall();
      }
      if (this.state === 'run') this.takeStars();
      if (this.state === 'run' && this.hit()) { this.state = 'crash'; this.tOver = 0.9; this.events.push('crash'); }
      if (this.state === 'run' && b.z > START_OPEN) {
        const ratio = this.v / target;
        this.stats.vRatioMin = Math.min(this.stats.vRatioMin, ratio);
        this.stats.vRatioMax = Math.max(this.stats.vRatioMax, ratio);
      }
    } else if (this.state === 'fall') {
      this.v *= Math.pow(0.02, dt); b.z += this.v * dt;
      b.vy -= G * dt; b.y += b.vy * dt;
      if (b.y < this.hAt(b.fallRow) - 8) { this.state = 'over'; this.events.push('over'); }
    } else if (this.state === 'crash') {
      if ((this.tOver -= dt) <= 0) { this.state = 'over'; this.events.push('over'); }
    }
  }
}
