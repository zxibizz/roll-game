// Game world: the track generator and the ball physics. No DOM here: the page draws the world (client.js),
// the tests run it in Node (test/core.test.js).
// When any file in public/ changes, bump VERSION here and in sw.js (a test checks they match).
export const VERSION = '0.2.0';

// ---- Tuning ----
export const LANES = 5, HALF = LANES / 2;
export const SEC_ROWS = 48;      // rows per section; the speed steps up at each section start
export const BREATH = 8;         // obstacle-free rows at the start of every section
export const START_OPEN = 16;    // obstacle-free, flat rows at the very start
export const R = 0.28;           // ball radius (lane width = 1)
export const INSET = 0.1;        // gap between a block and its cell border
export const BOX_H = 0.7;        // block height
export const RAMP_H = 0.3;       // ramp height at its far edge
const V0 = 9, VMUL = 1.06, VMAX = 24;
const G = 30;                    // gravity, rows/s²
const DRIVE = 2;                 // how fast the speed returns to the section's speed
const GS = 16;                   // how much a slope speeds up / slows down the ball
const SMAX = 0.32;               // steepest slope the terrain generator makes
const JUMP_VY = 10;              // vertical speed a ramp gives
const LEAD = 6;                  // flat rows needed before a jump, so the speed is predictable
const SPEED_TOL = 0.25;          // speed spread the jump planner allows for

export const speedOf = (s) => Math.min(VMAX, V0 * Math.pow(VMUL, s));
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
// A guaranteed path runs through every row. When it shifts by one lane, both lanes stay safe for m rows,
// enough to move sideways even at the fastest downhill speed. Patterns fill only cells outside the path,
// except the jump set piece: there a wall or a gap spans the full width and a ramp is the way over it.
const PATS = ['scatter', 'walls', 'bridge', 'slalom', 'strips', 'jump'];

export class Track {
  constructor(seed) {
    this.r = mulberry(seed);
    this.rows = [];
    this.path = 2; this.to = -1; this.left = 0; this.cool = 6;
    this.pat = ''; this.pi = 0; this.plen = 0; this.jump = null; this.wantJump = false;
    this.ter = { kind: 'flat', len: START_OPEN, i: 0, A: 0, base: 0 };
    this.flatRun = 0;
  }

  get(i) {
    while (this.rows.length <= i) this.gen();
    return this.rows[Math.max(0, i)];
  }

  pick(sec) {
    const w = [3, 2, sec >= 2 ? 2 : 0, 2, sec >= 2 ? 2 : 1, 3];
    let x = this.r() * w.reduce((a, b) => a + b);
    for (let k = 0; k < w.length; k++) { x -= w[k]; if (x < 0) return PATS[k]; }
    return 'scatter';
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
    for (let l = 0; l < LANES; l++) if (sec < 2 || l === this.path || r() < 0.3) J.ramps.push(l);
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

  heightOf(T, t) {
    if (T.kind === 'hill') return T.base + T.A * (1 - Math.cos(2 * Math.PI * t)) / 2;
    if (T.kind === 'climb') return T.base + T.A * (1 - Math.cos(Math.PI * t)) / 2;
    return T.base;
  }

  gen() {
    const i = this.rows.length, r = this.r, sec = Math.floor(i / SEC_ROWS), k = i % SEC_ROWS;
    const v = speedOf(sec), vhi = v + GS * SMAX / DRIVE + 0.5, m = Math.ceil(vhi / latOf(vhi)) + 1;
    const inJump = this.pat === 'jump' && this.pi < this.plen;   // a jump may run into the next section
    const open = i < START_OPEN || (k < BREATH && !inJump);
    const floor = Array(LANES).fill(true), block = Array(LANES).fill(false);
    const ramp = Array(LANES).fill(false), safe = Array(LANES).fill(false);
    if (!open && this.pi >= this.plen) {
      this.pat = this.wantJump ? 'jump' : this.pick(sec);
      this.pi = 0; this.plen = 8 + Math.floor(r() * 8);
      if (this.pat === 'jump') {
        const J = this.flatRun >= LEAD && this.left === 0 && this.ter.kind === 'flat' ? this.planJump(v, sec) : null;
        if (J) { this.jump = J; this.plen = J.len; this.wantJump = false; }
        else { this.wantJump = true; this.pat = 'scatter'; this.plen = 4; }   // flatten the ground, then try again
      }
    }
    const jumping = !open && this.pat === 'jump';
    const h = this.terrain(i < START_OPEN || jumping || this.wantJump);
    if (this.left > 0) {
      safe[this.path] = safe[this.to] = true;
      if (--this.left === 0) { this.path = this.to; this.to = -1; this.cool = 1 + Math.floor(r() * 4); }
    } else {
      safe[this.path] = true;
      if (!open && !jumping && --this.cool <= 0 && r() < 0.6) {
        const d = this.path === 0 ? 1 : this.path === LANES - 1 ? -1 : (r() < 0.5 ? -1 : 1);
        this.to = this.path + d; this.left = m - 1; safe[this.to] = true;
      }
    }
    if (jumping) {
      const J = this.jump, j = this.pi++, d = j - J.rampAt - 1;
      for (let l = 0; l < LANES; l++) {
        if (j === J.rampAt && J.ramps.includes(l)) ramp[l] = true;
        if (J.kind === 'wall' && J.rows.includes(d)) block[l] = true;
        if (J.kind === 'gap' && d >= 0 && d <= J.gEnd) floor[l] = false;
      }
    } else if (!open) {
      const dens = Math.min(0.6, 0.12 + sec * 0.035), j = this.pi++;
      for (let l = 0; l < LANES; l++) {
        if (safe[l]) continue;
        const x = r();
        switch (this.pat) {
          case 'scatter': if (x < dens * 0.45) floor[l] = false; else if (x < dens) block[l] = true; break;
          case 'walls': if (j % 5 === 2) block[l] = true; break;
          case 'bridge': if (!(sec < 3 && Math.abs(l - this.path) === 1 && x < 0.6)) floor[l] = false; break;
          case 'slalom': if ((j % 6 === 1 && l < this.path) || (j % 6 === 4 && l > this.path)) block[l] = true; break;
          case 'strips': if (j % 4 === 1) floor[l] = false; break;
        }
      }
    }
    this.rows.push({ floor, block, ramp, h, sec, goal: this.to >= 0 ? this.to : this.path });
  }
}

// ---- World ----
// state: 'run' → 'fall' (off the track or into a hole) or 'crash' (into a block) → 'over'.
// events: 'section', 'jump', 'fall', 'crash', 'over' — the page drains them for effects.
export class World {
  constructor(seed) {
    this.track = new Track(seed);
    this.ball = { x: 0, y: R, vy: 0, z: 2, tx: 0, roll: 0, fallRow: 0, air: false, airT: 0, fromRamp: false };
    this.v = speedOf(0);
    this.state = 'run';
    this.sec = 0;
    this.tOver = 0;
    this.events = [];
    this.stats = { jumps: 0, hops: 0, vRatioMin: Infinity, vRatioMax: 0 };
  }

  get score() { return Math.floor(this.ball.z); }

  // terrain height at z (linear between row starts)
  hAt(z) {
    const zz = Math.max(0, z), i = Math.floor(zz), a = this.track.get(i).h, b = this.track.get(i + 1).h;
    return a + (b - a) * (zz - i);
  }

  // surface under (x, z) including ramps, or null over a hole or off the track
  groundAt(x, z) {
    const lane = Math.floor(x + HALF), rz = Math.floor(z);
    if (lane < 0 || lane >= LANES || rz < 0) return null;
    const row = this.track.get(rz);
    if (!row.floor[lane]) return null;
    return this.hAt(z) + (row.ramp[lane] ? RAMP_H * (z - rz) : 0);
  }

  hit() {
    const b = this.ball;
    for (let rz = Math.floor(b.z - R); rz <= Math.floor(b.z + R); rz++) {
      if (rz < 0) continue;
      const row = this.track.get(rz);
      for (let l = Math.floor(b.x + HALF - R); l <= Math.floor(b.x + HALF + R); l++) {
        if (l < 0 || l >= LANES || !row.block[l]) continue;
        const x0 = l - HALF + INSET, x1 = l - HALF + 1 - INSET, z0 = rz + INSET, z1 = rz + 1 - INSET;
        const cx = clamp(b.x, x0, x1), cz = clamp(b.z, z0, z1);
        if ((cx - b.x) ** 2 + (cz - b.z) ** 2 >= R * R) continue;
        if (b.y - R < this.hAt(cz) + BOX_H) return true;
      }
    }
    return false;
  }

  // where the guaranteed path goes under the ball: lets a bot (and the tests) steer
  autoTarget() {
    return laneX(this.track.get(Math.max(0, Math.floor(this.ball.z - R - 0.05))).goal);
  }

  fall() {
    const b = this.ball;
    this.state = 'fall'; b.tx = b.x; b.fallRow = Math.floor(b.z);
    this.events.push('fall');
  }

  step(dt) {
    const b = this.ball, t = this.track;
    if (this.state === 'run') {
      const sec = Math.floor(b.z / SEC_ROWS), target = speedOf(sec), rowPrev = Math.floor(b.z);
      if (!b.air) {
        const s = t.get(rowPrev + 1).h - t.get(rowPrev).h;
        this.v = Math.max(2.5, this.v + (DRIVE * (target - this.v) - GS * s) * dt);
      }
      b.z += this.v * dt; b.roll += this.v * dt / R;
      const L = latOf(this.v);
      b.x += clamp(b.tx - b.x, -L * dt, L * dt);
      if (sec !== this.sec) { this.sec = sec; this.events.push('section'); }
      const lane = Math.floor(b.x + HALF), rz = Math.floor(b.z);
      const g = this.groundAt(b.x, b.z);
      if (!b.air) {
        if (rz !== rowPrev && lane >= 0 && lane < LANES && t.get(rowPrev).ramp[lane]) {
          // left the ramp: launch as if exactly from its top edge
          const over = (b.z - rz) / this.v;
          b.air = true; b.airT = 0; b.fromRamp = true; this.stats.jumps++;
          b.y = this.hAt(rz) + RAMP_H + R + JUMP_VY * over - G / 2 * over * over;
          b.vy = JUMP_VY - G * over;
          this.events.push('jump');
        } else if (g === null) this.fall();
        else {
          const yFree = b.y + b.vy * dt - G / 2 * dt * dt, yG = g + R;
          if (yFree > yG + 0.03) { b.air = true; b.airT = 0; b.fromRamp = false; b.vy -= G * dt; b.y = yFree; }
          else { b.vy = (yG - b.y) / dt; b.y = yG; }
        }
      } else {
        b.vy -= G * dt; b.y += b.vy * dt; b.airT += dt;
        if (g !== null && b.y <= g + R) {
          if (!b.fromRamp && b.airT > 0.15) this.stats.hops++;
          b.y = g + R; b.vy = 0; b.air = false;
        } else if (g === null && b.y < this.hAt(b.z) + R - 0.3) this.fall();
      }
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
