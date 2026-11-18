// Game world: the track generator and the ball physics. No DOM here: the page draws the world (client.js),
// the tests run it in Node (test/core.test.js).
// When any file in public/ changes, bump VERSION here and in sw.js (a test checks they match).
export const VERSION = '0.13.3';

// ---- Tuning ----
// The track has 7 lane slots. Usually the road takes the middle 5 (lanes 1..5); now and then it widens to all 7
// and then splits: the centre lane (MID) turns into a gap between two 3-lane roads. Slots outside the road are void.
export const LANES = 7, HALF = LANES / 2, MID = 3;
// The track is cut into sections and biomes by time, not by length. A section lasts SEC_T seconds at its own speed
// and the speed steps up at each section start, so a faster section is longer in rows (secStart, secOf). A biome is
// BIOME_SECS sections: half a minute whatever the speed. Nothing here knows how many biomes the page draws (THEMES
// in client.js): they are counted off for ever, and the last drawn one simply never ends.
export const SEC_T = 5, BIOME_SECS = 6;
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
const V0 = 9, VMUL = 1.03, VMAX = 24;   // rows a second: at the start, times this every section, at most
export const G = 30;             // gravity, rows/s²
const DRIVE = 2;                 // how fast the speed returns to the section's speed
const GS = 16;                   // how much a slope speeds up / slows down the ball
const SMAX = 0.32;               // steepest slope the terrain generator makes
const JUMP_VY = 7;               // vertical speed a ramp gives
// The ball's own jump (swipe up): about 0.65 high, 0.5 s long, and it follows the ground, so it is the same on a slope.
// It is floatier than a fall (HOP_G instead of G): a log is cleared by a jump started anywhere from 0.37 to 0.1 s
// before it. It clears a low barrier, not a block. A swipe down in the air throws the ball to the ground.
export const HOP_VY = 5.5, HOP_G = 22, DROP_VY = 16;
const HOP_BUFFER = 0.15;         // a jump asked for this long before landing happens on landing
// Bonuses lie on the track now and then (row.bonus), on the path or one lane off it:
//   'magnet' — for MAGNET_T seconds stars come to the ball from every lane of the road;
//   'shield' — for SHIELD_T seconds (four sections) the next hit breaks the obstacle instead of the ball, and
//              nothing can hit it for SHIELD_SAFE after;
//   'fly'    — for FLY_T seconds the ball flies FLY_H above the road, over everything, in three lanes of its own,
//              along a trail of stars in the air; a swipe down lands it early. It lands on the path by itself. Nothing can hit it for FLY_SAFE after it starts down.
export const SHIELD_T = 4 * SEC_T;
export const MAGNET_T = 8, FLY_T = 7, FLY_H = 2.2, SHIELD_SAFE = 0.7, FLY_SAFE = 1.6;
// a flight coming down heads for the path lane LAND_LOOK seconds ahead and wants LAND_AHEAD seconds of road there:
// the way down and time to react
const LAND_AHEAD = 1.3, LAND_LOOK = 0.5;
const REACT = 0.6;               // seconds a player gets for one swipe, on top of the lane change itself
const MAX_DT = 1 / 60;           // the world advances in steps no longer than this, however slow the frame
export const SAVE_V = 3;         // format of a saved run (World.toSave); bump when it changes
// Stars: runs of them lie along the guaranteed path, an arc of them hangs over most jumps, and now and then a lone
// one sits off the path. A star is taken when the ball's centre is this close to it (sideways / along / up).
const STAR_X = 0.5, STAR_Z = 0.55, STAR_Y = 0.75;
// Stars come in stretches with breaks between: a stretch lasts STAR_ON seconds (a line on the path, and lines in
// some of the other lanes alongside, each lane with SIDE_P), a break STAR_OFF seconds with no stars at all.
const STAR_ON = [1.2, 2], STAR_OFF = [2.5, 4.5], SIDE_P = 0.5;
// Steering: the ball rolls along the middle of a lane, and a swipe sends it to the next one (World.move sets the
// target `tx` to that lane's centre). One swipe is one lane. On the way there speeding up is limited (STEER_ACC, no jerks), slowing down is
// not; close to the target the ball settles in at STEER_K per second and never steps past it.
// The ball has some weight: it takes a moment to get going (STEER_ACC) and rolls into its lane slowing down from
// about a quarter of a lane away (STEER_K).
const STEER_ACC = 220, STEER_K = 34;
export function steer(b, L, dt) {
  const d = b.tx - b.x, want = Math.sign(d) * Math.min(L, STEER_K * Math.abs(d));
  if (b.vx !== 0 && Math.sign(want) !== Math.sign(b.vx)) b.vx = 0;                 // turning back: stop, then set off again
  if (Math.abs(want) < Math.abs(b.vx)) b.vx = want;                               // slowing down follows the target at once
  else b.vx += Math.min(Math.abs(want - b.vx), STEER_ACC * dt) * Math.sign(want);   // speeding up takes time, from rest too
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

export const speedOf = (s) => Math.min(VMAX, V0 * Math.pow(VMUL, Math.max(0, s)));
const SEC_AT = [0], ROW_SEC = [];   // the first row of each section; the section of each row (both filled as far as asked)
export function secStart(s) {
  for (s = Math.min(s, 1e5); SEC_AT.length <= s;) SEC_AT.push(SEC_AT[SEC_AT.length - 1] + Math.round(SEC_T * speedOf(SEC_AT.length - 1)));
  return SEC_AT[Math.max(0, Math.floor(s) || 0)];
}
export function secOf(z) {   // the section row (or point) z lies in
  const i = clamp(Math.floor(z) || 0, 0, 1e6);   // (a bound, so that a wild z cannot fill the memory)
  for (let n = ROW_SEC.length ? ROW_SEC[ROW_SEC.length - 1] : 0; ROW_SEC.length <= i;) {
    if (ROW_SEC.length >= secStart(n + 1)) n++;
    ROW_SEC.push(n);
  }
  return ROW_SEC[i];
}
// the same with the part of the section already behind: 2.5 is half-way through section 2
export function secPos(z) {
  const s = secOf(z), a = secStart(s);
  return s + clamp((z - a) / (secStart(s + 1) - a), 0, 1);
}
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
// Obstacles come in waves: a line of them across the road, one to four rows deep, then at least K free rows —
// the time for one swipe at the fastest downhill speed (REACT plus the lane change). In a wave every lane is either
// free, or has a free lane right next to it, or holds a low barrier to jump over. So whatever lane the ball is in,
// one swipe or one jump before each wave is enough, and never two in a hurry. A wave of low barriers across the
// whole road ('hurdle') can only be jumped.
// A guaranteed path (row.goal) runs through every row: it moves by at most one lane between waves, right after a
// wave, and stars lie along it. The jump set piece is the exception: a wall spans the full width and a
// ramp is the way over it; every lane has a ramp or one next to it.
// Lanes that end (the centre when the road splits, the outer ones when it narrows) get the same K rows of warning
// with no waves around.
// The road changes shape in two ways. normal → widen → split → close: it widens to 7 lanes and the centre turns into
// a gap. normal → squeeze → zig: it narrows to 3 lanes (S.a .. S.a + 2) and steps one lane sideways every K rows or
// more, a zigzag to follow, with a log to jump here and there; 'squeeze' is the wave-free warning before it.
const ROAD_LANES = {
  normal: (l) => l >= 1 && l <= 5,
  squeeze: (l) => l >= 1 && l <= 5,
  zig: (l, S) => l >= S.a && l <= S.a + 2,
  widen: () => true,
  split: (l) => l !== MID,
  close: () => true,
};
// 'cross': something alive walks across the road (row.mover) and is in its lane just as the ball gets there
// There are no pits: 'blocks' is a line of things to go round, one row deep, 'grove' the same several rows deep,
// 'lows' mixes them with logs.
const WAVES = ['blocks', 'grove', 'lows', 'hurdle', 'cross'];
// the walker sets off two lanes away when the ball is CROSS_ROWS from it and stands in its lane from CROSS_END on:
// by the time the ball is close, nothing moves any more
export const CROSS_ROWS = 30, CROSS_END = 6;

export class Track {
  constructor(seed) {
    this.r = mulberry(seed);
    this.rs = mulberry((seed ^ 0x5bd1e995) >>> 0);   // stars draw from their own stream: the track stays the same
    this.rb = mulberry((seed ^ 0x2545f491) >>> 0);   // and so do bonuses
    this.bonusCool = 30; this.bonusIn = 0;           // rows until a bonus is due; rows until it is laid
    // stars: rows left of the stretch or of the break; rows to wait for a lane's line and rows of it
    this.starOn = 0; this.starOff = 4; this.starSkip = 0;
    this.sideWait = Array(LANES).fill(0); this.sideRun = Array(LANES).fill(0);
    this.rows = [];
    this.path = MID;
    this.crossB = 0; this.crossN = 0;   // the biome being laid and how many times its walker has crossed in it
    // road shape (see ROAD_LANES): i of len rows done; for a zigzag also a — its first lane, next — a after the
    // coming step, steps — how many are left, logAt — the row of this stretch with a log across, or -1
    this.sh = { mode: 'normal', i: 0, len: START_OPEN + 60, a: 2, next: 2, steps: 0, logAt: -1 };
    this.cur = { kind: 'straight', i: 0, len: START_OPEN + 10, A: 0, n: 1 };   // bends of the road (just looks)
    this.gap = START_OPEN;     // free rows still to come before the next wave or jump may start
    this.wave = null;          // the wave being laid: { cells: per lane '' | 'block' | 'low', left: rows to go }
    this.jump = null; this.ji = 0; this.wantJump = false;
    this.ter = { kind: 'flat', len: START_OPEN, i: 0, A: 0, base: 0 };
    this.flatRun = 0;
  }

  get(i) {
    while (this.rows.length <= i) this.gen();
    return this.rows[Math.max(0, i)];
  }

  // The walker is the biome's own sight, to be met at least twice a biome: once by the middle of it and once more
  // by the end. When it is behind (none a sixth of the way in, one half-way in), the next wave on a normal road
  // is a crossing, and a jump waits for it. The road keeps its normal shape for it too, and from a third of the way
  // in already (`early`): a zigzag that starts later than that could last to the end of a short biome. A road
  // that is waiting like that gets its crossing with the very next wave.
  crossDue(early) {
    const at = secPos(this.rows.length) / BIOME_SECS, b = Math.floor(at);
    if (b !== this.crossB) { this.crossB = b; this.crossN = 0; }
    return this.crossN < (at - b > (early ? 0.33 : 0.5) ? 2 : at - b > 0.17 ? 1 : 0);
  }

  // A wave for the current road. Each stretch of road is filled on its own (two of them when the road is split).
  makeWave(sec, road, mode) {
    const r = this.r, w = [3.5, 2, sec >= 1 ? 2.5 : 0, sec >= 1 ? 1.5 : 0, mode === 'normal' ? 3 : 0];
    let x = r() * w.reduce((a, b) => a + b), kind = WAVES[0];
    for (let k = 0; k < w.length; k++) { x -= w[k]; if (x < 0) { kind = WAVES[k]; break; } }
    if (mode === 'normal' && this.crossDue(this.sh.i >= this.sh.len)) kind = 'cross';
    if (kind === 'cross') this.crossN++;
    const cells = Array(LANES).fill('');
    if (kind === 'hurdle') {
      for (let l = 0; l < LANES; l++) if (road[l]) cells[l] = 'low';
      return { cells, left: 1 };
    }
    if (kind === 'cross') {
      // the walker ends up in a lane off the path, coming from two lanes away; every other lane is free
      const ls = [1, 2, 3, 4, 5].filter((l) => l !== this.path), lane = ls[Math.floor(r() * ls.length)];
      return { cells, left: 1, mover: { lane, from: lane <= MID ? lane + 2 : lane - 2 } };
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
      cells[l] = kind === 'lows' && r() < 0.65 ? 'low' : 'block';
    }
    return { cells, left: kind === 'grove' ? 2 + Math.floor(r() * 3) : 1 };
  }

  // After a wave or a jump: free rows to come, and now and then the path moves one lane over.
  // Obstacles stay sparse: the speed alone makes the later sections harder.
  rest(K, mode) {
    const r = this.r;
    this.gap = K + Math.floor(r() * 5) + (r() < 0.1 ? 8 + Math.floor(r() * 10) : 0);
    if ((mode === 'normal' || mode === 'split') && r() < 0.55) {
      const ds = [-1, 1].filter((d) => this.pathLane(mode, this.path + d));
      if (ds.length) this.shift(ds[Math.floor(r() * ds.length)]);
    }
    if (mode === 'normal' && r() < 0.3) this.wantJump = true;
    // a bonus is due: it goes some way after this piece, and the free stretch is longer by as much, so there is
    // time both to get to the lane next to the path and to come back
    if (this.bonusCool <= 0 && (mode === 'normal' || mode === 'split')) {
      this.bonusIn = Math.max(3, Math.ceil(K * 0.6));   // far enough past the piece to get over to it
      this.gap += this.bonusIn; this.bonusCool = 60 + Math.floor(this.rb() * 60);
    }
  }

  // a stretch of stars, len rows: the path's line, and lines in about half of the other lanes, each starting a
  // little late or ending a little early
  beginStars(len) {
    const rs = this.rs;
    this.starOn = len; this.starOff = 0;
    for (let l = 0; l < LANES; l++) {
      const on = rs() < SIDE_P;
      this.sideWait[l] = Math.floor(rs() * len * 0.3);
      this.sideRun[l] = on ? Math.max(3, Math.round(len * (0.5 + rs() * 0.5)) - this.sideWait[l]) : 0;
    }
  }

  shift(d) {
    this.path += d;
    this.starSkip = 3;   // no stars while a ball on the path is still crossing over
  }

  // Where a block row or a gap fits, given the ramp physics and a speed spread.
  // Distances are counted from the far edge of the ramp row.
  planJump(v, sec) {
    const r = this.r;
    const need = BOX_H + 0.08 - RAMP_H, disc = Math.sqrt(JUMP_VY ** 2 - 2 * G * need);
    const t1 = (JUMP_VY - disc) / G, t2 = (JUMP_VY + disc) / G;   // ball bottom above block tops
    const tLand = (JUMP_VY + Math.sqrt(JUMP_VY ** 2 + 2 * G * RAMP_H)) / G;
    // rows where a wall fits for any speed within the spread; at the slowest sections the full spread leaves no
    // room for a row, so half of it is allowed for (the flat rows before a jump keep the speed close)
    let valid = [], vhi = v;
    for (const tol of [SPEED_TOL, SPEED_TOL / 2]) {
      const vlo = v * (1 - tol);
      vhi = v * (1 + tol);
      const zlo = vhi * t1 + vhi / 30, zhi = vlo * t2;
      valid = [];
      for (let d = 0; d + 1 - INSET + R <= zhi; d++) if (d + INSET - R >= zlo) valid.push(d);
      if (valid.length) break;
    }
    if (!valid.length) return null;
    const J = { rampAt: 2, rows: [], ramps: [] }, n = Math.min(valid.length, 1 + Math.floor(r() * 3));
    const s = valid[Math.floor((valid.length - n) / 2)];
    for (let k = 0; k < n; k++) J.rows.push(s + k);
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

  // Advance the road shape by a row. Before a lane ends there are at least K rows with no waves: the widening
  // before a split, the narrowing after it, the squeeze before a zigzag and every step of the zigzag last that
  // long. The path is moved out of the way first (see gen). No lane ends on a row hidden behind a crest.
  shape(K, busy, hidden, sec) {
    const S = this.sh, r = this.r;
    S.i++;
    const zigNext = () => {
      S.i = 0; S.len = K + 2 + Math.floor(r() * 4); S.logAt = -1;
      // now and then a stretch of the zigzag is twice as long and has a log across it half-way: time for a swipe,
      // a jump, and the next swipe
      if (r() < 0.4 && S.steps > 0 && sec >= 1) { S.len = 2 * K + 3; S.logAt = K + 1; }
      S.next = S.steps-- <= 0 ? S.a : S.a === 1 ? 2 : S.a === 3 ? 2 : S.a + (r() < 0.5 ? -1 : 1);
    };
    if (S.mode === 'normal') {
      if (S.i >= S.len && !busy && !this.wave && !this.crossDue(true)) {
        S.i = 0; S.len = K + 3;
        S.mode = r() < 0.45 ? 'widen' : 'squeeze';
      }
    } else if (S.mode === 'widen') {
      if (S.i >= S.len && this.path !== MID && !hidden) { S.mode = 'split'; S.i = 0; S.len = 24 + Math.floor(r() * 24); }
    } else if (S.mode === 'split') {
      if (S.i >= S.len && !this.wave) { S.mode = 'close'; S.i = 0; S.len = K + 3; }
    } else if (S.mode === 'squeeze') {
      if (S.i >= S.len && this.path >= 2 && this.path <= 4 && !hidden) { S.mode = 'zig'; S.a = 2; S.steps = 2 + Math.floor(r() * 4); zigNext(); }
    } else if (S.mode === 'zig') {
      if (S.i >= S.len && this.path >= S.next && this.path <= S.next + 2 && !hidden) {
        if (S.next === S.a) { S.mode = 'normal'; S.i = 0; S.len = 60 + Math.floor(r() * 60); }
        else { S.a = S.next; zigNext(); }
      }
    } else if (S.i >= S.len && this.path >= 1 && this.path <= 5 && !hidden) {
      S.mode = 'normal'; S.i = 0; S.len = 60 + Math.floor(r() * 60);
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
    const i = this.rows.length, r = this.r, sec = secOf(i), k = i - secStart(sec);
    // free rows are counted for the next section's speed: the next wave may already lie there
    const v = speedOf(sec), vhi = fastOf(sec), vK = fastOf(sec + 1), K = Math.ceil(vK * (REACT + shiftTime(vK)));
    const block = Array(LANES).fill(false), ramp = Array(LANES).fill(false), low = Array(LANES).fill(false);
    const star = Array(LANES).fill(0);   // 0 — none, otherwise 1 + its height above the spot where a resting ball would be
    // the ground is flat at the start, under a jump and while one is waiting for flat ground
    const h = this.terrain(i < START_OPEN || !!this.jump || this.wantJump), off = this.curve();
    // a row hidden behind a crest until the last moment gets no obstacles
    const hidden = this.hidden(i, h, Math.max(5, Math.ceil(vhi * SEE_AHEAD) + 2));
    const mode = this.shape(K, !!this.jump || this.wantJump, hidden, sec);
    const road = Array.from({ length: LANES }, (_, l) => ROAD_LANES[mode](l, this.sh)), floor = road.slice();
    // the shape needs the path somewhere else: move it at once, the shape waits K rows
    if (mode === 'widen' && this.path === MID) this.shift(r() < 0.5 ? -1 : 1);
    if (mode === 'close' && (this.path === 0 || this.path === LANES - 1)) this.shift(this.path === 0 ? 1 : -1);
    if (mode === 'squeeze' || mode === 'zig') {   // into the lanes that are there both now and after the next step
      const S = this.sh, a = mode === 'zig' ? S.a : 2, n = mode === 'zig' ? S.next : 2, lo = Math.max(a, n), hi = Math.min(a, n) + 2;
      if (this.path < lo) this.shift(1); else if (this.path > hi) this.shift(-1);
    }
    const open = i < START_OPEN || k < BREATH;   // nothing starts here
    if (!this.jump && !this.wave) {
      if (mode !== 'normal' && mode !== 'split') this.gap = Math.max(this.gap, K);
      if (this.gap > 0) this.gap--;
      else if (!open && !hidden) {
        if (this.wantJump && !this.crossDue()) {
          // flat ground for a while, a normal road: build the jump; otherwise carry on with waves and try later
          if (this.flatRun >= LEAD && this.ter.kind === 'flat' && mode === 'normal') {
            const J = this.planJump(v, sec);
            if (J) { this.jump = J; this.ji = 0; J.arc = this.rs() < 0.75; }
            this.wantJump = false;   // built, or no wall fits at this speed
          }
        }
        if (!this.jump && (mode === 'normal' || mode === 'split')) {
          this.wave = this.makeWave(sec, road, mode);
          this.wave.left = Math.min(this.wave.left, secStart(sec + 1) - i);   // the start of the next section stays free
        }
      }
    }
    let piece = false;   // this row belongs to a wave or a jump
    let mover = null;
    if (mode === 'zig' && this.sh.i === this.sh.logAt && !hidden && k >= BREATH) {   // a log across the zigzag, not where a section starts
      for (let l = 0; l < LANES; l++) if (road[l]) low[l] = true;
      star[this.path] = 1 + 0.55;
    }
    if (this.jump) {
      const J = this.jump, j = this.ji++, d = j - J.rampAt - 1;
      piece = true;
      for (let l = 0; l < LANES; l++) {
        if (!road[l]) continue;
        if (j === J.rampAt && J.ramps.includes(l)) ramp[l] = true;
        if (hidden) continue;
        if (J.rows.includes(d)) block[l] = true;
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
          if (W.cells[l] === 'block') block[l] = true; else if (W.cells[l] === 'low') low[l] = true;
        }
        if (W.mover) mover = W.mover;
        if (low[this.path] && this.rs() < 0.8) star[this.path] = 1 + 0.55;   // a star over the barrier: jump here
      }
      if (--W.left <= 0 || hidden) { this.wave = null; this.rest(K, mode); }
    }
    const goal = piece && this.rows.length ? this.rows[i - 1].goal : this.path;   // the path moves only after the piece
    if (!this.jump && !star[goal]) {
      const rs = this.rs, v = speedOf(sec);
      if (this.starOn > 0) {
        this.starOn--;
        if (this.starSkip > 0) this.starSkip--;
        else if (!hidden && !low[goal]) star[goal] = 1;
        // the lines in the other lanes, alongside the path's: a ball takes one lane of them, a magnet all.
        // Only on plain ground: never in or on an obstacle, never where someone walks across.
        for (let l = 0; l < LANES; l++) {
          if (l === goal) continue;
          if (this.sideWait[l] > 0) { this.sideWait[l]--; continue; }
          if (this.sideRun[l] <= 0) continue;
          this.sideRun[l]--;
          if (road[l] && floor[l] && !block[l] && !low[l] && !hidden && !mover) star[l] = 1;
        }
        if (this.starOn === 0) this.starOff = Math.round(v * (STAR_OFF[0] + rs() * (STAR_OFF[1] - STAR_OFF[0])));
      } else if (--this.starOff <= 0) this.beginStars(Math.round(v * (STAR_ON[0] + rs() * (STAR_ON[1] - STAR_ON[0]))));
    }
    let bonus = null;
    this.bonusCool--;
    if (!piece && this.bonusIn > 0 && --this.bonusIn === 0) {
      const rb = this.rb;
      if (!hidden && (mode === 'normal' || mode === 'split')) {
        const ds = [-1, 1].filter((d) => road[goal + d]), off = rb() < 0.45 && ds.length ? ds[Math.floor(rb() * ds.length)] : 0;
        const x = rb() * 8.5;
        if (!this.noBonus) {   // (the tests can ask for a track without bonuses: the road itself is the same)
          bonus = { lane: goal + off, kind: x < 3 ? 'magnet' : x < 6 ? 'shield' : 'fly' };
          star[bonus.lane] = 0;
        }
      } else this.bonusCool = 0;   // no room here: after the next piece
    }
    this.rows.push({ road, floor, block, ramp, low, mover, star, bonus, h, off, sec, goal });
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
// `fly` — carried through the air by a bonus.
// events: 'bonus' (which — in `got`), 'pop' (a shield broke something at `popAt`), 'fly', 'flyend',
// 'section', 'jump', 'drop', 'land' (how hard — in `impact`, 0..1), 'star', 'move' and 'bump' (a lane change made
// or refused; which way it was refused — in `side`), 'fall', 'crash', 'over' — the page drains them for effects.
export class World {
  constructor(seed) {
    this.seed = seed;
    this.track = new Track(seed);
    this.ball = { x: 0, vx: 0, y: R, vy: 0, z: 2, tx: 0, roll: 0, fallRow: 0, air: false, airT: 0, fromRamp: false, hop: false, hopQ: 0, fly: false };
    this.v = speedOf(0);
    this.state = 'run';
    this.sec = 0;
    this.tOver = 0;
    this.events = [];
    this.stars = 0;      // stars taken in this run
    // bonuses at work: seconds of magnet and of flight left, a shield in hand, seconds during which nothing can hit
    this.fx = { magnet: 0, fly: 0, shield: 0, safe: 0 };
    this.sky = [];       // stars in the air along a flight: { l, z, got }
    // a flight: the row it started at, the middle one of its three lanes, the lane it started in, and whether it is
    // coming down in a hurry (a swipe down)
    this.flyFrom = 0; this.flyLane = MID; this.flyStart = MID; this.fastLand = false;
    this.got = '';       // the bonus just taken ('bonus' event); popAt — where a shield broke something ('pop')
    this.popAt = null;
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

  // Where the walker of row rz is across the road. It moves with the ball's approach, not with the clock, so it is
  // in its lane in time at any speed.
  moverX(rz) {
    const m = this.track.get(rz).mover, t = clamp((CROSS_ROWS - (rz + 0.5 - this.ball.z)) / (CROSS_ROWS - CROSS_END), 0, 1);
    return laneX(m.from) + (laneX(m.lane) - laneX(m.from)) * t;
  }

  // what the ball is touching: { rz, l, kind: 'block' | 'low' | 'mover', x } or null
  hit() {
    const b = this.ball;
    for (let rz = Math.floor(b.z - R); rz <= Math.floor(b.z + R); rz++) {
      if (rz < 0) continue;
      const row = this.track.get(rz);
      // a block or a walker: a rectangle with rounded corners (the inner rectangle grown by CORNER) around xc
      const box = (xc) => {
        const w = 0.5 - INSET - CORNER, cx = clamp(b.x, xc - w, xc + w), cz = clamp(b.z, rz + INSET + CORNER, rz + 1 - INSET - CORNER);
        return (cx - b.x) ** 2 + (cz - b.z) ** 2 < (R + CORNER) ** 2 && b.y - R < this.hAt(cz) + BOX_H;
      };
      if (row.mover && box(this.moverX(rz))) return { rz, l: -1, kind: 'mover', x: this.moverX(rz) };
      for (let l = Math.floor(b.x + HALF - R); l <= Math.floor(b.x + HALF + R); l++) {
        if (l >= 0 && l < LANES && row.block[l] && box(laneX(l))) return { rz, l, kind: 'block', x: laneX(l) };
      }
      for (let l = Math.floor(b.x + HALF - R); l <= Math.floor(b.x + HALF + R); l++) {
        if (l < 0 || l >= LANES || !row.low[l]) continue;
        // a low barrier: a bar across the whole lane
        const cx = clamp(b.x, l - HALF, l - HALF + 1), cz = clamp(b.z, rz + LOW_Z0, rz + LOW_Z1);
        if ((cx - b.x) ** 2 + (cz - b.z) ** 2 < R * R && b.y - R < this.hAt(cz) + LOW_H) return { rz, l, kind: 'low', x: laneX(l) };
      }
    }
    return null;
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
  // Staying in a lane that ends is fair game.
  move(dir) {
    if (this.state !== 'run') return false;
    const b = this.ball, to = this.lane + dir;
    if (b.fly) {   // in the air there are three lanes, whatever the road below is doing
      if (this.fx.fly <= 0) return false;   // coming down: it steers itself
      const ok = Math.abs(to - this.flyLane) <= 1;
      if (ok) b.tx = laneX(to); else this.side = dir;
      this.events.push(ok ? 'move' : 'bump');
      return ok;
    }
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
    if (b.fly) return false;
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
    if (b.fly) {   // out of a flight: it heads for the road and comes down fast
      if (this.fx.fly <= 0) return false;
      this.fx.fly = 0; this.fastLand = true;
      this.events.push('drop');
      return true;
    }
    b.vy = Math.min(b.vy, -DROP_VY); b.hopQ = 0;
    this.events.push('drop');
    return true;
  }

  fall() {
    const b = this.ball;
    this.state = 'fall'; b.tx = b.x; b.fallRow = Math.floor(b.z);
    this.events.push('fall');
  }

  // ---- bonuses ----
  take(kind) {
    this.got = kind; this.events.push('bonus');
    if (kind === 'magnet') this.fx.magnet = MAGNET_T;
    else if (kind === 'shield') this.fx.shield = SHIELD_T;
    else if (kind === 'fly' && !this.ball.fly) {
      const b = this.ball;
      b.fly = true; b.air = true; b.hop = false; b.hopQ = 0; b.vy = 0; b.airT = 0; b.fromRamp = true;
      this.fx.fly = FLY_T;
      this.flyFrom = Math.floor(b.z); this.flyLane = clamp(this.lane, 2, LANES - 3); this.fastLand = false;
      // from an outer lane of a wide road it comes into the air's three lanes at once
      this.flyStart = clamp(this.lane, this.flyLane - 1, this.flyLane + 1); b.tx = laneX(this.flyStart);
      this.sky = this.skyStars(this.flyFrom, this.flyStart);
      this.events.push('fly');
    }
  }

  // The trail of stars along a flight: four long straight lines, each one lane over from the one before and a short
  // pause between them, so three swipes take them all. They keep to the three lanes of the air (flyLane and the two
  // beside it). The same for the same track, starting row and lane.
  skyStars(from, lane) {
    const r = mulberry((this.seed * 31 + from) >>> 0), out = [], c = this.flyLane;
    // Laid out from the section's speed, not the ball's at the moment (a flight settles at the section's speed, and
    // a restored run must get the same trail): the lines end a little before the flight does, and the pause between
    // two lines is long enough for a swipe even at the next section's speed.
    const sec = secOf(from), v = speedOf(sec);
    const n = Math.floor(FLY_T * v) - 9, parts = 4, len = Math.floor(n / parts), rest = Math.ceil(speedOf(sec + 1) * 0.45);
    const step = Math.max(1, Math.round(v / 9));   // about nine stars a second at any speed: a solid line
    let l = clamp(lane, c - 1, c + 1);
    for (let k = 0; k < parts; k++) {
      const z0 = from + 6 + k * len;
      for (let z = z0; z < z0 + len - (k < parts - 1 ? rest : 0); z += step) out.push({ l, z, got: false });
      l = l === c ? c + (r() < 0.5 ? -1 : 1) : c;   // the next line is one lane over
    }
    return out;
  }

  // is there road under the ball from here to where it would touch down, and on for long enough to react after
  canLand(ahead = LAND_AHEAD) {
    const b = this.ball, at = Math.floor(b.x + HALF), to = this.lane;
    for (let r = Math.floor(b.z); r <= Math.floor(b.z + this.v * ahead); r++) {
      const row = this.track.get(r);
      if (!row.road[at] || !row.floor[at] || !row.road[to] || !row.floor[to]) return false;
    }
    return true;
  }

  land(fast) {
    const b = this.ball;
    b.fly = false; b.hop = false; b.vy = fast ? -DROP_VY : 0;
    this.fx.fly = 0; this.fx.safe = FLY_SAFE; this.sky = [];
    this.events.push('flyend');
  }

  flight(dt) {
    const b = this.ball, t = this.track;
    this.fx.fly -= dt; b.airT += dt;
    b.y += (this.hAt(b.z) + R + FLY_H - b.y) * Math.min(1, dt * 5); b.vy = 0;
    for (const s of this.sky) {
      if (s.got || Math.abs(s.z + 0.5 - b.z) > 0.65 || Math.abs(laneX(s.l) - b.x) > 0.6) continue;
      s.got = true; this.stars++; this.events.push('star');
    }
    if (this.fx.fly > 0) return;
    // time is up, or a swipe down: over to the path, wherever the flight has been, and down where the road goes on
    // (if no stretch of road is long enough for a while, a shorter one will do: the ball can't be hit after landing)
    b.tx = laneX(t.get(Math.floor(b.z + this.v * LAND_LOOK)).goal);
    if (Math.abs(b.tx - b.x) < 0.1 && this.canLand(this.fx.fly < -1.5 ? LAND_LOOK : LAND_AHEAD)) this.land(this.fastLand);
  }

  // The ball takes the stars it touches. They hang where a resting or a jumping ball's centre passes.
  takeStars() {
    const b = this.ball, lane = Math.floor(b.x + HALF), rz = Math.floor(b.z), mag = this.fx.magnet > 0 && !b.fly;
    const reachX = mag ? LANES : STAR_X, reachZ = mag ? 0.9 : STAR_Z;   // a magnet reaches across the whole road
    for (let r = Math.max(0, rz - 1); r <= rz + 1; r++) {
      const row = this.track.get(r);
      for (let l = mag ? 0 : Math.max(0, lane - 1); l <= (mag ? LANES - 1 : Math.min(LANES - 1, lane + 1)); l++) {
        const s = row.star[l];
        if (!s || Math.abs(b.x - laneX(l)) > reachX || Math.abs(b.z - r - 0.5) > reachZ) continue;
        if (!mag && Math.abs(b.y - (this.hAt(r + 0.5) + R + s - 1)) > STAR_Y) continue;   // a magnet reaches up and down too
        row.star[l] = 0; this.stars++; this.events.push('star');
      }
      const bo = row.bonus;
      if (bo && Math.abs(b.x - laneX(bo.lane)) <= STAR_X && Math.abs(b.z - r - 0.5) <= STAR_Z && Math.abs(b.y - (this.hAt(r + 0.5) + R)) <= STAR_Y) {
        row.bonus = null; this.take(bo.kind);
      }
    }
  }

  // A run in progress as plain data, and back. The track is rebuilt from the seed, so only the ball is stored.
  toSave() {
    return { v: SAVE_V, seed: this.seed, ball: { ...this.ball }, speed: this.v, sec: this.sec, stars: this.stars, fx: { ...this.fx }, flyFrom: this.flyFrom, flyLane: this.flyLane, flyStart: this.flyStart, fastLand: this.fastLand };
  }

  static fromSave(o) {
    if (!o || o.v !== SAVE_V || !Number.isFinite(o.seed) || !o.ball || !(o.ball.z >= 0 && o.ball.z < 2e5) || !(o.speed > 0 && o.speed < 100)) return null;
    const w = new this(o.seed), b = w.ball;
    for (const k in b) if (typeof o.ball[k] === typeof b[k] && (typeof b[k] !== 'number' || Number.isFinite(o.ball[k]))) b[k] = o.ball[k];
    w.v = o.speed; w.sec = secOf(b.z); w.stars = Math.max(0, Math.floor(o.stars) || 0);
    // what is behind was taken or missed; so was the next row's star if the ball already reached it
    for (let r = 0; r <= Math.floor(b.z + 0.05); r++) { const row = w.track.get(r); row.star.fill(0); row.bonus = null; }
    const fx = o.fx || {}, sec = (x, max) => (x > 0 && x <= max ? x : 0);
    w.fx = { magnet: sec(fx.magnet, MAGNET_T), fly: b.fly ? sec(fx.fly, FLY_T) : 0, shield: sec(fx.shield, SHIELD_T), safe: sec(fx.safe, FLY_SAFE) };
    if (b.fly) {   // in the middle of a flight: the same trail of stars, less what is behind
      w.flyFrom = clamp(Math.floor(o.flyFrom) || 0, 0, Math.floor(b.z));
      w.flyLane = clamp(Math.floor(o.flyLane) || 0, 2, LANES - 3); w.flyStart = clamp(Math.floor(o.flyStart) || 0, 0, LANES - 1);
      w.fastLand = o.fastLand === true;
      w.sky = w.skyStars(w.flyFrom, w.flyStart).filter((s) => s.z + 0.5 > b.z + 0.65);   // what was in reach is taken
    }
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
      const sec = secOf(b.z), target = speedOf(sec), rowPrev = Math.floor(b.z);
      if (!b.air) {
        const s = t.get(rowPrev + 1).h - t.get(rowPrev).h;
        this.v = Math.max(2.5, this.v + (DRIVE * (target - this.v) - GS * s) * dt);
      } else if (b.fly) this.v += DRIVE * (target - this.v) * dt;   // a flight settles at the section's speed
      const hPrev = this.hAt(b.z);
      b.z += this.v * dt; b.roll += this.v * dt / R;
      steer(b, latOf(this.v), dt);
      if (b.hopQ > 0) b.hopQ = Math.max(0, b.hopQ - dt);
      if (this.fx.magnet > 0 && !b.fly) this.fx.magnet = Math.max(0, this.fx.magnet - dt);   // it waits out a flight
      if (this.fx.shield > 0) this.fx.shield = Math.max(0, this.fx.shield - dt);
      if (this.fx.safe > 0) {
        this.fx.safe = Math.max(0, this.fx.safe - dt);
        if (this.fx.safe === 0 && !b.fly && this.hit()) this.fx.safe = 0.05;   // not while the ball is inside something
      }
      if (sec !== this.sec) { this.sec = sec; this.events.push('section'); }
      const lane = Math.floor(b.x + HALF), rz = Math.floor(b.z);
      const g = this.groundAt(b.x, b.z);
      // a ramp throws the ball the same way whether it rolled onto it or came down on it in a jump of its own
      const offRamp = !b.fly && rz !== rowPrev && lane >= 0 && lane < LANES && t.get(rowPrev).ramp[lane]
        && (!b.air || (b.hop && b.y - R < hPrev + RAMP_H + 0.45));
      if (b.fly) this.flight(dt);
      else if (!b.air || offRamp) {
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
      const hit = this.state === 'run' && this.fx.safe <= 0 && !b.fly ? this.hit() : null;
      if (hit && this.fx.shield > 0) {   // the shield takes it: the thing is gone, the ball rolls on
        const row = t.get(hit.rz);
        if (hit.kind === 'mover') row.mover = null; else row[hit.kind === 'low' ? 'low' : 'block'][hit.l] = false;
        this.fx.shield = 0; this.fx.safe = SHIELD_SAFE;
        this.popAt = { x: hit.x, z: hit.rz + 0.5 }; this.events.push('pop');
      } else if (hit) { this.state = 'crash'; this.tOver = 0.9; this.events.push('crash'); }
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
