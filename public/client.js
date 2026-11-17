// The page: draws the world from core.js in a hand-rolled perspective, reads the finger / mouse / keys,
// shows the score and the play / game-over screen.
import { World, LANES, HALF, SEC_ROWS, R, INSET, BOX_H, RAMP_H, laneX, clamp, mulberry } from './core.js';

const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const $score = document.getElementById('score'), $sec = document.getElementById('sec');
const $over = document.getElementById('over'), $oscore = document.getElementById('oscore'), $obest = document.getElementById('obest');

const BEST_KEY = 'roll.best';
const SENS = 6;                     // world units per full screen-width drag
const SLAB = 0.35, VIEW = 46;       // track thickness, rows drawn ahead
const CAM_H = 4.6, CAM_BACK = 6.5, PITCH = 0.5;

// mode: 'ready' | 'play' | 'pause' | 'over'; the world has its own state inside a game
let mode = 'ready', world = new World(1), parts = [], flash = null;
let camZ = 0, camX = 0, camY = 0, keyDir = 0, overlayAt = 0;
let best = Number(localStorage.getItem(BEST_KEY)) || 0;

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
  if (world.state === 'run') {
    camZ = b.z - CAM_BACK;
    camY += (world.hAt(b.z) * 0.7 + world.hAt(b.z + 8) * 0.3 - camY) * Math.min(1, dt * 4);
    $score.textContent = world.score;
  }
  camX += (b.x * 0.5 - camX) * Math.min(1, dt * 5);
  if (flash && (flash.t -= dt * 0.8) <= 0) flash = null;
}

// ---- Rendering ----
let W, H, dpr, f, cy, stars;
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
  stars = document.createElement('canvas'); stars.width = W; stars.height = H;
  const s = stars.getContext('2d'), rr = mulberry(7);
  for (let n = 0; n < W * H / 3000; n++) {
    s.globalAlpha = 0.2 + rr() * 0.6; s.fillStyle = '#fff';
    s.beginPath(); s.arc(rr() * W, rr() * H, (0.4 + rr() * 1.1) * dpr, 0, 7); s.fill();
  }
}

const BG = [5, 6, 13];
function hsl(h, s, l, fog) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const c = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const rgb = [c(0), c(8), c(4)].map((v, i) => Math.round(v * 255 * (1 - fog) + BG[i] * fog));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}
const secHue = (s) => (205 + s * 47) % 360;

function quad(a, b, c, d, color) {
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
  ctx.closePath(); ctx.fill();
}

function drawRow(rz) {
  const track = world.track, row = track.get(rz), zA = Math.max(rz, camZ + 0.4), zB = rz + 1;
  if (zB <= zA) return;
  const hA = world.hAt(zA), hB = track.get(rz + 1).h, slope = hB - row.h;
  const fog = clamp(((zA + zB) / 2 - camZ - 12) / (VIEW - 12), 0, 1);
  const hue = secHue(row.sec), prev = rz > 0 ? track.get(rz - 1) : null;
  const lit = slope * 22;   // uphill faces the camera and looks brighter
  for (let l = 0; l < LANES; l++) {
    if (!row.floor[l]) continue;
    const x0 = l - HALF, x1 = x0 + 1;
    if (l > 0 && !row.floor[l - 1] && camX < x0)
      quad(proj(x0, hA, zA), proj(x0, hB, zB), proj(x0, hB - SLAB, zB), proj(x0, hA - SLAB, zA), hsl(hue, 35, 16, fog));
    if (l < LANES - 1 && !row.floor[l + 1] && camX > x1)
      quad(proj(x1, hA, zA), proj(x1, hB, zB), proj(x1, hB - SLAB, zB), proj(x1, hA - SLAB, zA), hsl(hue, 35, 16, fog));
    if (zA === rz && (!prev || !prev.floor[l]))
      quad(proj(x0, hA, rz), proj(x1, hA, rz), proj(x1, hA - SLAB, rz), proj(x0, hA - SLAB, rz), hsl(hue, 35, 20, fog));
    quad(proj(x0, hA, zA), proj(x1, hA, zA), proj(x1, hB, zB), proj(x0, hB, zB),
      hsl(hue, 42, clamp(((l + rz) & 1 ? 31 : 36) + lit, 12, 60), fog));
  }
  if (rz > 0 && rz % SEC_ROWS === 0 && zA === rz) {   // section start line
    ctx.globalAlpha = 1 - fog;
    const h2 = world.hAt(rz + 0.15);
    quad(proj(-HALF, hA + 0.01, rz), proj(HALF, hA + 0.01, rz), proj(HALF, h2 + 0.01, rz + 0.15), proj(-HALF, h2 + 0.01, rz + 0.15), '#fff');
    ctx.globalAlpha = 1;
  }
  const order = [0, 1, 2, 3, 4].sort((a, b) => Math.abs(laneX(b) - camX) - Math.abs(laneX(a) - camX));
  for (const l of order) {
    if (!row.ramp[l]) continue;
    const x0 = l - HALF + 0.06, x1 = l - HALF + 1 - 0.06, rA = RAMP_H * (zA - rz);
    if (camX < x0) quad(proj(x0, hA, zA), proj(x0, hB, zB), proj(x0, hB + RAMP_H, zB), proj(x0, hA + rA, zA), hsl(hue, 25, 62, fog));
    if (camX > x1) quad(proj(x1, hA, zA), proj(x1, hB, zB), proj(x1, hB + RAMP_H, zB), proj(x1, hA + rA, zA), hsl(hue, 25, 62, fog));
    quad(proj(x0, hA + rA, zA), proj(x1, hA + rA, zA), proj(x1, hB + RAMP_H, zB), proj(x0, hB + RAMP_H, zB), hsl(hue, 30, 90, fog));
    for (const t of [0.3, 0.65]) {   // chevrons
      const za = rz + t, zb = za + 0.12;
      if (za < zA) continue;
      const ya = world.hAt(za) + RAMP_H * t + 0.005, yb = world.hAt(zb) + RAMP_H * (t + 0.12) + 0.005, xm = (x0 + x1) / 2;
      const p = [proj(x0 + 0.1, ya, za), proj(xm, ya, zb + 0.1), proj(x1 - 0.1, ya, za), proj(x1 - 0.1, yb, zb), proj(xm, yb, zb + 0.22), proj(x0 + 0.1, yb, zb)];
      ctx.fillStyle = hsl(hue, 70, 55, fog); ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]); for (const q of p.slice(1)) ctx.lineTo(q[0], q[1]);
      ctx.closePath(); ctx.fill();
    }
  }
  const bh = (hue + 170) % 360;
  for (const l of order) {
    if (!row.block[l]) continue;
    const x0 = l - HALF + INSET, x1 = l - HALF + 1 - INSET, z0 = rz + INSET, z1 = rz + 1 - INSET;
    if (z1 <= camZ + 0.4) continue;
    const za = Math.max(z0, camZ + 0.4), ba = world.hAt(za), bb = world.hAt(z1);
    if (camX < x0) quad(proj(x0, ba, za), proj(x0, bb, z1), proj(x0, bb + BOX_H, z1), proj(x0, ba + BOX_H, za), hsl(bh, 60, 40, fog));
    if (camX > x1) quad(proj(x1, ba, za), proj(x1, bb, z1), proj(x1, bb + BOX_H, z1), proj(x1, ba + BOX_H, za), hsl(bh, 60, 40, fog));
    if (za === z0) quad(proj(x0, ba, z0), proj(x1, ba, z0), proj(x1, ba + BOX_H, z0), proj(x0, ba + BOX_H, z0), hsl(bh, 62, 50, fog));
    quad(proj(x0, ba + BOX_H, za), proj(x1, ba + BOX_H, za), proj(x1, bb + BOX_H, z1), proj(x0, bb + BOX_H, z1), hsl(bh, 65, 63, fog));
  }
}

function drawBall() {
  const b = world.ball;
  if (world.state === 'crash' || world.state === 'over') return;
  const g = world.state === 'fall' ? null : world.groundAt(b.x, b.z);
  if (g !== null) {   // the shadow shows where a jump lands
    const s = proj(b.x, g, b.z), up = b.y - R - g;
    ctx.fillStyle = `rgba(0,0,0,${0.38 * clamp(1 - up / 3, 0.25, 1)})`;
    ctx.beginPath(); ctx.ellipse(s[0], s[1], R * 1.15 * s[2], R * 0.45 * s[2], 0, 0, 7); ctx.fill();
  }
  const [px, py, sc] = proj(b.x, b.y, b.z), r = R * sc;
  const gr = ctx.createRadialGradient(px - r * 0.35, py - r * 0.4, r * 0.1, px, py, r);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.7, '#d8dcf0'); gr.addColorStop(1, '#8a90b0');
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
  const a = b.roll % (Math.PI * 2), o = Math.cos(a);   // a band that rolls with the ball
  if (Math.sin(a) > 0) {
    ctx.save(); ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.clip();
    ctx.strokeStyle = 'rgba(90,100,150,.55)'; ctx.lineWidth = r * 0.22;
    ctx.beginPath(); ctx.ellipse(px, py - o * r * 0.85, r, r * 0.25 * Math.sin(a), 0, 0, Math.PI); ctx.stroke();
    ctx.restore();
  }
}

function draw() {
  ctx.fillStyle = '#05060d'; ctx.fillRect(0, 0, W, H);
  const sx = (-camX * 6 * dpr) % W;
  ctx.drawImage(stars, sx, 0); ctx.drawImage(stars, sx + (sx > 0 ? -W : W), 0);
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
    ctx.fillStyle = '#e8ebf8'; ctx.beginPath(); ctx.arc(px, py, R * 0.32 * sc, 0, 7); ctx.fill();
  }
  if (flash) {
    ctx.globalAlpha = Math.min(1, flash.t * 1.5);
    ctx.fillStyle = hsl(secHue(flash.sec), 70, 75, 0);
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
