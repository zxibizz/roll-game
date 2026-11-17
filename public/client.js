// The page: draws the world from core.js in a hand-rolled perspective, reads the finger / mouse / keys,
// shows the score and the play / game-over screen. The sky goes from day to night to space with the distance.
import { World, LANES, HALF, SEC_ROWS, R, INSET, BOX_H, RAMP_H, laneX, clamp, mulberry } from './core.js';

const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const $score = document.getElementById('score'), $sec = document.getElementById('sec');
const $over = document.getElementById('over'), $oscore = document.getElementById('oscore'), $obest = document.getElementById('obest');

const BEST_KEY = 'roll.best';
const SENS = 6;                     // world units per full screen-width drag
const SLAB = 0.35, VIEW = 46;       // track thickness, rows drawn ahead
const CAM_H = 1.4, CAM_BACK = 1.9, PITCH = 0.5;

// mode: 'ready' | 'play' | 'pause' | 'over' (and 'shot' — frozen by the screenshot hook at the end);
// the world has its own state inside a game
let mode = 'ready', world = new World(1), parts = [], flash = null;
let camZ = 0, camX = 0, camY = 0, keyDir = 0, overlayAt = 0;
let best = Number(localStorage.getItem(BEST_KEY)) || 0;

// ---- Colours ----
let FOG = [5, 6, 13];
function hsl(h, s, l, fog = 0) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const c = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const rgb = [c(0), c(8), c(4)].map((v, i) => Math.round(v * 255 * (1 - fog) + FOG[i] * fog));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}
const secHue = (s) => (205 + s * 47) % 360;
const grad = (y0, y1, stops) => {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
};

// ---- Sky cycle ----
// One look that changes with the distance: day → sunset → night → space. PAL holds the key frames,
// PHASE_AT says at which section each one is fully reached; in between everything is blended.
const PAL = [
  { // day
    sky: [[111, 177, 242], [169, 211, 251], [226, 240, 255]], fog: [226, 240, 255],
    floorS: 55, floorL: [78, 84], litK: 0.6, slabL: [60, 66], rimS: 60, rimL: 96,
    blockS: [80, 65, 55], blockL: [70, 60, 51], rampS: 20, rampL: 99, rampSideL: 82, chevL: 62,
    shadow: [40, 70, 130], hud: 0, stars: 0, space: 0, moon: 0,
    sunA: 1, sunH: 0.22, sunC: [255, 253, 240], sunR: 0.06, clouds: 1, cloudC: [255, 255, 255], glow: 0,
  },
  { // sunset
    sky: [[51, 64, 126], [201, 112, 143], [255, 195, 138]], fog: [255, 200, 165],
    floorS: 50, floorL: [60, 66], litK: 0.7, slabL: [40, 46], rimS: 70, rimL: 88,
    blockS: [75, 62, 52], blockL: [66, 56, 47], rampS: 25, rampL: 96, rampSideL: 72, chevL: 58,
    shadow: [60, 20, 60], hud: 0.8, stars: 0.15, space: 0, moon: 0,
    sunA: 1, sunH: 0.03, sunC: [255, 170, 100], sunR: 0.09, clouds: 0.85, cloudC: [255, 205, 215], glow: 0.25,
  },
  { // night: stars and a hint of space up top
    sky: [[6, 10, 34], [17, 28, 74], [38, 52, 110]], fog: [26, 36, 84],
    floorS: 45, floorL: [30, 35], litK: 1, slabL: [14, 18], rimS: 80, rimL: 70,
    blockS: [65, 62, 60], blockL: [62, 50, 40], rampS: 30, rampL: 88, rampSideL: 60, chevL: 55,
    shadow: [0, 0, 0], hud: 1, stars: 0.85, space: 0.3, moon: 1,
    sunA: 0, sunH: -0.05, sunC: [255, 140, 90], sunR: 0.09, clouds: 0.2, cloudC: [60, 72, 130], glow: 0.6,
  },
  { // space
    sky: [[5, 6, 13], [5, 6, 13], [5, 6, 13]], fog: [5, 6, 13],
    floorS: 42, floorL: [31, 36], litK: 1, slabL: [16, 20], rimS: 75, rimL: 72,
    blockS: [65, 62, 60], blockL: [63, 50, 40], rampS: 30, rampL: 90, rampSideL: 62, chevL: 55,
    shadow: [0, 0, 0], hud: 1, stars: 1, space: 1, moon: 0,
    sunA: 0, sunH: -0.05, sunC: [255, 140, 90], sunR: 0.09, clouds: 0, cloudC: [60, 72, 130], glow: 0.6,
  },
];
const PHASE_AT = [2.5, 4.5, 7, 10];   // sections where day, sunset, night and space are fully in

const mix = (a, b, t) => (Array.isArray(a) ? a.map((v, i) => mix(v, b[i], t)) : a + (b - a) * t);
function phaseAt(z) {
  const s = z / SEC_ROWS;
  for (let i = 0; i < PHASE_AT.length - 1; i++) {
    if (s < PHASE_AT[i + 1]) {
      const t = clamp((s - PHASE_AT[i]) / (PHASE_AT[i + 1] - PHASE_AT[i]), 0, 1);
      return i + t * t * (3 - 2 * t);
    }
  }
  return PAL.length - 1;
}
function paletteAt(k) {
  const i = Math.min(PAL.length - 2, Math.floor(k)), t = k - i, a = PAL[i], b = PAL[i + 1], out = {};
  for (const key in a) out[key] = mix(a[key], b[key], t);
  return out;
}
const wrap = (v, m) => ((v % m) + m) % m;
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
let P = PAL[0], hudDark = null;

const theme = {
  sky(hue, horY) {
    ctx.fillStyle = grad(0, horY, P.sky.map((c) => css(c))); ctx.fillRect(0, 0, W, horY + 1);
    ctx.fillStyle = css(P.fog); ctx.fillRect(0, horY, W, H - horY);
    if (P.stars > 0.01) drawStars(P.stars, horY + (H - horY) * P.space);
    if (P.space > 0.01) {
      nebula(W * 0.22, horY - H * 0.16, W * 0.7, hsl(hue, 70, 35), 0.45 * P.space);
      nebula(W * 0.85, horY - H * 0.32, W * 0.5, hsl(hue + 70, 70, 35), 0.35 * P.space);
    }
    if (P.space > 0.6) {   // a ringed planet once it is properly space
      ctx.globalAlpha = (P.space - 0.6) / 0.4;
      const px = W * 0.78 - camX * 4 * dpr, py = horY - H * 0.1, pr = Math.min(W, H) * 0.09;
      const g = ctx.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
      g.addColorStop(0, hsl(hue + 140, 45, 70)); g.addColorStop(1, hsl(hue + 140, 45, 18));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, pr, 0, 7); ctx.fill();
      ctx.strokeStyle = hsl(hue + 140, 40, 70); ctx.globalAlpha *= 0.5; ctx.lineWidth = pr * 0.06;
      ctx.beginPath(); ctx.ellipse(px, py, pr * 1.7, pr * 0.35, -0.25, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (P.moon > 0.01) {   // a crescent moon
      const mx = W * 0.24 - camX * 3 * dpr, my = horY - H * 0.3, mr = Math.min(W, H) * 0.05;
      ctx.globalAlpha = P.moon; ctx.fillStyle = '#f4f1de'; ctx.beginPath(); ctx.arc(mx, my, mr, 0, 7); ctx.fill();
      ctx.fillStyle = css(P.sky[0]); ctx.beginPath(); ctx.arc(mx + mr * 0.45, my - mr * 0.2, mr * 0.85, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (P.sunA > 0.01) {   // the sun goes down towards the horizon and sets
      const sx = W * 0.78 - camX * 3 * dpr, sy = horY - P.sunH * H, sr = Math.min(W, H) * P.sunR;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, horY); ctx.clip(); ctx.globalAlpha = P.sunA;
      const g = ctx.createRadialGradient(sx, sy, sr * 0.6, sx, sy, sr * 3);
      g.addColorStop(0, css(P.sunC, 1)); g.addColorStop(0.3, css(P.sunC, 0.45)); g.addColorStop(1, css(P.sunC, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, sr * 3, 0, 7); ctx.fill();
      ctx.fillStyle = css(mix(P.sunC, [255, 255, 255], 0.5)); ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 7); ctx.fill();
      ctx.restore();
    }
    if (P.clouds > 0.01) {   // clouds, above and below the horizon
      const rr = mulberry(3);
      for (let n = 0; n < 9; n++) {
        const cx = wrap(rr() * 1.6 * W - camX * (2 + n) * dpr, W * 1.6) - 0.3 * W, cy = horY + (rr() - 0.65) * H * 0.5, s = (0.05 + rr() * 0.06) * W;
        ctx.globalAlpha = P.clouds * (cy > horY ? 0.55 : 0.85); ctx.fillStyle = css(P.cloudC);
        for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(cx + (k - 1.5) * s * 0.7, cy - (k % 2) * s * 0.25, s * 0.6, s * 0.38, 0, 0, 7); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }
  },
  floor: (h, f, par, lit) => hsl(h, P.floorS, clamp(P.floorL[par ? 0 : 1] + lit * P.litK, 8, 95), f),
  slab: (h, f, front) => hsl(h, 35, P.slabL[front ? 1 : 0], f),
  rim: (h, f) => hsl(h, P.rimS, P.rimL, f),
  blockHue: (h) => (h + 170) % 360,
  block: {
    top: (h, f) => hsl(h, P.blockS[0], P.blockL[0], f), front: (h, f) => hsl(h, P.blockS[1], P.blockL[1], f),
    side: (h, f) => hsl(h, P.blockS[2], P.blockL[2], f),
  },
  ramp: { top: (h, f) => hsl(h, P.rampS, P.rampL, f), side: (h, f) => hsl(h, 30, P.rampSideL, f), chev: (h, f) => hsl(h, 75, P.chevL, f) },
  ball: { c: ['#fff1e6', '#ff8a5c', '#cf4b25'], glow: [255, 140, 90] },
  get shadow() { return P.shadow.map(Math.round); },
  streak: [255, 255, 255],
};

// blend the palette for the current distance; the HUD turns light once the sky is dark
function setPhase(z) {
  P = paletteAt(phaseAt(z));
  FOG = P.fog;
  const dark = P.hud < 0.5;
  if (dark !== hudDark) {
    hudDark = dark;
    document.body.style.color = dark ? '#1d2433' : '#fff';
  }
  $over.style.background = css(P.fog, 0.55);
}

// ---- Game flow ----
function newGame() {
  world = new World((Math.random() * 1e9) | 0);
  parts = []; flash = null; camX = 0; camY = 0; camZ = world.ball.z - CAM_BACK;
  $score.textContent = '0'; $sec.textContent = '';
}

function showOverlay(score) {
  $oscore.textContent = score == null ? '' : score;
  $obest.textContent = best ? '★ ' + best : '';
  $over.classList.remove('hide');
  overlayAt = performance.now();
}

function play() {
  if (mode === 'ready' || mode === 'over') newGame();
  mode = 'play';
  $over.classList.add('hide');
}

function gameOver() {
  mode = 'over';
  const s = world.score;
  if (s > best) { best = s; localStorage.setItem(BEST_KEY, String(best)); }
  showOverlay(s);
}

function update(dt) {
  if (mode !== 'play') return;
  const b = world.ball;
  if (keyDir) b.tx = b.x + keyDir;
  world.step(dt);
  for (const e of world.events) {
    if (e === 'section') { flash = { sec: world.sec, t: 1 }; $sec.textContent = '» ' + (world.sec + 1); }
    else if (e === 'crash') {
      for (let n = 0; n < 18; n++) {
        parts.push({ x: b.x, y: b.y, z: b.z, vx: (Math.random() - 0.5) * 6, vy: 2 + Math.random() * 5, vz: (Math.random() - 0.6) * 5 });
      }
    } else if (e === 'over') gameOver();
  }
  world.events.length = 0;
  for (const p of parts) { p.vy -= 18 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
  follow(dt);
  if (world.state === 'run') $score.textContent = world.score;
  if (flash && (flash.t -= dt * 0.8) <= 0) flash = null;
}

// the camera follows the ball
function follow(dt) {
  const b = world.ball;
  if (world.state === 'run') {
    camZ = b.z - CAM_BACK;
    camY += (world.hAt(b.z) * 0.7 + world.hAt(b.z + 8) * 0.3 - camY) * Math.min(1, dt * 4);
  }
  camX += (b.x * 0.85 - camX) * Math.min(1, dt * 5);
}

// ---- Rendering ----
let W, H, dpr, f, cy, horY, stars;
const CP = Math.cos(PITCH), SP = Math.sin(PITCH);

function proj(x, y, z) {
  const dx = x - camX, dy = y - camY - CAM_H, dz = z - camZ;
  const zc = dz * CP - dy * SP, yc = dy * CP + dz * SP;
  return [W / 2 + f * dx / zc, cy - f * yc / zc, f / zc];
}

function resize() {
  dpr = Math.min(2, devicePixelRatio || 1);
  W = cv.width = Math.round(innerWidth * dpr);
  H = cv.height = Math.round(innerHeight * dpr);
  f = Math.min(W * 1.2, H * 0.9);
  // the ball's contact point sits at 84 % of the height on flat ground
  const dz = CAM_BACK, dy = -CAM_H, zc = dz * CP - dy * SP, yc = dy * CP + dz * SP;
  cy = H * 0.84 + f * yc / zc;
  horY = cy - f * SP / CP;
  stars = document.createElement('canvas'); stars.width = W; stars.height = H;
  const s = stars.getContext('2d'), rr = mulberry(7);
  for (let n = 0; n < W * H / 3000; n++) {
    s.globalAlpha = 0.2 + rr() * 0.6; s.fillStyle = '#fff';
    s.beginPath(); s.arc(rr() * W, rr() * H, (0.4 + rr() * 1.1) * dpr, 0, 7); s.fill();
  }
}

function drawStars(alpha, maxY = H) {
  const sx = (-camX * 6 * dpr) % W;
  ctx.save(); ctx.globalAlpha = alpha; ctx.beginPath(); ctx.rect(0, 0, W, maxY); ctx.clip();
  ctx.drawImage(stars, sx, 0); ctx.drawImage(stars, sx + (sx > 0 ? -W : W), 0);
  ctx.restore();
}

function nebula(x, y, r, color, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = a; ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); ctx.globalAlpha = 1;
}

function path(pts) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
function quad(a, b, c, d, color) { ctx.fillStyle = color; path([a, b, c, d]); ctx.fill(); }
function line(a, b, color, w, alpha = 1) {
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.globalAlpha = 1;
}

function drawRow(rz) {
  const T = theme, track = world.track, row = track.get(rz), zA = Math.max(rz, camZ + 0.4), zB = rz + 1;
  if (zB <= zA) return;
  const hA = world.hAt(zA), hB = track.get(rz + 1).h, slope = hB - row.h;
  const fog = clamp(((zA + zB) / 2 - camZ - 12) / (VIEW - 12), 0, 1);
  const hue = secHue(row.sec), prev = rz > 0 ? track.get(rz - 1) : null;
  const lit = slope * 22;   // uphill faces the camera and looks brighter
  const px = proj(0, hA, (zA + zB) / 2)[2];   // pixels per world unit at this row
  for (let l = 0; l < LANES; l++) {
    if (!row.floor[l]) continue;
    const x0 = l - HALF, x1 = x0 + 1;
    if (l > 0 && !row.floor[l - 1] && camX < x0)
      quad(proj(x0, hA, zA), proj(x0, hB, zB), proj(x0, hB - SLAB, zB), proj(x0, hA - SLAB, zA), T.slab(hue, fog, false));
    if (l < LANES - 1 && !row.floor[l + 1] && camX > x1)
      quad(proj(x1, hA, zA), proj(x1, hB, zB), proj(x1, hB - SLAB, zB), proj(x1, hA - SLAB, zA), T.slab(hue, fog, false));
    if (zA === rz && (!prev || !prev.floor[l]))
      quad(proj(x0, hA, rz), proj(x1, hA, rz), proj(x1, hA - SLAB, rz), proj(x0, hA - SLAB, rz), T.slab(hue, fog, true));
    quad(proj(x0, hA, zA), proj(x1, hA, zA), proj(x1, hB, zB), proj(x0, hB, zB), T.floor(hue, fog, (l + rz) & 1, lit));
  }
  // bright rims along the outer edges and along hole edges
  for (let l = 0; l < LANES; l++) {
    if (!row.floor[l]) continue;
    const w = Math.max(1, px * 0.03), c = T.rim(hue, fog);
    for (const [x, open] of [[l - HALF, l === 0 || !row.floor[l - 1]], [l - HALF + 1, l === LANES - 1 || !row.floor[l + 1]]]) {
      if (!open) continue;
      line(proj(x, hA + 0.01, zA), proj(x, hB + 0.01, zB), c, w, 1 - fog * 0.7);
    }
    if (zA === rz && (!prev || !prev.floor[l])) line(proj(l - HALF, hA + 0.01, rz), proj(l - HALF + 1, hA + 0.01, rz), T.rim(hue, fog), Math.max(1, px * 0.03), 1 - fog * 0.7);
  }
  if (rz > 0 && rz % SEC_ROWS === 0 && zA === rz) {   // section start line
    ctx.globalAlpha = 1 - fog;
    const h2 = world.hAt(rz + 0.15);
    quad(proj(-HALF, hA + 0.01, rz), proj(HALF, hA + 0.01, rz), proj(HALF, h2 + 0.01, rz + 0.15), proj(-HALF, h2 + 0.01, rz + 0.15), T.rim(hue, 0));
    ctx.globalAlpha = 1;
  }
  const order = [0, 1, 2, 3, 4].sort((a, b) => Math.abs(laneX(b) - camX) - Math.abs(laneX(a) - camX));
  for (const l of order) {
    if (!row.ramp[l]) continue;
    const x0 = l - HALF + 0.06, x1 = l - HALF + 1 - 0.06, rA = RAMP_H * (zA - rz);
    if (camX < x0) quad(proj(x0, hA, zA), proj(x0, hB, zB), proj(x0, hB + RAMP_H, zB), proj(x0, hA + rA, zA), T.ramp.side(hue, fog));
    if (camX > x1) quad(proj(x1, hA, zA), proj(x1, hB, zB), proj(x1, hB + RAMP_H, zB), proj(x1, hA + rA, zA), T.ramp.side(hue, fog));
    quad(proj(x0, hA + rA, zA), proj(x1, hA + rA, zA), proj(x1, hB + RAMP_H, zB), proj(x0, hB + RAMP_H, zB), T.ramp.top(hue, fog));
    for (const t of [0.3, 0.65]) {   // chevrons
      const za = rz + t, zb = za + 0.12;
      if (za < zA) continue;
      const ya = world.hAt(za) + RAMP_H * t + 0.005, yb = world.hAt(zb) + RAMP_H * (t + 0.12) + 0.005, xm = (x0 + x1) / 2;
      ctx.fillStyle = T.ramp.chev(hue, fog);
      path([proj(x0 + 0.1, ya, za), proj(xm, ya, zb + 0.1), proj(x1 - 0.1, ya, za), proj(x1 - 0.1, yb, zb), proj(xm, yb, zb + 0.22), proj(x0 + 0.1, yb, zb)]);
      ctx.fill();
    }
  }
  const bh = T.blockHue(hue), B = T.block;
  for (const l of order) {
    if (!row.block[l]) continue;
    const x0 = l - HALF + INSET, x1 = l - HALF + 1 - INSET, z0 = rz + INSET, z1 = rz + 1 - INSET;
    if (z1 <= camZ + 0.4) continue;
    const za = Math.max(z0, camZ + 0.4), ba = world.hAt(za), bb = world.hAt(z1);
    if (camX < x0) quad(proj(x0, ba, za), proj(x0, bb, z1), proj(x0, bb + BOX_H, z1), proj(x0, ba + BOX_H, za), B.side(bh, fog));
    if (camX > x1) quad(proj(x1, ba, za), proj(x1, bb, z1), proj(x1, bb + BOX_H, z1), proj(x1, ba + BOX_H, za), B.side(bh, fog));
    if (za === z0) quad(proj(x0, ba, z0), proj(x1, ba, z0), proj(x1, ba + BOX_H, z0), proj(x0, ba + BOX_H, z0), B.front(bh, fog));
    quad(proj(x0, ba + BOX_H, za), proj(x1, ba + BOX_H, za), proj(x1, bb + BOX_H, z1), proj(x0, bb + BOX_H, z1), B.top(bh, fog));
  }
}

function drawBall() {
  const b = world.ball, T = theme.ball;
  if (world.state === 'crash' || world.state === 'over') return;
  const g = world.state === 'fall' ? null : world.groundAt(b.x, b.z);
  if (g !== null) {   // the shadow shows where a jump lands
    const s = proj(b.x, g, b.z), up = b.y - R - g, c = theme.shadow;
    ctx.fillStyle = `rgba(${c},${0.38 * clamp(1 - up / 3, 0.25, 1)})`;
    ctx.beginPath(); ctx.ellipse(s[0], s[1], R * 1.15 * s[2], R * 0.45 * s[2], 0, 0, 7); ctx.fill();
  }
  const [px, py, sc] = proj(b.x, b.y, b.z), r = R * sc;
  if (T.glow && P.glow > 0.01) {
    const gl = ctx.createRadialGradient(px, py, r * 0.8, px, py, r * 2.6);
    gl.addColorStop(0, `rgba(${T.glow},${0.55 * P.glow})`); gl.addColorStop(1, `rgba(${T.glow},0)`);
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(px, py, r * 2.6, 0, 7); ctx.fill();
  }
  const gr = ctx.createRadialGradient(px - r * 0.35, py - r * 0.4, r * 0.1, px, py, r);
  gr.addColorStop(0, T.c[0]); gr.addColorStop(0.7, T.c[1]); gr.addColorStop(1, T.c[2]);
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
  // gloss: a soft highlight up-left and a faint rim of reflected light at the bottom
  const hl = ctx.createRadialGradient(px - r * 0.38, py - r * 0.42, 0, px - r * 0.38, py - r * 0.42, r * 0.45);
  hl.addColorStop(0, 'rgba(255,255,255,.85)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl; ctx.beginPath(); ctx.arc(px - r * 0.38, py - r * 0.42, r * 0.45, 0, 7); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.clip();
  ctx.strokeStyle = 'rgba(255,230,210,.35)'; ctx.lineWidth = r * 0.08;
  ctx.beginPath(); ctx.arc(px, py - r * 0.06, r * 0.96, Math.PI * 0.2, Math.PI * 0.8); ctx.stroke();
  ctx.restore();
}

// speed lines at the screen edges once the ball is fast
function drawStreaks() {
  const k = clamp((world.v - 13) / 11, 0, 1);
  if (k <= 0 || world.state !== 'run') return;
  const c = theme.streak, cx = W / 2, R0 = Math.hypot(W, H) * 0.42, rr = mulberry((performance.now() / 50) | 0);
  ctx.lineWidth = Math.max(1, 1.5 * dpr);
  for (let n = 0; n < 14; n++) {
    const ang = rr() * Math.PI * 2, r0 = R0 * (0.85 + rr() * 0.3), len = R0 * (0.15 + rr() * 0.25) * k;
    ctx.strokeStyle = `rgba(${c},${0.08 + 0.18 * k * rr()})`;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * r0, horY + Math.sin(ang) * r0);
    ctx.lineTo(cx + Math.cos(ang) * (r0 + len), horY + Math.sin(ang) * (r0 + len)); ctx.stroke();
  }
}

function draw() {
  const hue = secHue(Math.floor(Math.max(0, camZ + CAM_BACK) / SEC_ROWS));
  setPhase(camZ + CAM_BACK);
  theme.sky(hue, horY);
  const near = Math.max(0, Math.floor(camZ + 0.4)), far = Math.floor(camZ) + VIEW;
  const ballRow = world.state === 'fall' ? world.ball.fallRow : Math.floor(world.ball.z);
  for (let rz = far; rz >= near; rz--) {
    drawRow(rz);
    if (rz === ballRow) drawBall();
  }
  if (ballRow < near) drawBall();
  for (const p of parts) {
    const [px, py, sc] = proj(p.x, p.y, p.z);
    if (sc <= 0) continue;
    ctx.fillStyle = theme.ball.c[1]; ctx.beginPath(); ctx.arc(px, py, R * 0.32 * sc, 0, 7); ctx.fill();
  }
  drawStreaks();
  if (flash) {
    ctx.globalAlpha = Math.min(1, flash.t * 1.5);
    ctx.fillStyle = theme.rim(secHue(flash.sec), 0);
    ctx.font = `700 ${Math.round(H * 0.09)}px system-ui, sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(String(flash.sec + 1), W / 2, H * 0.3);
    ctx.globalAlpha = 1;
  }
}

// ---- Input ----
let dragX = null;
cv.addEventListener('pointerdown', (e) => { dragX = e.clientX; });
addEventListener('pointermove', (e) => {
  if (dragX == null || mode !== 'play') return;
  const b = world.ball;
  b.tx = clamp(b.tx + (e.clientX - dragX) / innerWidth * SENS, -HALF - 0.9, HALF + 0.9);
  dragX = e.clientX;
});
addEventListener('pointerup', () => { dragX = null; });
addEventListener('pointercancel', () => { dragX = null; });
$over.addEventListener('pointerdown', (e) => {
  if (performance.now() - overlayAt < 400) return;   // a stray tap right after a crash doesn't restart
  dragX = e.clientX;
  play();
});
const KEYS = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };
addEventListener('keydown', (e) => {
  if (KEYS[e.code]) keyDir = KEYS[e.code];
  else if ((e.code === 'Space' || e.code === 'Enter') && mode !== 'play') play();
});
addEventListener('keyup', (e) => {
  if (KEYS[e.code] === keyDir) { keyDir = 0; world.ball.tx = world.ball.x; }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode === 'play') { mode = 'pause'; showOverlay(world.score); }
});

let last = performance.now();
function frame(t) {
  const dt = Math.min(1 / 30, (t - last) / 1000);
  last = t;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
addEventListener('resize', resize);
resize();
camZ = world.ball.z - CAM_BACK;
showOverlay(null);
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

// test hook for screenshots: jump the camera to row z of the given seed, driving the bot along the path
window.__shot = (seed, z) => {
  world = new World(seed); mode = 'shot';
  while (world.state === 'run' && world.ball.z < z) {
    world.ball.tx = world.autoTarget(); world.step(1 / 60); world.events.length = 0;
    follow(1 / 60);
  }
  $over.classList.add('hide'); $score.textContent = world.score; draw();
};
