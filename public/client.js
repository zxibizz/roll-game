// The page: draws the world from core.js in a hand-rolled perspective, reads the finger / mouse / keys and runs the
// screens around the game: home, pause, results, settings. The road is grass and earth; the sky goes from day to
// night to space with the distance. There are no words in the interface, only numbers and icons.
import { World, VERSION, LANES, HALF, SEC_ROWS, R, INSET, BOX_H, RAMP_H, CAM_H, CAM_BACK, laneX, clamp, mulberry } from './core.js';
import { initAudio, applyVolume, setHum, sfx, haptic, canHaptic } from './audio.js';

const $ = (id) => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
const $hud = $('hud'), $score = $('score'), $starN = $('starN'), $hudStars = $('hudStars'), $hint = $('hint');
const $home = $('home'), $pause = $('pause'), $over = $('over'), $set = $('set');
$('ver').textContent = 'v' + VERSION;   // small, on the home screen: which version runs

const SENS = 3.2;                   // lanes per full screen-width drag: one lane takes about a third of the screen
const SLAB = 0.35, VIEW = 46;       // track thickness, rows drawn ahead
const PITCH = 0.5;
const CAM_FOLLOW = 0.6;             // how much of the ball's sideways move the camera repeats
const COUNT_T = 0.55;               // seconds per digit of the 3-2-1 before a paused run goes on

// ---- What the device remembers ----
// roll.save: settings and progress; roll.run: a run in progress (see saveRun)
const SAVE_KEY = 'roll.save', RUN_KEY = 'roll.run';
const read = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const save = { vol: 0.5, music: 0.4, haptic: true, skin: 'coral', stars: 0, best: 0, runs: 0, ...read(SAVE_KEY) };
if (!(save.best > 0)) save.best = Number(read('roll.best')) || 0;   // the record of versions before 0.5
for (const k of ['vol', 'music']) save[k] = clamp(Number(save[k]) || 0, 0, 1);
for (const k of ['stars', 'best', 'runs']) save[k] = Math.max(0, Math.floor(Number(save[k]) || 0));
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private mode: play on without saving */ } };

// Balls: smooth and glossy, they differ in colour only. `need` — stars collected over all runs that open one.
const SKINS = [
  { id: 'coral', need: 0, c: ['#fff1e6', '#ff8a5c', '#cf4b25'], glow: [255, 140, 90] },
  { id: 'sky', need: 50, c: ['#f0faff', '#4fb4ff', '#1867c9'], glow: [90, 170, 255] },
  { id: 'rose', need: 150, c: ['#fff0f6', '#ff6fa5', '#c42b6b'], glow: [255, 120, 170] },
  { id: 'sun', need: 300, c: ['#fffde6', '#ffd84a', '#e08e00'], glow: [255, 215, 90] },
  { id: 'violet', need: 500, c: ['#f8eaff', '#b56cff', '#6a2bc4'], glow: [190, 120, 255] },
  { id: 'pearl', need: 800, c: ['#ffffff', '#ebe6f7', '#a79fc4'], glow: [230, 225, 255] },
  { id: 'night', need: 1200, c: ['#c3cdf0', '#3b4466', '#10131f'], glow: [120, 140, 255] },
  { id: 'ruby', need: 1800, c: ['#ffe3e3', '#e0193a', '#7a0018'], glow: [255, 70, 90], sparkle: true },
];
const skinOpen = (k) => save.stars >= k.need;
let skinAt = Math.max(0, SKINS.findIndex((k) => k.id === save.skin && skinOpen(k)));   // the ball that plays
let skinView = skinAt;                                                               // the ball on show on the home screen

// mode: 'home' | 'play' | 'count' (3-2-1 after a pause) | 'pause' | 'over' (and 'shot' — frozen by the screenshot
// hook at the end); the world has its own state inside a game
let mode = 'home', world = new World(1), parts = [], rings = [], flash = null;
let camZ = 0, camX = 0, camL = 0, camY = 0, keyDir = 0;   // camL: the camera across the road
let shake = 0, squash = 0, hitStop = 0, count = 0, beatBest = false, overAnim = null, hintUntil = 0;

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
        const cx = wrap(rr() * 1.6 * W - camX * (2 + n) * dpr + now() * (1.5 + n * 0.4) * dpr, W * 1.6) - 0.3 * W, cy = horY + (rr() - 0.65) * H * 0.5, s = (0.05 + rr() * 0.06) * W;
        ctx.globalAlpha = P.clouds * (cy > horY ? 0.55 : 0.85); ctx.fillStyle = css(P.cloudC);
        for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(cx + (k - 1.5) * s * 0.7, cy - (k % 2) * s * 0.25, s * 0.6, s * 0.38, 0, 0, 7); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }
  },
  get ball() { return SKINS[mode === 'home' ? skinView : skinAt]; },
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
    document.body.classList.toggle('dark', !dark);
  }
}

// ---- Game flow ----
function setMode(m) {
  mode = m;
  $home.hidden = m !== 'home'; $pause.hidden = m !== 'pause'; $over.hidden = m !== 'over';
  $hud.hidden = m === 'home' || m === 'shot';
  if (m !== 'play') { $hint.hidden = true; setHum(0, false); }
}

function resetView() {
  banked = null;
  parts = []; rings = []; flash = null; shake = 0; squash = 0; hitStop = 0; beatBest = false;
  $score.textContent = world.score; $score.style.color = ''; $starN.textContent = world.stars;
  follow();
}

function goHome() {
  bankRun();
  if (reloadWanted) { location.reload(); return; }
  world = new World(1); skinView = skinAt;
  resetView(); setMode('home'); showHome();
}

function showHome() {
  const k = SKINS[skinView], open = skinOpen(k);
  if (open && skinAt !== skinView) { skinAt = skinView; save.skin = k.id; persist(); }
  $('bank').textContent = save.stars; $('bestN').textContent = save.best;
  $('homeBest').hidden = !save.best;
  $('lock').hidden = open; $('lockN').textContent = `${save.stars}/${k.need}`;
  $('dots').innerHTML = SKINS.map((x, i) => `<i class="${i === skinView ? 'on' : ''} ${skinOpen(x) ? '' : 'locked'}"></i>`).join('');
}

function startGame() {
  bankRun();
  if (reloadWanted) { location.reload(); return; }
  world = new World(2 + ((Math.random() * 1e9) | 0));
  resetView(); setMode('play');
  save.runs++; persist();
  if (save.runs <= 3) { $hint.hidden = false; hintUntil = performance.now() + 4000; }   // a hand shows the swipe
}

function pause() {
  if (mode !== 'play' && mode !== 'count') return;
  saveRun();
  $('pauseScore').textContent = world.score; $('pauseStars').textContent = world.stars;
  setMode('pause');
}

// a paused run goes on after 3-2-1: at speed there is no time to find the ball again
function resume() {
  if (mode !== 'pause') return;
  $set.hidden = true;
  clearRun();   // from here on the stored run is out of date; hiding or pausing stores it afresh
  count = COUNT_T * 3; setMode('count'); sfx.count(false);
}

// The run is over (the ball died, or the player left it from the pause): its stars go to the bank, its score may be
// the new record, the stored copy goes. Done once per run, at the moment it ends — not after the last animation,
// which the player may never see.
let banked = null;
function bankRun() {
  if (banked || world.seed === 1) return banked;   // seed 1 is the scene behind the home screen
  const s = world.score, was = save.stars, isBest = s > save.best;
  save.stars += world.stars;
  if (isBest) save.best = s;
  persist(); clearRun();
  banked = { s, isBest, stars: world.stars, fresh: SKINS.filter((k) => k.need > was && k.need <= save.stars) };
  return banked;
}

function gameOver() {
  const { s, isBest, stars, fresh } = bankRun();
  $('overCard').classList.toggle('best', isBest); $('newBest').hidden = !isBest;
  $('overBest').textContent = save.best; $('overStars').textContent = '+' + stars;
  $('unlock').hidden = !fresh.length;
  $('unlock').innerHTML = fresh.map((k) => `<i style="background:radial-gradient(circle at 35% 30%, ${k.c[0]}, ${k.c[1]} 60%, ${k.c[2]})"></i>`).join('');
  $('overScore').textContent = '0'; overAnim = { t: 0, to: s };
  $('overActs').classList.add('wait');   // a stray tap right after a crash must not restart or leave
  setTimeout(() => $('overActs').classList.remove('wait'), 600);
  setMode('over');
  if (isBest) { setTimeout(() => { if (mode === 'over') { sfx.best(); haptic('best'); } }, 800); } else sfx.over();
  if (fresh.length) sfx.unlock();
}

// A run in progress survives the game being closed or unloaded by the phone: it is stored when paused or hidden and
// opens on pause the next time. The track comes back from its seed.
function saveRun() {
  if (banked || world.state !== 'run' || (mode !== 'play' && mode !== 'count' && mode !== 'pause')) return;
  try { localStorage.setItem(RUN_KEY, JSON.stringify({ ...world.toSave(), game: VERSION })); } catch { /* */ }
}
function clearRun() { try { localStorage.removeItem(RUN_KEY); } catch { /* */ } }
function restoreRun() {
  const o = read(RUN_KEY), w = o && o.game === VERSION ? World.fromSave(o) : null;
  if (!w) {
    // a run of another version can't go on (the same seed may build another track): keep what it earned
    if (o && o.ball) {
      save.stars += clamp(Math.floor(o.stars) || 0, 0, 1e5);
      save.best = Math.max(save.best, clamp(Math.floor(o.ball.z) || 0, 0, 1e6));
      persist();
    }
    clearRun();
    return false;
  }
  world = w; resetView();
  $('pauseScore').textContent = world.score; $('pauseStars').textContent = world.stars;
  setMode('pause');
  return true;
}

function spray(n, at, make) {
  for (let k = 0; k < n && parts.length < 160; k++) parts.push({ x: at.x, y: at.y, z: at.z, t: 0, ...make(k) });
}
const rnd = (a, b) => a + Math.random() * (b - a);

function onEvent(e) {
  const b = world.ball, skin = theme.ball;
  if (e === 'section') {
    flash = { sec: world.sec, t: 1 }; sfx.section(); haptic('section');
  } else if (e === 'star') {
    sfx.star();
    $starN.textContent = world.stars;
    $hudStars.classList.remove('pop'); void $hudStars.offsetWidth; $hudStars.classList.add('pop');
    spray(5, b, () => ({ vx: rnd(-1.6, 1.6), vy: rnd(1.5, 4), vz: world.v + rnd(-1, 1), g: 7, life: rnd(0.25, 0.45), size: rnd(0.02, 0.04), color: '#fff3b0' }));
  } else if (e === 'jump') sfx.jump();
  else if (e === 'land') {
    const k = world.impact;
    sfx.land(k); haptic('land');
    squash = Math.max(squash, 0.35 * k); shake = Math.max(shake, 0.25 * k);
    const dust = pal('soil', 18);
    spray(Math.round(4 + 8 * k), { x: b.x, y: b.y - R, z: b.z }, () => ({ vx: rnd(-2.2, 2.2), vy: rnd(0.3, 1.6), vz: world.v * 0.6 + rnd(-1, 2), g: 3, life: rnd(0.3, 0.6), size: rnd(0.08, 0.16), color: dust, grow: 1.5 }));
  } else if (e === 'crash') {
    bankRun();
    sfx.crash(); haptic('crash');
    shake = 1; hitStop = 0.07; rings.push({ x: b.x, y: b.y, z: b.z + R, t: 0 });
    spray(26, b, (k) => ({ vx: rnd(-5, 5), vy: rnd(1, 7), vz: rnd(-3, 4), g: 18, life: rnd(0.6, 1.1), size: rnd(0.03, 0.065), color: skin.c[k % 3 === 0 ? 0 : 1] }));
  } else if (e === 'fall') { bankRun(); sfx.fall(); haptic('fall'); }
  else if (e === 'over') gameOver();
}

function update(dt) {
  if (overAnim) {   // the score on the results card counts up
    overAnim.t = Math.min(1, overAnim.t + dt / 0.7);
    $('overScore').textContent = Math.round(overAnim.to * (1 - (1 - overAnim.t) ** 3));
    if (overAnim.t >= 1) overAnim = null;
  }
  if (mode === 'pause' || mode === 'shot') return;
  for (const p of parts) { p.t += dt; p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
  parts = parts.filter((p) => p.t < p.life);
  for (const r of rings) r.t += dt;
  rings = rings.filter((r) => r.t < 0.45);
  shake = Math.max(0, shake - dt * 3.5); squash = Math.max(0, squash - dt * 2.2);
  if (flash && (flash.t -= dt * 0.8) <= 0) flash = null;
  if (mode === 'count') {
    const was = Math.ceil(count / COUNT_T);
    count -= dt;
    if (count <= 0) setMode('play');
    else if (Math.ceil(count / COUNT_T) !== was) sfx.count(Math.ceil(count / COUNT_T) === 1);
    return;
  }
  if (mode !== 'play') return;
  if (hitStop > 0) { hitStop -= dt; return; }   // the world holds its breath for a moment on impact
  const b = world.ball;
  if (keyDir) b.tx = clamp(b.x + keyDir, -HALF - 0.9, HALF + 0.9);
  world.step(dt);
  const events = world.events.splice(0);
  for (const e of events) onEvent(e);
  follow();
  if (world.state === 'run') {
    $score.textContent = world.score;
    if (!beatBest && save.best > 0 && world.score > save.best) { beatBest = true; $score.style.color = '#ffc107'; sfx.best(); }
  }
  if (!$hint.hidden && performance.now() > hintUntil) $hint.hidden = true;
  setHum(world.v / 24, world.state === 'run' && !b.air);
}

// the camera follows the ball
function follow() {
  const b = world.ball;
  if (world.state === 'run') {
    camZ = b.z - CAM_BACK;
    // never below the road under the ball (the generator counts on that to know what can be seen);
    // a little higher when the road ahead climbs, to look over the crest
    camY = world.hAt(b.z) + Math.max(0, world.hAt(b.z + 6) - world.hAt(b.z)) * 0.3;
  }
  // Sideways the camera moves rigidly with the ball, part of the way: a lagging camera made the ball run past the
  // finger on screen and drift back once the camera caught up. On a narrow screen it repeats more of the move, so
  // the ball never leaves the screen in the outer lanes.
  const room = Math.max(0, W / 2 / (f / BALL_ZC) - R * 1.7);
  camL = b.x - clamp(b.x * (1 - CAM_FOLLOW), -room, room);
  camX = world.offAt(b.z) + camL;   // the road bends: the camera goes along
}

// ---- Rendering ----
let W, H, dpr, f, cy, horY, stars;
const CP = Math.cos(PITCH), SP = Math.sin(PITCH);
const BALL_ZC = CAM_BACK * CP + CAM_H * SP;   // depth of the ball's contact point in camera space

function proj(x, y, z) {
  const dx = x + world.offAt(z) - camX, dy = y - camY - CAM_H, dz = z - camZ;   // x is across the road
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
  // the home screen places its arrows and the price round the ball in the scene
  const br = R * f / BALL_ZC / dpr;
  document.documentElement.style.setProperty('--ball-y', `${innerHeight * 0.84 - br}px`);
  document.documentElement.style.setProperty('--ball-r', `${br}px`);
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
const LEAVES = [[28, 85, 48], [15, 75, 40], [40, 90, 52], [5, 60, 34]];

// what the obstacles and the small things on the grass look like at a row: a normal meadow by day and at sunset,
// Halloween at night, an alien garden in space
function themeAt(rz) {
  const k = phaseAt(rz);
  return k < 1.6 ? 'meadow' : k < 2.6 ? 'spooky' : 'alien';
}

// the road edge waves a little instead of following the lane grid; `edge` numbers the lane boundary
const wave = (z, edge) => 0.09 * Math.sin(z * 1.3 + edge * 1.7) + 0.05 * Math.sin(z * 0.57 + edge * 2.9);

// a smooth closed shape through screen points
function blob(pts) {
  ctx.beginPath();
  for (let k = 0; k <= pts.length; k++) {
    const p = pts[k % pts.length], q = pts[(k + 1) % pts.length], m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (k === 0) ctx.moveTo(m[0], m[1]); else ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  ctx.closePath();
}

// part: 'ground' (grass, pits, little things), 'objects' (ramps, obstacles) or both
function drawRow(rz, part = 'all') {
  const track = world.track, row = track.get(rz), zA = Math.max(rz, camZ + 0.4), zB = rz + 1;
  if (zB <= zA) return;
  const next = track.get(rz + 1), prev = rz > 0 ? track.get(rz - 1) : null;
  const hA = world.hAt(zA), hB = next.h, slope = hB - row.h, dz = (zA + zB) / 2 - camZ;
  const fog = clamp((dz - 12) / (VIEW - 12), 0, 1);
  const lit = slope * 20 * P.litK;   // uphill faces the camera and looks brighter
  const px = proj(0, hA, (zA + zB) / 2)[2];   // pixels per world unit at this row
  const zM = (zA + zB) / 2, hM = world.hAt(zM), zE = zB + 0.02, hE = world.hAt(zE);
  const theme = themeAt(rz);
  if (part !== 'objects') {
  // grass over the whole road, holes included (the pits are dug into it below); outer edges wave
  for (let l = 0; l < LANES; l++) {
    if (!row.road[l]) continue;
    const leftEdge = l === 0 || !row.road[l - 1], rightEdge = l === LANES - 1 || !row.road[l + 1];
    const xl = (z) => l - HALF - (leftEdge ? wave(z, l) : 0.01), xr = (z) => l - HALF + 1 + (rightEdge ? wave(z, l + 1) : 0.01);
    const patch = (hash(rz, l) - 0.5) * 3 * clamp((dz - 4) / 8, 0.1, 1) * Math.min(1, P.grass[2] / 50);   // dark grass shows squares
    ctx.fillStyle = pal('grass', lit + patch, fog);
    path([proj(xl(zA), hA, zA), proj(xr(zA), hA, zA), proj(xr(zM), hM, zM), proj(xr(zE), hE, zE), proj(xl(zE), hE, zE), proj(xl(zM), hM, zM)]);
    ctx.fill();
    const w = Math.max(1, px * 0.025);
    for (const [on, xf] of [[leftEdge, xl], [rightEdge, xr]]) {
      if (!on) continue;
      ctx.globalAlpha = 1 - fog * 0.7; ctx.strokeStyle = pal('tuft', 0, fog); ctx.lineWidth = w;
      ctx.beginPath(); const a = proj(xf(zA), hA, zA), m = proj(xf(zM), hM, zM), b = proj(xf(zB), hB, zB);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(m[0], m[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // where the road starts after void, a cut of earth faces the camera
    if (zA === rz && (!prev || !prev.road[l]))
      quad(proj(xl(rz), hA, rz), proj(xr(rz), hA, rz), proj(xr(rz), hA - SLAB, rz), proj(xl(rz), hA - SLAB, rz), pal('soil', 0, fog));
  }
  // pits dug into the grass: a ragged opening, earthen walls going down into the dark
  for (let l = 0; l < LANES; l++) if (row.road[l] && !row.floor[l]) drawPit(rz, l, row, prev, next, fog, px);
  if (dz < 22) drawDecor(rz, row, zA, px, fog, theme);
  if (rz > 0 && rz % SEC_ROWS === 0 && zA === rz) {   // section start line, like chalk on the grass
    ctx.globalAlpha = 0.6 * (1 - fog);
    const h2 = world.hAt(rz + 0.12);
    for (let l = 0; l < LANES; l++) {
      if (!row.road[l] || !row.floor[l]) continue;
      quad(proj(l - HALF, hA + 0.01, rz), proj(l - HALF + 1, hA + 0.01, rz), proj(l - HALF + 1, h2 + 0.01, rz + 0.12), proj(l - HALF, h2 + 0.01, rz + 0.12), '#fff');
    }
    ctx.globalAlpha = 1;
  }
  }
  if (part === 'ground') return;
  const order = [...Array(LANES).keys()].sort((a, b) => Math.abs(laneX(b) - (camX - world.offAt(rz))) - Math.abs(laneX(a) - (camX - world.offAt(rz))));
  const camL = camX - world.offAt(rz + 0.5);   // the camera's place across this row
  for (const l of order) {   // wooden ramps
    if (!row.ramp[l]) continue;
    const x0 = l - HALF + 0.06, x1 = l - HALF + 1 - 0.06, rA = RAMP_H * (zA - rz);
    if (camL < x0) quad(proj(x0, hA, zA), proj(x0, hB, zB), proj(x0, hB + RAMP_H, zB), proj(x0, hA + rA, zA), pal('woodDark', 0, fog));
    if (camL > x1) quad(proj(x1, hA, zA), proj(x1, hB, zB), proj(x1, hB + RAMP_H, zB), proj(x1, hA + rA, zA), pal('woodDark', 0, fog));
    quad(proj(x0, hA + rA, zA), proj(x1, hA + rA, zA), proj(x1, hB + RAMP_H, zB), proj(x0, hB + RAMP_H, zB), pal('wood', 0, fog));
    for (const t of [0.25, 0.5, 0.75]) {   // planks
      const z = rz + t;
      if (z < zA) continue;
      const y = world.hAt(z) + RAMP_H * t + 0.005;
      line(proj(x0, y, z), proj(x1, y, z), pal('woodDark', 0, fog), Math.max(1, px * 0.02), 1 - fog);
    }
    line(proj(x0, hB + RAMP_H, zB), proj(x1, hB + RAMP_H, zB), pal('wood', 16, fog), Math.max(1, px * 0.03), 1 - fog);
  }
  // obstacles: the same box for hitting, drawn as whatever fits the theme; a full wall is all one kind
  const wall = row.road.every((on, l) => !on || row.block[l]);
  for (const l of order) {
    if (!row.block[l] || rz + 0.5 <= camZ + 0.9) continue;
    const o = obstacleFrame(l, rz);
    if (!(o.hw > 0 && o.bottom > o.top)) continue;
    const pick = hash(rz, wall ? 0 : l, 7), seed = hash(rz, l, 8);
    const kinds = OBSTACLES[theme];
    kinds[Math.floor(pick * kinds.length)](o, seed, fog, rz, l);
  }
  if (rz + 0.5 > camZ + 0.9) for (const l of order) if (row.star[l]) drawStar(l, rz, row.star[l], fog);
}

// a star turns and bobs over the road (or hangs along the flight over a jump)
const STAR_PTS = Array.from({ length: 10 }, (_, k) => {
  const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 0.45 : 1;
  return [Math.cos(a) * r, Math.sin(a) * r];
});
function drawStar(l, rz, s, fog) {
  const zc = rz + 0.5, t = now(), y = world.hAt(zc) + R + s - 1 + Math.sin(t * 3 + rz) * 0.04;
  const [x, py, sc] = proj(laneX(l), y, zc), r = 0.19 * sc;
  if (!(sc > 0)) return;
  const a = 1 - fog * 0.85;
  if (r < 2.5) { ctx.globalAlpha = a; ctx.fillStyle = '#ffd84a'; ctx.beginPath(); ctx.arc(x, py, Math.max(1, r), 0, 7); ctx.fill(); ctx.globalAlpha = 1; return; }
  halo(x, py, r * 2.4, 'rgba(255,214,90,1)', 0.3 * a * (0.6 + P.glow));
  const turn = Math.cos(t * 2.4 + rz * 0.7), w = Math.max(0.12, Math.abs(turn));
  ctx.save(); ctx.translate(x, py); ctx.scale(w, 1); ctx.globalAlpha = a;
  ctx.beginPath(); STAR_PTS.forEach(([u, v], k) => (k ? ctx.lineTo(u * r, v * r) : ctx.moveTo(u * r, v * r))); ctx.closePath();
  ctx.fillStyle = turn > 0 ? '#ffd84a' : '#f5b921'; ctx.fill();
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, r * 0.14); ctx.strokeStyle = '#d99100'; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(-r * 0.2, -r * 0.25, r * 0.22, 0, 7); ctx.fill();
  ctx.restore();
}

const PIT_DEPTH = 0.8;
// One pit cell. Towards grass its edge sits a varying, ragged distance in from the cell border (about the rim the
// ball can still roll on); towards another pit it reaches past the border, so pits merge; towards the void it stays
// on the border. Inside: a dark bottom, the far wall with layers of earth and roots, side walls in shadow, and grass
// hanging over the rim.
function drawPit(rz, l, row, prev, next, fog, px) {
  const kind = (dl, dr) => {
    const rr = dr < 0 ? prev : dr > 0 ? next : row, ll = l + dl;
    return !rr || ll < 0 || ll >= LANES || !rr.road[ll] ? 'void' : rr.floor[ll] ? 'grass' : 'pit';
  };
  const side = { L: kind(-1, 0), R: kind(1, 0), N: kind(0, -1), F: kind(0, 1) };
  // sideways the edge sits well in from the grass; along the road only a little, or a pit far ahead would be a slit
  const amp = 0.07 + hash(rz, l, 90) * 0.13, ampZ = 0.02 + hash(rz, l, 94) * 0.05, rough = 0.02 + hash(rz, l, 91) * 0.08;
  const bite = Math.floor(hash(rz, l, 92) * 16);
  const off = (s, k) => side[s] === 'grass' ? (s === 'N' || s === 'F' ? ampZ : amp) + (hash(rz * 5 + k, l, 93) - 0.5) * 2 * rough + (k === bite ? 0.07 : 0)
    : side[s] === 'pit' ? -0.08 : 0;
  // walk round the cell, four points a side: near (w = 0), right, far, left
  const ring = [];
  for (let k = 0; k < 4; k++) ring.push([k / 4, 0, 'N', k], [1, k / 4, 'R', 4 + k], [1 - k / 4, 1, 'F', 8 + k], [0, 1 - k / 4, 'L', 12 + k]);
  ring.sort((a, b) => a[3] - b[3]);
  const pts = ring.map(([u, w, s, k]) => {
    let uu = u, ww = w;
    if (u === 0) uu += off('L', k); if (u === 1) uu -= off('R', k);
    if (w === 0) ww += off('N', k); if (w === 1) ww -= off('F', k);
    if (k % 4) {   // points along a side wander a little, so no two pits look alike
      const t = (hash(rz, l, 100 + k) - 0.5) * 0.12;
      if (s === 'N' || s === 'F') uu += t; else ww += t;
    }
    return { x: l - HALF + uu, z: rz + ww, s };
  }).filter((p) => p.z > camZ + 0.4);
  if (pts.length < 3) return;
  const top = (p) => proj(p.x, world.hAt(p.z), p.z), down = (p) => proj(p.x, world.hAt(p.z) - PIT_DEPTH, p.z);
  const open = pts.map(top);
  const yTop = Math.min(...open.map((q) => q[1])), yBot = Math.max(...open.map((q) => q[1]));
  ctx.save();
  blob(open); ctx.clip();
  ctx.fillStyle = pal('pit', -2, fog); ctx.fillRect(Math.min(...open.map((q) => q[0])) - 2, yTop - 2, W, yBot - yTop + 4);
  const wall = (edge, light) => {   // a wall below one edge of the opening, its top lit, its foot in the dark
    if (edge.length < 2) return;
    const a = edge.map(top), b = edge.map(down).reverse();
    const y0 = Math.min(...a.map((q) => q[1])), y1 = Math.max(...b.map((q) => q[1]));
    const g = ctx.createLinearGradient(0, y0, 0, Math.max(y0 + 1, y1));
    g.addColorStop(0, pal('soil', light, fog)); g.addColorStop(0.18, pal('pitWall', light - 8, fog)); g.addColorStop(0.5, pal('pit', 2, fog)); g.addColorStop(1, pal('pit', -3, fog));
    ctx.fillStyle = g; path([...a, ...b]); ctx.fill();
    return a;
  };
  const camAcross = camX - world.offAt(rz + 0.5);
  const far = pts.filter((p) => p.s === 'F' || (p.z - rz > 0.6 && side.F === 'grass'));
  if (side.F === 'grass') {
    const a = wall(far.sort((p, q) => p.x - q.x), -4);
    if (a) {   // layers of earth and a few roots on the far wall
      ctx.globalAlpha = 0.5 * (1 - fog); ctx.strokeStyle = pal('soil', -10, fog); ctx.lineWidth = Math.max(1, px * 0.012);
      for (const d of [0.16, 0.36]) {
        ctx.beginPath();
        far.forEach((p, i) => { const q = proj(p.x, world.hAt(p.z) - d - (hash(rz, i, 110) - 0.5) * 0.04, p.z); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
        ctx.stroke();
      }
      ctx.strokeStyle = pal('woodDark', -8, fog); ctx.lineWidth = Math.max(1, px * 0.01);
      for (let k = 0; k < 3; k++) {
        const p = far[Math.floor(hash(rz, l, 120 + k) * far.length)], q0 = top(p), q1 = proj(p.x + (hash(rz, l, 125 + k) - 0.5) * 0.15, world.hAt(p.z) - 0.18 - hash(rz, l, 128 + k) * 0.2, p.z);
        ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.quadraticCurveTo(q0[0] + (q1[0] - q0[0]) * 1.4, (q0[1] + q1[1]) / 2, q1[0], q1[1]); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
  const leftX = Math.min(...pts.filter((p) => p.s === 'L').map((p) => p.x)), rightX = Math.max(...pts.filter((p) => p.s === 'R').map((p) => p.x));
  if (side.L === 'grass' && camAcross > leftX) wall(pts.filter((p) => p.s === 'L').sort((p, q) => q.z - p.z), -8);
  if (side.R === 'grass' && camAcross < rightX) wall(pts.filter((p) => p.s === 'R').sort((p, q) => q.z - p.z), -8);
  ctx.restore();
  // the rim: a dark lip and grass hanging over it, only where the pit meets grass
  const cx = open.reduce((s2, q) => s2 + q[0], 0) / open.length, cy = open.reduce((s2, q) => s2 + q[1], 0) / open.length;
  ctx.globalAlpha = 1 - fog;
  for (const [which, color, wdt] of [[(s2) => s2 === 'F', pal('grassHi', 8, fog), 0.03], [(s2) => s2 !== 'F', pal('grass', -16, fog), 0.022]]) {
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, px * wdt);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (side[pts[i].s] !== 'grass' || !which(pts[i].s)) continue;
      const a = open[i], b = open[(i + 1) % open.length];
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = pal('grass', -4, fog); ctx.lineWidth = Math.max(1, px * 0.01);
  ctx.beginPath();
  open.forEach((a, i) => {
    if (side[pts[i].s] !== 'grass' || hash(rz, l, 140 + i) < 0.4) return;
    const dx = cx - a[0], dy = cy - a[1], d = Math.hypot(dx, dy) || 1, len = px * (0.04 + hash(rz, l, 150 + i) * 0.05);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] + dx / d * len, a[1] + dy / d * len * 0.6 + len * 0.3);
  });
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// grass tufts and small things on plain ground near the camera: flowers by day, fallen leaves and glowing
// toadstools at night, glowing spores in space
function drawDecor(rz, row, zA, px, fog, theme) {
  const blades = [], bits = [];
  for (let l = 0; l < LANES; l++) {
    if (!row.road[l] || !row.floor[l] || row.block[l] || row.ramp[l]) continue;
    for (let k = 0; k < 4; k++) {
      const z = rz + 0.08 + hash(rz, l, 2 * k + 1) * 0.84;
      if (z < zA) continue;
      const x = l - HALF + 0.08 + hash(rz, l, 2 * k) * 0.84, p = proj(x, world.hAt(z), z);
      blades.push([p[0], p[1], p[2] * 0.06]);
    }
    const n = hash(rz, l, 99) < 0.3 ? 1 : hash(rz, l, 99) < 0.45 ? 2 : 0;
    for (let k = 0; k < n; k++) {
      const z = rz + 0.12 + hash(rz, l, 50 + k) * 0.76;
      if (z < zA) continue;
      const x = l - HALF + 0.12 + hash(rz, l, 60 + k) * 0.76;
      bits.push([proj(x, world.hAt(z) + 0.02, z), hash(rz, l, 70 + k)]);
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
  for (const [p, h] of bits) {
    const r = p[2] * 0.03;
    if (theme === 'meadow') drawFlower(p, r, FLOWERS[Math.floor(h * FLOWERS.length)], fog);
    else if (theme === 'spooky') {
      if (h < 0.75) {   // a fallen leaf
        const c = LEAVES[Math.floor(h * 4 / 0.75)];
        ctx.fillStyle = hsl(c[0], c[1], c[2], fog);
        ctx.beginPath(); ctx.ellipse(p[0], p[1], r * 1.6, r * 0.7, h * 9, 0, 7); ctx.fill();
      } else glowBit(p, r, [110, 90, 60], fog, true);   // a little glowing toadstool
    } else glowBit(p, r * 0.8, h < 0.5 ? [175, 90, 60] : [290, 85, 70], fog, false);
  }
}

function drawFlower(p, r, c, fog) {
  const petal = hsl(c[0], c[1], Math.min(97, c[2] * P.flowerL / 72), fog);
  if (P.glowF > 0.05) halo(p[0], p[1], r * 3, petal, 0.45 * P.glowF * (1 - fog));
  ctx.fillStyle = petal;
  if (r < 1.3) { ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(0.8, r * 1.4), 0, 7); ctx.fill(); return; }
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    const a = k * 1.2566;
    ctx.moveTo(p[0] + Math.cos(a) * r * 1.1 + r * 0.7, p[1] + Math.sin(a) * r * 0.55);
    ctx.arc(p[0] + Math.cos(a) * r * 1.1, p[1] + Math.sin(a) * r * 0.55, r * 0.7, 0, 7);
  }
  ctx.fill();
  ctx.fillStyle = hsl(45, 95, 55, fog); ctx.beginPath(); ctx.arc(p[0], p[1], r * 0.5, 0, 7); ctx.fill();
}

function halo(x, y, r, color, alpha) {
  if (!(r > 0) || alpha <= 0.01) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = alpha; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
}

function glowBit(p, r, c, fog, cap) {
  const col = hsl(c[0], c[1], c[2], fog * 0.5);
  halo(p[0], p[1] - r, r * 4, col, 0.5 * (1 - fog));
  if (cap) {
    ctx.fillStyle = hsl(30, 20, 70, fog); ctx.fillRect(p[0] - r * 0.25, p[1] - r * 1.2, r * 0.5, r * 1.2);
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(p[0], p[1] - r * 1.2, r * 0.9, r * 0.55, 0, Math.PI, 0); ctx.fill();
  } else { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p[0], p[1] - r, Math.max(0.8, r * 0.6), 0, 7); ctx.fill(); }
}

// where an obstacle sits on the screen: front-bottom centre, half width, top of the hit box, in pixels
function obstacleFrame(l, rz) {
  const xc = laneX(l), zc = rz + 0.5, base = world.hAt(zc);
  const pf = proj(xc, base, rz + INSET + 0.1), pt = proj(xc, base + BOX_H, zc);
  const hw = proj(xc + 0.42, base, rz + INSET + 0.1)[0] - pf[0];
  return { x: pf[0], bottom: pf[1], top: pt[1], hw, pc: proj(xc, base, zc) };
}
function shadowUnder(o, fog, k = 1) {
  ctx.fillStyle = `rgba(${P.shadow.map(Math.round)},${0.3 * (1 - fog)})`;
  ctx.beginPath(); ctx.ellipse(o.x, (o.bottom + o.pc[1]) / 2, o.hw * 1.15 * k, Math.max(1, (o.bottom - o.pc[1]) * 0.9), 0, 0, 7); ctx.fill();
}
const now = () => performance.now() / 1000;

// ---- obstacles: (frame, seed 0..1, fog, row, lane) ----
function rock(o, s, fog, rz, l) {
  shadowUnder(o, fog);
  // one stone or a heap of two or three; each its own width, height and lumpy outline
  const stones = s < 0.35 ? [[0, 1, 1]] : s < 0.7 ? [[-0.3, 0.75, 0.85], [0.35, 0.6, 0.65]] : [[-0.35, 0.6, 0.7], [0.32, 0.65, 0.8], [0, 0.45, 0.5]];
  for (const [dx, ws, hs] of stones) {
    const rx = o.hw * ws * (0.8 + hash(rz, l, 11) * 0.35), ry = (o.bottom - o.top) * 0.5 * hs * (0.75 + hash(rz, l, 12) * 0.5);
    const cx = o.x + dx * o.hw, cy = o.bottom - ry * 0.95, pts = [];
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2, j = 1 + (hash(rz * 7 + k, l, 20 + dx * 10) - 0.5) * 0.35;
      pts.push([cx + Math.cos(a) * rx * j, Math.min(o.bottom, cy + Math.sin(a) * ry * j)]);
    }
    const g = ctx.createRadialGradient(cx - rx * 0.35, cy - ry * 0.5, 0, cx, cy, Math.max(rx, ry) * 1.3);
    g.addColorStop(0, pal('rock', 16, fog)); g.addColorStop(0.55, pal('rock', 0, fog)); g.addColorStop(1, pal('rock', -22, fog));
    ctx.fillStyle = g; blob(pts); ctx.fill();
    if (ws > 0.7) {
      ctx.strokeStyle = pal('rock', -26, fog); ctx.lineWidth = Math.max(1, rx * 0.04); ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.moveTo(cx - rx * 0.1, cy - ry * 0.7); ctx.lineTo(cx + rx * 0.08, cy - ry * 0.2); ctx.lineTo(cx - rx * 0.12, cy + ry * 0.3); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

function bush(o, s, fog, rz, l) {
  shadowUnder(o, fog);
  const H = o.bottom - o.top, n = 4 + Math.floor(s * 4), tall = hash(rz, l, 13) < 0.3;
  const balls = [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1 || 1);
    const bx = (hash(rz, l, 30 + k) - 0.5) * (tall ? 0.9 : 1.6), by = tall ? 0.15 + t * 0.7 : 0.15 + hash(rz, l, 40 + k) * 0.45;
    balls.push([bx, by, (0.32 + hash(rz, l, 50 + k) * 0.25) * (tall ? 1 - t * 0.35 : 1)]);
  }
  balls.sort((a, b) => b[1] - a[1]);
  for (const [bx, by, br] of balls.reverse()) {
    const r = br * o.hw * 1.1, x = o.x + bx * o.hw, y = Math.min(o.bottom - r * 0.6, o.bottom - by * H * (tall ? 1.35 : 1));
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, 0, x, y, r);
    g.addColorStop(0, pal('bushHi', 0, fog)); g.addColorStop(0.7, pal('bush', 0, fog)); g.addColorStop(1, pal('bush', -8, fog));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  const c = FLOWERS[Math.floor(hash(rz, l, 60) * FLOWERS.length)];
  ctx.fillStyle = hsl(c[0], c[1], c[2], fog);
  for (let k = 0; k < 4; k++) {
    const x = o.x + (hash(rz, l, 61 + k) - 0.5) * o.hw * 1.3, y = o.bottom - (0.25 + hash(rz, l, 65 + k) * 0.6) * H;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, o.hw * 0.07), 0, 7); ctx.fill();
  }
}

function pumpkin(o, s, fog, rz, l) {
  shadowUnder(o, fog);
  const H = o.bottom - o.top, rx = o.hw * (0.75 + s * 0.2), ry = H * 0.4, cx = o.x, cy = o.bottom - ry;
  halo(cx, cy, rx * 2.4, 'rgba(255,150,40,1)', 0.25 * (1 - fog) * (P.glowF + 0.2));
  for (const [dx, w] of [[-0.45, 0.6], [0.45, 0.6], [0, 0.7]]) {   // three lobes
    const g = ctx.createRadialGradient(cx + dx * rx - rx * 0.2, cy - ry * 0.4, 0, cx + dx * rx, cy, rx * w * 1.2);
    g.addColorStop(0, hsl(32, 95, 60, fog)); g.addColorStop(1, hsl(22, 90, 34, fog));
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx + dx * rx, cy, rx * w, ry, 0, 0, 7); ctx.fill();
  }
  ctx.fillStyle = hsl(95, 50, 25, fog); ctx.fillRect(cx - rx * 0.07, cy - ry * 1.25, rx * 0.14, ry * 0.35);
  // a carved face with a flickering candle inside
  const t = now(), fl = 0.75 + 0.25 * Math.sin(t * 13 + s * 40) * Math.sin(t * 7.3 + s * 9);
  ctx.fillStyle = `rgba(255,${Math.round(190 + 50 * fl)},70,${(0.65 + 0.35 * fl) * (1 - fog)})`;
  ctx.beginPath();
  for (const ex of [-0.35, 0.35]) { ctx.moveTo(cx + ex * rx - rx * 0.13, cy - ry * 0.15); ctx.lineTo(cx + ex * rx + rx * 0.13, cy - ry * 0.15); ctx.lineTo(cx + ex * rx, cy - ry * 0.48); ctx.closePath(); }
  ctx.moveTo(cx - rx * 0.5, cy + ry * 0.15);
  for (let k = 0; k <= 6; k++) ctx.lineTo(cx - rx * 0.5 + k * rx / 6, cy + ry * (k % 2 ? 0.3 : 0.15));
  ctx.lineTo(cx + rx * 0.4, cy + ry * 0.5); ctx.lineTo(cx - rx * 0.4, cy + ry * 0.5); ctx.closePath();
  ctx.fill();
}

function grave(o, s, fog, rz, l) {
  shadowUnder(o, fog, 0.9);
  const H = (o.bottom - o.top) * (0.95 + s * 0.3), w = o.hw * (0.65 + s * 0.2), cx = o.x;
  ctx.save(); ctx.translate(cx, o.bottom); ctx.rotate((s - 0.5) * 0.25);
  const g = ctx.createLinearGradient(-w, -H, w, 0);
  g.addColorStop(0, hsl(230, 8, 62, fog)); g.addColorStop(1, hsl(230, 10, 32, fog));
  ctx.fillStyle = g; ctx.beginPath();
  ctx.moveTo(-w, 0); ctx.lineTo(-w, -H + w); ctx.arc(0, -H + w, w, Math.PI, 0); ctx.lineTo(w, 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = hsl(230, 10, 24, fog); ctx.lineWidth = Math.max(1, w * 0.12);   // an engraved cross
  ctx.beginPath(); ctx.moveTo(0, -H * 0.78); ctx.lineTo(0, -H * 0.38); ctx.moveTo(-w * 0.35, -H * 0.65); ctx.lineTo(w * 0.35, -H * 0.65); ctx.stroke();
  ctx.fillStyle = hsl(150, 30, 18, fog);   // moss at the foot
  ctx.beginPath(); ctx.ellipse(0, 0, w * 1.15, w * 0.22, 0, Math.PI, 0); ctx.fill();
  ctx.restore();
}

function deadTree(o, s, fog, rz, l) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 1.7, cx = o.x, col = hsl(280, 15, 9, fog * 0.6);
  ctx.strokeStyle = col; ctx.lineCap = 'round';
  const branch = (x, y, len, ang, wdt, depth) => {
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    ctx.lineWidth = Math.max(1, wdt); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    if (depth <= 0) return;
    const sp = 0.45 + hash(rz, l, depth * 5) * 0.35;
    branch(x2, y2, len * 0.68, ang - sp, wdt * 0.6, depth - 1);
    branch(x2, y2, len * 0.62, ang + sp * 0.9, wdt * 0.55, depth - 1);
  };
  branch(cx, o.bottom, H * 0.45, -Math.PI / 2 + (s - 0.5) * 0.3, o.hw * 0.32, 3);
  ctx.lineCap = 'butt';
  if (s > 0.5) {   // something looks out of the hollow
    const t = now(), blink = Math.sin(t * 1.3 + s * 20) > -0.9 ? 1 : 0;
    ctx.fillStyle = `rgba(255,220,80,${blink * (1 - fog)})`;
    for (const ex of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + ex * o.hw * 0.08, o.bottom - H * 0.25, Math.max(1, o.hw * 0.04), 0, 7); ctx.fill(); }
  }
}

function skeleton(o, s, fog, rz, l) {
  shadowUnder(o, fog, 0.7);
  const H = (o.bottom - o.top) * 1.35, cx = o.x, by = o.bottom, u = H / 10, t = now();
  const bone = hsl(45, 25, 88, fog * 0.6);
  ctx.strokeStyle = bone; ctx.fillStyle = bone; ctx.lineWidth = Math.max(1, u * 0.45); ctx.lineCap = 'round';
  const sway = Math.sin(t * 2 + s * 10) * u * 0.25;
  ctx.beginPath();
  ctx.moveTo(cx - u, by); ctx.lineTo(cx - u * 0.4, by - u * 4); ctx.moveTo(cx + u, by); ctx.lineTo(cx + u * 0.4, by - u * 4);   // legs
  ctx.moveTo(cx, by - u * 4); ctx.lineTo(cx + sway, by - u * 7.4);   // spine
  for (let k = 0; k < 3; k++) { const y = by - u * (5.6 + k * 0.6); ctx.moveTo(cx - u * 1.1 + sway, y); ctx.quadraticCurveTo(cx + sway, y + u * 0.5, cx + u * 1.1 + sway, y); }
  ctx.moveTo(cx - u * 1.4 + sway, by - u * 7.2); ctx.lineTo(cx - u * 1.9, by - u * 4.6);   // one arm hangs
  const wave = -1.2 + Math.sin(t * 5 + s * 20) * 0.5;   // the other one waves
  ctx.moveTo(cx + u * 1.4 + sway, by - u * 7.2); ctx.lineTo(cx + u * 1.4 + sway + Math.cos(wave) * u * 2.6, by - u * 7.2 + Math.sin(wave) * u * 2.6);
  ctx.stroke(); ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.arc(cx + sway, by - u * 8.6, u * 1.2, 0, 7); ctx.fill();   // skull
  ctx.fillStyle = hsl(260, 30, 8, fog * 0.6);
  for (const ex of [-0.45, 0.45]) { ctx.beginPath(); ctx.arc(cx + sway + ex * u, by - u * 8.7, u * 0.32, 0, 7); ctx.fill(); }
}

function zombie(o, s, fog, rz, l) {
  shadowUnder(o, fog, 0.8);
  const H = (o.bottom - o.top) * 1.4, u = H / 10, t = now(), sway = Math.sin(t * 1.8 + s * 12) * u * 0.6;
  const cx = o.x + sway, by = o.bottom;
  ctx.fillStyle = hsl(250, 25, 22, fog * 0.6);   // legs
  ctx.fillRect(cx - u * 1.1, by - u * 4, u * 0.9, u * 4); ctx.fillRect(cx + u * 0.2, by - u * 4 + Math.abs(sway) * 0.5, u * 0.9, u * 4);
  ctx.fillStyle = hsl(15 + s * 30, 30, 28, fog * 0.6);   // a torn shirt
  ctx.beginPath(); ctx.moveTo(cx - u * 1.5, by - u * 7.5); ctx.lineTo(cx + u * 1.5, by - u * 7.5); ctx.lineTo(cx + u * 1.3, by - u * 3.6);
  ctx.lineTo(cx + u * 0.5, by - u * 4.1); ctx.lineTo(cx - u * 0.2, by - u * 3.6); ctx.lineTo(cx - u * 1.3, by - u * 4); ctx.closePath(); ctx.fill();
  const skin = hsl(95, 30, 45, fog * 0.6);
  ctx.strokeStyle = skin; ctx.lineWidth = Math.max(1, u * 0.7); ctx.lineCap = 'round';   // arms reach forward
  const reach = Math.sin(t * 3 + s * 7) * u * 0.4;
  ctx.beginPath(); ctx.moveTo(cx - u * 1.3, by - u * 7); ctx.lineTo(cx - u * 1.7, by - u * 5.6 + reach); ctx.moveTo(cx + u * 1.3, by - u * 7); ctx.lineTo(cx + u * 1.7, by - u * 5.6 - reach); ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = skin; ctx.beginPath(); ctx.ellipse(cx, by - u * 8.6, u * 1.15, u * 1.3, sway * 0.05, 0, 7); ctx.fill();
  ctx.fillStyle = `rgba(255,60,40,${1 - fog})`;
  for (const ex of [-0.45, 0.45]) { ctx.beginPath(); ctx.arc(cx + ex * u, by - u * 8.7, u * 0.22, 0, 7); ctx.fill(); }
}

function crystal(o, s, fog, rz, l) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 1.2, t = now(), pulse = 0.75 + 0.25 * Math.sin(t * 2.5 + s * 20);
  const hue = s < 0.5 ? 180 : 290;
  halo(o.x, o.bottom - H * 0.4, o.hw * 2.2, hsl(hue, 90, 60), 0.35 * pulse * (1 - fog));
  for (const [dx, hh, w, tilt] of [[-0.45, 0.6, 0.22, -0.35], [0.4, 0.7, 0.24, 0.3], [0, 1, 0.3, 0.05]]) {
    const bx = o.x + dx * o.hw, ty = o.bottom - H * hh, tx = bx + tilt * H * hh * 0.3, ww = w * o.hw;
    const g = ctx.createLinearGradient(bx - ww, 0, bx + ww, 0);
    g.addColorStop(0, hsl(hue, 80, 75, fog)); g.addColorStop(0.5, hsl(hue, 85, 55, fog)); g.addColorStop(1, hsl(hue + 20, 80, 30, fog));
    ctx.fillStyle = g; ctx.beginPath();
    ctx.moveTo(bx - ww, o.bottom); ctx.lineTo(tx - ww * 0.8, ty + ww); ctx.lineTo(tx, ty); ctx.lineTo(tx + ww * 0.8, ty + ww); ctx.lineTo(bx + ww, o.bottom); ctx.closePath(); ctx.fill();
  }
}

function mushroom(o, s, fog, rz, l) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 1.1, t = now(), pulse = 0.7 + 0.3 * Math.sin(t * 1.7 + s * 15), hue = 140 + s * 200;
  ctx.fillStyle = hsl(60, 20, 75, fog);
  ctx.beginPath(); ctx.moveTo(o.x - o.hw * 0.18, o.bottom); ctx.quadraticCurveTo(o.x - o.hw * 0.05, o.bottom - H * 0.4, o.x - o.hw * 0.12, o.bottom - H * 0.65);
  ctx.lineTo(o.x + o.hw * 0.12, o.bottom - H * 0.65); ctx.quadraticCurveTo(o.x + o.hw * 0.05, o.bottom - H * 0.4, o.x + o.hw * 0.18, o.bottom); ctx.closePath(); ctx.fill();
  const cy = o.bottom - H * 0.62;
  halo(o.x, cy, o.hw * 2, hsl(hue, 90, 60), 0.4 * pulse * (1 - fog));
  const g = ctx.createRadialGradient(o.x - o.hw * 0.3, cy - H * 0.3, 0, o.x, cy, o.hw);
  g.addColorStop(0, hsl(hue, 90, 75, fog)); g.addColorStop(1, hsl(hue, 80, 35, fog));
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(o.x, cy, o.hw * 0.95, H * 0.38, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = `rgba(255,255,255,${0.7 * pulse * (1 - fog)})`;
  for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(o.x + (hash(rz, l, 80 + k) - 0.5) * o.hw * 1.2, cy - (0.1 + hash(rz, l, 84 + k) * 0.6) * H * 0.35, Math.max(1, o.hw * 0.07), 0, 7); ctx.fill(); }
}

const OBSTACLES = {
  meadow: [rock, bush, rock, bush],
  spooky: [pumpkin, grave, deadTree, skeleton, zombie],
  alien: [crystal, mushroom],
};

function drawBall() {
  const b = world.ball, T = theme.ball;
  if (world.state === 'crash' || world.state === 'over') return;
  const g = world.state === 'fall' ? null : world.groundAt(b.x, b.z);
  if (g !== null) {   // the shadow shows where a jump lands
    const s = proj(b.x, g, b.z), up = b.y - R - g, c = theme.shadow;
    ctx.fillStyle = `rgba(${c},${0.38 * clamp(1 - up / 3, 0.25, 1)})`;
    ctx.beginPath(); ctx.ellipse(s[0], s[1], R * 1.15 * s[2], R * 0.45 * s[2], 0, 0, 7); ctx.fill();
  }
  const [px, py0, sc] = proj(b.x, b.y, b.z), r = R * sc;
  if (!(sc > 0) || !Number.isFinite(px + py0 + r)) return;   // behind the camera: nothing to draw
  // a landing squashes the ball for a moment: wider, lower, still touching the ground
  const py = py0 + r * squash;
  ctx.save(); ctx.translate(px, py); ctx.scale(1 + squash * 0.5, 1 - squash); ctx.translate(-px, -py);
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
  if (T.sparkle) {   // the last ball glints
    const t = now();
    for (let k = 0; k < 3; k++) {
      const ph = (t * 0.7 + k / 3) % 1, a = Math.sin(ph * Math.PI), sx = px + Math.cos(k * 2.4 + 1) * r * 0.55, sy = py + Math.sin(k * 2.4 + 1) * r * 0.55, q = r * 0.2 * a;
      ctx.fillStyle = `rgba(255,255,255,${0.9 * a})`;
      ctx.beginPath(); ctx.moveTo(sx, sy - q); ctx.quadraticCurveTo(sx, sy, sx + q, sy); ctx.quadraticCurveTo(sx, sy, sx, sy + q);
      ctx.quadraticCurveTo(sx, sy, sx - q, sy); ctx.quadraticCurveTo(sx, sy, sx, sy - q); ctx.fill();
    }
  }
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
  ctx.save();
  if (shake > 0.01) { const k = shake * shake * 14 * dpr; ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k); }
  const near = Math.max(0, Math.floor(camZ + 0.4)), far = Math.floor(camZ) + VIEW;
  const ballRow = world.state === 'fall' ? world.ball.fallRow : Math.floor(world.ball.z);
  if (world.state === 'fall') {   // falling into a pit: the near edge of the ground must hide the ball
    for (let rz = far; rz >= near; rz--) { drawRow(rz); if (rz === ballRow) drawBall(); }
    if (ballRow < near) drawBall();
  } else {
    // The rows around the ball get all their ground first and the ball, its shadow and the obstacles on top:
    // drawn row by row, the nearer grass cut the shadow off with a straight line that jumped from row to row.
    // Farther rows stay row by row, so a crest still hides what is behind it.
    const split = Math.min(far, ballRow + 1);
    for (let rz = far; rz > split; rz--) drawRow(rz);
    for (let rz = split; rz >= near; rz--) drawRow(rz, 'ground');
    for (let rz = split; rz >= near; rz--) { drawRow(rz, 'objects'); if (rz === ballRow) drawBall(); }
    if (ballRow < near) drawBall();
  }
  for (const p of parts) {
    const [px, py, sc] = proj(p.x, p.y, p.z);
    if (!(sc > 0)) continue;
    const k = p.t / p.life, r = Math.min(p.size * (1 + (p.grow || 0) * k) * sc, 16 * dpr);   // one flying at the camera stays a speck
    ctx.globalAlpha = (1 - k) * (p.grow ? 0.5 : 1);
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const g of rings) {   // a ring spreads from the point of impact
    const [px, py, sc] = proj(g.x, g.y, g.z), k = g.t / 0.45;
    if (!(sc > 0)) continue;
    ctx.globalAlpha = (1 - k) ** 2; ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, (1 - k) * 0.12 * sc);
    ctx.beginPath(); ctx.arc(px, py, (0.2 + 1.3 * k) * sc, 0, 7); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  drawStreaks();
  if (rings.length && rings[0].t < 0.12) { ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - rings[0].t / 0.12)})`; ctx.fillRect(0, 0, W, H); }
  if (mode === 'count') {   // 3-2-1, each digit shrinks into place
    const n = Math.ceil(count / COUNT_T), k = 1 - (count / COUNT_T - (n - 1));
    bigNumber(n, 0.16 * (1.5 - 0.5 * Math.min(1, k * 4)), Math.min(1, (1 - k) * 3));
  } else if (flash) bigNumber(flash.sec + 1, 0.09 * (1 + 0.6 * Math.max(0, flash.t - 0.8) / 0.2), Math.min(1, flash.t * 1.5));
}

function bigNumber(n, size, alpha) {
  ctx.globalAlpha = alpha;
  ctx.font = `800 ${Math.round(H * size)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = H * size * 0.08; ctx.strokeStyle = 'rgba(20,30,60,.35)';
  ctx.strokeText(String(n), W / 2, H * 0.3);
  ctx.fillStyle = '#fff'; ctx.fillText(String(n), W / 2, H * 0.3);
  ctx.globalAlpha = 1;
}

// ---- Input ----
// One finger steers: the first one down on the scene. Others are ignored, so a second touch can't jerk the ball.
let dragId = null, dragX = 0;
addEventListener('pointerdown', (e) => {
  if (dragId !== null || e.target.closest('button, input, .card')) return;
  dragId = e.pointerId; dragX = e.clientX;
});
addEventListener('pointermove', (e) => {
  if (e.pointerId !== dragId) return;
  const dx = e.clientX - dragX;
  dragX = e.clientX;
  if (mode !== 'play') return;
  const b = world.ball;
  b.tx = clamp(b.tx + dx / innerWidth * SENS, -HALF - 0.9, HALF + 0.9);
  if (Math.abs(dx) > 2) $hint.hidden = true;
});
const dragEnd = (e) => { if (e.pointerId === dragId) dragId = null; };
addEventListener('pointerup', dragEnd);
addEventListener('pointercancel', dragEnd);
addEventListener('contextmenu', (e) => e.preventDefault());

// the button gives the focus back, or Space and Enter would press it again instead of doing their own job
const on = (id, fn) => $(id).addEventListener('click', (e) => { e.currentTarget.blur(); sfx.tap(); fn(); });
on('btnPlay', startGame);
on('btnAgain', startGame);
on('btnPause', pause);
on('btnResume', resume);
on('btnPauseAgain', startGame);
on('btnPauseHome', goHome);
on('btnOverHome', goHome);
const turnSkin = (d) => { skinView = (skinView + d + SKINS.length) % SKINS.length; showHome(); };
on('skPrev', () => turnSkin(-1));
on('skNext', () => turnSkin(1));

// settings: one sheet for the home screen and the pause
const $vol = $('volRange'), $music = $('musicRange'), $haptic = $('hapticSw');
function openSettings() {
  $vol.value = Math.round(save.vol * 100); $music.value = Math.round(save.music * 100);
  $('hapticRow').hidden = !canHaptic(); $haptic.setAttribute('aria-checked', String(!!save.haptic));
  $set.hidden = false;
}
on('btnSet', openSettings);
on('btnPauseSet', openSettings);
on('btnSetDone', () => { $set.hidden = true; });
$set.addEventListener('click', (e) => { if (e.target === $set) $set.hidden = true; });
for (const [el, key] of [[$vol, 'vol'], [$music, 'music']]) {
  el.addEventListener('input', () => { save[key] = el.value / 100; applyVolume(); });
  el.addEventListener('change', () => { persist(); if (key === 'vol') sfx.star(); });   // released: hear the new level
}
on('hapticSw', () => { save.haptic = !save.haptic; $haptic.setAttribute('aria-checked', String(save.haptic)); persist(); haptic('land'); });

const KEYS = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };
addEventListener('keydown', (e) => {
  if (e.repeat || e.target.closest('input')) return;
  if (KEYS[e.code]) {
    if (mode === 'home') turnSkin(KEYS[e.code]); else keyDir = KEYS[e.code];
  } else if (e.code === 'Space' || e.code === 'Enter') {
    if (e.target.closest('button')) return;   // the focused button gets its click
    if (!$set.hidden) $set.hidden = true;
    else if (mode === 'home' || (mode === 'over' && !$('overActs').classList.contains('wait'))) startGame();
    else if (mode === 'pause') resume();
  } else if (e.code === 'Escape' || e.code === 'KeyP') {
    if (!$set.hidden) $set.hidden = true;
    else if (mode === 'pause') resume(); else pause();
  }
});
addEventListener('keyup', (e) => {
  if (KEYS[e.code] === keyDir) { keyDir = 0; world.ball.tx = world.ball.x; }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('pagehide', saveRun);
addEventListener('blur', () => { keyDir = 0; });

let last = performance.now();
// The next frame is requested first: an error in one frame must not stop the game for good.
function frame(t) {
  requestAnimationFrame(frame);
  const dt = clamp((t - last) / 1000, 0, 1 / 20);
  last = t;
  try {
    update(dt);
    draw();
  } catch (e) {
    console.error(e);
  }
}

// A new version takes over as soon as it is downloaded: reload right away on the home screen, otherwise when the
// player gets there (a stored run belongs to the version that made it).
let reloadWanted = false;
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;   // the very first install: nothing old is running
    if (mode === 'home' && $set.hidden) location.reload(); else reloadWanted = true;
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

initAudio(save);
addEventListener('resize', () => { resize(); follow(); });
resize();
if (!restoreRun()) goHome();
requestAnimationFrame(frame);

// test hooks: __shot jumps the camera to row z of the given seed, driving the bot along the path; the rest let a
// script reach the world and redraw
window.__shot = (seed, z) => {
  world = new World(seed); setMode('shot');
  while (world.state === 'run' && world.ball.z < z) {
    world.ball.tx = world.autoTarget(); world.step(1 / 60); world.events.length = 0;
  }
  follow();
  $hud.hidden = false; $score.textContent = world.score; $starN.textContent = world.stars; draw();
};
window.__world = () => world;
window.__draw = draw;
window.__follow = follow;
