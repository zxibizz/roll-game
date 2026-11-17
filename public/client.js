// The page: draws the world from core.js in a hand-rolled perspective, reads the finger / mouse / keys,
// shows the score and the play / game-over screen. Looks come from a theme (?theme=space|neon|day|mono).
import { World, LANES, HALF, SEC_ROWS, R, INSET, BOX_H, RAMP_H, laneX, clamp, mulberry } from './core.js';

const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const $score = document.getElementById('score'), $sec = document.getElementById('sec');
const $over = document.getElementById('over'), $oscore = document.getElementById('oscore'), $obest = document.getElementById('obest');

const BEST_KEY = 'roll.best';
const SENS = 6;                     // world units per full screen-width drag
const SLAB = 0.35, VIEW = 46;       // track thickness, rows drawn ahead
const CAM_H = 4.6, CAM_BACK = 6.5, PITCH = 0.5;
const TRAIL = 9;                    // ball positions kept for the trail

// mode: 'ready' | 'play' | 'pause' | 'over'; the world has its own state inside a game
let mode = 'ready', world = new World(1), parts = [], flash = null, trail = [];
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

// ---- Themes ----
// sky(hue, horY) draws the background; colour functions take (hue, fog 0..1).
const THEMES = {
  space: {
    fog: [5, 6, 13], hud: '#fff', overlay: 'rgba(5,6,13,.5)',
    sky(hue, horY) {
      ctx.fillStyle = '#05060d'; ctx.fillRect(0, 0, W, H);
      nebula(W * 0.22, horY - H * 0.16, W * 0.7, hsl(hue, 70, 35), 0.45);
      nebula(W * 0.85, horY - H * 0.32, W * 0.5, hsl(hue + 70, 70, 35), 0.35);
      drawStars(1);
      // a planet low over the horizon
      const px = W * 0.78 - camX * 4 * dpr, py = horY - H * 0.1, pr = Math.min(W, H) * 0.09;
      const g = ctx.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
      g.addColorStop(0, hsl(hue + 140, 45, 70)); g.addColorStop(1, hsl(hue + 140, 45, 18));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, pr, 0, 7); ctx.fill();
      ctx.strokeStyle = hsl(hue + 140, 40, 70); ctx.globalAlpha = 0.5; ctx.lineWidth = pr * 0.06;
      ctx.beginPath(); ctx.ellipse(px, py, pr * 1.7, pr * 0.35, -0.25, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    },
    floor: (h, f, par, lit) => hsl(h, 42, clamp((par ? 31 : 36) + lit, 12, 60), f),
    slab: (h, f, front) => hsl(h, 35, front ? 20 : 16, f),
    rim: (h, f) => hsl(h, 75, 72, f), rimGlow: false, grid: null,
    blockHue: (h) => (h + 170) % 360,
    block: { top: (h, f) => hsl(h, 65, 63, f), front: (h, f) => hsl(h, 62, 50, f), side: (h, f) => hsl(h, 60, 40, f), edge: null },
    ramp: { top: (h, f) => hsl(h, 30, 90, f), side: (h, f) => hsl(h, 25, 62, f), chev: (h, f) => hsl(h, 70, 55, f) },
    ball: { c: ['#ffffff', '#d8dcf0', '#8a90b0'], band: 'rgba(90,100,150,.55)', glow: null, trail: [220, 225, 255] },
    shadow: [0, 0, 0], streak: [255, 255, 255],
  },
  neon: {
    fog: [36, 8, 58], hud: '#fff', overlay: 'rgba(11,2,33,.55)',
    sky(hue, horY) {
      ctx.fillStyle = grad(0, horY, ['#0b0221', '#24073f', '#4a0d5e']); ctx.fillRect(0, 0, W, horY + 1);
      drawStars(0.5, horY);
      // striped sun sitting on the horizon
      const sx = W / 2 - camX * 3 * dpr, r = Math.min(W, H) * 0.2;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, horY); ctx.clip();
      ctx.fillStyle = grad(horY - r, horY, ['#ffe066', '#ff5fa2', '#c4157a']);
      ctx.beginPath(); ctx.arc(sx, horY, r, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#3a0b52';
      for (let k = 0; k < 6; k++) { const y = horY - r * (0.08 + k * 0.11); ctx.fillRect(sx - r, y, 2 * r, r * 0.02 * (6 - k)); }
      ctx.restore();
      // the ground below: a dark plane with a magenta grid
      ctx.fillStyle = grad(horY, H, ['#2a0844', '#0b0221']); ctx.fillRect(0, horY, W, H - horY);
      ctx.strokeStyle = '#ff3ea5'; ctx.lineWidth = Math.max(1, dpr);
      const GY = camY - 4;
      for (let z = Math.ceil(camZ / 3) * 3; z < camZ + VIEW * 1.5; z += 3) {
        const p = proj(0, GY, z); if (p[2] <= 0) continue;
        ctx.globalAlpha = clamp(0.6 - (z - camZ) / (VIEW * 1.5), 0, 0.6);
        ctx.beginPath(); ctx.moveTo(0, p[1]); ctx.lineTo(W, p[1]); ctx.stroke();
      }
      ctx.globalAlpha = 0.35;
      for (let x = -40; x <= 40; x += 3) {
        const a = proj(x, GY, camZ + 1.2), b = proj(x, GY, camZ + VIEW * 1.5);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    floor: (h, f, par, lit) => hsl(h, 55, clamp((par ? 7 : 9) + lit * 0.3, 3, 20), f),
    slab: (h, f) => hsl(h, 60, 5, f),
    rim: (h, f) => hsl(h, 100, 66, f), rimGlow: true,
    grid: (h, f) => hsl(h, 100, 60, f),
    blockHue: (h) => (h + 170) % 360,
    block: { top: (h, f) => hsl(h, 60, 16, f), front: (h, f) => hsl(h, 60, 11, f), side: (h, f) => hsl(h, 60, 8, f), edge: (h, f) => hsl(h, 100, 62, f) },
    ramp: { top: (h, f) => hsl(55, 50, 14, f), side: (h, f) => hsl(55, 50, 9, f), chev: (h, f) => hsl(55, 100, 62, f) },
    ball: { c: ['#ffffff', '#c9f6ff', '#38bdf8'], band: 'rgba(14,90,140,.5)', glow: [56, 189, 248], trail: [56, 189, 248] },
    shadow: [0, 0, 0], streak: [255, 120, 210],
  },
  day: {
    fog: [226, 240, 255], hud: '#1d2433', overlay: 'rgba(226,240,255,.6)',
    sky(hue, horY) {
      ctx.fillStyle = grad(0, horY, ['#6fb1f2', '#a9d3fb', '#e2f0ff']); ctx.fillRect(0, 0, W, horY + 1);
      ctx.fillStyle = '#e2f0ff'; ctx.fillRect(0, horY, W, H - horY);
      const sx = W * 0.8 - camX * 3 * dpr, sy = horY - H * 0.22, sr = Math.min(W, H) * 0.06;
      const g = ctx.createRadialGradient(sx, sy, sr * 0.6, sx, sy, sr * 3);
      g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.3, 'rgba(255,245,200,.5)'); g.addColorStop(1, 'rgba(255,245,200,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, sr * 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#fffdf0'; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 7); ctx.fill();
      const rr = mulberry(3);   // clouds, above and below the horizon
      for (let n = 0; n < 9; n++) {
        const cx = ((rr() * 1.6 - 0.3) * W - camX * (2 + n) * dpr) % (W * 1.6), cy = horY + (rr() - 0.65) * H * 0.5, s = (0.05 + rr() * 0.06) * W;
        ctx.globalAlpha = cy > horY ? 0.55 : 0.85; ctx.fillStyle = '#ffffff';
        for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(cx + (k - 1.5) * s * 0.7, cy - (k % 2) * s * 0.25, s * 0.6, s * 0.38, 0, 0, 7); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    },
    floor: (h, f, par, lit) => hsl(h, 55, clamp((par ? 78 : 84) + lit * 0.6, 55, 95), f),
    slab: (h, f, front) => hsl(h, 35, front ? 66 : 60, f),
    rim: (h, f) => hsl(h, 60, 96, f), rimGlow: false, grid: null,
    blockHue: (h) => (h + 170) % 360,
    block: { top: (h, f) => hsl(h, 80, 70, f), front: (h, f) => hsl(h, 65, 60, f), side: (h, f) => hsl(h, 55, 51, f), edge: null },
    ramp: { top: (h, f) => hsl(h, 20, 99, f), side: (h, f) => hsl(h, 30, 82, f), chev: (h, f) => hsl(h, 75, 62, f) },
    ball: { c: ['#fff1e6', '#ff8a5c', '#cf4b25'], band: 'rgba(255,255,255,.5)', glow: null, trail: [255, 160, 120] },
    shadow: [40, 70, 130], streak: [255, 255, 255],
  },
  mono: {
    fog: [18, 18, 22], hud: '#fff', overlay: 'rgba(15,15,18,.55)',
    sky(hue, horY) {
      ctx.fillStyle = grad(0, H, ['#0d0d10', '#17171c', '#0d0d10']); ctx.fillRect(0, 0, W, H);
    },
    floor: (h, f, par, lit) => hsl(230, 6, clamp((par ? 80 : 86) + lit * 0.6, 50, 96), f),
    slab: (h, f, front) => hsl(230, 6, front ? 42 : 34, f),
    rim: (h, f) => hsl(h, 85, 58, f), rimGlow: false, grid: null,
    blockHue: () => 6,
    block: { top: (h, f) => hsl(h, 90, 66, f), front: (h, f) => hsl(h, 75, 55, f), side: (h, f) => hsl(h, 65, 44, f), edge: null },
    ramp: { top: (h, f) => hsl(217, 90, 60, f), side: (h, f) => hsl(217, 70, 42, f), chev: (h, f) => hsl(0, 0, 100, f) },
    ball: { c: ['#8a8a96', '#2b2b33', '#0b0b0e'], band: 'rgba(255,255,255,.28)', glow: null, trail: [140, 140, 155] },
    shadow: [0, 0, 0], streak: [255, 255, 255],
  },
};
const themeName = new URLSearchParams(location.search).get('theme');
const theme = THEMES[themeName] || THEMES.space;
FOG = theme.fog;
document.body.style.color = theme.hud;
$over.style.background = theme.overlay;

// ---- Game flow ----
function newGame() {
  world = new World((Math.random() * 1e9) | 0);
  parts = []; flash = null; trail = []; camX = 0; camY = 0; camZ = world.ball.z - CAM_BACK;
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
  if (world.state === 'run') {
    camZ = b.z - CAM_BACK;
    camY += (world.hAt(b.z) * 0.7 + world.hAt(b.z + 8) * 0.3 - camY) * Math.min(1, dt * 4);
    $score.textContent = world.score;
    trail.push({ x: b.x, y: b.y, z: b.z });
    if (trail.length > TRAIL) trail.shift();
  } else trail.length = 0;
  camX += (b.x * 0.5 - camX) * Math.min(1, dt * 5);
  if (flash && (flash.t -= dt * 0.8) <= 0) flash = null;
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
  // the ball's contact point sits at 76 % of the height on flat ground
  const dz = CAM_BACK, dy = -CAM_H, zc = dz * CP - dy * SP, yc = dy * CP + dz * SP;
  cy = H * 0.76 + f * yc / zc;
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
function outline(pts, color, w, alpha = 1) {
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = w; path(pts); ctx.stroke(); ctx.globalAlpha = 1;
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
    const top = [proj(x0, hA, zA), proj(x1, hA, zA), proj(x1, hB, zB), proj(x0, hB, zB)];
    quad(...top, T.floor(hue, fog, (l + rz) & 1, lit));
    if (T.grid) outline(top, T.grid(hue, fog), Math.max(1, px * 0.025), 0.55 * (1 - fog));
  }
  // bright rims along the outer edges and along hole edges
  for (let l = 0; l < LANES; l++) {
    if (!row.floor[l]) continue;
    const w = Math.max(1, px * (T.rimGlow ? 0.04 : 0.03)), c = T.rim(hue, fog);
    for (const [x, open] of [[l - HALF, l === 0 || !row.floor[l - 1]], [l - HALF + 1, l === LANES - 1 || !row.floor[l + 1]]]) {
      if (!open) continue;
      const a = proj(x, hA + 0.01, zA), b = proj(x, hB + 0.01, zB);
      if (T.rimGlow) line(a, b, c, w * 5, 0.18 * (1 - fog));
      line(a, b, c, w, 1 - fog * 0.7);
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
    const top = [proj(x0, hA + rA, zA), proj(x1, hA + rA, zA), proj(x1, hB + RAMP_H, zB), proj(x0, hB + RAMP_H, zB)];
    quad(...top, T.ramp.top(hue, fog));
    if (T.rimGlow) outline(top, T.ramp.chev(hue, fog), Math.max(1, px * 0.03), 1 - fog);
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
    const faces = [];
    if (camX < x0) faces.push([[proj(x0, ba, za), proj(x0, bb, z1), proj(x0, bb + BOX_H, z1), proj(x0, ba + BOX_H, za)], B.side]);
    if (camX > x1) faces.push([[proj(x1, ba, za), proj(x1, bb, z1), proj(x1, bb + BOX_H, z1), proj(x1, ba + BOX_H, za)], B.side]);
    if (za === z0) faces.push([[proj(x0, ba, z0), proj(x1, ba, z0), proj(x1, ba + BOX_H, z0), proj(x0, ba + BOX_H, z0)], B.front]);
    faces.push([[proj(x0, ba + BOX_H, za), proj(x1, ba + BOX_H, za), proj(x1, bb + BOX_H, z1), proj(x0, bb + BOX_H, z1)], B.top]);
    for (const [pts, col] of faces) {
      quad(...pts, col(bh, fog));
      if (B.edge) outline(pts, B.edge(bh, fog), Math.max(1, px * 0.03), 1 - fog * 0.6);
    }
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
  trail.forEach((p, i) => {   // a fading trail of past positions
    const [tx, ty, ts] = proj(p.x, p.y, p.z), k = (i + 1) / trail.length;
    ctx.fillStyle = `rgba(${T.trail},${0.22 * k})`;
    ctx.beginPath(); ctx.arc(tx, ty, R * ts * (0.45 + 0.5 * k), 0, 7); ctx.fill();
  });
  const [px, py, sc] = proj(b.x, b.y, b.z), r = R * sc;
  if (T.glow) {
    const gl = ctx.createRadialGradient(px, py, r * 0.8, px, py, r * 2.6);
    gl.addColorStop(0, `rgba(${T.glow},.55)`); gl.addColorStop(1, `rgba(${T.glow},0)`);
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(px, py, r * 2.6, 0, 7); ctx.fill();
  }
  const gr = ctx.createRadialGradient(px - r * 0.35, py - r * 0.4, r * 0.1, px, py, r);
  gr.addColorStop(0, T.c[0]); gr.addColorStop(0.7, T.c[1]); gr.addColorStop(1, T.c[2]);
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
  const a = b.roll % (Math.PI * 2), o = Math.cos(a);   // a band that rolls with the ball
  if (Math.sin(a) > 0) {
    ctx.save(); ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.clip();
    ctx.strokeStyle = T.band; ctx.lineWidth = r * 0.22;
    ctx.beginPath(); ctx.ellipse(px, py - o * r * 0.85, r, r * 0.25 * Math.sin(a), 0, 0, Math.PI); ctx.stroke();
    ctx.restore();
  }
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
  world = new World(seed); trail = []; mode = 'shot';
  while (world.state === 'run' && world.ball.z < z) {
    world.ball.tx = world.autoTarget(); world.step(1 / 60); world.events.length = 0;
    trail.push({ x: world.ball.x, y: world.ball.y, z: world.ball.z }); if (trail.length > TRAIL) trail.shift();
    camZ = world.ball.z - CAM_BACK; camY += (world.hAt(world.ball.z) * 0.7 + world.hAt(world.ball.z + 8) * 0.3 - camY) * 0.067;
    camX += (world.ball.x * 0.5 - camX) * 0.083;
  }
  $over.classList.add('hide'); $score.textContent = world.score; draw();
};
