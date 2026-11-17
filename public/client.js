// The page: draws the world from core.js in a hand-rolled perspective, reads the finger / mouse / keys,
// shows the score and the play / game-over screen. The road is grass and earth; the sky goes from day to night
// to space with the distance.
import { World, LANES, HALF, SEC_ROWS, R, INSET, BOX_H, RAMP_H, CAM_H, CAM_BACK, laneX, clamp, mulberry } from './core.js';

const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const $score = document.getElementById('score'), $sec = document.getElementById('sec');
const $over = document.getElementById('over'), $oscore = document.getElementById('oscore'), $obest = document.getElementById('obest');

const BEST_KEY = 'roll.best';
const SENS = 6;                     // world units per full screen-width drag
const SLAB = 0.35, VIEW = 46;       // track thickness, rows drawn ahead
const PITCH = 0.5;

// mode: 'ready' | 'play' | 'pause' | 'over' (and 'shot' — frozen by the screenshot hook at the end);
// the world has its own state inside a game
let mode = 'ready', world = new World(1), parts = [], flash = null;
let camZ = 0, camX = 0, camY = 0, keyDir = 0, overlayAt = 0;
let best = Number(localStorage.getItem(BEST_KEY)) || 0;

// ---- Colours ----
let FOG = [5, 6, 13];
function hsl(h, s, l, fog = 0) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
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
    grass: [98, 52, 50], grassHi: [88, 62, 64], tuft: [104, 55, 34], soil: [30, 42, 38], pit: [26, 40, 12], pitWall: [28, 38, 24],
    rock: [35, 8, 64], bush: [118, 45, 34], bushHi: [100, 58, 52], wood: [33, 55, 58], woodDark: [28, 50, 38],
    flowerL: 72, glowF: 0, litK: 0.6,
    shadow: [40, 70, 130], hud: 0, stars: 0, space: 0, moon: 0,
    sunA: 1, sunH: 0.22, sunC: [255, 253, 240], sunR: 0.06, clouds: 1, cloudC: [255, 255, 255], glow: 0,
  },
  { // sunset
    sky: [[51, 64, 126], [201, 112, 143], [255, 195, 138]], fog: [255, 200, 165],
    grass: [85, 45, 42], grassHi: [70, 55, 56], tuft: [90, 45, 28], soil: [22, 40, 30], pit: [20, 40, 10], pitWall: [22, 35, 20],
    rock: [20, 12, 52], bush: [105, 35, 26], bushHi: [88, 45, 42], wood: [28, 50, 50], woodDark: [22, 45, 32],
    flowerL: 66, glowF: 0.1, litK: 0.7,
    shadow: [60, 20, 60], hud: 0.8, stars: 0.15, space: 0, moon: 0,
    sunA: 1, sunH: 0.03, sunC: [255, 170, 100], sunR: 0.09, clouds: 0.85, cloudC: [255, 205, 215], glow: 0.25,
  },
  { // night: stars and a hint of space up top, the flowers glow
    sky: [[6, 10, 34], [17, 28, 74], [38, 52, 110]], fog: [26, 36, 84],
    grass: [160, 30, 20], grassHi: [150, 35, 30], tuft: [165, 30, 12], soil: [-125, 18, 15], pit: [-125, 30, 4], pitWall: [-125, 20, 10],
    rock: [-135, 10, 32], bush: [165, 30, 13], bushHi: [158, 35, 25], wood: [30, 25, 26], woodDark: [30, 25, 17],
    flowerL: 70, glowF: 0.7, litK: 1,
    shadow: [0, 0, 0], hud: 1, stars: 0.85, space: 0.3, moon: 1,
    sunA: 0, sunH: -0.05, sunC: [255, 140, 90], sunR: 0.09, clouds: 0.2, cloudC: [60, 72, 130], glow: 0.6,
  },
  { // space: alien teal grass
    sky: [[5, 6, 13], [5, 6, 13], [5, 6, 13]], fog: [5, 6, 13],
    grass: [178, 45, 22], grassHi: [175, 55, 34], tuft: [182, 45, 13], soil: [-98, 25, 15], pit: [-98, 30, 3], pitWall: [-98, 25, 9],
    rock: [-105, 12, 34], bush: [195, 40, 15], bushHi: [188, 50, 28], wood: [-80, 25, 32], woodDark: [-80, 25, 22],
    flowerL: 72, glowF: 1, litK: 1,
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
    // never below the road under the ball (the generator counts on that to know what can be seen);
    // a little higher when the road ahead climbs, to look over the crest
    camY = world.hAt(b.z) + Math.max(0, world.hAt(b.z + 6) - world.hAt(b.z)) * 0.3;
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

// a stable pseudo-random number in [0, 1) for a cell: decorations must not flicker from frame to frame
function hash(a, b, c = 0) {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const pal = (k, dl = 0, fog = 0) => { const v = P[k]; return hsl(v[0], v[1], clamp(v[2] + dl, 2, 97), fog); };
const FLOWERS = [[0, 0, 97], [50, 95, 60], [330, 80, 76], [275, 65, 72], [5, 80, 62], [205, 85, 72]];

function drawRow(rz) {
  const track = world.track, row = track.get(rz), zA = Math.max(rz, camZ + 0.4), zB = rz + 1;
  if (zB <= zA) return;
  const next = track.get(rz + 1), prev = rz > 0 ? track.get(rz - 1) : null;
  const hA = world.hAt(zA), hB = next.h, slope = hB - row.h, dz = (zA + zB) / 2 - camZ;
  const fog = clamp((dz - 12) / (VIEW - 12), 0, 1);
  const lit = slope * 20 * P.litK;   // uphill faces the camera and looks brighter
  const px = proj(0, hA, (zA + zB) / 2)[2];   // pixels per world unit at this row
  // pits in the ground: a dark opening at road level and the earthen far wall
  for (let l = 0; l < LANES; l++) {
    if (row.floor[l]) continue;
    const x0 = l - HALF, x1 = x0 + 1;
    quad(proj(x0, hA, zA), proj(x1, hA, zA), proj(x1, hB, zB), proj(x0, hB, zB), pal('pit', 0, fog));
    if (next.floor[l]) quad(proj(x0, hB, zB), proj(x1, hB, zB), proj(x1, hB - SLAB, zB), proj(x0, hB - SLAB, zB), pal('pitWall', 0, fog));
  }
  // the ground: grass on top, a layer of earth where it is cut
  for (let l = 0; l < LANES; l++) {
    if (!row.floor[l]) continue;
    const x0 = l - HALF, x1 = x0 + 1;
    if (l > 0 && !row.floor[l - 1] && camX < x0)
      quad(proj(x0, hA, zA), proj(x0, hB, zB), proj(x0, hB - SLAB, zB), proj(x0, hA - SLAB, zA), pal('soil', -5, fog));
    if (l < LANES - 1 && !row.floor[l + 1] && camX > x1)
      quad(proj(x1, hA, zA), proj(x1, hB, zB), proj(x1, hB - SLAB, zB), proj(x1, hA - SLAB, zA), pal('soil', -5, fog));
    if (zA === rz && (!prev || !prev.floor[l]))
      quad(proj(x0, hA, rz), proj(x1, hA, rz), proj(x1, hA - SLAB, rz), proj(x0, hA - SLAB, rz), pal('soil', 0, fog));
    // patches of lighter and darker grass; faint near the camera, where cells rush past
    const patch = (hash(rz, l) - 0.5) * 3 * clamp((dz - 4) / 8, 0.1, 1);
    // cells overlap a hair so no seams show between them
    const zE = zB + 0.02, hE = world.hAt(zE);
    quad(proj(x0 - 0.01, hA, zA), proj(x1 + 0.01, hA, zA), proj(x1 + 0.01, hE, zE), proj(x0 - 0.01, hE, zE), pal('grass', lit + patch, fog));
  }
  // a darker grass line where the ground ends
  for (let l = 0; l < LANES; l++) {
    if (!row.floor[l]) continue;
    for (const [x, open] of [[l - HALF, l === 0 || !row.floor[l - 1]], [l - HALF + 1, l === LANES - 1 || !row.floor[l + 1]]]) {
      if (open) line(proj(x, hA + 0.01, zA), proj(x, hB + 0.01, zB), pal('tuft', 0, fog), Math.max(1, px * 0.025), 1 - fog * 0.7);
    }
    if (zA === rz && (!prev || !prev.floor[l])) line(proj(l - HALF, hA + 0.01, rz), proj(l - HALF + 1, hA + 0.01, rz), pal('tuft', 0, fog), Math.max(1, px * 0.025), 1 - fog * 0.7);
  }
  if (dz < 22) drawDecor(rz, row, zA, px, fog);
  if (rz > 0 && rz % SEC_ROWS === 0 && zA === rz) {   // section start line, like chalk on the grass
    ctx.globalAlpha = 0.6 * (1 - fog);
    const h2 = world.hAt(rz + 0.12);
    quad(proj(-HALF, hA + 0.01, rz), proj(HALF, hA + 0.01, rz), proj(HALF, h2 + 0.01, rz + 0.12), proj(-HALF, h2 + 0.01, rz + 0.12), '#fff');
    ctx.globalAlpha = 1;
  }
  const order = [0, 1, 2, 3, 4].sort((a, b) => Math.abs(laneX(b) - camX) - Math.abs(laneX(a) - camX));
  for (const l of order) {   // wooden ramps
    if (!row.ramp[l]) continue;
    const x0 = l - HALF + 0.06, x1 = l - HALF + 1 - 0.06, rA = RAMP_H * (zA - rz);
    if (camX < x0) quad(proj(x0, hA, zA), proj(x0, hB, zB), proj(x0, hB + RAMP_H, zB), proj(x0, hA + rA, zA), pal('woodDark', 0, fog));
    if (camX > x1) quad(proj(x1, hA, zA), proj(x1, hB, zB), proj(x1, hB + RAMP_H, zB), proj(x1, hA + rA, zA), pal('woodDark', 0, fog));
    quad(proj(x0, hA + rA, zA), proj(x1, hA + rA, zA), proj(x1, hB + RAMP_H, zB), proj(x0, hB + RAMP_H, zB), pal('wood', 0, fog));
    for (const t of [0.25, 0.5, 0.75]) {   // planks
      const z = rz + t;
      if (z < zA) continue;
      const y = world.hAt(z) + RAMP_H * t + 0.005;
      line(proj(x0, y, z), proj(x1, y, z), pal('woodDark', 0, fog), Math.max(1, px * 0.02), 1 - fog);
    }
    line(proj(x0, hB + RAMP_H, zB), proj(x1, hB + RAMP_H, zB), pal('wood', 16, fog), Math.max(1, px * 0.03), 1 - fog);
  }
  for (const l of order) {   // obstacles: rocks and bushes, the same box for hitting
    if (!row.block[l]) continue;
    if (rz + 0.5 <= camZ + 0.9) continue;
    if (hash(rz, l, 7) < 0.5) drawRock(l, rz, fog); else drawBush(l, rz, fog);
  }
}

// grass tufts and little flowers, only on plain ground near the camera
function drawDecor(rz, row, zA, px, fog) {
  const blades = [], flowers = [];
  for (let l = 0; l < LANES; l++) {
    if (!row.floor[l] || row.block[l] || row.ramp[l]) continue;
    for (let k = 0; k < 4; k++) {
      const z = rz + 0.08 + hash(rz, l, 2 * k + 1) * 0.84;
      if (z < zA) continue;
      const x = l - HALF + 0.08 + hash(rz, l, 2 * k) * 0.84, p = proj(x, world.hAt(z), z), h = p[2] * 0.06;
      blades.push([p[0], p[1], h]);
    }
    const nF = hash(rz, l, 99) < 0.3 ? 1 : hash(rz, l, 99) < 0.42 ? 2 : 0;
    for (let k = 0; k < nF; k++) {
      const z = rz + 0.12 + hash(rz, l, 50 + k) * 0.76;
      if (z < zA) continue;
      const x = l - HALF + 0.12 + hash(rz, l, 60 + k) * 0.76;
      flowers.push([proj(x, world.hAt(z) + 0.02, z), FLOWERS[Math.floor(hash(rz, l, 70 + k) * FLOWERS.length)]]);
    }
  }
  if (blades.length) {
    ctx.strokeStyle = pal('tuft', 0, fog); ctx.lineWidth = Math.max(1, px * 0.01); ctx.globalAlpha = 0.75 * (1 - fog);
    ctx.beginPath();
    for (const [x, y, h] of blades) {
      ctx.moveTo(x - h * 0.35, y - h); ctx.lineTo(x, y);
      ctx.lineTo(x + h * 0.05, y - h * 1.2); ctx.moveTo(x, y); ctx.lineTo(x + h * 0.4, y - h * 0.9);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  for (const [p, c] of flowers) {
    const r = p[2] * 0.03, petal = hsl(c[0], c[1], Math.min(97, c[2] * P.flowerL / 72), fog);
    if (P.glowF > 0.05) {   // flowers glow in the dark: a soft halo that fades out
      const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 3);
      g.addColorStop(0, petal); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.45 * P.glowF * (1 - fog); ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p[0], p[1], r * 3, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.fillStyle = petal;
    if (r < 1.3) { ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(0.8, r * 1.4), 0, 7); ctx.fill(); continue; }
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = k * 1.2566;
      ctx.moveTo(p[0] + Math.cos(a) * r * 1.1 + r * 0.7, p[1] + Math.sin(a) * r * 0.55);
      ctx.arc(p[0] + Math.cos(a) * r * 1.1, p[1] + Math.sin(a) * r * 0.55, r * 0.7, 0, 7);
    }
    ctx.fill();
    ctx.fillStyle = hsl(45, 95, 55, fog); ctx.beginPath(); ctx.arc(p[0], p[1], r * 0.5, 0, 7); ctx.fill();
  }
}

// where an obstacle sits on the screen: front-bottom centre, half width and height in pixels
function obstacleFrame(l, rz) {
  const xc = laneX(l), zc = rz + 0.5, base = world.hAt(zc);
  const pf = proj(xc, base, rz + INSET + 0.1), pt = proj(xc, base + BOX_H, zc);
  const hw = proj(xc + 0.42, base, rz + INSET + 0.1)[0] - pf[0];
  return { x: pf[0], bottom: pf[1], top: pt[1], hw, pc: proj(xc, base, zc) };
}
function obstacleShadow(o, fog) {
  ctx.fillStyle = `rgba(${P.shadow.map(Math.round)},${0.3 * (1 - fog)})`;
  ctx.beginPath(); ctx.ellipse(o.x, (o.bottom + o.pc[1]) / 2, o.hw * 1.15, Math.max(1, (o.bottom - o.pc[1]) * 0.9), 0, 0, 7); ctx.fill();
}

function drawRock(l, rz, fog) {
  const o = obstacleFrame(l, rz), cx = o.x, cy = (o.bottom + o.top) / 2, rx = o.hw, ry = (o.bottom - o.top) / 2;
  if (!(rx > 0 && ry > 0)) return;
  obstacleShadow(o, fog);
  // an irregular rounded outline, flat at the bottom
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2, j = 1 + (hash(rz, l, 20 + k) - 0.5) * 0.22;
    pts.push([cx + Math.cos(a) * rx * j, Math.min(o.bottom, cy + Math.sin(a) * ry * j * (Math.sin(a) > 0 ? 1.1 : 1))]);
  }
  ctx.beginPath();
  for (let k = 0; k <= 10; k++) {
    const p = pts[k % 10], q = pts[(k + 1) % 10], m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (k === 0) ctx.moveTo(m[0], m[1]); else ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  const g = ctx.createRadialGradient(cx - rx * 0.35, cy - ry * 0.5, 0, cx, cy, Math.max(rx, ry) * 1.25);
  g.addColorStop(0, pal('rock', 16, fog)); g.addColorStop(0.55, pal('rock', 0, fog)); g.addColorStop(1, pal('rock', -22, fog));
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = pal('rock', -26, fog); ctx.lineWidth = Math.max(1, rx * 0.04); ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.moveTo(cx - rx * 0.1, cy - ry * 0.7); ctx.lineTo(cx + rx * 0.05, cy - ry * 0.2); ctx.lineTo(cx - rx * 0.15, cy + ry * 0.25); ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawBush(l, rz, fog) {
  const o = obstacleFrame(l, rz), cx = o.x, rx = o.hw, ry = (o.bottom - o.top) / 2, cy = o.bottom - ry;
  if (!(rx > 0 && ry > 0)) return;
  obstacleShadow(o, fog);
  // overlapping leafy balls, back ones first
  const balls = [[-0.5, 0.25, 0.5], [0.5, 0.25, 0.5], [-0.25, -0.35, 0.5], [0.28, -0.3, 0.48], [0, 0.15, 0.62]];
  for (const [bx, by, br] of balls) {
    const x = cx + bx * rx, y = cy + by * ry, r = br * Math.max(rx, ry * 1.1);
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, 0, x, y, r);
    g.addColorStop(0, pal('bushHi', 0, fog)); g.addColorStop(0.7, pal('bush', 0, fog)); g.addColorStop(1, pal('bush', -8, fog));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, Math.min(y, o.bottom - r * 0.6), r, 0, 7); ctx.fill();
  }
  // a few berries or blossoms
  const c = FLOWERS[Math.floor(hash(rz, l, 40) * FLOWERS.length)];
  ctx.fillStyle = hsl(c[0], c[1], c[2], fog);
  for (let k = 0; k < 4; k++) {
    const x = cx + (hash(rz, l, 41 + k) - 0.5) * rx * 1.3, y = cy + (hash(rz, l, 45 + k) - 0.7) * ry * 1.2;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, rx * 0.07), 0, 7); ctx.fill();
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
  if (!(sc > 0) || !Number.isFinite(px + py + r)) return;   // behind the camera: nothing to draw
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
    ctx.fillStyle = '#ffffff';
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
// The next frame is requested first: an error in one frame must not stop the game for good.
function frame(t) {
  requestAnimationFrame(frame);
  const dt = clamp((t - last) / 1000, 0, 1 / 30);
  last = t;
  try {
    update(dt);
    draw();
  } catch (e) {
    console.error(e);
  }
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
