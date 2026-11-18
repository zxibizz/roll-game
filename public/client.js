// The page: draws the world from core.js in a hand-rolled perspective, reads the finger / mouse / keys and runs the
// screens around the game: home, pause, results, settings. The road is grass and earth; the sky goes from day to
// night to space with the distance. There are no words in the interface, only numbers and icons.
import { World, VERSION, LANES, HALF, BIOME_SECS, secOf, secStart, secPos, R, INSET, BOX_H, RAMP_H, LOW_H, LOW_Z0, LOW_Z1, MAGNET_T, SHIELD_T, FLY_T, FLY_H, CAM_H, CAM_BACK, laneX, clamp, mulberry } from './core.js';
import { initAudio, applyVolume, setHum, sfx, haptic, canHaptic, muffleMusic } from './audio.js';

const $ = (id) => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
const $hud = $('hud'), $score = $('score'), $starN = $('starN'), $hudStars = $('hudStars'), $hint = $('hint');
const $home = $('home'), $pause = $('pause'), $over = $('over'), $set = $('set');
$('ver').textContent = 'v' + VERSION;   // small, on the home screen: which version runs

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

// Balls: smooth and glossy, they differ in colour only; between them come pets that run inside a clear ball of the
// given tint (`pet`, drawn by drawPet; `c` and `glow` are the glass, for the shards of a crash and the glow).
// `need` — stars collected over all runs that open one.
const SKINS = [
  { id: 'coral', need: 0, c: ['#fff1e6', '#ff8a5c', '#cf4b25'], glow: [255, 140, 90] },
  { id: 'sky', need: 50, c: ['#f0faff', '#4fb4ff', '#1867c9'], glow: [90, 170, 255] },
  { id: 'hamster', need: 100, pet: 'hamster', c: ['#f2f9ff', '#9fd0ff', '#5d9bd9'], glow: [120, 190, 255] },
  { id: 'rose', need: 150, c: ['#fff0f6', '#ff6fa5', '#c42b6b'], glow: [255, 120, 170] },
  { id: 'sun', need: 300, c: ['#fffde6', '#ffd84a', '#e08e00'], glow: [255, 215, 90] },
  { id: 'kitten', need: 400, pet: 'kitten', c: ['#fff4f8', '#ffb0d0', '#e0709f'], glow: [255, 150, 195] },
  { id: 'violet', need: 500, c: ['#f8eaff', '#b56cff', '#6a2bc4'], glow: [190, 120, 255] },
  { id: 'pearl', need: 800, c: ['#ffffff', '#ebe6f7', '#a79fc4'], glow: [230, 225, 255] },
  { id: 'chick', need: 1000, pet: 'chick', c: ['#f0fff8', '#9be8c8', '#4fb88f'], glow: [110, 215, 170] },
  { id: 'night', need: 1200, c: ['#c3cdf0', '#3b4466', '#10131f'], glow: [120, 140, 255] },
  { id: 'ruby', need: 1800, c: ['#ffe3e3', '#e0193a', '#7a0018'], glow: [255, 70, 90], sparkle: true },
];
const skinOpen = (k) => save.stars >= k.need;
let skinAt = Math.max(0, SKINS.findIndex((k) => k.id === save.skin && skinOpen(k)));   // the ball that plays
let skinView = skinAt;                                                               // the ball on show on the home screen

// mode: 'home' | 'play' | 'count' (3-2-1 after a pause) | 'pause' | 'over' (and 'shot' — frozen by the screenshot
// hook at the end); the world has its own state inside a game
let mode = 'home', world = new World(1), parts = [], rings = [], flash = null;
let camZ = 0, camX = 0, camL = 0, camY = 0;   // camL: the camera across the road
let flyLift = 0, flyShow = 0, flyT = 0;   // a flight: how far the camera has risen, how much of the show in the sky is on (0..1), its clock
let lean = 0, wasOff = 0;   // weight: how far the ball leans in a lane change, its last distance to its lane
let nudge = null;   // a refused lane change: the ball leans towards the edge and comes back
let shake = 0, squash = 0, hitStop = 0, count = 0, beatBest = false, overAnim = null, hintUntil = 0, hintRow = -1;
// Feel: with no vibration on the web the picture and the sound have to carry every touch. squash is a spring (a
// landing squashes the ball, it springs back a little past round); kick — the camera jolted in a direction by a blow
// and pulled back by a spring; zoom — a short punch of the view; rush — a burst of speed lines; gulp — the ball
// swells for a moment as it takes something; tint — the screen's edges flash in a bonus's colour; homing — stars
// flying from the ball up to the counter.
let squashV = 0, gulp = 0, zoom = 0, rush = 0, tint = null, homing = [], shownStars = 0, hudStar = null;
const kick = { x: 0, y: 0, vx: 0, vy: 0 };
let passRow = -1, whooshAt = 0, rollAcc = 0, nearN = 0;

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

// ---- Biomes ----
// One look that changes with the distance: a summer farm → autumn → a snowy winter evening → a Halloween night →
// a pink magic land → the bottom of the sea → a jungle of dinosaurs → a land of robots → space. PAL holds the key
// frames; between two biomes everything is blended (colours given as [hue, saturation, lightness] turn the short
// way round the colour wheel, see paletteAt). What stands and moves there is picked by themeAt.
// Sky layers a frame leaves out are off there: snow (falling flakes), aurora (northern lights), sea (water instead
// of air: light from above and bubbles), volcano (on the horizon, smoking).
const LAYERS = { snow: 0, aurora: 0, sea: 0, volcano: 0 };
const PAL = [
  { // summer: a farm under a clear sky
    sky: [[111, 177, 242], [169, 211, 251], [226, 240, 255]], fog: [226, 240, 255],
    grass: [98, 52, 50], grassHi: [88, 62, 64], tuft: [104, 55, 34], soil: [30, 42, 38], pit: [26, 40, 12], pitWall: [28, 38, 24],
    rock: [35, 8, 64], bush: [118, 45, 34], bushHi: [100, 58, 52], wood: [33, 55, 58], woodDark: [28, 50, 38],
    flowerL: 72, glowF: 0, litK: 0.6,
    shadow: [40, 70, 130], hud: 0, stars: 0, space: 0, moon: 0,
    sunA: 1, sunH: 0.22, sunC: [255, 253, 240], sunR: 0.06, clouds: 1, cloudC: [255, 255, 255], glow: 0, rainbow: 1, city: 0,
  },
  { // autumn: golden light, yellowing grass, orange leaves
    sky: [[96, 150, 214], [186, 205, 230], [255, 226, 190]], fog: [255, 228, 200],
    grass: [62, 50, 48], grassHi: [52, 60, 58], tuft: [45, 55, 32], soil: [25, 42, 32], pit: [24, 40, 11], pitWall: [24, 36, 22],
    rock: [30, 10, 58], bush: [22, 72, 46], bushHi: [40, 88, 58], wood: [30, 50, 52], woodDark: [24, 48, 34],
    flowerL: 68, glowF: 0.05, litK: 0.65,
    shadow: [70, 40, 90], hud: 0, stars: 0, space: 0, moon: 0,
    sunA: 1, sunH: 0.12, sunC: [255, 225, 170], sunR: 0.07, clouds: 0.9, cloudC: [255, 240, 225], glow: 0.1, rainbow: 0, city: 0,
  },
  { // winter: a snowy evening, lit windows, northern lights
    sky: [[22, 38, 92], [66, 96, 168], [214, 186, 214]], fog: [204, 200, 230],
    grass: [208, 40, 91], grassHi: [204, 60, 97], tuft: [212, 30, 76], soil: [215, 22, 42], pit: [215, 30, 10], pitWall: [215, 25, 20],
    rock: [215, 14, 52], bush: [152, 38, 22], bushHi: [158, 30, 34], wood: [25, 40, 40], woodDark: [22, 40, 26],
    flowerL: 80, glowF: 0.5, litK: 0.5,
    shadow: [70, 90, 160], hud: 1, stars: 0.45, space: 0, moon: 0.7,
    sunA: 0, sunH: -0.05, sunC: [255, 180, 150], sunR: 0.08, clouds: 0.15, cloudC: [130, 140, 200], glow: 0.4, rainbow: 0, city: 0,
    snow: 1, aurora: 1,
  },
  { // night: stars and a hint of space up top, the flowers glow
    sky: [[6, 10, 34], [17, 28, 74], [38, 52, 110]], fog: [26, 36, 84],
    grass: [160, 30, 20], grassHi: [150, 35, 30], tuft: [165, 30, 12], soil: [-125, 18, 15], pit: [-125, 30, 4], pitWall: [-125, 20, 10],
    rock: [-135, 10, 32], bush: [165, 30, 13], bushHi: [158, 35, 25], wood: [30, 25, 26], woodDark: [30, 25, 17],
    flowerL: 70, glowF: 0.7, litK: 1,
    shadow: [0, 0, 0], hud: 1, stars: 0.85, space: 0.3, moon: 1,
    sunA: 0, sunH: -0.05, sunC: [255, 140, 90], sunR: 0.09, clouds: 0.2, cloudC: [60, 72, 130], glow: 0.6, rainbow: 0, city: 0,
  },
  { // a magic land: pink grass, mint trees, candy
    sky: [[176, 138, 236], [243, 170, 218], [255, 216, 234]], fog: [255, 218, 238],
    grass: [316, 58, 74], grassHi: [322, 70, 82], tuft: [285, 45, 56], soil: [-85, 35, 42], pit: [-85, 40, 16], pitWall: [-85, 35, 30],
    rock: [-100, 30, 72], bush: [172, 50, 56], bushHi: [165, 65, 76], wood: [35, 40, 90], woodDark: [335, 60, 70],
    flowerL: 80, glowF: 0.4, litK: 0.6,
    shadow: [120, 40, 140], hud: 0, stars: 0.25, space: 0, moon: 0,
    sunA: 0.9, sunH: 0.2, sunC: [255, 245, 250], sunR: 0.07, clouds: 1, cloudC: [255, 238, 247], glow: 0.3, rainbow: 1, city: 0,
  },
  { // the bottom of the sea: sand, corals, light coming down through the water
    sky: [[6, 52, 96], [16, 112, 156], [64, 186, 200]], fog: [58, 166, 190],
    grass: [42, 48, 70], grassHi: [46, 60, 80], tuft: [150, 55, 32], soil: [30, 30, 40], pit: [30, 35, 10], pitWall: [30, 30, 22],
    rock: [200, 14, 50], bush: [350, 70, 62], bushHi: [12, 85, 74], wood: [30, 30, 36], woodDark: [26, 30, 24],
    flowerL: 72, glowF: 0.3, litK: 0.6,
    shadow: [10, 60, 90], hud: 1, stars: 0, space: 0, moon: 0,
    sunA: 0, sunH: -0.05, sunC: [255, 255, 255], sunR: 0.08, clouds: 0, cloudC: [200, 240, 250], glow: 0.3, rainbow: 0, city: 0,
    sea: 1,
  },
  { // a jungle of dinosaurs: green and steamy, a volcano on the horizon
    sky: [[92, 160, 204], [172, 210, 204], [250, 228, 182]], fog: [244, 228, 192],
    grass: [100, 50, 40], grassHi: [94, 60, 50], tuft: [112, 55, 26], soil: [25, 45, 30], pit: [25, 40, 10], pitWall: [25, 40, 22],
    rock: [30, 12, 52], bush: [125, 55, 30], bushHi: [108, 60, 45], wood: [28, 45, 40], woodDark: [25, 45, 26],
    flowerL: 66, glowF: 0, litK: 0.6,
    shadow: [40, 70, 50], hud: 0, stars: 0, space: 0, moon: 0,
    sunA: 1, sunH: 0.25, sunC: [255, 240, 200], sunR: 0.065, clouds: 0.7, cloudC: [255, 250, 240], glow: 0, rainbow: 0, city: 0,
    volcano: 1,
  },
  { // a land of robots: steel ground with neon lines, a city on the horizon
    sky: [[6, 14, 30], [10, 44, 70], [20, 110, 130]], fog: [18, 70, 95],
    grass: [215, 22, 26], grassHi: [205, 30, 36], tuft: [185, 80, 45], soil: [-140, 25, 14], pit: [-140, 40, 4], pitWall: [-140, 25, 10],
    rock: [-150, 12, 45], bush: [200, 30, 30], bushHi: [190, 50, 48], wood: [-150, 15, 58], woodDark: [-145, 20, 34],
    flowerL: 72, glowF: 1, litK: 1,
    shadow: [0, 0, 0], hud: 1, stars: 0.5, space: 0.15, moon: 0,
    sunA: 0, sunH: -0.05, sunC: [255, 140, 90], sunR: 0.09, clouds: 0, cloudC: [60, 72, 130], glow: 0.6, rainbow: 0, city: 1,
  },
  { // space: alien teal grass
    sky: [[5, 6, 13], [5, 6, 13], [5, 6, 13]], fog: [5, 6, 13],
    grass: [178, 45, 22], grassHi: [175, 55, 34], tuft: [182, 45, 13], soil: [-98, 25, 15], pit: [-98, 30, 3], pitWall: [-98, 25, 9],
    rock: [-105, 12, 34], bush: [195, 40, 15], bushHi: [188, 50, 28], wood: [-80, 25, 32], woodDark: [-80, 25, 22],
    flowerL: 72, glowF: 1, litK: 1,
    shadow: [0, 0, 0], hud: 1, stars: 1, space: 1, moon: 0,
    sunA: 0, sunH: -0.05, sunC: [255, 140, 90], sunR: 0.09, clouds: 0, cloudC: [60, 72, 130], glow: 0.6, rainbow: 0, city: 0,
  },
].map((frame) => ({ ...LAYERS, ...frame }));
// a biome is BIOME_SECS sections (core.js: sections are equal in time, so it is half a minute at any speed);
// it stays as it is for most of that and turns into the next one over its last BIOME_BLEND sections. The last
// biome never ends. To add a biome: a name in THEMES, a key frame in PAL at the same place, and an entry under that
// name in MOVERS, SIDE, FLY and OBSTACLES (checked at start, see checkBiomes) — nothing else counts biomes.
const BIOME_BLEND = 0.75;
const THEMES = ['farm', 'autumn', 'winter', 'spooky', 'magic', 'sea', 'dino', 'tech', 'alien'];

const mix = (a, b, t) => (Array.isArray(a) ? a.map((v, i) => mix(v, b[i], t)) : a + (b - a) * t);
function phaseAt(z) {
  const s = secPos(z) / BIOME_SECS, i = Math.floor(s), t = clamp(((s - i) * BIOME_SECS - (BIOME_SECS - BIOME_BLEND)) / BIOME_BLEND, 0, 1);
  return Math.min(PAL.length - 1, i + t * t * (3 - 2 * t));
}
// colours given as plain RGB; every other triple is [hue, saturation, lightness], and its hue turns the short way
const RGB = new Set(['sky', 'fog', 'shadow', 'sunC', 'cloudC']);
function paletteAt(k) {
  const i = Math.min(PAL.length - 2, Math.floor(k)), t = k - i, a = PAL[i], b = PAL[i + 1], out = {};
  for (const key in a) {
    out[key] = mix(a[key], b[key], t);
    if (Array.isArray(a[key]) && !RGB.has(key)) out[key][0] = a[key][0] + (wrap(b[key][0] - a[key][0] + 180, 360) - 180) * t;
  }
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
    if (P.aurora > 0.01) aurora(P.aurora);   // after the moon: its crescent is cut out with a disc of flat sky
    if (P.sunA > 0.01) {   // the sun goes down towards the horizon and sets
      const sx = W * 0.78 - camX * 3 * dpr, sy = horY - P.sunH * H, sr = Math.min(W, H) * P.sunR;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, horY); ctx.clip(); ctx.globalAlpha = P.sunA;
      const g = ctx.createRadialGradient(sx, sy, sr * 0.6, sx, sy, sr * 3);
      g.addColorStop(0, css(P.sunC, 1)); g.addColorStop(0.3, css(P.sunC, 0.45)); g.addColorStop(1, css(P.sunC, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, sr * 3, 0, 7); ctx.fill();
      ctx.fillStyle = css(mix(P.sunC, [255, 255, 255], 0.5)); ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 7); ctx.fill();
      ctx.restore();
    }
    if (P.volcano > 0.01) volcano(P.volcano);
    if (P.city > 0.01) {   // a city of towers on the horizon, windows lit
      const rr = mulberry(11);
      ctx.globalAlpha = P.city;
      for (let n = 0; n < 16; n++) {
        const bw = (0.05 + rr() * 0.06) * W, bh = (0.03 + rr() * 0.11) * H, bx = wrap(rr() * 1.5 * W - camX * 2.5 * dpr, W * 1.5) - 0.25 * W, lit = rr();
        ctx.fillStyle = 'rgb(7,18,36)'; ctx.fillRect(bx, horY - bh, bw, bh + 2);
        ctx.fillStyle = lit < 0.5 ? 'rgba(90,240,255,.8)' : 'rgba(255,200,90,.8)';
        const cw = bw / 5, ch = cw * 1.2;
        for (let wy = 1; wy * ch * 1.8 < bh - ch; wy++) for (let wx = 0; wx < 3; wx++) if (hash(n, wy, wx) < 0.55) ctx.fillRect(bx + cw * (0.6 + wx * 1.4), horY - bh + wy * ch * 1.8 - ch, cw * 0.7, ch * 0.7);
        if (lit > 0.7) { ctx.fillStyle = `rgba(255,70,70,${Math.sin(now() * 3 + n) > 0 ? 1 : 0.2})`; ctx.fillRect(bx + bw / 2 - 1.5 * dpr, horY - bh - 4 * dpr, 3 * dpr, 4 * dpr); }
      }
      ctx.globalAlpha = 1;
    }
    if (P.rainbow > 0.02) {   // a rainbow over the farm and the magic land
      const rx = W * 0.16 - camX * 2 * dpr, ry = horY + H * 0.05, rr = Math.min(W, H) * 0.62, lw = rr * 0.022;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, horY); ctx.clip();
      ctx.globalAlpha = 0.3 * P.rainbow; ctx.lineWidth = lw + 1;
      [[0, 85, 62], [28, 95, 62], [52, 95, 62], [125, 60, 58], [205, 80, 62], [270, 60, 64]].forEach((c, k) => {
        ctx.strokeStyle = hsl(c[0], c[1], c[2]); ctx.beginPath(); ctx.arc(rx, ry, rr - k * lw, Math.PI, 2 * Math.PI); ctx.stroke();
      });
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
    if (P.sea > 0.01) seaLight(P.sea);
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
  $hud.hidden = m === 'home' || m === 'shot'; hudStar = null;
  if (m !== 'play' && m !== 'count') flushHoming();   // nothing hangs in mid-air over a pause; the counter is right
  if (m === 'home') muffleMusic(false);
  if (m !== 'play') { $hint.hidden = true; setHum(0, false); }
}

function resetView() {
  banked = null;
  parts = []; rings = []; flash = null; nudge = null; lean = 0; wasOff = 0; flyLift = world.ball.fly ? 1.85 : 0; flyShow = world.ball.fly ? 1 : 0; shake = 0; squash = 0; hitStop = 0; beatBest = false;
  squashV = 0; gulp = 0; zoom = 0; rush = 0; tint = null; homing = []; passRow = -1; rollAcc = 0; Object.assign(kick, { x: 0, y: 0, vx: 0, vy: 0 });
  shownStars = world.stars; muffleMusic(false);
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
  hintRow = -1; $hint.classList.remove('up');
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
  lean = 0;
  const { s, isBest, stars, fresh } = bankRun();
  $('overCard').classList.toggle('best', isBest); $('newBest').hidden = !isBest;
  $('overBest').textContent = save.best; $('overStars').textContent = '+' + stars;
  $('unlock').hidden = !fresh.length;
  $('unlock').innerHTML = fresh.map((k) => k.pet ? `<i style="background:#fff url(${petIcon(k.pet)}) center/cover"></i>`
    : `<i style="background:radial-gradient(circle at 35% 30%, ${k.c[0]}, ${k.c[1]} 60%, ${k.c[2]})"></i>`).join('');
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

function popEl(el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
function kickCam(x, y) { kick.vx += x * dpr; kick.vy += y * dpr; }   // px/s on a 1x screen; positive y is down
function shownStar() {   // one more digit moves the icon: its place is looked up again
  shownStars = Math.min(world.stars, shownStars + 1); $starN.textContent = shownStars; popEl($hudStars); hudStar = null;
}
function flushHoming() { for (const h of homing) shownStar(); homing = []; }
// where the counter's star is on the canvas; null while the HUD is not on screen
function hudStarAt() {
  if (hudStar) return hudStar;
  const r = $hudStars.querySelector('svg').getBoundingClientRect();
  if (!r.width) return null;
  return (hudStar = { x: (r.left + r.width / 2) * dpr, y: (r.top + r.height / 2) * dpr, r: r.height / 2 * dpr });
}

function onEvent(e) {
  const b = world.ball, skin = theme.ball;
  if (e === 'section') {
    flash = { sec: world.sec, t: 1 }; sfx.section(); haptic('section');
    zoom = Math.max(zoom, 0.035); rush = 1; popEl($score);   // a push of speed: the view punches in, lines rush past
  } else if (e === 'star') {
    const run = sfx.star(b.x / HALF);
    gulp = 1;
    // the star flies from the ball up to the counter, which counts it when it gets there
    const [px, py, sc] = proj(b.x, b.y + R * 0.6, b.z), to = hudStarAt();
    if (to && sc > 0 && homing.length < 14) homing.push({ x: px, y: py, r: 0.19 * sc, t: 0, d: rnd(0.38, 0.48), side: rnd(-1, 1) });
    else shownStar();
    rings.push({ x: b.x, y: b.y, z: b.z + 0.2, t: 0.1, s: 0.35, c: '#ffe58a' });
    spray(5, b, () => ({ vx: rnd(-1.6, 1.6), vy: rnd(1.5, 4), vz: world.v + rnd(-1, 1), g: 7, life: rnd(0.25, 0.45), size: rnd(0.02, 0.04), color: '#fff3b0' }));
    if (run % 5 === 0) {   // a good run of stars: a golden ring and a fountain of sparks
      rings.push({ x: b.x, y: b.y, z: b.z + 0.2, t: 0, s: 0.8, c: '#ffd84a' });
      spray(10 + Math.min(10, run), b, () => ({ vx: rnd(-3, 3), vy: rnd(2, 6), vz: world.v + rnd(-1, 2), g: 8, life: rnd(0.4, 0.7), size: rnd(0.02, 0.04), color: Math.random() < 0.5 ? '#ffd84a' : '#ffffff' }));
    }
  } else if (e === 'bonus') {
    sfx.bonus(); haptic('land');
    const c = BONUS_C[world.got];
    gulp = 2; tint = { c, t: 0 }; zoom = Math.max(zoom, 0.025);
    rings.push({ x: b.x, y: b.y, z: b.z + R, t: 0, s: 1.2, c: `rgb(${c})` });
    spray(14, b, () => ({ vx: rnd(-3, 3), vy: rnd(1, 5), vz: world.v + rnd(-2, 2), g: 6, life: rnd(0.3, 0.6), size: rnd(0.012, 0.028), color: `rgb(${c})` }));
  } else if (e === 'pop') {   // the shield took a hit: the thing flies apart, the bubble bursts
    const at = { x: world.popAt.x, y: world.hAt(world.popAt.z) + 0.35, z: world.popAt.z };
    sfx.pop(); haptic('crash'); shake = Math.max(shake, 0.5); rings.push({ x: b.x, y: b.y, z: b.z + R, t: 0.12 });
    hitStop = 0.05; kickCam(0, -160); zoom = Math.max(zoom, 0.04); tint = { c: BONUS_C.shield, t: 0 };
    spray(22, at, (k) => ({ vx: rnd(-5, 5), vy: rnd(2, 7), vz: world.v * 0.8 + rnd(-2, 5), g: 16, life: rnd(0.5, 0.9), size: rnd(0.04, 0.09), color: k % 3 ? pal('rock', 0) : pal('wood', 0) }));
    spray(12, b, () => ({ vx: rnd(-4, 4), vy: rnd(-1, 4), vz: world.v + rnd(-2, 2), g: 3, life: rnd(0.3, 0.5), size: rnd(0.012, 0.025), color: 'rgb(170,225,255)' }));
  } else if (e === 'fly') {
    sfx.fly(); haptic('best'); flyT = 0; rings.push({ x: b.x, y: b.y, z: b.z + R, t: 0, w: true });
    kickCam(0, 220); squash = -0.25; squashV = 0; rush = 1;
    spray(30, b, () => ({ vx: rnd(-4, 4), vy: rnd(-1, 6), vz: world.v + rnd(-3, 3), g: 4, life: rnd(0.5, 1), size: rnd(0.012, 0.028), color: '#fff3b0' }));
  } else if (e === 'flyend') sfx.flyEnd();
  else if (e === 'jump') {   // it pushes off: stretched up, a puff of dust left on the ground
    sfx.jump(); squash = Math.min(squash, -0.08); squashV = 0; kickCam(0, 60);
    if (!b.fromRamp || b.hop) {
      const dust = pal('soil', 18);
      spray(4, { x: b.x, y: b.y - R, z: b.z }, () => ({ vx: rnd(-1.4, 1.4), vy: rnd(0.2, 0.9), vz: world.v * 0.7 + rnd(-1, 1), g: 2, life: rnd(0.3, 0.5), size: rnd(0.06, 0.11), color: dust, grow: 1.5 }));
    }
  } else if (e === 'drop') { sfx.drop(); squash = -0.2; squashV = 0; }   // slammed down: stretched along the way
  else if (e === 'move') sfx.move(Math.sign(b.tx - b.x));
  else if (e === 'bump') { sfx.bump(world.side); haptic('land'); nudge = { dir: world.side, t: 0 }; kickCam(world.side * 110, 0); }
  else if (e === 'land') {
    const k = world.impact;
    sfx.land(k); haptic('land');
    squash = Math.max(squash, 0.35 * k); squashV = 0; shake = Math.max(shake, k > 0.7 ? 0.25 * k : 0);
    kickCam(0, 120 + 200 * k);   // the whole view dips under the blow and comes back
    if (k > 0.45) rings.push({ x: b.x, y: b.y - R + 0.02, z: b.z, t: 0, s: 0.4 + 0.5 * k, flat: true, c: 'rgba(255,255,255,.8)' });
    const dust = pal('soil', 18);
    spray(Math.round(4 + 8 * k), { x: b.x, y: b.y - R, z: b.z }, () => ({ vx: rnd(-2.2, 2.2), vy: rnd(0.3, 1.6), vz: world.v * 0.6 + rnd(-1, 2), g: 3, life: rnd(0.3, 0.6), size: rnd(0.08, 0.16), color: dust, grow: 1.5 }));
  } else if (e === 'crash') {
    bankRun();
    sfx.crash(); haptic('crash'); muffleMusic(true);
    shake = 1; hitStop = 0.1; zoom = 0.07; rush = 0; kickCam(0, 300); rings.push({ x: b.x, y: b.y, z: b.z + R, t: 0, w: true });
    spray(26, b, (k) => ({ vx: rnd(-5, 5), vy: rnd(1, 7), vz: rnd(-3, 4), g: 18, life: rnd(0.6, 1.1), size: rnd(0.03, 0.065), color: skin.c[k % 3 === 0 ? 0 : 1] }));
  } else if (e === 'fall') { bankRun(); sfx.fall(); haptic('fall'); muffleMusic(true); }
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
  shake = Math.max(0, shake - dt * 3.5);
  const sd = Math.min(dt, 1 / 30);   // springs: stable on a slow frame too
  squashV += (-380 * squash - 15 * squashV) * sd; squash += squashV * sd;   // springs back a little past round
  kick.vx += (-260 * kick.x - 20 * kick.vx) * sd; kick.vy += (-260 * kick.y - 20 * kick.vy) * sd;
  kick.x += kick.vx * sd; kick.y += kick.vy * sd;
  zoom *= Math.exp(-dt * 7); rush = Math.max(0, rush - dt * 1.6); gulp = Math.max(0, gulp - dt * 7);
  if (tint && (tint.t += dt) > 0.45) tint = null;
  for (const h of homing) h.t += dt / h.d;
  if (homing.some((h) => h.t >= 1)) homing = homing.filter((h) => h.t < 1 || (shownStar(), false));
  if (flash && (flash.t -= dt * 0.8) <= 0) flash = null;
  if (nudge && (nudge.t += dt / 0.18) >= 1) nudge = null;
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
  world.step(dt);
  // some weight: the ball leans back a little as it sets off sideways; rolling into its lane it lands there with a
  // soft thud (the view itself stays level: rolling it made the sky swing)
  const side = world.state === 'run' ? clamp(b.vx / 9, -1, 1) : 0, offNow = Math.abs(b.tx - b.x);
  lean += (side - lean) * Math.min(1, dt * 22);
  if (wasOff > 0.05 && offNow <= 0.05 && world.state === 'run' && !b.air) {   // in the air there is nothing to land on
    const dir = Math.sign(lean) || 1, dust = pal('soil', 18);
    sfx.settle(dir); haptic('tick');
    squash = Math.max(squash, 0.07);
    spray(3, { x: b.x + dir * R * 0.8, y: b.y - R, z: b.z }, () => ({ vx: dir * rnd(0.8, 2.4), vy: rnd(0.3, 1.2), vz: world.v * 0.7 + rnd(-1, 1), g: 3, life: rnd(0.25, 0.45), size: rnd(0.06, 0.12), color: dust, grow: 1.5 }));
  }
  wasOff = offNow;
  if (world.state === 'run' && !b.air && !b.fly) {   // bits of the ground thrown up behind the rolling ball, more with speed
    rollAcc += dt * world.v * 0.3;
    if (rollAcc >= 1 && parts.length < 100) {
      rollAcc -= 1;
      const c = Math.random() < 0.6 ? pal('grassHi', -6) : pal('soil', 10);
      spray(1, { x: b.x + rnd(-0.12, 0.12), y: b.y - R + 0.02, z: b.z - R * 0.6 }, () => ({ vx: rnd(-0.8, 0.8), vy: rnd(0.6, 1.6), vz: world.v * 0.8, g: 9, life: rnd(0.2, 0.35), size: rnd(0.018, 0.03), color: c }));
    } else rollAcc = Math.min(rollAcc, 1);
  }
  nearMiss();
  flyLift += ((b.fly ? 1.85 : 0) - flyLift) * Math.min(1, dt * 3);   // the camera goes up almost as far as the ball: the road is seen from above
  flyShow = clamp(flyShow + (b.fly ? dt / 0.6 : -dt / 0.8), 0, 1);
  if (b.fly) {   // a trail of sparks behind the wings
    flyT += dt;
    if (parts.length < 120) spray(1, { x: b.x + rnd(-0.25, 0.25), y: b.y + rnd(-0.1, 0.1), z: b.z - 0.1 }, () => ({ vx: rnd(-0.4, 0.4), vy: rnd(-0.6, 0.2), vz: world.v * 0.25, g: 0.5, life: rnd(0.4, 0.8), size: rnd(0.01, 0.02), color: Math.random() < 0.5 ? '#fff3b0' : '#ffffff' }));
  }
  const events = world.events.splice(0);
  for (const e of events) onEvent(e);
  follow();
  if (world.state === 'run') {
    $score.textContent = world.score;
    if (!beatBest && save.best > 0 && world.score > save.best) {   // a new record, right now: confetti
      beatBest = true; $score.style.color = '#ffc107'; sfx.best(); popEl($score);
      const C = ['#ffd84a', '#ff6fa5', '#4fb4ff', '#7ee07e', '#ffffff'];
      spray(30, { x: b.x, y: b.y + 0.4, z: b.z + 0.8 }, (k) => ({ vx: rnd(-4, 4), vy: rnd(3, 7), vz: world.v + rnd(-1, 2), g: 9, life: rnd(0.7, 1.1), size: rnd(0.025, 0.045), color: C[k % C.length] }));
    }
  }
  if (!$hint.hidden && performance.now() > hintUntil) $hint.hidden = true;
  if (save.runs <= 5 && $hint.hidden && !b.air && world.state === 'run') {   // first runs: a hand shows the swipe up before a log
    for (let r = Math.floor(b.z + world.v * 0.3); r <= Math.floor(b.z + world.v * 0.6); r++) {
      if (r <= hintRow || !world.track.get(r).low[world.lane]) continue;
      hintRow = r; $hint.classList.add('up'); $hint.hidden = false; hintUntil = performance.now() + 500;
      break;
    }
  }
  setHum(world.v / 24, world.state === 'run' && !b.air);
}

// Something rushed past close by: a thing in the next lane level with the ball, or a log under it in a jump.
// The sound comes from that side; it is what makes a narrow escape felt.
function nearMiss() {
  const b = world.ball, zr = Math.floor(b.z);
  if (world.state !== 'run' || b.fly || zr === passRow) return;
  passRow = zr;
  const row = world.track.get(zr), lane = Math.floor(b.x + HALF), t = performance.now();
  if (t - whooshAt < 280 || Math.abs(b.x - laneX(lane)) > 0.3) return;
  if (b.air && (row.low[lane] || row.block[lane])) { whooshAt = t; nearN++; sfx.whoosh(0, 0.8); return; }   // right under it
  if (row.block[lane]) return;
  for (const d of [-1, 1]) {
    const l = lane + d;
    if (l < 0 || l >= LANES || !row.block[l]) continue;
    whooshAt = t; nearN++; sfx.whoosh(d * 0.8, 1);
    spray(3, { x: b.x + d * 0.5, y: b.y, z: b.z + 0.3 }, () => ({ vx: d * rnd(0.5, 1.5), vy: rnd(-0.2, 0.4), vz: world.v * 0.6, g: 0, life: rnd(0.15, 0.25), size: rnd(0.012, 0.02), color: 'rgba(255,255,255,.7)' }));
    return;
  }
}

// the camera follows the ball
function follow() {
  const b = world.ball;
  if (world.state === 'run') {
    camZ = b.z - CAM_BACK;
    // never below the road under the ball (the generator counts on that to know what can be seen);
    // a little higher when the road ahead climbs, to look over the crest
    camY = world.hAt(b.z) + Math.max(0, world.hAt(b.z + 6) - world.hAt(b.z)) * 0.3 + flyLift;   // up with a flight
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

// northern lights: green and violet curtains that ripple slowly high in the sky
function aurora(a) {
  const t = now(), n = 36, sw = W / n * 1.6;
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, horY); ctx.clip(); ctx.globalCompositeOperation = 'lighter';
  for (const [band, hue, y0, amp] of [[0, 140, 0.5, 0.05], [1, 175, 0.62, 0.04], [2, 290, 0.42, 0.035]]) {
    for (let k = 0; k < n; k++) {
      const x = wrap(k * W / n - camX * 1.5 * dpr + band * W * 0.3, W * 1.2) - W * 0.1, ph = k * 0.23 + band * 2;
      const top = horY - H * (y0 + amp * Math.sin(ph + t * 0.35) + 0.02 * Math.sin(ph * 2.7 - t * 0.6)), len = H * (0.1 + 0.05 * Math.sin(ph * 1.3 + t * 0.5));
      const lit = (0.5 + 0.5 * Math.sin(ph * 0.7 - t * 0.8)) * (band === 2 ? 0.5 : 1);
      const g = ctx.createLinearGradient(0, top, 0, top + len);
      g.addColorStop(0, `hsla(${hue},90%,65%,0)`); g.addColorStop(0.3, `hsla(${hue},90%,65%,${0.22 * a * lit})`); g.addColorStop(1, `hsla(${hue},90%,55%,0)`);
      ctx.fillStyle = g; ctx.fillRect(x, top, sw, len);
    }
  }
  ctx.restore();
}

// a volcano far off on the horizon: smoke rises from it all the time, and now and then it puffs out a big cloud
function volcano(a) {
  const t = now(), vx = wrap(W * 0.52 - camX * 2 * dpr, W * 1.6) - W * 0.3, vb = horY + 1, vh = H * 0.13, vw = W * 0.26;
  ctx.save(); ctx.globalAlpha = a;
  const g = ctx.createLinearGradient(0, vb - vh, 0, vb);
  g.addColorStop(0, 'rgb(96,78,82)'); g.addColorStop(1, 'rgb(150,140,130)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(vx - vw, vb);
  ctx.quadraticCurveTo(vx - vw * 0.35, vb - vh * 0.55, vx - vw * 0.16, vb - vh); ctx.lineTo(vx + vw * 0.14, vb - vh);
  ctx.quadraticCurveTo(vx + vw * 0.4, vb - vh * 0.5, vx + vw, vb); ctx.fill();
  const puff = (t % 9) / 9, boom = puff < 0.25 ? Math.sin(puff / 0.25 * Math.PI) : 0;   // every 9 s a puff
  halo(vx, vb - vh, vw * (0.25 + 0.2 * boom), 'rgba(255,110,40,1)', (0.5 + 0.4 * boom) * a);
  ctx.globalAlpha = a; ctx.strokeStyle = 'rgba(255,120,50,.7)'; ctx.lineWidth = Math.max(1, vw * 0.025); ctx.lineCap = 'round';   // lava down the side
  ctx.beginPath(); ctx.moveTo(vx - vw * 0.05, vb - vh); ctx.quadraticCurveTo(vx - vw * 0.12, vb - vh * 0.6, vx - vw * 0.22, vb - vh * 0.35); ctx.stroke(); ctx.lineCap = 'butt';
  for (let k = 0; k < 6; k++) {
    const q = (t * 0.07 + k / 6) % 1, r = vw * (0.06 + q * 0.2);
    ctx.globalAlpha = a * 0.55 * (1 - q); ctx.fillStyle = 'rgb(120,112,118)';
    ell(vx + Math.sin(q * 3 + k) * vw * 0.06 + q * vw * 0.25, vb - vh - q * H * 0.22, r, r * 0.8);
  }
  if (boom > 0) {
    ctx.globalAlpha = a * 0.8 * boom; ctx.fillStyle = 'rgb(140,130,135)';
    for (let k = 0; k < 4; k++) ell(vx + (k - 1.5) * vw * 0.09, vb - vh - H * (0.03 + puff * 0.35) - (k % 2) * vw * 0.05, vw * (0.08 + puff * 0.25), vw * (0.07 + puff * 0.2));
  }
  ctx.restore();
}

// under water: shafts of light come down from the surface far above and sway slowly
function seaLight(a) {
  const t = now();
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 6; k++) {
    const x = wrap(k * W * 0.27 - camX * 2 * dpr + Math.sin(t * 0.3 + k * 2) * W * 0.03, W * 1.6) - W * 0.3, w = W * (0.04 + 0.03 * ((k * 37) % 5) / 5);
    const g = ctx.createLinearGradient(0, 0, 0, horY + H * 0.2);
    g.addColorStop(0, `rgba(200,255,250,${0.2 * a * (0.6 + 0.4 * Math.sin(t * 0.7 + k * 1.7))})`); g.addColorStop(1, 'rgba(200,255,250,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - w * 0.5, 0); ctx.lineTo(x + w * 0.5, 0); ctx.lineTo(x + w * 2.2 + W * 0.05, horY + H * 0.2); ctx.lineTo(x + w * 0.6 + W * 0.05, horY + H * 0.2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.25 * a; ctx.strokeStyle = '#dffaff'; ctx.lineWidth = Math.max(1, 1.5 * dpr);   // the surface, rippling
  for (let r = 0; r < 2; r++) {
    ctx.beginPath();
    for (let x = 0; x <= W; x += W / 24) { const y = H * (0.02 + r * 0.03) + Math.sin(x / W * 14 + t * (1.2 + r * 0.4) + r * 2) * H * 0.006; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
  }
  ctx.restore();
}

// in front of everything: snowflakes falling, or bubbles going up through the water
function drawWeather() {
  const t = now();
  if (P.snow > 0.01) {
    const rr = mulberry(21);
    ctx.fillStyle = '#ffffff';
    for (let n = 0; n < 90; n++) {
      const near = rr(), sp = (0.05 + near * 0.12) * H, r = (0.8 + near * 2.2) * dpr;
      const y = wrap(rr() * H + t * sp, H + 20 * dpr) - 10 * dpr, x = wrap(rr() * W + Math.sin(t * (0.5 + rr()) + n) * 14 * dpr - camX * (2 + near * 10) * dpr, W);
      ctx.globalAlpha = P.snow * (0.35 + near * 0.5); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (P.sea > 0.01) {
    const rr = mulberry(23);
    ctx.strokeStyle = '#e6fdff'; ctx.lineWidth = Math.max(1, dpr);
    for (let n = 0; n < 26; n++) {
      const near = rr(), sp = (0.04 + near * 0.08) * H, r = (1.5 + near * 4) * dpr;
      const y = H - wrap(rr() * H + t * sp, H + 20 * dpr) + 10 * dpr, x = wrap(rr() * W + Math.sin(t * 2 + n) * 6 * dpr - camX * (2 + near * 8) * dpr, W);
      ctx.globalAlpha = P.sea * (0.3 + near * 0.4); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
      ctx.globalAlpha *= 0.8; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
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
const TROPIC = [[2, 85, 58], [28, 95, 58], [48, 95, 62], [320, 75, 66]];
// a star with five points (a starfish) round x, y; flattened as if lying on the ground
function starShape(x, y, r, flat, rot = 0) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) { const a = rot + k * Math.PI / 5, q = k % 2 ? 0.45 : 1; ctx.lineTo(x + Math.cos(a) * r * q, y + Math.sin(a) * r * q * flat); }
  ctx.closePath();
}

// what stands, walks and flies at a row: the biome that is closest there
function themeAt(rz) {
  return THEMES[Math.min(THEMES.length - 1, Math.round(phaseAt(rz)))];
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
let rowTheme = 'farm';   // the biome of the row being drawn, for sprites that differ a little from biome to biome
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
  rowTheme = theme;
  if (part !== 'objects') {
  drawSide(rz, fog, theme);
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
  if (theme === 'tech') {   // steel plates: neon seams between the lanes and across every other row
    const c = `rgba(70,235,255,${0.35 * (1 - fog)})`, w = Math.max(1, px * 0.012), plate = (l) => l >= 0 && l < LANES && row.road[l] && row.floor[l];
    for (let l = 0; l < LANES; l++) {
      if (!plate(l)) continue;
      if (plate(l - 1)) line(proj(l - HALF, hA + 0.01, zA), proj(l - HALF, hB + 0.01, zB), c, w);
      if (zA === rz && rz % 2 === 0) line(proj(l - HALF + (plate(l - 1) ? 0 : 0.18), hA + 0.01, rz), proj(l - HALF + 1 - (plate(l + 1) ? 0 : 0.18), hA + 0.01, rz), c, w);
    }
  }
  if (dz < 22) drawDecor(rz, row, zA, px, fog, theme);
  if (rz > 0 && secStart(secOf(rz)) === rz && zA === rz) {   // section start line, like chalk on the grass
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
  if (row.mover && rz + 0.5 > camZ + 0.9) {   // someone walks across the road
    const mx = world.moverX(rz), o = frameAt(mx, rz);
    if (o.hw > 0 && o.bottom > o.top) MOVERS[theme](o, hash(rz, 3, 8), fog, rz, 0, Math.sign(row.mover.lane - row.mover.from), mx * 9);
  }
  if (rz + LOW_Z0 > camZ + 0.5) for (const l of order) if (row.low[l]) drawLog(l, rz, row, fog, px);
  if (rz + 0.5 > camZ + 0.9) {
    if (!world.ball.fly) {   // in a flight the things lying on the road are not shown: only the trail in the air
      for (const l of order) if (row.star[l]) drawStar(l, rz, row.star[l], fog);
      if (row.bonus) drawBonus(row.bonus, rz, fog);
    }
    for (const s of world.sky) if (s.z === rz && !s.got) drawStar(s.l, rz, 1 + FLY_H, fog);   // the trail of a flight
    if (flyShow > 0.01) drawFlightRow(rz, fog);
  }
  drawFlyers(rz, fog, theme);
}

// a star turns and bobs over the road (or hangs along the flight over a jump)
const STAR_PTS = Array.from({ length: 10 }, (_, k) => {
  const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 0.45 : 1;
  return [Math.cos(a) * r, Math.sin(a) * r];
});
function drawStar(l, rz, s, fog) {
  const zc = rz + 0.5, t = now(), b = world.ball;
  let wx = laneX(l), y = world.hAt(zc) + R + s - 1 + Math.sin(t * 3 + rz) * 0.04;
  if (world.fx.magnet > 0 && !b.fly && s < FLY_H && zc - b.z < 3.5) {   // a magnet draws it in from any lane
    const k = clamp(1 - (zc - b.z) / 3.5, 0, 1) ** 2;
    wx += (b.x - wx) * k; y += (b.y - y) * k;
  }
  const [x, py, sc] = proj(wx, y, zc), r = 0.19 * sc;
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

const PIT_DEPTH = 0.75;   // how far down the walls of a pit can be seen before they are lost in the dark
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
  const amp = 0.07 + hash(rz, l, 90) * 0.11, ampZ = 0.02 + hash(rz, l, 94) * 0.05, rough = 0.01 + hash(rz, l, 91) * 0.03;
  const bite = Math.floor(hash(rz, l, 92) * 16);
  const off = (s, k) => side[s] === 'grass' ? (s === 'N' || s === 'F' ? ampZ : amp) + (hash(rz * 5 + k, l, 93) - 0.5) * 2 * rough + (k === bite ? 0.04 : 0)
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
      const t = (hash(rz, l, 100 + k) - 0.5) * 0.06;
      if (s === 'N' || s === 'F') uu += t; else ww += t;
    }
    return { x: l - HALF + uu, z: rz + ww, s };
  }).filter((p) => p.z > camZ + 0.4);
  if (pts.length < 3) return;
  const top = (p) => proj(p.x, world.hAt(p.z), p.z), down = (p) => proj(p.x, world.hAt(p.z) - PIT_DEPTH, p.z);
  const open = pts.map(top);
  const yTop = Math.min(...open.map((q) => q[1])), yBot = Math.max(...open.map((q) => q[1])), xMin = Math.min(...open.map((q) => q[0])), xMax = Math.max(...open.map((q) => q[0]));
  // trodden earth round the hole, where it meets grass
  ctx.strokeStyle = pal('soil', 8, fog); ctx.lineWidth = Math.max(1, px * 0.09); ctx.lineCap = 'round'; ctx.globalAlpha = 0.85 * (1 - fog);
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    if (side[pts[i].s] !== 'grass') continue;
    const a = open[i], b = open[(i + 1) % open.length];
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke(); ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
  ctx.save();
  blob(open); ctx.clip();
  ctx.fillStyle = pal('pit', 0, fog); ctx.fillRect(xMin - 2, yTop - 2, xMax - xMin + 4, yBot - yTop + 4);   // the dark at the bottom
  const wall = (edge, light) => {   // the wall below one edge of the opening: turf, then earth, going down into the dark
    if (edge.length < 2) return;
    const a = edge.map(top), b = edge.map(down).reverse();
    const y0 = Math.min(...a.map((q) => q[1])), y1 = Math.max(...b.map((q) => q[1]));
    const g = ctx.createLinearGradient(0, y0, 0, Math.max(y0 + 1, y1));
    g.addColorStop(0, pal('grass', light - 12, fog)); g.addColorStop(0.09, pal('soil', light + 8, fog)); g.addColorStop(0.45, pal('soil', light - 6, fog)); g.addColorStop(0.8, pal('pitWall', light - 8, fog)); g.addColorStop(1, pal('pit', 1, fog));
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
      for (let k = 0; k < 3; k++) {   // stones in the earth
        const p = far[Math.floor(hash(rz, l, 160 + k) * far.length)], q = proj(p.x + (hash(rz, l, 163 + k) - 0.5) * 0.1, world.hAt(p.z) - 0.12 - hash(rz, l, 166 + k) * 0.28, p.z), r = px * (0.025 + hash(rz, l, 169 + k) * 0.025);
        ctx.fillStyle = pal('rock', -6, fog); ctx.beginPath(); ctx.ellipse(q[0], q[1], r * 1.3, r, 0, 0, 7); ctx.fill();
      }
    }
  }
  const leftX = Math.min(...pts.filter((p) => p.s === 'L').map((p) => p.x)), rightX = Math.max(...pts.filter((p) => p.s === 'R').map((p) => p.x));
  if (side.L === 'grass' && camAcross > leftX) wall(pts.filter((p) => p.s === 'L').sort((p, q) => q.z - p.z), -9);
  if (side.R === 'grass' && camAcross < rightX) wall(pts.filter((p) => p.s === 'R').sort((p, q) => q.z - p.z), -9);
  // the near edge throws its shadow into the hole, and the turf overhangs the far wall
  const sh = ctx.createLinearGradient(0, yTop, 0, yBot);
  sh.addColorStop(0, `rgba(8,10,28,${0.3 * (1 - fog)})`); sh.addColorStop(0.18, 'rgba(8,10,28,0)'); sh.addColorStop(0.6, 'rgba(8,10,28,0)'); sh.addColorStop(1, `rgba(8,10,28,${0.5 * (1 - fog)})`);
  ctx.fillStyle = sh; ctx.fillRect(xMin - 2, yTop - 2, xMax - xMin + 4, yBot - yTop + 4);
  ctx.restore();
  // the rim: a dark lip and grass hanging over it, only where the pit meets grass
  const cx = open.reduce((s2, q) => s2 + q[0], 0) / open.length, cy = open.reduce((s2, q) => s2 + q[1], 0) / open.length;
  ctx.globalAlpha = 1 - fog;
  for (const [which, color, wdt] of [[(s2) => s2 === 'F', pal('grassHi', 10, fog), 0.04], [(s2) => s2 !== 'F', pal('grass', -18, fog), 0.03]]) {
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

// grass tufts and small things on plain ground near the camera, by biome: flowers; fallen leaves; leaves and glowing
// toadstools; flowers and sparkles; little lamps (and no grass); glowing spores
function drawDecor(rz, row, zA, px, fog, theme) {
  const blades = [], bits = [];
  for (let l = 0; l < LANES; l++) {
    if (!row.road[l] || !row.floor[l] || row.block[l] || row.low[l] || row.ramp[l]) continue;
    for (let k = 0; theme !== 'tech' && theme !== 'winter' && k < 4; k++) {   // no grass on steel or snow
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
    if (theme === 'farm' || (theme === 'magic' && h < 0.6)) drawFlower(p, r, FLOWERS[Math.floor(h * FLOWERS.length) % FLOWERS.length], fog);
    else if (theme === 'magic') glowBit(p, r * 0.7, [h < 0.8 ? 50 : 320, 95, 80], fog, false);   // a sparkle
    else if (theme === 'tech') glowBit(p, r * 0.6, h < 0.5 ? [185, 95, 60] : [35, 95, 60], fog, false);   // a little lamp
    else if (theme === 'winter') glowBit(p, r * 0.5, [200, 70, 94], fog, false);   // the snow glints
    else if (theme === 'dino') drawFlower(p, r * 1.2, TROPIC[Math.floor(h * TROPIC.length) % TROPIC.length], fog);
    else if (theme === 'sea') {
      if (h < 0.55) {   // a little shell
        ctx.fillStyle = hsl(h < 0.3 ? 350 : 30, 70, 82, fog); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.arc(p[0], p[1], r * 1.4, Math.PI * 1.1, Math.PI * 1.9); ctx.fill();
      } else { ctx.fillStyle = hsl(h < 0.8 ? 18 : 48, 90, 60, fog); starShape(p[0], p[1] - r * 0.3, r * 1.5, 0.5, h * 6); ctx.fill(); }   // a starfish
    }
    else if (theme === 'spooky' || theme === 'autumn') {
      if (h < 0.75 || theme === 'autumn') {   // a fallen leaf
        const c = LEAVES[Math.floor(h * 4 / 0.75) % 4];
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
// A low barrier: a log lying across the lane, to jump over. Logs in neighbouring lanes join into one long trunk.
function drawLog(l, rz, row, fog, px) {
  const endL = !row.low[l - 1], endR = !row.low[l + 1];
  const x0 = l - HALF + (endL ? 0.04 : 0), x1 = l - HALF + 1 - (endR ? 0.04 : 0), zf = rz + LOW_Z0, zb = rz + LOW_Z1;
  const hf = world.hAt(zf), hb = world.hAt(zb), top = LOW_H;
  const a = proj(x0, hf, zf), b = proj(x1, hf, zf);
  ctx.fillStyle = `rgba(${P.shadow.map(Math.round)},${0.3 * (1 - fog)})`;   // shadow on the grass in front
  path([proj(x0, hf, zf - 0.1), proj(x1, hf, zf - 0.1), b, a]); ctx.fill();
  // the side facing the camera: bark, darker towards the ground
  const at = proj(x0, hf + top * 0.8, zf), bt = proj(x1, hf + top * 0.8, zf);
  const g = ctx.createLinearGradient(0, at[1], 0, a[1]);
  g.addColorStop(0, pal('wood', -6, fog)); g.addColorStop(1, pal('woodDark', -8, fog));
  ctx.fillStyle = g; path([a, b, bt, at]); ctx.fill();
  // the rounded top
  const c0 = proj(x0, hf + top, (zf + zb) / 2), c1 = proj(x1, hf + top, (zf + zb) / 2), d0 = proj(x0, hb + top * 0.8, zb), d1 = proj(x1, hb + top * 0.8, zb);
  quad(at, bt, c1, c0, pal('wood', 6, fog)); quad(c0, c1, d1, d0, pal('wood', 14, fog));
  const w = Math.max(1, px * 0.018);
  for (let k = 0; k < 3; k++) {   // cracks in the bark
    const t = 0.15 + hash(rz, l, 70 + k) * 0.7, len = 0.12 + hash(rz, l, 75 + k) * 0.2, y = hf + top * (0.25 + 0.2 * k);
    line(proj(x0 + (x1 - x0) * t, y, zf), proj(x0 + (x1 - x0) * Math.min(1, t + len), y, zf), pal('woodDark', -14, fog), w, 0.7 * (1 - fog));
  }
  for (const [end, x] of [[endL, x0], [endR, x1]]) {   // the sawn ends with rings
    if (!end) continue;
    const e = proj(x, hf + top * 0.5, zf), r = (a[1] - at[1]) * 0.55;
    ctx.fillStyle = pal('wood', 22, fog); ctx.beginPath(); ctx.ellipse(e[0], e[1], r * 0.45, r, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = pal('woodDark', 0, fog); ctx.lineWidth = w; ctx.globalAlpha = 0.7 * (1 - fog);
    ctx.beginPath(); ctx.ellipse(e[0], e[1], r * 0.22, r * 0.5, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
  }
}

const obstacleFrame = (l, rz) => frameAt(laneX(l), rz);
function frameAt(xc, rz) {
  const zc = rz + 0.5, base = world.hAt(zc);
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
    if (rowTheme === 'winter') {   // a cap of snow
      ctx.save(); blob(pts); ctx.clip(); ctx.fillStyle = hsl(208, 45, 95, fog); ell(cx - rx * 0.1, cy - ry * 0.95, rx * 1.2, ry * 0.6); ctx.restore();
    }
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

// ---- trees and a haystack ----
const ell = (x, y, rx, ry, rot = 0) => { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, 7); ctx.fill(); };
function crown(x, y, r, fog, dl = 0) {
  if (r < 12 * dpr) { ctx.fillStyle = pal('bush', dl + 6, fog); ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, 7); ctx.fill(); return; }   // far away: no shading
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, 0, x, y, r);
  g.addColorStop(0, pal('bushHi', dl + 4, fog)); g.addColorStop(0.7, pal('bush', dl + 4, fog)); g.addColorStop(1, pal('bush', dl - 6, fog));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, 7); ctx.fill();
}
function tree(o, s, fog, rz, l) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * (1.8 + s * 0.5), w = o.hw, sway = Math.sin(now() * 1.2 + s * 30) * w * 0.04;
  ctx.fillStyle = pal('woodDark', 0, fog);
  ctx.beginPath(); ctx.moveTo(o.x - w * 0.2, o.bottom); ctx.lineTo(o.x - w * 0.11, o.bottom - H * 0.55); ctx.lineTo(o.x + w * 0.11, o.bottom - H * 0.55); ctx.lineTo(o.x + w * 0.2, o.bottom); ctx.fill();
  const balls = [[-0.5, 0.5, 0.5], [0.5, 0.52, 0.48], [-0.22, 0.66, 0.52], [0.26, 0.68, 0.5], [0, 0.82, 0.5]];
  for (const [dx, dy, r] of balls) crown(o.x + dx * w + sway * dy * 2, o.bottom - dy * H, r * w * 1.15, fog);
  const kind = hash(rz, l, 14);   // on the farm apples, blossom or plain; apples in autumn; golden fruit in the magic land
  if (rowTheme === 'farm' ? kind < 0.7 : rowTheme === 'autumn' ? kind < 0.35 : kind < 0.6) {
    ctx.fillStyle = rowTheme === 'magic' ? hsl(48, 100, 70, fog) : kind < 0.35 ? hsl(2, 80, 55, fog) : hsl(335, 85, 86, fog);
    for (let k = 0; k < 7; k++) {
      const [dx, dy, r] = balls[k % 5], a = hash(rz, l, 80 + k) * 6.28, d = hash(rz, l, 90 + k) * 0.7;
      ell(o.x + (dx + Math.cos(a) * r * d) * w + sway * dy * 2, o.bottom - dy * H + Math.sin(a) * r * d * w, w * 0.075, w * 0.075);
    }
  }
}
function pine(o, s, fog) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * (2 + s * 0.6), w = o.hw, sway = Math.sin(now() * 1.1 + s * 40) * w * 0.03;
  ctx.fillStyle = pal('woodDark', -4, fog); ctx.fillRect(o.x - w * 0.09, o.bottom - H * 0.22, w * 0.18, H * 0.22);
  for (let k = 0; k < 4; k++) {
    const y0 = o.bottom - H * (0.14 + k * 0.2), y1 = y0 - H * 0.34, hw = w * (0.85 - k * 0.17), x = o.x + sway * k;
    ctx.fillStyle = pal('bush', -5 + k * 3, fog); ctx.beginPath(); ctx.moveTo(x - hw, y0); ctx.lineTo(x, y1); ctx.lineTo(x + hw, y0); ctx.fill();
    ctx.fillStyle = pal('bushHi', -8 + k * 3, fog); ctx.beginPath(); ctx.moveTo(x - hw, y0); ctx.lineTo(x, y1); ctx.lineTo(x - hw * 0.15, y0); ctx.fill();
    if (rowTheme === 'winter') {   // snow lying on each tier
      const ys = y1 + (y0 - y1) * 0.55, xs = hw * 0.55;
      ctx.fillStyle = hsl(208, 40, 95, fog); ctx.beginPath(); ctx.moveTo(x, y1);
      ctx.lineTo(x + xs, ys); ctx.lineTo(x + xs * 0.5, ys - (y0 - y1) * 0.08); ctx.lineTo(x, ys + (y0 - y1) * 0.04); ctx.lineTo(x - xs * 0.5, ys - (y0 - y1) * 0.08); ctx.lineTo(x - xs, ys); ctx.fill();
    }
  }
}
function haystack(o, s, fog, rz, l) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * (0.95 + s * 0.2), w = o.hw * 0.95;
  const g = ctx.createLinearGradient(o.x - w, 0, o.x + w, 0);
  g.addColorStop(0, hsl(46, 80, 66, fog)); g.addColorStop(1, hsl(38, 70, 46, fog));
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(o.x - w, o.bottom);
  ctx.bezierCurveTo(o.x - w * 1.05, o.bottom - H * 1.25, o.x + w * 1.05, o.bottom - H * 1.25, o.x + w, o.bottom); ctx.fill();
  ctx.strokeStyle = hsl(36, 65, 36, fog); ctx.lineWidth = Math.max(1, w * 0.04); ctx.globalAlpha = 0.6;
  ctx.beginPath();
  for (let k = 0; k < 7; k++) {
    const x = o.x + (hash(rz, l, 70 + k) - 0.5) * w * 1.4, y = o.bottom - (0.15 + hash(rz, l, 78 + k) * 0.6) * H;
    ctx.moveTo(x, y); ctx.lineTo(x + (hash(rz, l, 86 + k) - 0.5) * w * 0.3, y + H * 0.16);
  }
  ctx.stroke(); ctx.globalAlpha = 1;
}

// ---- who walks across the road: (frame, seed, fog, row, lane, facing -1 | 1, walk phase) ----
function cow(o, s, fog, rz, l, dir = 1, walk = 0) {
  shadowUnder(o, fog);
  const u = o.hw / 5, x = o.x, by = o.bottom, bob = Math.abs(Math.sin(walk)) * u * 0.25;
  const white = hsl(40, 25, 96, fog), dark = hsl(22, 28, 20, fog), pink = hsl(350, 75, 82, fog);
  ctx.lineCap = 'round';
  ctx.strokeStyle = dark; ctx.lineWidth = Math.max(1, u * 0.35);   // tail
  ctx.beginPath(); ctx.moveTo(x - dir * u * 3.8, by - u * 5.2 - bob);
  ctx.quadraticCurveTo(x - dir * u * 5.2, by - u * 4.6, x - dir * u * 4.8 + Math.sin(now() * 3 + s * 9) * u * 0.6, by - u * 2.6); ctx.stroke();
  legs4(x, by, u, walk, 3.4, white, dark);
  ctx.fillStyle = pink; ell(x - dir * u * 1.3, by - u * 2.6 - bob, u * 0.9, u * 0.6);   // udder
  ctx.fillStyle = white; ell(x, by - u * 4.4 - bob, u * 4, u * 2.1);
  ctx.fillStyle = dark;   // patches
  ell(x - dir * u * 1.6, by - u * 5.1 - bob, u * 1.3, u * 0.9, 0.3 * dir); ell(x + dir * u * 0.9, by - u * 3.7 - bob, u * 1, u * 0.7, -0.4 * dir);
  ell(x - dir * u * 3.1, by - u * 3.9 - bob, u * 0.7, u * 0.9);
  const hx = x + dir * u * 4.2, hy = by - u * 5.9 - bob + Math.sin(walk * 0.5) * u * 0.25;
  ctx.fillStyle = hsl(40, 35, 80, fog);   // horns
  for (const e of [-1, 1]) { ctx.beginPath(); ctx.moveTo(hx + e * u * 0.5, hy - u * 1.1); ctx.lineTo(hx + e * u * 1.1, hy - u * 2.1); ctx.lineTo(hx + e * u * 1, hy - u * 0.9); ctx.fill(); }
  ctx.fillStyle = dark; ell(hx - u * 1.5, hy - u * 0.5, u * 0.7, u * 0.4, -0.5); ell(hx + u * 1.5, hy - u * 0.5, u * 0.7, u * 0.4, 0.5);   // ears
  ctx.fillStyle = white; ell(hx, hy, u * 1.45, u * 1.35);
  ctx.fillStyle = pink; ell(hx + dir * u * 0.3, hy + u * 0.75, u * 1.1, u * 0.7);
  ctx.fillStyle = dark;
  ell(hx + dir * u * 0.3 - u * 0.4, hy + u * 0.75, u * 0.14, u * 0.2); ell(hx + dir * u * 0.3 + u * 0.4, hy + u * 0.75, u * 0.14, u * 0.2);
  ell(hx - u * 0.55 + dir * u * 0.2, hy - u * 0.3, u * 0.2, u * 0.26); ell(hx + u * 0.55 + dir * u * 0.2, hy - u * 0.3, u * 0.2, u * 0.26);
}
function ghost(o, s, fog, rz, l, dir = 1) {
  const H = o.bottom - o.top, w = o.hw * 0.8, t = now(), x = o.x, y = o.bottom - H * 0.12 - (Math.sin(t * 2.5 + s * 9) + 1) * H * 0.07;
  halo(x, y - H * 0.5, w * 2.6, 'rgba(190,220,255,1)', 0.3 * (1 - fog));
  ctx.globalAlpha = 0.92 * (1 - fog * 0.7); ctx.fillStyle = '#f2f6ff';
  ctx.beginPath(); ctx.arc(x, y - H * 0.75, w, Math.PI, 0); ctx.lineTo(x + w, y);
  for (let k = 0; k < 4; k++) ctx.quadraticCurveTo(x + w - (k + 0.5) * w / 2, y - H * 0.16 + Math.sin(t * 5 + k) * H * 0.03, x + w - (k + 1) * w / 2, y);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1b1830';
  for (const e of [-1, 1]) ell(x + (e * 0.36 + dir * 0.18) * w, y - H * 0.8, w * 0.15, w * 0.22);
  ell(x + dir * 0.18 * w, y - H * 0.55, w * 0.16, w * 0.2 + Math.sin(t * 3 + s * 5) * w * 0.05);
  ctx.globalAlpha = 1;
}
function saucer(o, s, fog, rz, l, dir = 1) {
  shadowUnder(o, fog, 0.8);
  const H = o.bottom - o.top, w = o.hw * 1.1, t = now(), x = o.x, y = o.bottom - H * 0.5 - Math.sin(t * 3 + s * 9) * H * 0.06;
  ctx.fillStyle = `rgba(120,255,220,${0.16 * (1 - fog)})`;   // a beam down to the grass
  ctx.beginPath(); ctx.moveTo(x - w * 0.3, y); ctx.lineTo(x + w * 0.3, y); ctx.lineTo(x + w * 0.7, o.bottom); ctx.lineTo(x - w * 0.7, o.bottom); ctx.fill();
  const g = ctx.createRadialGradient(x - w * 0.2, y - H * 0.42, 0, x, y - H * 0.25, w * 0.55);
  g.addColorStop(0, hsl(170, 90, 88, fog)); g.addColorStop(1, hsl(185, 70, 50, fog));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - H * 0.08, w * 0.5, Math.PI, 0); ctx.fill();
  ctx.fillStyle = hsl(265, 25, 62, fog); ell(x, y, w, H * 0.17);
  ctx.fillStyle = hsl(265, 30, 42, fog); ell(x, y + H * 0.06, w * 0.7, H * 0.09);
  for (let k = 0; k < 5; k++) {
    ctx.fillStyle = hsl((k * 70 + t * 120) % 360, 95, 68, fog); ell(x + (k - 2) * w * 0.38, y + Math.abs(k - 2) * -H * 0.025 + H * 0.02, w * 0.07, w * 0.07);
  }
}
// ---- more to meet: the farm, autumn, the magic land, the land of robots ----
function sunflower(o, s, fog) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 1.5, w = o.hw, sway = Math.sin(now() * 1.4 + s * 20) * w * 0.05;
  for (const [dx, hh] of [[-0.5, 0.75], [0.5, 0.85], [0, 1]]) {
    const x = o.x + dx * w, ty = o.bottom - H * hh, tx = x + sway * hh * 2, r = w * 0.3;
    ctx.strokeStyle = hsl(100, 50, 32, fog); ctx.lineWidth = Math.max(1, w * 0.09); ctx.beginPath(); ctx.moveTo(x, o.bottom); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.fillStyle = hsl(105, 50, 38, fog); ell(x + w * 0.16, o.bottom - H * hh * 0.45, w * 0.2, w * 0.09, -0.5); ell(x - w * 0.16, o.bottom - H * hh * 0.6, w * 0.2, w * 0.09, 0.5);
    ctx.fillStyle = hsl(48, 100, 56, fog);
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; ell(tx + Math.cos(a) * r * 0.75, ty + Math.sin(a) * r * 0.75, r * 0.5, r * 0.26, a); }
    ctx.fillStyle = hsl(25, 55, 26, fog); ell(tx, ty, r * 0.52, r * 0.52);
  }
}
function scarecrow(o, s, fog) {
  shadowUnder(o, fog, 0.7);
  const H = (o.bottom - o.top) * 1.6, u = H / 10, x = o.x, by = o.bottom, sw = Math.sin(now() * 1.6 + s * 12) * u * 0.25;
  ctx.strokeStyle = hsl(28, 45, 30, fog); ctx.lineWidth = Math.max(1, u * 0.5);
  ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x, by - u * 8); ctx.moveTo(x - u * 3.2, by - u * 6.3 + sw); ctx.lineTo(x + u * 3.2, by - u * 6.3 - sw); ctx.stroke();
  ctx.fillStyle = hsl(s < 0.5 ? 5 : 210, 65, 50, fog);   // a shirt
  ctx.beginPath(); ctx.moveTo(x - u * 2.9, by - u * 7 + sw); ctx.lineTo(x + u * 2.9, by - u * 7 - sw); ctx.lineTo(x + u * 2.9, by - u * 5.7 - sw); ctx.lineTo(x + u * 1.3, by - u * 5.6);
  ctx.lineTo(x + u * 1.5, by - u * 3); ctx.lineTo(x - u * 1.5, by - u * 3); ctx.lineTo(x - u * 1.3, by - u * 5.6); ctx.lineTo(x - u * 2.9, by - u * 5.7 + sw); ctx.fill();
  ctx.fillStyle = hsl(45, 80, 62, fog);   // straw
  for (const e of [-1, 1]) ell(x + e * u * 3.3, by - u * 6.3 - e * sw, u * 0.6, u * 0.4);
  ell(x, by - u * 2.8, u * 1.5, u * 0.5);
  ctx.fillStyle = hsl(40, 50, 78, fog); ell(x, by - u * 8.2, u * 1.25, u * 1.3);
  ctx.fillStyle = hsl(25, 40, 20, fog); ell(x - u * 0.45, by - u * 8.4, u * 0.18, u * 0.18); ell(x + u * 0.45, by - u * 8.4, u * 0.18, u * 0.18);
  ctx.strokeStyle = hsl(25, 40, 20, fog); ctx.lineWidth = Math.max(1, u * 0.14); ctx.beginPath(); ctx.arc(x, by - u * 8.1, u * 0.55, 0.2, Math.PI - 0.2); ctx.stroke();
  ctx.fillStyle = hsl(38, 60, 45, fog); ell(x, by - u * 9.2, u * 2, u * 0.4);   // a hat
  ctx.beginPath(); ctx.moveTo(x - u * 1, by - u * 9.2); ctx.lineTo(x - u * 0.7, by - u * 10.6); ctx.lineTo(x + u * 0.7, by - u * 10.6); ctx.lineTo(x + u * 1, by - u * 9.2); ctx.fill();
}
function barn(o, s, fog) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 1.3, w = o.hw * 1.2, x = o.x, by = o.bottom;
  ctx.fillStyle = hsl(4, 62, 44, fog);
  ctx.beginPath(); ctx.moveTo(x - w * 0.85, by); ctx.lineTo(x - w * 0.85, by - H * 0.5); ctx.lineTo(x - w * 0.55, by - H * 0.82); ctx.lineTo(x, by - H); ctx.lineTo(x + w * 0.55, by - H * 0.82); ctx.lineTo(x + w * 0.85, by - H * 0.5); ctx.lineTo(x + w * 0.85, by); ctx.fill();
  ctx.strokeStyle = hsl(40, 30, 94, fog); ctx.lineWidth = Math.max(1, w * 0.07);
  ctx.beginPath(); ctx.moveTo(x - w * 0.95, by - H * 0.48); ctx.lineTo(x - w * 0.58, by - H * 0.85); ctx.lineTo(x, by - H * 1.03); ctx.lineTo(x + w * 0.58, by - H * 0.85); ctx.lineTo(x + w * 0.95, by - H * 0.48); ctx.stroke();
  ctx.strokeRect(x - w * 0.36, by - H * 0.42, w * 0.72, H * 0.42);
  ctx.beginPath(); ctx.moveTo(x - w * 0.36, by - H * 0.42); ctx.lineTo(x + w * 0.36, by); ctx.moveTo(x + w * 0.36, by - H * 0.42); ctx.lineTo(x - w * 0.36, by); ctx.stroke();
  ctx.fillStyle = hsl(40, 30, 94, fog); ell(x, by - H * 0.68, w * 0.14, w * 0.14);
}
function toadstool(o, s, fog, rz, l) {
  shadowUnder(o, fog);
  const H = o.bottom - o.top, w = o.hw;
  for (const [dx, k] of s < 0.5 ? [[0, 1]] : [[-0.4, 0.7], [0.3, 1]]) {
    const x = o.x + dx * w, hh = H * k, cw = w * 0.85 * k;
    ctx.fillStyle = hsl(45, 30, 90, fog);
    ctx.beginPath(); ctx.moveTo(x - cw * 0.3, o.bottom); ctx.quadraticCurveTo(x - cw * 0.12, o.bottom - hh * 0.4, x - cw * 0.2, o.bottom - hh * 0.6); ctx.lineTo(x + cw * 0.2, o.bottom - hh * 0.6); ctx.quadraticCurveTo(x + cw * 0.12, o.bottom - hh * 0.4, x + cw * 0.3, o.bottom); ctx.fill();
    ctx.fillStyle = hsl(2, 78, 50, fog); ctx.beginPath(); ctx.ellipse(x, o.bottom - hh * 0.58, cw, hh * 0.45, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = hsl(45, 30, 96, fog);
    for (let n = 0; n < 5; n++) ell(x + (hash(rz, l, 80 + n) - 0.5) * cw * 1.4, o.bottom - hh * (0.66 + hash(rz, l, 86 + n) * 0.28), cw * 0.1, cw * 0.08);
  }
}
// four legs that walk: `top` — where they start above the ground, in units
function legs4(x, by, u, walk, top, color, hoof, xs = [-2.7, -1.7, 1.7, 2.7]) {
  ctx.lineCap = 'round';
  xs.forEach((lx, k) => {
    const sw = Math.sin(walk + (k % 3 ? Math.PI : 0)) * u * 0.8;
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, u * 0.8);
    ctx.beginPath(); ctx.moveTo(x + lx * u, by - u * top); ctx.lineTo(x + lx * u + sw, by - u * 0.5); ctx.stroke();
    ctx.fillStyle = hoof; ctx.fillRect(x + lx * u + sw - u * 0.45, by - u * 0.6, u * 0.9, u * 0.6);
  });
  ctx.lineCap = 'butt';
}
function fox(o, s, fog, rz, l, dir = 1, walk = 0) {
  shadowUnder(o, fog, 0.9);
  const u = o.hw / 5, x = o.x, by = o.bottom, bob = Math.abs(Math.sin(walk)) * u * 0.3;
  const org = hsl(22, 88, 52, fog), dark = hsl(20, 40, 16, fog), white = hsl(40, 30, 96, fog);
  ctx.fillStyle = org; ell(x - dir * u * 4.3, by - u * 3.9 - bob, u * 2.3, u * 0.95, -dir * (0.5 + Math.sin(now() * 3 + s * 9) * 0.15));
  ctx.fillStyle = white; ell(x - dir * u * 5.9, by - u * 4.9 - bob, u * 0.9, u * 0.65, -dir * 0.5);
  legs4(x, by, u, walk, 2.6, dark, dark, [-2.3, -1.5, 1.5, 2.3]);
  ctx.fillStyle = org; ell(x, by - u * 3.3 - bob, u * 3.4, u * 1.5);
  ctx.fillStyle = white; ell(x + dir * u * 0.6, by - u * 2.6 - bob, u * 2, u * 0.7);
  const hx = x + dir * u * 3.7, hy = by - u * 4.6 - bob;
  ctx.fillStyle = org;
  for (const e of [-1, 1]) { ctx.beginPath(); ctx.moveTo(hx + e * u * 0.2, hy - u * 0.8); ctx.lineTo(hx + e * u * 1.1, hy - u * 2.3); ctx.lineTo(hx + e * u * 1.4, hy - u * 0.5); ctx.fill(); }
  ell(hx, hy, u * 1.5, u * 1.25);
  ctx.fillStyle = white; ell(hx + dir * u * 0.9, hy + u * 0.45, u * 1, u * 0.6);
  ctx.fillStyle = dark; ell(hx + dir * u * 1.8, hy + u * 0.3, u * 0.25, u * 0.22); ell(hx + dir * u * 0.3, hy - u * 0.25, u * 0.2, u * 0.24); ell(hx + dir * u * 0.3 - dir * u * 0.9, hy - u * 0.25, u * 0.2, u * 0.24);
}
function unicorn(o, s, fog, rz, l, dir = 1, walk = 0) {
  shadowUnder(o, fog);
  const u = o.hw / 5, x = o.x, by = o.bottom, bob = Math.abs(Math.sin(walk)) * u * 0.3, white = hsl(300, 30, 97, fog), gold = hsl(45, 95, 60, fog);
  const mane = [[340, 90, 70], [45, 95, 65], [190, 85, 65], [275, 70, 72]], wv = Math.sin(now() * 3 + s * 9) * u * 0.4;
  ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, u * 0.5);
  mane.forEach((c, k) => {   // tail
    ctx.strokeStyle = hsl(c[0], c[1], c[2], fog); ctx.beginPath(); ctx.moveTo(x - dir * u * 3.7, by - u * 5 - bob);
    ctx.quadraticCurveTo(x - dir * u * (5 + k * 0.3), by - u * 4.8, x - dir * u * (4.6 + k * 0.4) + wv, by - u * (2.2 + k * 0.3)); ctx.stroke();
  });
  legs4(x, by, u, walk, 3.4, white, gold);
  ctx.fillStyle = white; ell(x, by - u * 4.4 - bob, u * 3.9, u * 1.9);
  const hx = x + dir * u * 4.4, hy = by - u * 7.6 - bob;
  ctx.beginPath(); ctx.moveTo(x + dir * u * 2, by - u * 5.4 - bob); ctx.lineTo(hx - dir * u * 0.9, hy); ctx.lineTo(hx + dir * u * 0.6, hy + u * 0.8); ctx.lineTo(x + dir * u * 3.7, by - u * 3.6 - bob); ctx.fill();   // neck
  mane.forEach((c, k) => {
    ctx.strokeStyle = hsl(c[0], c[1], c[2], fog); ctx.beginPath(); ctx.moveTo(hx - dir * u * (0.9 + k * 0.1), hy - u * 0.3 + k * u * 0.9);
    ctx.lineTo(hx - dir * u * (1.9 + k * 0.25) + wv * 0.5, hy + u * (1.2 + k * 0.9)); ctx.stroke();
  });
  ctx.lineCap = 'butt';
  ctx.fillStyle = gold; ctx.beginPath(); ctx.moveTo(hx - dir * u * 0.1, hy - u * 0.9); ctx.lineTo(hx + dir * u * 0.9, hy - u * 3); ctx.lineTo(hx + dir * u * 0.6, hy - u * 0.7); ctx.fill();   // horn
  ctx.fillStyle = white; ell(hx + dir * u * 0.5, hy + u * 0.1, u * 1.6, u * 1, dir * 0.45);
  ctx.beginPath(); ctx.moveTo(hx - dir * u * 0.8, hy - u * 0.6); ctx.lineTo(hx - dir * u * 0.6, hy - u * 1.7); ctx.lineTo(hx - dir * u * 0.1, hy - u * 0.7); ctx.fill();
  ctx.fillStyle = hsl(275, 40, 25, fog); ell(hx + dir * u * 0.5, hy - u * 0.1, u * 0.2, u * 0.26);
  ctx.fillStyle = hsl(340, 80, 82, fog); ell(hx + dir * u * 1.6, hy + u * 0.75, u * 0.3, u * 0.22);
}
function lollipop(o, s, fog, rz, l) {
  shadowUnder(o, fog, 0.6);
  const H = (o.bottom - o.top) * 1.5, r = o.hw * 0.62, x = o.x, cy = o.bottom - H + r, hue = [340, 190, 45, 275][Math.floor(s * 4)];
  ctx.fillStyle = hsl(40, 30, 96, fog); ctx.fillRect(x - o.hw * 0.07, cy, o.hw * 0.14, o.bottom - cy);
  ctx.fillStyle = hsl(hue, 85, 66, fog); ell(x, cy, r, r);
  ctx.strokeStyle = hsl(40, 30, 97, fog); ctx.lineWidth = Math.max(1, r * 0.2); ctx.beginPath();
  const a0 = now() * 0.8 + s * 6;
  for (let k = 0; k <= 26; k++) { const a = a0 + k * 0.5, rr = r * 0.9 * k / 26; ctx[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  ctx.stroke();
  ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - fog)})`; ell(x - r * 0.4, cy - r * 0.45, r * 0.22, r * 0.14, -0.6);
}
function castle(o, s, fog) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 1.9, w = o.hw * 1.15, x = o.x, by = o.bottom, wall = hsl(330, 70, 86, fog), roof = hsl(275, 55, 60, fog);
  const tower = (tx, tw, th) => {
    ctx.fillStyle = wall; ctx.fillRect(tx - tw, by - th, tw * 2, th);
    ctx.fillStyle = roof; ctx.beginPath(); ctx.moveTo(tx - tw * 1.25, by - th); ctx.lineTo(tx, by - th - tw * 2.6); ctx.lineTo(tx + tw * 1.25, by - th); ctx.fill();
    ctx.strokeStyle = hsl(40, 30, 96, fog); ctx.lineWidth = Math.max(1, w * 0.03); ctx.beginPath(); ctx.moveTo(tx, by - th - tw * 2.6); ctx.lineTo(tx, by - th - tw * 3.6); ctx.stroke();
    ctx.fillStyle = hsl(45, 95, 62, fog); const fl = Math.sin(now() * 5 + th * 0.01 + s * 9) * tw * 0.15;   // a flag
    ctx.beginPath(); ctx.moveTo(tx, by - th - tw * 3.6); ctx.lineTo(tx + tw * 0.9, by - th - tw * 3.3 + fl); ctx.lineTo(tx, by - th - tw * 3); ctx.fill();
    ctx.fillStyle = hsl(48, 100, 75, fog * 0.5); ell(tx, by - th * 0.75, tw * 0.3, tw * 0.45);
  };
  tower(x - w * 0.7, w * 0.24, H * 0.55); tower(x + w * 0.7, w * 0.24, H * 0.6);
  ctx.fillStyle = hsl(325, 65, 80, fog); ctx.fillRect(x - w * 0.6, by - H * 0.36, w * 1.2, H * 0.36);
  for (let k = 0; k < 5; k++) ctx.fillRect(x - w * 0.6 + k * w * 0.27, by - H * 0.42, w * 0.14, H * 0.07);
  tower(x, w * 0.3, H * 0.72);
  ctx.fillStyle = hsl(275, 45, 40, fog); ctx.beginPath(); ctx.arc(x, by - H * 0.14, w * 0.2, Math.PI, 0); ctx.lineTo(x + w * 0.2, by); ctx.lineTo(x - w * 0.2, by); ctx.fill();
}
function robot(o, s, fog, rz, l) {
  shadowUnder(o, fog, 0.8);
  const H = (o.bottom - o.top) * 1.35, u = H / 10, x = o.x, by = o.bottom, t = now(), body = hsl(205 + s * 30, 18, 62, fog), dark = hsl(215, 20, 30, fog);
  const eye = hsl(s < 0.5 ? 185 : 40, 100, 62, fog * 0.4), wave = Math.sin(t * 3 + s * 20) * 0.5;
  ctx.fillStyle = dark; ctx.fillRect(x - u * 1.7, by - u * 2.6, u * 1.1, u * 2.6); ctx.fillRect(x + u * 0.6, by - u * 2.6, u * 1.1, u * 2.6);   // legs
  ctx.strokeStyle = dark; ctx.lineWidth = Math.max(1, u * 0.7); ctx.lineCap = 'round';   // arms: one waves
  ctx.beginPath(); ctx.moveTo(x - u * 2.3, by - u * 6.2); ctx.lineTo(x - u * 3.2, by - u * 3.8);
  ctx.moveTo(x + u * 2.3, by - u * 6.2); ctx.lineTo(x + u * 3.4 + wave * u, by - u * 8 - Math.abs(wave) * u); ctx.stroke(); ctx.lineCap = 'butt';
  ctx.fillStyle = body; ctx.fillRect(x - u * 2.2, by - u * 6.8, u * 4.4, u * 4.4);
  ctx.fillStyle = dark; ctx.fillRect(x - u * 1.4, by - u * 5.9, u * 2.8, u * 1.5);
  for (let k = 0; k < 3; k++) { ctx.fillStyle = hsl([120, 45, 0][k], 90, 60, fog * 0.4); ctx.globalAlpha = Math.sin(t * 4 + k * 2 + s * 9) > 0 ? 1 : 0.3; ell(x - u * 0.8 + k * u * 0.8, by - u * 5.15, u * 0.25, u * 0.25); }
  ctx.globalAlpha = 1;
  ctx.fillStyle = body; ctx.fillRect(x - u * 1.7, by - u * 9.6, u * 3.4, u * 2.5);   // head
  ctx.fillStyle = dark; ctx.fillRect(x - u * 1.3, by - u * 9, u * 2.6, u * 1.1);
  halo(x, by - u * 8.45, u * 2.4, eye, 0.5 * (1 - fog));
  ctx.fillStyle = eye; const look = Math.sin(t * 1.3 + s * 7) * u * 0.5;
  ell(x - u * 0.55 + look, by - u * 8.45, u * 0.32, u * 0.32); ell(x + u * 0.55 + look, by - u * 8.45, u * 0.32, u * 0.32);
  ctx.strokeStyle = dark; ctx.lineWidth = Math.max(1, u * 0.25); ctx.beginPath(); ctx.moveTo(x, by - u * 9.6); ctx.lineTo(x, by - u * 10.8); ctx.stroke();
  ctx.fillStyle = `rgba(255,80,80,${(Math.sin(t * 5 + s * 9) > 0 ? 1 : 0.3) * (1 - fog)})`; ell(x, by - u * 11, u * 0.35, u * 0.35);
}
function antenna(o, s, fog) {
  shadowUnder(o, fog, 0.6);
  const H = (o.bottom - o.top) * 2, w = o.hw * 0.6, x = o.x, by = o.bottom, t = now();
  ctx.strokeStyle = hsl(210, 15, 62, fog); ctx.lineWidth = Math.max(1, w * 0.1);
  ctx.beginPath(); ctx.moveTo(x - w, by); ctx.lineTo(x, by - H); ctx.lineTo(x + w, by);
  for (let k = 1; k < 5; k++) { const y = by - H * k / 5.5, hw = w * (1 - k / 5.5); ctx.moveTo(x - hw, y); ctx.lineTo(x + hw * (k % 2 ? 1 : -1) * 0.2 + hw * (k % 2 ? 0.8 : -0.8), y - H / 5.5 * 0.9); ctx.moveTo(x - hw, y); ctx.lineTo(x + hw, y); }
  ctx.stroke();
  const on = (t * 1.2 + s) % 1;
  ctx.strokeStyle = `rgba(90,240,255,${(1 - on) * (1 - fog)})`; ctx.lineWidth = Math.max(1, w * 0.08);
  ctx.beginPath(); ctx.arc(x, by - H, w * (0.4 + on * 1.6), -2.4, -0.74); ctx.stroke();
  halo(x, by - H, w * 1.5, 'rgba(255,70,70,1)', (Math.sin(t * 4 + s * 9) > 0 ? 0.8 : 0.15) * (1 - fog));
  ctx.fillStyle = hsl(0, 90, 60, fog * 0.4); ell(x, by - H, w * 0.16, w * 0.16);
}
function battery(o, s, fog) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 0.95, w = o.hw * 0.62, x = o.x, by = o.bottom, hue = s < 0.5 ? 150 : 185, lvl = 2 + Math.floor((now() * 0.8 + s * 4) % 3);
  halo(x, by - H * 0.5, w * 2.6, hsl(hue, 95, 60), 0.3 * (1 - fog));
  const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
  g.addColorStop(0, hsl(215, 15, 62, fog)); g.addColorStop(1, hsl(215, 20, 30, fog));
  ctx.fillStyle = g; ctx.fillRect(x - w, by - H, w * 2, H); ell(x, by, w, w * 0.25);
  ctx.fillStyle = hsl(215, 15, 72, fog); ell(x, by - H, w, w * 0.25); ctx.fillRect(x - w * 0.3, by - H * 1.12, w * 0.6, H * 0.12);
  ctx.fillStyle = hsl(hue, 95, 62, fog * 0.4);
  for (let k = 0; k < lvl; k++) ctx.fillRect(x - w * 0.62, by - H * (0.2 + k * 0.2) - H * 0.13, w * 1.24, H * 0.13);
}
function rover(o, s, fog, rz, l, dir = 1, walk = 0) {
  shadowUnder(o, fog);
  const u = o.hw / 5, x = o.x, by = o.bottom, t = now(), dark = hsl(215, 22, 26, fog);
  for (const wx of [-3, 0, 3]) {   // wheels
    ctx.fillStyle = dark; ell(x + wx * u, by - u * 1.1, u * 1.15, u * 1.15);
    ctx.strokeStyle = hsl(210, 15, 70, fog); ctx.lineWidth = Math.max(1, u * 0.25); ctx.beginPath();
    ctx.moveTo(x + wx * u - Math.cos(walk) * u * 0.8, by - u * 1.1 - Math.sin(walk) * u * 0.8); ctx.lineTo(x + wx * u + Math.cos(walk) * u * 0.8, by - u * 1.1 + Math.sin(walk) * u * 0.8); ctx.stroke();
  }
  ctx.fillStyle = hsl(28, 90, 56, fog); ctx.fillRect(x - u * 4.3, by - u * 4.6, u * 8.6, u * 3);
  ctx.fillStyle = hsl(28, 80, 42, fog); ctx.fillRect(x - u * 4.3, by - u * 2.4, u * 8.6, u * 0.8);
  ctx.fillStyle = hsl(210, 15, 70, fog); ctx.fillRect(x + dir * u * 1 - u * 1.6, by - u * 7, u * 3.2, u * 2.4);   // head
  ctx.fillStyle = dark; ctx.fillRect(x + dir * u * 1 - u * 1.2, by - u * 6.5, u * 2.4, u * 1.2);
  ctx.fillStyle = hsl(185, 100, 65, fog * 0.4); ell(x + dir * u * 1.5 - u * 0.45, by - u * 5.9, u * 0.3, u * 0.3); ell(x + dir * u * 1.5 + u * 0.45, by - u * 5.9, u * 0.3, u * 0.3);
  const on = Math.sin(t * 8) > 0;   // a beacon
  halo(x - dir * u * 2.6, by - u * 5.4, u * 3, 'rgba(255,170,40,1)', (on ? 0.7 : 0.1) * (1 - fog));
  ctx.fillStyle = hsl(40, 100, on ? 62 : 40, fog * 0.4); ctx.beginPath(); ctx.arc(x - dir * u * 2.6, by - u * 4.6, u * 0.8, Math.PI, 0); ctx.fill();
}
function factory(o, s, fog) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 1.5, w = o.hw * 1.2, x = o.x, by = o.bottom, t = now();
  ctx.fillStyle = hsl(215, 20, 26, fog); ctx.fillRect(x - w, by - H * 0.5, w * 2, H * 0.5); ctx.fillRect(x - w * 0.9, by - H * 0.8, w * 0.7, H * 0.8);
  ctx.fillRect(x + w * 0.35, by - H, w * 0.3, H);
  for (let k = 0; k < 3; k++) {   // glowing rings out of the stack
    const a = (t * 0.4 + k / 3 + s) % 1;
    ctx.strokeStyle = `rgba(90,240,255,${0.8 * (1 - a) * (1 - fog)})`; ctx.lineWidth = Math.max(1, w * 0.05);
    ctx.beginPath(); ctx.ellipse(x + w * 0.5, by - H * (1.05 + a * 0.5), w * (0.18 + a * 0.25), w * (0.07 + a * 0.08), 0, 0, 7); ctx.stroke();
  }
  for (let k = 0; k < 8; k++) {
    ctx.fillStyle = hash(k, Math.floor(s * 99), 5) < 0.5 ? hsl(185, 95, 62, fog * 0.4) : hsl(40, 95, 62, fog * 0.4);
    if (k < 5) ctx.fillRect(x - w * 0.85 + k * w * 0.36, by - H * 0.36, w * 0.2, H * 0.12); else ctx.fillRect(x - w * 0.78 + (k - 5) * w * 0.2, by - H * 0.7, w * 0.11, H * 0.1);
  }
}
function dish(o, s, fog) {
  shadowUnder(o, fog, 0.7);
  const H = (o.bottom - o.top) * 1.2, w = o.hw, x = o.x, by = o.bottom, a = Math.sin(now() * 0.5 + s * 9), cy = by - H * 0.7;
  ctx.strokeStyle = hsl(210, 15, 50, fog); ctx.lineWidth = Math.max(1, w * 0.1);
  ctx.beginPath(); ctx.moveTo(x - w * 0.4, by); ctx.lineTo(x, cy); ctx.lineTo(x + w * 0.4, by); ctx.stroke();
  ctx.fillStyle = hsl(210, 15, 82, fog); ell(x, cy, w * (0.25 + 0.6 * Math.abs(a)), w * 0.85, 0);
  ctx.fillStyle = hsl(210, 15, 60, fog); ell(x + a * w * 0.1, cy, w * (0.15 + 0.45 * Math.abs(a)), w * 0.65, 0);
  ctx.strokeStyle = hsl(210, 15, 40, fog); ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + a * w * 0.9, cy - w * 0.1); ctx.stroke();
  ctx.fillStyle = hsl(0, 90, 60, fog * 0.4); ell(x + a * w * 0.9, cy - w * 0.1, w * 0.1, w * 0.1);
}

function well(o, s, fog) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 1.35, w = o.hw * 0.8, x = o.x, by = o.bottom;
  ctx.fillStyle = pal('woodDark', 0, fog); ctx.fillRect(x - w * 0.85, by - H * 0.85, w * 0.14, H * 0.6); ctx.fillRect(x + w * 0.71, by - H * 0.85, w * 0.14, H * 0.6);
  ctx.fillStyle = pal('rock', -8, fog); ctx.fillRect(x - w, by - H * 0.36, w * 2, H * 0.36); ell(x, by, w, w * 0.22);
  ctx.fillStyle = pal('rock', 6, fog); ell(x, by - H * 0.36, w, w * 0.24);
  ctx.fillStyle = hsl(210, 60, 30, fog); ell(x, by - H * 0.36, w * 0.72, w * 0.15);
  ctx.strokeStyle = pal('rock', -18, fog); ctx.lineWidth = Math.max(1, w * 0.04); ctx.beginPath();
  for (let k = 0; k < 4; k++) { ctx.moveTo(x - w * 0.75 + k * w * 0.5, by - H * 0.3); ctx.lineTo(x - w * 0.75 + k * w * 0.5, by - H * 0.16); ctx.moveTo(x - w * 0.5 + k * w * 0.5, by - H * 0.16); ctx.lineTo(x - w * 0.5 + k * w * 0.5, by - H * 0.03); }
  ctx.moveTo(x - w, by - H * 0.16); ctx.lineTo(x + w, by - H * 0.16); ctx.stroke();
  ctx.fillStyle = hsl(s < 0.5 ? 6 : 28, 62, 46, fog); ctx.beginPath(); ctx.moveTo(x - w * 1.2, by - H * 0.82); ctx.lineTo(x, by - H * 1.12); ctx.lineTo(x + w * 1.2, by - H * 0.82); ctx.fill();
  ctx.strokeStyle = pal('woodDark', -10, fog); ctx.beginPath(); ctx.moveTo(x, by - H * 0.82); ctx.lineTo(x, by - H * 0.6); ctx.stroke();
  ctx.fillStyle = pal('wood', 0, fog); ctx.fillRect(x - w * 0.16, by - H * 0.62, w * 0.32, H * 0.14);
}
function leafPile(o, s, fog, rz, l) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 0.75, w = o.hw, x = o.x, by = o.bottom;
  ctx.fillStyle = hsl(24, 70, 40, fog); ctx.beginPath(); ctx.moveTo(x - w, by); ctx.bezierCurveTo(x - w * 0.8, by - H * 1.2, x + w * 0.8, by - H * 1.3, x + w, by); ctx.fill();
  for (let k = 0; k < 16; k++) {
    const c = LEAVES[k % 4], a = hash(rz, l, 70 + k), b = hash(rz, l, 90 + k);
    ctx.fillStyle = hsl(c[0], c[1], c[2] + 6, fog); ell(x + (a - 0.5) * w * 1.6, by - b * H * 0.85 * (1 - Math.abs(a - 0.5) * 1.5), w * 0.17, w * 0.08, a * 9);
  }
}
function cauldron(o, s, fog) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 0.95, w = o.hw * 0.9, x = o.x, by = o.bottom, t = now();
  halo(x, by - H * 0.9, w * 2.2, 'rgba(110,255,90,1)', 0.35 * (1 - fog));
  ctx.fillStyle = hsl(260, 15, 12, fog * 0.6); ell(x, by - H * 0.45, w, H * 0.5); ctx.fillRect(x - w * 0.7, by - H * 0.08, w * 0.25, H * 0.08); ctx.fillRect(x + w * 0.45, by - H * 0.08, w * 0.25, H * 0.08);
  ell(x, by - H * 0.85, w * 0.95, w * 0.24);
  ctx.fillStyle = hsl(110, 90, 55, fog * 0.4); ell(x, by - H * 0.87, w * 0.8, w * 0.17);
  for (let k = 0; k < 4; k++) {   // bubbles
    const a = (t * 0.7 + k / 4 + s) % 1;
    ctx.fillStyle = `rgba(150,255,120,${0.8 * (1 - a) * (1 - fog)})`; ell(x + (k - 1.5) * w * 0.35, by - H * (0.9 + a * 0.7), w * (0.07 + a * 0.06), w * (0.07 + a * 0.06));
  }
}
function cupcake(o, s, fog) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 1.15, w = o.hw * 0.9, x = o.x, by = o.bottom, hue = [335, 190, 275, 45][Math.floor(s * 4)];
  ctx.fillStyle = hsl(hue + 30, 60, 62, fog); ctx.beginPath(); ctx.moveTo(x - w * 0.62, by); ctx.lineTo(x - w * 0.85, by - H * 0.42); ctx.lineTo(x + w * 0.85, by - H * 0.42); ctx.lineTo(x + w * 0.62, by); ctx.fill();
  ctx.strokeStyle = hsl(hue + 30, 60, 46, fog); ctx.lineWidth = Math.max(1, w * 0.05); ctx.beginPath();
  for (let k = -2; k <= 2; k++) { ctx.moveTo(x + k * w * 0.3, by - H * 0.42); ctx.lineTo(x + k * w * 0.24, by); }
  ctx.stroke();
  ctx.fillStyle = hsl(hue, 85, 80, fog); ell(x, by - H * 0.5, w * 0.95, H * 0.17); ell(x, by - H * 0.68, w * 0.7, H * 0.15); ell(x, by - H * 0.84, w * 0.42, H * 0.12);
  ctx.fillStyle = hsl(0, 85, 52, fog); ell(x, by - H * 0.98, w * 0.17, w * 0.17);
  ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - fog)})`; ell(x - w * 0.4, by - H * 0.55, w * 0.06, w * 0.06); ell(x + w * 0.3, by - H * 0.7, w * 0.06, w * 0.06); ell(x + w * 0.5, by - H * 0.5, w * 0.06, w * 0.06);
}
function cone(o, s, fog) {
  shadowUnder(o, fog, 0.8);
  const H = (o.bottom - o.top) * 1.1, w = o.hw * 0.8, x = o.x, by = o.bottom, on = Math.sin(now() * 6 + s * 9) > 0;
  ctx.fillStyle = hsl(215, 20, 28, fog); ctx.fillRect(x - w, by - H * 0.1, w * 2, H * 0.1);
  ctx.fillStyle = hsl(28, 95, 55, fog); ctx.beginPath(); ctx.moveTo(x - w * 0.7, by - H * 0.1); ctx.lineTo(x - w * 0.14, by - H * 0.92); ctx.lineTo(x + w * 0.14, by - H * 0.92); ctx.lineTo(x + w * 0.7, by - H * 0.1); ctx.fill();
  ctx.fillStyle = hsl(40, 20, 96, fog);
  for (const [a, b] of [[0.3, 0.44], [0.58, 0.7]]) { const wa = 0.7 - (a - 0.1) * 0.68, wb = 0.7 - (b - 0.1) * 0.68; ctx.beginPath(); ctx.moveTo(x - w * wa, by - H * a); ctx.lineTo(x - w * wb, by - H * b); ctx.lineTo(x + w * wb, by - H * b); ctx.lineTo(x + w * wa, by - H * a); ctx.fill(); }
  halo(x, by - H * 0.98, w * 1.6, 'rgba(255,190,60,1)', (on ? 0.8 : 0.12) * (1 - fog));
  ctx.fillStyle = hsl(42, 100, on ? 66 : 40, fog * 0.4); ell(x, by - H * 0.98, w * 0.2, w * 0.2);
}
function meteor(o, s, fog, rz, l) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 0.95, w = o.hw * 0.95, x = o.x, cy = o.bottom - H * 0.5, pulse = 0.6 + 0.4 * Math.sin(now() * 2 + s * 20), pts = [];
  halo(x, cy, w * 2.3, 'rgba(255,120,40,1)', 0.35 * pulse * (1 - fog));
  for (let k = 0; k < 9; k++) { const a = k / 9 * 6.283, j = 0.8 + hash(rz, l, 70 + k) * 0.35; pts.push([x + Math.cos(a) * w * j, Math.min(o.bottom, cy + Math.sin(a) * H * 0.52 * j)]); }
  const g = ctx.createRadialGradient(x - w * 0.3, cy - H * 0.3, 0, x, cy, w * 1.2);
  g.addColorStop(0, hsl(20, 15, 38, fog)); g.addColorStop(1, hsl(280, 20, 12, fog));
  ctx.fillStyle = g; blob(pts); ctx.fill();
  ctx.strokeStyle = `rgba(255,${Math.round(140 + 60 * pulse)},50,${(0.6 + 0.4 * pulse) * (1 - fog)})`; ctx.lineWidth = Math.max(1, w * 0.07); ctx.lineCap = 'round'; ctx.beginPath();
  for (let k = 0; k < 3; k++) { const a = hash(rz, l, 80 + k) * 6.283; ctx.moveTo(x + Math.cos(a) * w * 0.15, cy + Math.sin(a) * H * 0.1); ctx.lineTo(x + Math.cos(a + 0.5) * w * 0.5, cy + Math.sin(a + 0.5) * H * 0.3); ctx.lineTo(x + Math.cos(a + 0.2) * w * 0.75, cy + Math.sin(a + 0.2) * H * 0.38); }
  ctx.stroke(); ctx.lineCap = 'butt';
}

const MOVERS = { farm: cow, autumn: fox, winter: penguin, spooky: ghost, magic: unicorn, sea: crab, dino: triceratops, tech: rover, alien: saucer };

// ---- buildings for the islands ----
function house(o, s, fog) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 1.25, w = o.hw * 1.15, x = o.x, by = o.bottom, wallH = H * 0.55, lit = P.glowF > 0.25;
  ctx.fillStyle = hsl(30, 30, 55, fog); ctx.fillRect(x + w * 0.35, by - H * 1.05, w * 0.22, H * 0.4);   // chimney and smoke
  for (let k = 0; k < 3; k++) {
    const a = (now() * 0.35 + k / 3 + s) % 1;
    ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - a) * (1 - fog)})`; ell(x + w * (0.46 + a * 0.5), by - H * (1.1 + a * 0.6), w * (0.1 + a * 0.16), w * (0.1 + a * 0.16));
  }
  ctx.fillStyle = hsl(42, 55, 88, fog); ctx.fillRect(x - w * 0.8, by - wallH, w * 1.6, wallH);
  ctx.fillStyle = hsl(s < 0.5 ? 6 : 212, 65, 52, fog);
  ctx.beginPath(); ctx.moveTo(x - w, by - wallH); ctx.lineTo(x, by - H); ctx.lineTo(x + w, by - wallH); ctx.fill();
  if (rowTheme === 'winter') {   // a thick roof of snow and icicles under the eaves
    ctx.fillStyle = hsl(208, 40, 96, fog); ctx.beginPath();
    ctx.moveTo(x - w * 1.06, by - wallH + H * 0.02); ctx.lineTo(x, by - H * 1.05); ctx.lineTo(x + w * 1.06, by - wallH + H * 0.02);
    ctx.lineTo(x + w * 0.8, by - wallH - H * 0.05); ctx.lineTo(x, by - H * 0.9); ctx.lineTo(x - w * 0.8, by - wallH - H * 0.05); ctx.fill();
    ctx.fillStyle = hsl(195, 60, 88, fog);
    for (let k = 0; k < 5; k++) { const ix = x - w * 0.7 + k * w * 0.35; ctx.beginPath(); ctx.moveTo(ix - w * 0.05, by - wallH + H * 0.01); ctx.lineTo(ix, by - wallH + H * (0.07 + (k % 2) * 0.04)); ctx.lineTo(ix + w * 0.05, by - wallH + H * 0.01); ctx.fill(); }
  }
  ctx.fillStyle = hsl(25, 45, 34, fog); ctx.fillRect(x - w * 0.55, by - wallH * 0.62, w * 0.36, wallH * 0.62);
  ctx.fillStyle = lit ? hsl(48, 100, 68, fog * 0.5) : hsl(200, 70, 72, fog); ctx.fillRect(x + w * 0.1, by - wallH * 0.72, w * 0.42, wallH * 0.38);
}
function windmill(o, s, fog) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 1.9, w = o.hw * 0.75, x = o.x, by = o.bottom;
  ctx.fillStyle = hsl(40, 35, 90, fog);
  ctx.beginPath(); ctx.moveTo(x - w * 0.6, by); ctx.lineTo(x - w * 0.34, by - H * 0.72); ctx.lineTo(x + w * 0.34, by - H * 0.72); ctx.lineTo(x + w * 0.6, by); ctx.fill();
  ctx.fillStyle = hsl(8, 60, 48, fog); ctx.beginPath(); ctx.moveTo(x - w * 0.45, by - H * 0.72); ctx.lineTo(x, by - H * 0.92); ctx.lineTo(x + w * 0.45, by - H * 0.72); ctx.fill();
  ctx.fillStyle = hsl(25, 45, 34, fog); ctx.fillRect(x - w * 0.14, by - H * 0.2, w * 0.28, H * 0.2);
  const hy = by - H * 0.7, a0 = now() * 0.9 + s * 6, L = H * 0.48;
  for (let k = 0; k < 4; k++) {   // sails
    const a = a0 + k * Math.PI / 2, c = Math.cos(a), sn = Math.sin(a), px = -sn * L * 0.16, py = c * L * 0.16;
    ctx.strokeStyle = hsl(25, 40, 32, fog); ctx.lineWidth = Math.max(1, w * 0.07); ctx.beginPath(); ctx.moveTo(x, hy); ctx.lineTo(x + c * L, hy + sn * L); ctx.stroke();
    ctx.fillStyle = hsl(45, 50, 82, fog);
    ctx.beginPath(); ctx.moveTo(x + c * L * 0.3, hy + sn * L * 0.3); ctx.lineTo(x + c * L, hy + sn * L); ctx.lineTo(x + c * L + px, hy + sn * L + py); ctx.lineTo(x + c * L * 0.3 + px, hy + sn * L * 0.3 + py); ctx.fill();
  }
}
function hauntedHouse(o, s, fog) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 1.9, w = o.hw, x = o.x, by = o.bottom, f = fog * 0.6;
  ctx.fillStyle = hsl(265, 22, 16, f);
  ctx.beginPath(); ctx.moveTo(x - w * 0.75, by); ctx.lineTo(x - w * 0.68, by - H * 0.5); ctx.lineTo(x + w * 0.72, by - H * 0.54); ctx.lineTo(x + w * 0.75, by); ctx.fill();
  ctx.fillRect(x + w * 0.2, by - H * 0.82, w * 0.4, H * 0.4);
  ctx.fillStyle = hsl(280, 25, 9, f);
  ctx.beginPath(); ctx.moveTo(x - w * 0.9, by - H * 0.48); ctx.lineTo(x - w * 0.2, by - H * 0.8); ctx.lineTo(x + w * 0.25, by - H * 0.52); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + w * 0.1, by - H * 0.8); ctx.lineTo(x + w * 0.4, by - H * 1.08); ctx.lineTo(x + w * 0.7, by - H * 0.8); ctx.fill();
  const fl = 0.7 + 0.3 * Math.sin(now() * 9 + s * 30) * Math.sin(now() * 5.3 + s * 7);
  ctx.fillStyle = `rgba(255,205,80,${fl * (1 - fog)})`;
  ctx.fillRect(x - w * 0.5, by - H * 0.38, w * 0.24, H * 0.14); ctx.fillRect(x + w * 0.3, by - H * 0.7, w * 0.2, H * 0.12); ctx.fillRect(x + w * 0.05, by - H * 0.22, w * 0.22, H * 0.22);
}
function dome(o, s, fog) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 1.2, w = o.hw, x = o.x, by = o.bottom;
  ctx.fillStyle = hsl(250, 20, 40, fog); ctx.fillRect(x - w, by - H * 0.14, w * 2, H * 0.14);
  const g = ctx.createRadialGradient(x - w * 0.35, by - H * 0.6, 0, x, by - H * 0.14, w);
  g.addColorStop(0, `rgba(210,255,250,${0.85 * (1 - fog)})`); g.addColorStop(1, `rgba(70,200,210,${0.5 * (1 - fog)})`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, by - H * 0.14, w * 0.92, Math.PI, 0); ctx.fill();
  ctx.fillStyle = hsl(140, 60, 45, fog); ell(x - w * 0.25, by - H * 0.2, w * 0.2, H * 0.12); ell(x + w * 0.3, by - H * 0.22, w * 0.16, H * 0.16);
  ctx.strokeStyle = hsl(250, 15, 70, fog); ctx.lineWidth = Math.max(1, w * 0.05); ctx.beginPath(); ctx.moveTo(x, by - H * 0.14 - w * 0.92); ctx.lineTo(x, by - H * 1.25); ctx.stroke();
  ctx.fillStyle = `rgba(255,90,90,${(Math.sin(now() * 4 + s * 9) > 0 ? 1 : 0.25) * (1 - fog)})`; ell(x, by - H * 1.25, w * 0.09, w * 0.09);
}
function rocket(o, s, fog, rz, l, dir = 1, walk = 0, flame = false) {
  if (!flame) shadowUnder(o, fog, 0.6);
  const H = (o.bottom - o.top) * 1.8, w = o.hw * 0.42, x = o.x, by = o.bottom - H * 0.12;
  ctx.fillStyle = hsl(5, 75, 52, fog);
  for (const e of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + e * w * 0.8, by - H * 0.3); ctx.lineTo(x + e * w * 1.9, by + H * 0.12); ctx.lineTo(x + e * w * 0.8, by); ctx.fill(); }
  if (flame) {
    const fl = 0.3 + Math.sin(now() * 40) * 0.06;
    ctx.fillStyle = hsl(40, 100, 60, fog); ctx.beginPath(); ctx.moveTo(x - w * 0.6, by); ctx.lineTo(x, by + H * fl); ctx.lineTo(x + w * 0.6, by); ctx.fill();
  }
  const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
  g.addColorStop(0, hsl(220, 15, 96, fog)); g.addColorStop(1, hsl(220, 15, 70, fog));
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - w, by); ctx.lineTo(x - w, by - H * 0.55);
  ctx.quadraticCurveTo(x - w, by - H * 0.85, x, by - H); ctx.quadraticCurveTo(x + w, by - H * 0.85, x + w, by - H * 0.55); ctx.lineTo(x + w, by); ctx.fill();
  ctx.fillStyle = hsl(5, 75, 52, fog); ctx.beginPath(); ctx.moveTo(x - w * 0.72, by - H * 0.78); ctx.quadraticCurveTo(x, by - H * 1.08, x + w * 0.72, by - H * 0.78); ctx.fill();
  ctx.fillStyle = hsl(195, 85, 70, fog); ell(x, by - H * 0.52, w * 0.45, w * 0.45);
}

// ---- islands floating beside the road, with something of the place on each ----
const SIDE = {
  farm: [tree, tree, pine, house, windmill, cow, haystack, barn, sunflower, scarecrow],
  autumn: [tree, tree, house, pumpkin, haystack, toadstool, scarecrow, barn],
  winter: [pine, pine, house, igloo, snowman, rink, giftSled, pine],
  spooky: [deadTree, hauntedHouse, pumpkin, grave, deadTree, hauntedHouse, pumpkin, skeleton],
  magic: [tree, castle, lollipop, mushroom, crystal, tree, castle],
  sea: [wreck, kelp, coral, chest, kelp, clam, anchor, coral],
  dino: [palm, palm, bronto, nest, fern, bigBone, bronto],
  tech: [robot, antenna, factory, dish, battery, rocket, dome, factory],
  alien: [crystal, mushroom, dome, rocket, crystal, mushroom],
};
const BIG = new Set([house, windmill, hauntedHouse, dome, rocket, barn, castle, factory, igloo, wreck, bronto]);
function drawSide(rz, fog, th) {
  if (rz + 0.5 < camZ + 3) return;
  for (const side of [-1, 1]) {
    if (hash(rz, side, 200) > 0.13) continue;
    const z = rz + 0.5, r = 0.9 + hash(rz, side, 201) * 1.1;
    let edge = 2.5;   // how far the road reaches on this side around here
    for (let k = Math.max(0, rz - 3); k <= rz + 3; k++) {
      const road = world.track.get(k).road;
      for (let l = 0; l < LANES; l++) if (road[l]) edge = Math.max(edge, side * (laneX(l) + side * 0.5));
    }
    const x = side * (edge + 0.5 + r + hash(rz, side, 202) ** 2 * 4);
    const y = world.hAt(z) - 0.5 + (hash(rz, side, 203) - 0.4) * 2.4 + Math.sin(now() * 0.6 + rz) * 0.07;
    const c = proj(x, y, z), sc = c[2];
    if (!(sc > 0) || c[0] < -1.6 * r * sc || c[0] > W + 1.6 * r * sc) continue;   // off the screen
    const rx = r * sc, ry = rx * 0.3, tip = (hash(rz, side, 204) - 0.5) * rx * 0.5, deep = rx * (0.7 + hash(rz, side, 205) * 0.5);
    if (rx < 40 * dpr) ctx.fillStyle = pal('soil', -4, fog);   // far away: no shading
    else {
      const g = ctx.createLinearGradient(0, c[1], 0, c[1] + deep);
      g.addColorStop(0, pal('soil', 4, fog)); g.addColorStop(1, pal('soil', -14, fog));
      ctx.fillStyle = g;
    }
    ctx.beginPath(); ctx.moveTo(c[0] - rx, c[1]);
    ctx.quadraticCurveTo(c[0] - rx * 0.55, c[1] + deep * 0.7, c[0] + tip, c[1] + deep); ctx.quadraticCurveTo(c[0] + rx * 0.6, c[1] + deep * 0.65, c[0] + rx, c[1]); ctx.fill();
    ctx.fillStyle = pal('grass', -4, fog); ell(c[0], c[1], rx, ry);
    ctx.fillStyle = pal('grass', 5, fog); ell(c[0], c[1] - ry * 0.12, rx * 0.93, ry * 0.82);
    const kinds = SIDE[th], n = 1 + Math.floor(hash(rz, side, 206) * 2.6), items = [];
    for (let k = 0; k < n; k++) {
      const fn = kinds[Math.floor(hash(rz, side, 210 + k) * kinds.length)];
      if (BIG.has(fn) && items.some((it) => BIG.has(it.fn))) continue;
      items.push({ fn, dx: n === 1 ? 0 : (k / (n - 1) - 0.5) * 1.2 + (hash(rz, side, 220 + k) - 0.5) * 0.2, dy: (hash(rz, side, 230 + k) - 0.5) * 0.9, k });
    }
    items.sort((a, b) => a.dy - b.dy);
    for (const it of items) {
      const u = sc * (BIG.has(it.fn) ? 1.9 : 1.5) * Math.min(1.2, r), bx = c[0] + it.dx * rx * 0.6, by = c[1] + it.dy * ry * 0.6;
      it.fn({ x: bx, bottom: by, top: by - 0.7 * u, hw: 0.42 * u, pc: [bx, by - 0.1 * u] }, hash(rz, side, 240 + it.k), fog, rz, side * 9 + it.k, side, 0);
    }
  }
}

// ---- what flies by: (row, z, ground height, seed, direction, time, fog) ----
const airSpot = (x, y, z, size) => {
  const p = proj(x, y, z), u = p[2] * size;
  return { x: p[0], bottom: p[1], top: p[1] - 0.7 * u, hw: 0.42 * u, pc: [p[0], p[1]], u };
};
// over the road and far out of sight, then in again from the other side
const across = (s, dir, t, speed, span = 50) => wrap(s * span + dir * t * speed, span) - span / 2;
function birds(rz, z, base, s, dir, t, fog) {
  const x0 = across(s, dir, t, 1.8), y0 = base + 2.4 + s * 2.6;
  ctx.strokeStyle = hsl(220, 25, 24, fog); ctx.lineCap = 'round';
  for (let k = 0; k < 5; k++) {
    const row = Math.ceil(k / 2), e = k % 2 ? 1 : -1;
    const p = proj(x0 - dir * row * 0.55, y0 + Math.sin(t * 2 + k) * 0.08, z + e * row * 0.45), u = p[2] * 0.26, flap = Math.sin(t * 9 + k * 1.7) * 0.6;
    if (!(u > 0)) continue;
    ctx.lineWidth = Math.max(1, u * 0.16); ctx.beginPath();
    ctx.moveTo(p[0] - u, p[1] - u * flap); ctx.quadraticCurveTo(p[0] - u * 0.5, p[1] - u * (0.35 + flap * 0.3), p[0], p[1]);
    ctx.quadraticCurveTo(p[0] + u * 0.5, p[1] - u * (0.35 + flap * 0.3), p[0] + u, p[1] - u * flap); ctx.stroke();
  }
  ctx.lineCap = 'butt';
}
function balloon(rz, z, base, s, dir, t, fog) {
  const o = airSpot(dir * (5 + s * 7) + Math.sin(t * 0.25 + s * 9) * 0.8, base + 1.6 + s * 4 + Math.sin(t * 0.7 + s * 20) * 0.3, z, 2.2), u = o.u;
  if (!(u > 0)) return;
  const x = o.x, y = o.bottom, r = u * 0.42, hue = Math.floor(s * 6) * 60;
  ctx.strokeStyle = hsl(30, 30, 30, fog); ctx.lineWidth = Math.max(1, u * 0.012);
  ctx.beginPath(); ctx.moveTo(x - r * 0.55, y - r * 1.3); ctx.lineTo(x - r * 0.2, y - r * 0.32); ctx.moveTo(x + r * 0.55, y - r * 1.3); ctx.lineTo(x + r * 0.2, y - r * 0.32); ctx.stroke();
  ctx.fillStyle = hsl(28, 50, 40, fog); ctx.fillRect(x - r * 0.24, y - r * 0.34, r * 0.48, r * 0.34);
  const cy0 = y - r * 1.9;
  ctx.fillStyle = hsl(hue, 80, 60, fog); ctx.beginPath(); ctx.arc(x, cy0, r, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - r * 0.86, cy0 + r * 0.5); ctx.lineTo(x - r * 0.3, y - r * 0.6); ctx.lineTo(x + r * 0.3, y - r * 0.6); ctx.lineTo(x + r * 0.86, cy0 + r * 0.5); ctx.fill();
  ctx.fillStyle = hsl(hue + 180, 20, 97, fog); ell(x, cy0, r * 0.62, r); ctx.fillStyle = hsl(hue + 50, 85, 62, fog); ell(x, cy0, r * 0.26, r);
}
function butterflies(rz, z, base, s, dir, t, fog) {
  for (let k = 0; k < 3; k++) {
    const h = hash(rz, k, 310), ph = t * (1.1 + h) + h * 30;
    const p = proj((h - 0.5) * 6 + Math.sin(ph) * 0.5, base + 0.55 + h * 0.6 + Math.sin(ph * 1.7) * 0.15, z + Math.cos(ph * 0.8) * 0.4), u = p[2] * 0.1;
    if (!(u > 0)) continue;
    const c = FLOWERS[1 + Math.floor(h * 5)], open = Math.abs(Math.sin(t * 11 + h * 20));
    ctx.fillStyle = hsl(c[0], c[1], c[2], fog);
    for (const e of [-1, 1]) { ell(p[0] + e * u * 0.55 * open, p[1] - u * 0.3, u * 0.6 * open + 0.3, u * 0.75, e * 0.4); ell(p[0] + e * u * 0.4 * open, p[1] + u * 0.4, u * 0.4 * open + 0.3, u * 0.5, -e * 0.4); }
    ctx.fillStyle = hsl(25, 30, 20, fog); ell(p[0], p[1], Math.max(0.5, u * 0.1), u * 0.7);
  }
}
function cloudlet(rz, z, base, s, dir, t, fog) {
  const p = proj(dir * (5.5 + s * 6) + Math.sin(t * 0.2 + s * 9) * 1.5, base - 0.5 + s * 3, z), u = p[2] * (1 + s);
  if (!(u > 0)) return;
  ctx.globalAlpha = 0.8 * (1 - fog) * P.clouds; ctx.fillStyle = css(P.cloudC);
  for (let k = 0; k < 4; k++) ell(p[0] + (k - 1.5) * u * 0.42, p[1] - (k % 2) * u * 0.16, u * 0.4, u * 0.25);
  ctx.globalAlpha = 1;
}
function bats(rz, z, base, s, dir, t, fog) {
  const x0 = across(s, dir, t, 2.6), y0 = base + 1.8 + s * 2.4;
  ctx.fillStyle = hsl(275, 30, 10, fog * 0.6);
  for (let k = 0; k < 4; k++) {
    const p = proj(x0 - dir * k * 0.6 + Math.sin(t * 3 + k * 2) * 0.2, y0 + Math.sin(t * 4 + k * 1.3) * 0.25, z + (k % 2) * 0.5), u = p[2] * 0.3, flap = Math.sin(t * 14 + k * 2) * 0.55;
    if (!(u > 0)) continue;
    ctx.beginPath(); ctx.moveTo(p[0], p[1] - u * 0.2);
    for (const e of [1, -1]) { ctx.lineTo(p[0] + e * u * 0.5, p[1] - u * (0.5 + flap)); ctx.lineTo(p[0] + e * u, p[1] - u * flap * 0.6); ctx.lineTo(p[0] + e * u * 0.6, p[1] + u * 0.1); ctx.lineTo(p[0] + e * u * 0.3, p[1] - u * 0.05); ctx.lineTo(p[0], p[1] + u * 0.25); }
    ctx.fill();
  }
}
function witch(rz, z, base, s, dir, t, fog) {
  const p = proj(across(s, dir, t, 3.2, 60), base + 3.5 + s * 2 + Math.sin(t * 1.5) * 0.3, z), u = p[2] * 0.5, x = p[0], y = p[1];
  if (!(u > 0)) return;
  ctx.strokeStyle = hsl(30, 40, 25, fog * 0.6); ctx.lineWidth = Math.max(1, u * 0.1); ctx.beginPath(); ctx.moveTo(x - dir * u * 1.5, y + u * 0.1); ctx.lineTo(x + dir * u * 1.3, y - u * 0.1); ctx.stroke();
  ctx.fillStyle = hsl(40, 60, 40, fog * 0.6); ctx.beginPath(); ctx.moveTo(x - dir * u * 1.4, y + u * 0.1); ctx.lineTo(x - dir * u * 2.2, y - u * 0.2); ctx.lineTo(x - dir * u * 2.2, y + u * 0.45); ctx.fill();
  ctx.fillStyle = hsl(275, 30, 10, fog * 0.6);
  ctx.beginPath(); ctx.moveTo(x - dir * u * 0.5, y); ctx.lineTo(x + dir * u * 0.1, y - u * 1.1); ctx.lineTo(x + dir * u * 0.5, y); ctx.fill();   // cloak
  ell(x + dir * u * 0.12, y - u * 1.2, u * 0.3, u * 0.3);
  ctx.beginPath(); ctx.moveTo(x - dir * u * 0.45, y - u * 1.38); ctx.lineTo(x + dir * u * 0.7, y - u * 1.38); ctx.lineTo(x + dir * u * 0.05, y - u * 2.3); ctx.fill();   // hat
}
function comet(rz, z, base, s, dir, t, fog) {
  const k = (t * 0.22 + s) % 1, p = proj(dir * (14 - k * 28), base + 9 - k * 6, z + 6), u = p[2];
  if (!(u > 0)) return;
  const tx = p[0] + dir * u * 3.2, ty = p[1] - u * 0.7, g = ctx.createLinearGradient(p[0], p[1], tx, ty);
  g.addColorStop(0, `rgba(200,240,255,${0.9 * (1 - fog)})`); g.addColorStop(1, 'rgba(200,240,255,0)');
  ctx.strokeStyle = g; ctx.lineWidth = Math.max(1, u * 0.16); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(tx, ty); ctx.stroke(); ctx.lineCap = 'butt';
  halo(p[0], p[1], u * 0.5, 'rgba(255,255,255,1)', 0.9 * (1 - fog));
}
function rocketFly(rz, z, base, s, dir, t, fog) {
  const k = (t * 0.12 + s) % 1, o = airSpot(dir * (-9 + k * 14), base + 0.5 + k * 9, z, 1.5);
  if (!(o.u > 0)) return;
  ctx.save(); ctx.translate(o.x, o.bottom); ctx.rotate(dir * 0.6); ctx.translate(-o.x, -o.bottom);
  rocket(o, s, fog, rz, 0, dir, 0, true);
  ctx.restore();
}
function leaves(rz, z, base, s, dir, t, fog) {   // leaves drift down across the road
  for (let k = 0; k < 7; k++) {
    const h = hash(rz, k, 320), fall = (t * (0.12 + h * 0.1) + h) % 1;
    const p = proj((h - 0.5) * 9 + dir * fall * 3 + Math.sin(t * 2 + h * 30) * 0.4, base + 3.2 * (1 - fall) + 0.1, z + (hash(rz, k, 321) - 0.5) * 2), u = p[2] * 0.11;
    if (!(u > 0)) continue;
    const c = LEAVES[k % 4];
    ctx.fillStyle = hsl(c[0], c[1], c[2] + 8, fog); ell(p[0], p[1], u, u * 0.5, t * 3 * (h + 0.3) + k);
  }
}
function fairies(rz, z, base, s, dir, t, fog) {   // little lights with wings, dancing in a ring
  const x0 = (s - 0.5) * 7, y0 = base + 1 + s * 1.5;
  for (let k = 0; k < 4; k++) {
    const a = t * (0.9 + k * 0.15) + k * 1.6, p = proj(x0 + Math.cos(a) * 0.8, y0 + Math.sin(a * 1.3) * 0.35, z + Math.sin(a) * 0.6), u = p[2] * 0.09;
    if (!(u > 0)) continue;
    const col = hsl([320, 50, 185, 275][k], 95, 78, fog * 0.4), flap = Math.abs(Math.sin(t * 16 + k));
    halo(p[0], p[1], u * 5, col, 0.55 * (1 - fog));
    ctx.fillStyle = `rgba(255,255,255,${0.75 * (1 - fog)})`; ell(p[0] - u * 0.9 * flap, p[1] - u * 0.5, u * 0.9 * flap + 0.3, u * 0.5, 0.5); ell(p[0] + u * 0.9 * flap, p[1] - u * 0.5, u * 0.9 * flap + 0.3, u * 0.5, -0.5);
    ctx.fillStyle = col; ell(p[0], p[1], u * 0.5, u * 0.5);
  }
}
function drone(rz, z, base, s, dir, t, fog) {
  const p = proj(across(s, dir, t, 1.6), base + 1.9 + s * 2.4 + Math.sin(t * 2 + s * 9) * 0.15, z), u = p[2] * 0.3, x = p[0], y = p[1];
  if (!(u > 0)) return;
  ctx.strokeStyle = hsl(210, 15, 55, fog); ctx.lineWidth = Math.max(1, u * 0.12);
  ctx.beginPath(); ctx.moveTo(x - u * 1.3, y - u * 0.25); ctx.lineTo(x + u * 1.3, y - u * 0.25); ctx.stroke();
  ctx.fillStyle = `rgba(200,240,255,${0.45 * (1 - fog)})`;
  for (const e of [-1, 1]) ell(x + e * u * 1.3, y - u * 0.4, u * 0.75 * (0.6 + 0.4 * Math.abs(Math.sin(t * 30 + e))), u * 0.12);
  ctx.fillStyle = hsl(215, 20, 32, fog); ell(x, y, u * 0.7, u * 0.4);
  ctx.fillStyle = hsl(185, 100, 65, fog * 0.4); ell(x + dir * u * 0.3, y + u * 0.05, u * 0.2, u * 0.2);
  halo(x, y + u * 0.5, u * 1.2, Math.sin(t * 6 + s * 9) > 0 ? 'rgba(255,70,70,1)' : 'rgba(80,255,120,1)', 0.7 * (1 - fog));
}
// ---- winter ----
function snowman(o, s, fog, rz, l) {
  shadowUnder(o, fog, 0.9);
  const H = (o.bottom - o.top) * 1.5, x = o.x, by = o.bottom, t = now();
  const r1 = Math.min(o.hw * 0.72, H * 0.23), r2 = r1 * 0.74, r3 = r1 * 0.56, coal = hsl(220, 20, 15, fog);
  const y1 = by - r1 * 0.92, y2 = y1 - r1 * 0.78 - r2 * 0.62, y3 = y2 - r2 * 0.72 - r3 * 0.66;
  const ball = (y, r) => {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x, y, r);
    g.addColorStop(0, hsl(205, 50, 99, fog)); g.addColorStop(1, hsl(212, 35, 80, fog));
    ctx.fillStyle = g; ell(x, y, r, r * 0.95);
  };
  ctx.strokeStyle = hsl(25, 45, 28, fog); ctx.lineWidth = Math.max(1, r2 * 0.1); ctx.lineCap = 'round';   // stick arms: one waves
  const wv = -0.9 + Math.sin(t * 4 + s * 20) * 0.45, ax = x + r2 * 0.8 + Math.cos(wv) * r2 * 1.5, ay = y2 + Math.sin(wv) * r2 * 1.5;
  ctx.beginPath(); ctx.moveTo(x - r2 * 0.8, y2); ctx.lineTo(x - r2 * 2, y2 + r2 * 0.5); ctx.moveTo(x - r2 * 1.6, y2 + r2 * 0.38); ctx.lineTo(x - r2 * 1.9, y2 + r2 * 0.05);
  ctx.moveTo(x + r2 * 0.8, y2); ctx.lineTo(ax, ay); ctx.stroke(); ctx.lineCap = 'butt';
  ball(y1, r1); ball(y2, r2); ball(y3, r3);
  ctx.fillStyle = coal;   // coal buttons and eyes, a smile
  for (let k = 0; k < 3; k++) ell(x, y2 - r2 * 0.45 + k * r2 * 0.42, r2 * 0.08, r2 * 0.08);
  for (const e of [-1, 1]) ell(x + e * r3 * 0.35, y3 - r3 * 0.18, r3 * 0.1, r3 * 0.12);
  ctx.strokeStyle = coal; ctx.lineWidth = Math.max(1, r3 * 0.08); ctx.beginPath(); ctx.arc(x, y3 + r3 * 0.05, r3 * 0.45, 0.5, Math.PI - 0.5); ctx.stroke();
  ctx.fillStyle = hsl(25, 95, 55, fog);   // a carrot nose
  ctx.beginPath(); ctx.moveTo(x - r3 * 0.05, y3 - r3 * 0.02); ctx.lineTo(x + r3 * 0.8, y3 + r3 * 0.14); ctx.lineTo(x, y3 + r3 * 0.22); ctx.fill();
  const scarf = hsl(s < 0.5 ? 0 : 140, 70, 48, fog), fl = Math.sin(t * 5 + s * 9) * r3 * 0.2;   // a scarf, its end flapping
  ctx.fillStyle = scarf; ctx.fillRect(x - r3 * 0.95, y3 + r3 * 0.68, r3 * 1.9, r3 * 0.34);
  ctx.beginPath(); ctx.moveTo(x + r3 * 0.25, y3 + r3); ctx.lineTo(x + r3 * 0.85 + fl, y3 + r3 * 1.9); ctx.lineTo(x + r3 * 0.35 + fl, y3 + r3 * 2); ctx.lineTo(x - r3 * 0.1, y3 + r3); ctx.fill();
  ctx.fillStyle = hsl(s < 0.5 ? 210 : 5, 50, 40, fog);   // a bucket for a hat
  ctx.beginPath(); ctx.moveTo(x - r3 * 0.78, y3 - r3 * 0.68); ctx.lineTo(x - r3 * 0.55, y3 - r3 * 1.55); ctx.lineTo(x + r3 * 0.55, y3 - r3 * 1.55); ctx.lineTo(x + r3 * 0.78, y3 - r3 * 0.68); ctx.fill();
}
function iceBlock(o, s, fog, rz, l) {
  shadowUnder(o, fog);
  const H = o.bottom - o.top, x = o.x, by = o.bottom;
  const block = (cx, bottom, w, h, d) => {
    const g = ctx.createLinearGradient(cx - w, bottom - h, cx + w, bottom);
    g.addColorStop(0, `hsla(192,80%,88%,${0.92 * (1 - fog * 0.5)})`); g.addColorStop(1, `hsla(200,70%,62%,${0.92 * (1 - fog * 0.5)})`);
    ctx.fillStyle = g; ctx.fillRect(cx - w, bottom - h, w * 2, h);
    ctx.fillStyle = hsl(190, 70, 94, fog); ctx.beginPath();   // the top, catching the light
    ctx.moveTo(cx - w, bottom - h); ctx.lineTo(cx + w, bottom - h); ctx.lineTo(cx + w * 0.88, bottom - h - d); ctx.lineTo(cx - w * 0.88, bottom - h - d); ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - fog)})`; ctx.lineWidth = Math.max(1, w * 0.06);   // a gleam and a crack
    ctx.beginPath(); ctx.moveTo(cx - w * 0.75, bottom - h * 0.25); ctx.lineTo(cx - w * 0.35, bottom - h * 0.85);
    ctx.moveTo(cx + w * 0.3, bottom - h * 0.2); ctx.lineTo(cx + w * 0.45, bottom - h * 0.5); ctx.lineTo(cx + w * 0.25, bottom - h * 0.7); ctx.stroke();
  };
  if (s < 0.5) block(x, by, o.hw * 0.85, H * 0.95, H * 0.22);
  else { block(x, by, o.hw * 0.88, H * 0.56, H * 0.17); block(x + o.hw * 0.12, by - H * 0.56 - H * 0.08, o.hw * 0.56, H * 0.46, H * 0.13); }
}
function giftSled(o, s, fog, rz, l) {
  shadowUnder(o, fog);
  const u = (o.bottom - o.top) / 9, w = o.hw, x = o.x, by = o.bottom, top = by - u * 2.4;
  ctx.strokeStyle = hsl(45, 70, 55, fog); ctx.lineWidth = Math.max(1, u * 0.45); ctx.lineCap = 'round';   // runners curling up in front
  ctx.beginPath(); ctx.moveTo(x - w * 0.9, by - u * 0.4); ctx.lineTo(x + w * 0.7, by - u * 0.4); ctx.quadraticCurveTo(x + w * 1.05, by - u * 0.4, x + w * 0.95, by - u * 2.2); ctx.stroke(); ctx.lineCap = 'butt';
  ctx.fillStyle = hsl(2, 70, 45, fog); ctx.fillRect(x - w * 0.9, top, w * 1.8, u * 1.3);
  const gift = (gx, gw, gh, gb, k) => {
    const c = [[205, 70, 55], [140, 55, 45], [45, 90, 58], [320, 60, 62]][Math.floor(hash(rz, l, 50 + k) * 4)];
    ctx.fillStyle = hsl(c[0], c[1], c[2], fog); ctx.fillRect(gx - gw, gb - gh, gw * 2, gh);
    ctx.fillStyle = hsl(c[0] + 180, 80, 88, fog); ctx.fillRect(gx - gw * 0.14, gb - gh, gw * 0.28, gh); ctx.fillRect(gx - gw, gb - gh * 0.55, gw * 2, gh * 0.16);
    ell(gx - gw * 0.28, gb - gh - gw * 0.12, gw * 0.3, gw * 0.16, -0.4); ell(gx + gw * 0.28, gb - gh - gw * 0.12, gw * 0.3, gw * 0.16, 0.4);   // a bow
  };
  gift(x - w * 0.42, w * 0.42, u * 3.8, top, 0); gift(x + w * 0.4, w * 0.36, u * 3, top, 1); gift(x - w * 0.05, w * 0.3, u * 2.4, top - u * 3, 2);
}
function penguin(o, s, fog, rz, l, dir = 1, walk = 0) {
  shadowUnder(o, fog, 1.1);
  const u = o.hw / 4.4, x = o.x, by = o.bottom, black = hsl(225, 25, 16, fog), white = hsl(210, 30, 97, fog), org = hsl(35, 95, 55, fog);
  const flap = Math.sin(walk * 1.3) * 0.5;
  ctx.fillStyle = `rgba(255,255,255,${0.75 * (1 - fog)})`;   // snow sprays up behind it
  for (let k = 0; k < 4; k++) ell(x - dir * u * (4.8 + k * 0.9), by - u * (0.5 + ((k * 7 + Math.floor(walk * 2)) % 3) * 0.35), u * (0.5 - k * 0.09), u * (0.45 - k * 0.08));
  ctx.fillStyle = org; ell(x - dir * u * 4.2, by - u * 0.9, u * 0.9, u * 0.35, dir * 0.3); ell(x - dir * u * 4, by - u * 1.5, u * 0.8, u * 0.3, dir * 0.5);   // feet behind
  ctx.fillStyle = black; ell(x, by - u * 1.9, u * 4.2, u * 1.8);   // sliding on its belly
  ctx.fillStyle = white; ell(x + dir * u * 0.3, by - u * 1.2, u * 3.6, u * 1.05);
  ctx.fillStyle = black;   // a flipper out to the side, flapping with joy
  ctx.save(); ctx.translate(x + dir * u * 0.6, by - u * 2.6); ctx.rotate(-dir * (0.5 + flap)); ell(-dir * u * 1.6, 0, u * 1.8, u * 0.45); ctx.restore();
  const hx = x + dir * u * 4, hy = by - u * 3.3;   // its head up, looking ahead
  ctx.fillStyle = black; ell(hx, hy, u * 1.6, u * 1.5);
  ctx.fillStyle = white; ell(hx + dir * u * 0.5, hy + u * 0.3, u * 1, u * 0.95);
  ctx.fillStyle = org; ctx.beginPath(); ctx.moveTo(hx + dir * u * 1.3, hy + u * 0.05); ctx.lineTo(hx + dir * u * 2.4, hy + u * 0.45); ctx.lineTo(hx + dir * u * 1.3, hy + u * 0.75); ctx.fill();
  ctx.fillStyle = black; ell(hx + dir * u * 0.75, hy - u * 0.2, u * 0.2, u * 0.26);
  ctx.fillStyle = white; ell(hx + dir * u * 0.8, hy - u * 0.28, u * 0.07, u * 0.08);
}
function igloo(o, s, fog) {
  shadowUnder(o, fog);
  const w = o.hw * 1.05, x = o.x, by = o.bottom, h = w * 0.85;
  const g = ctx.createRadialGradient(x - w * 0.35, by - h * 0.7, 0, x, by - h * 0.3, w * 1.1);
  g.addColorStop(0, hsl(205, 50, 99, fog)); g.addColorStop(1, hsl(212, 35, 78, fog));
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, by, w, h, 0, Math.PI, 0); ctx.fill();
  ctx.strokeStyle = hsl(212, 30, 72, fog); ctx.lineWidth = Math.max(1, w * 0.025); ctx.beginPath();   // rows of snow blocks
  for (let k = 0; k < 4; k++) {
    const y0 = by - h * k / 4, y1 = by - h * (k + 1) / 4, xw = w * Math.sqrt(1 - ((k + 1) / 4) ** 2), n = 5 - k;
    if (k < 3) { ctx.moveTo(x - xw, y1); ctx.lineTo(x + xw, y1); }
    for (let j = 1; j < n; j++) { const xx = x - xw + (j - (k % 2) * 0.5) * 2 * xw / n; ctx.moveTo(xx, y0); ctx.lineTo(xx, y1); }
  }
  ctx.stroke();
  ctx.fillStyle = hsl(208, 40, 92, fog); ctx.beginPath(); ctx.ellipse(x + w * 0.2, by, w * 0.36, h * 0.5, 0, Math.PI, 0); ctx.fill();   // the way in, warm inside
  halo(x + w * 0.2, by - h * 0.15, w * 0.6, 'rgba(255,190,90,1)', 0.5 * (1 - fog));
  ctx.fillStyle = `rgb(${Math.round(255 * (1 - fog) + FOG[0] * fog)},${Math.round(175 * (1 - fog) + FOG[1] * fog)},${Math.round(80 * (1 - fog) + FOG[2] * fog)})`;
  ctx.beginPath(); ctx.ellipse(x + w * 0.2, by, w * 0.22, h * 0.36, 0, Math.PI, 0); ctx.fill();
}
function rink(o, s, fog) {   // a skating rink: someone glides round and round
  const w = o.hw * 1.4, x = o.x, by = o.bottom - o.hw * 0.1, ry = w * 0.32, t = now();
  ctx.fillStyle = hsl(195, 60, 84, fog); ell(x, by, w, ry);
  ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - fog)})`; ell(x - w * 0.3, by - ry * 0.3, w * 0.35, ry * 0.18, -0.2);
  ctx.strokeStyle = hsl(210, 30, 97, fog); ctx.lineWidth = Math.max(1, w * 0.06); ctx.beginPath(); ctx.ellipse(x, by, w, ry, 0, 0, 7); ctx.stroke();
  const a = t * 1.1 + s * 9, sx = x + Math.cos(a) * w * 0.55, sy = by + Math.sin(a) * ry * 0.5, u = o.hw * 0.17, d = Math.sin(a) > 0 ? -1 : 1;
  ctx.strokeStyle = hsl(220, 25, 22, fog); ctx.lineWidth = Math.max(1, u * 0.4); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(sx, sy - u * 2); ctx.lineTo(sx - d * u * 0.4, sy); ctx.moveTo(sx, sy - u * 2); ctx.lineTo(sx - d * u * 1.6, sy - u * 1.2);   // one leg stretched back
  ctx.moveTo(sx - u * 0.2, sy - u * 3.4); ctx.lineTo(sx - u * 1.5, sy - u * 3); ctx.moveTo(sx + u * 0.2, sy - u * 3.4); ctx.lineTo(sx + u * 1.5, sy - u * 3.1); ctx.stroke(); ctx.lineCap = 'butt';
  ctx.fillStyle = hsl(s < 0.5 ? 330 : 200, 70, 55, fog); ell(sx, sy - u * 3, u * 0.8, u * 1.15);
  ctx.fillStyle = hsl(30, 50, 82, fog); ell(sx + d * u * 0.15, sy - u * 4.6, u * 0.55, u * 0.55);
  ctx.fillStyle = hsl(0, 75, 50, fog); ell(sx + d * u * 0.15, sy - u * 5, u * 0.55, u * 0.3); ell(sx + d * u * 0.15, sy - u * 5.4, u * 0.2, u * 0.2);
}
function bullfinches(rz, z, base, s, dir, t, fog) {
  const x0 = across(s, dir, t, 1.6), y0 = base + 2 + s * 2;
  for (let k = 0; k < 4; k++) {
    const p = proj(x0 - dir * k * 0.7, y0 + Math.sin(t * 3 + k * 1.9) * 0.15 + (k % 2) * 0.3, z + (k % 2 ? 0.5 : -0.3)), u = p[2] * 0.11;
    if (!(u > 0)) continue;
    const flap = Math.sin(t * 16 + k * 2), x = p[0], y = p[1];
    ctx.fillStyle = hsl(220, 20, 12, fog);
    ctx.beginPath(); ctx.moveTo(x - dir * u * 0.8, y - u * 0.1); ctx.lineTo(x - dir * u * 1.8, y - u * 0.45); ctx.lineTo(x - dir * u * 1.7, y + u * 0.15); ctx.fill();   // tail
    ctx.fillStyle = hsl(215, 12, 48, fog); ell(x - dir * u * 0.2, y, u * 1.1, u * 0.85);
    ctx.fillStyle = hsl(4, 80, 55, fog); ell(x + dir * u * 0.15, y + u * 0.25, u * 0.85, u * 0.6);   // the red breast
    ctx.fillStyle = hsl(220, 20, 12, fog); ell(x + dir * u * 0.8, y - u * 0.45, u * 0.5, u * 0.45);
    ctx.fillStyle = hsl(220, 15, 25, fog); ell(x - dir * u * 0.2, y - u * 0.5 - flap * u * 0.4, u * 0.9, u * 0.3 + Math.abs(flap) * u * 0.3, -dir * 0.3);
  }
}
function sleigh(rz, z, base, s, dir, t, fog) {   // a sleigh with presents high up, pulled by two reindeer
  const p = proj(across(s, dir, t, 3, 70), base + 5 + s * 2 + Math.sin(t * 1.2) * 0.3, z + 6), u = p[2] * 0.45, x = p[0], y = p[1];
  if (!(u > 0)) return;
  for (let k = 1; k < 7; k++) halo(x - dir * u * (1.2 + k * 0.8), y + Math.sin(t * 6 + k) * u * 0.15, u * 0.35, 'rgba(255,240,180,1)', 0.5 * (1 - k / 7) * (1 - fog));
  ctx.fillStyle = hsl(140, 55, 42, fog); ctx.fillRect(x - dir * u * 0.75 - u * 0.25, y - u * 0.75, u * 0.5, u * 0.45);
  ctx.fillStyle = hsl(205, 70, 58, fog); ctx.fillRect(x - dir * u * 0.2 - u * 0.2, y - u * 0.65, u * 0.4, u * 0.35);
  ctx.strokeStyle = hsl(45, 80, 60, fog); ctx.lineWidth = Math.max(1, u * 0.08); ctx.beginPath();   // runners and reins
  ctx.moveTo(x - dir * u, y + u * 0.18); ctx.lineTo(x + dir * u * 0.8, y + u * 0.18); ctx.quadraticCurveTo(x + dir * u * 1.2, y + u * 0.18, x + dir * u * 1.1, y - u * 0.1);
  ctx.moveTo(x + dir * u * 0.7, y - u * 0.35); ctx.lineTo(x + dir * u * 3.6, y - u * 0.3); ctx.stroke();
  ctx.fillStyle = hsl(2, 75, 48, fog); ctx.beginPath();
  ctx.moveTo(x - dir * u, y - u * 0.55); ctx.lineTo(x - dir * u, y); ctx.lineTo(x + dir * u * 0.6, y); ctx.quadraticCurveTo(x + dir * u * 1.05, y, x + dir * u * 0.9, y - u * 0.5);
  ctx.lineTo(x + dir * u * 0.45, y - u * 0.3); ctx.lineTo(x - dir * u * 0.6, y - u * 0.3); ctx.closePath(); ctx.fill();
  for (let k = 0; k < 2; k++) {
    const rx = x + dir * u * (2.2 + k * 1.5), ry = y - u * 0.25 + Math.sin(t * 8 + k * 2) * u * 0.1, gal = Math.sin(t * 8 + k * 2) * u * 0.25, brown = hsl(25, 45, 35, fog);
    ctx.strokeStyle = brown; ctx.lineWidth = Math.max(1, u * 0.1); ctx.beginPath();
    ctx.moveTo(rx - dir * u * 0.35, ry); ctx.lineTo(rx - dir * u * 0.55 - gal, ry + u * 0.45); ctx.moveTo(rx + dir * u * 0.35, ry); ctx.lineTo(rx + dir * u * 0.55 + gal, ry + u * 0.45);
    ctx.moveTo(rx + dir * u * 0.75, ry - u * 0.45); ctx.lineTo(rx + dir * u * 0.6, ry - u * 0.85); ctx.lineTo(rx + dir * u * 0.4, ry - u * 0.95);   // antlers
    ctx.moveTo(rx + dir * u * 0.6, ry - u * 0.7); ctx.lineTo(rx + dir * u * 0.85, ry - u * 0.9); ctx.stroke();
    ctx.fillStyle = brown; ell(rx, ry, u * 0.55, u * 0.22); ell(rx + dir * u * 0.75, ry - u * 0.35, u * 0.2, u * 0.16);
    if (k === 1) halo(rx + dir * u * 0.95, ry - u * 0.32, u * 0.3, 'rgba(255,60,60,1)', 0.9 * (1 - fog));   // the lead one has a shining red nose
  }
}

// ---- the bottom of the sea ----
function crab(o, s, fog, rz, l, dir = 1, walk = 0) {   // it faces the camera and goes sideways, as crabs do
  shadowUnder(o, fog, 1.05);
  const u = o.hw / 4.5, x = o.x, by = o.bottom, t = now(), red = hsl(6, 80, 52, fog), dark = hsl(4, 70, 34, fog), bob = Math.abs(Math.sin(walk * 2)) * u * 0.3;
  ctx.strokeStyle = dark; ctx.lineWidth = Math.max(1, u * 0.45); ctx.lineCap = 'round'; ctx.beginPath();
  for (const e of [-1, 1]) for (let k = 0; k < 3; k++) {
    const sw = Math.sin(walk * 2 + k * 2 + (e > 0 ? Math.PI : 0)) * u * 0.5;
    ctx.moveTo(x + e * u * 1.6, by - u * (2.2 - k * 0.3) - bob); ctx.lineTo(x + e * u * (3 + k * 0.6) + sw, by - u * (2.7 - k * 0.3) - bob); ctx.lineTo(x + e * u * (3.4 + k * 0.7) + sw, by - u * 0.2);
  }
  ctx.stroke();
  const snap = Math.max(0, Math.sin(t * 6 + s * 9)) * 0.6;   // claws up, snapping
  for (const e of [-1, 1]) {
    ctx.strokeStyle = red; ctx.lineWidth = Math.max(1, u * 0.6); ctx.beginPath(); ctx.moveTo(x + e * u * 2, by - u * 3 - bob); ctx.lineTo(x + e * u * 3, by - u * 4.6 - bob); ctx.stroke();
    const gap = 0.2 + snap;
    ctx.fillStyle = red; ctx.beginPath(); ctx.moveTo(x + e * u * 3.1, by - u * 5.4 - bob);
    ctx.arc(x + e * u * 3.1, by - u * 5.4 - bob, u * 1.05, -Math.PI / 2 + gap + e * 0.3, -Math.PI / 2 - gap + e * 0.3 + Math.PI * 2); ctx.closePath(); ctx.fill();
  }
  const g = ctx.createRadialGradient(x - u, by - u * 3.4 - bob, 0, x, by - u * 2.6 - bob, u * 2.8);
  g.addColorStop(0, hsl(14, 90, 64, fog)); g.addColorStop(1, hsl(4, 75, 40, fog));
  ctx.fillStyle = g; ell(x, by - u * 2.6 - bob, u * 2.6, u * 1.6);
  ctx.strokeStyle = dark; ctx.lineWidth = Math.max(1, u * 0.3);
  ctx.beginPath(); for (const e of [-1, 1]) { ctx.moveTo(x + e * u * 0.7, by - u * 3.8 - bob); ctx.lineTo(x + e * u * 0.9, by - u * 5 - bob); } ctx.stroke();
  for (const e of [-1, 1]) {   // eyes on stalks look where it goes
    ctx.fillStyle = hsl(0, 0, 98, fog); ell(x + e * u * 0.9, by - u * 5.2 - bob, u * 0.45, u * 0.45);
    ctx.fillStyle = hsl(220, 30, 10, fog); ell(x + e * u * 0.9 + dir * u * 0.18, by - u * 5.2 - bob, u * 0.22, u * 0.22);
  }
  ctx.lineWidth = Math.max(1, u * 0.2); ctx.beginPath(); ctx.arc(x, by - u * 2.8 - bob, u * 0.8, 0.5, Math.PI - 0.5); ctx.stroke();
  ctx.lineCap = 'butt';
}
function coral(o, s, fog, rz, l) {
  shadowUnder(o, fog, 0.9);
  const H = (o.bottom - o.top) * 1.4, x = o.x, by = o.bottom, hue = [345, 18, 285, 40][Math.floor(s * 4)], sway = Math.sin(now() * 1.3 + s * 20) * 0.05;
  ctx.lineCap = 'round';
  const branch = (bx, byy, len, ang, wd, depth) => {
    const a = ang + sway * (3 - depth), x2 = bx + Math.cos(a) * len, y2 = byy + Math.sin(a) * len;
    ctx.strokeStyle = hsl(hue, 75, 50 + (3 - depth) * 6, fog); ctx.lineWidth = Math.max(1, wd);
    ctx.beginPath(); ctx.moveTo(bx, byy); ctx.lineTo(x2, y2); ctx.stroke();
    if (depth <= 0) { ctx.fillStyle = hsl(hue, 85, 80, fog); ell(x2, y2, wd * 0.55, wd * 0.55); return; }
    const sp = 0.35 + hash(rz, l, 30 + depth) * 0.3;
    branch(x2, y2, len * 0.72, a - sp, wd * 0.75, depth - 1);
    branch(x2, y2, len * 0.72, a + sp, wd * 0.75, depth - 1);
  };
  branch(x, by, H * 0.32, -Math.PI / 2 + (s - 0.5) * 0.2, o.hw * 0.28, 3);
  ctx.lineCap = 'butt';
}
function clam(o, s, fog, rz, l) {   // a big shell opens slowly: a pearl inside
  shadowUnder(o, fog);
  const H = o.bottom - o.top, w = o.hw * 0.95, x = o.x, cy = o.bottom - H * 0.3, lift = Math.max(0, Math.sin(now() * 0.8 + s * 20)) * H * 0.3;
  const shell = (y0, y1) => { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, hsl(15, 70, 84, fog)); g.addColorStop(1, hsl(350, 45, 62, fog)); return g; };
  ctx.fillStyle = shell(cy, cy + H * 0.3); ctx.beginPath(); ctx.ellipse(x, cy, w, H * 0.3, 0, 0, Math.PI); ctx.fill();
  if (lift > 1) {
    ctx.fillStyle = hsl(340, 45, 32, fog); ctx.beginPath(); ctx.ellipse(x, cy, w * 0.92, lift * 0.9, 0, Math.PI, 0); ctx.fill();
    halo(x, cy - w * 0.12, w * 0.6, 'rgba(255,250,255,1)', 0.7 * Math.min(1, lift / (H * 0.2)) * (1 - fog));
    ctx.fillStyle = hsl(300, 30, 96, fog); ell(x, cy - Math.min(lift * 0.5, w * 0.15), w * 0.18, w * 0.18);
  }
  ctx.fillStyle = shell(cy - lift - H * 0.55, cy - lift); ctx.beginPath(); ctx.moveTo(x - w, cy - lift); ctx.ellipse(x, cy - lift, w, H * 0.55, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = hsl(350, 40, 58, fog); ctx.lineWidth = Math.max(1, w * 0.04); ctx.beginPath();   // ribs fanning out
  for (let k = 1; k < 7; k++) { const a = Math.PI + k * Math.PI / 7; ctx.moveTo(x, cy - lift); ctx.lineTo(x + Math.cos(a) * w * 0.95, cy - lift + Math.sin(a) * H * 0.52); }
  ctx.stroke();
}
function anchor(o, s, fog, rz, l) {
  shadowUnder(o, fog, 0.8);
  const H = (o.bottom - o.top) * 1.4, w = o.hw, iron = hsl(200, 12, 30, fog);
  ctx.save(); ctx.translate(o.x, o.bottom); ctx.rotate((s - 0.5) * 0.4);
  ctx.strokeStyle = iron; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, w * 0.16); ctx.beginPath();
  ctx.moveTo(0, -H * 0.08); ctx.lineTo(0, -H * 0.85); ctx.moveTo(-w * 0.45, -H * 0.7); ctx.lineTo(w * 0.45, -H * 0.7);
  ctx.moveTo(-w * 0.8, -H * 0.35); ctx.quadraticCurveTo(-w * 0.7, -H * 0.02, 0, -H * 0.05); ctx.quadraticCurveTo(w * 0.7, -H * 0.02, w * 0.8, -H * 0.35); ctx.stroke();
  ctx.lineWidth = Math.max(1, w * 0.09); ctx.beginPath(); ctx.arc(0, -H * 0.93, w * 0.16, 0, 7); ctx.stroke();
  ctx.fillStyle = iron; for (const e of [-1, 1]) { ctx.beginPath(); ctx.moveTo(e * w * 0.8, -H * 0.35 - w * 0.2); ctx.lineTo(e * w * 0.98, -H * 0.26); ctx.lineTo(e * w * 0.6, -H * 0.3); ctx.fill(); }
  ctx.strokeStyle = hsl(140, 50, 36, fog); ctx.lineWidth = Math.max(1, w * 0.07); ctx.beginPath();   // seaweed has grown round it
  for (let k = 0; k <= 10; k++) { const yy = -H * 0.08 - k * H * 0.065, xx = Math.sin(k * 1.3 + now() * 1.5) * w * 0.16; if (k) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy); }
  ctx.stroke(); ctx.lineCap = 'butt'; ctx.restore();
}
function chest(o, s, fog, rz, l) {   // a treasure chest: the lid lifts now and then and gold shines out
  shadowUnder(o, fog);
  const H = o.bottom - o.top, w = o.hw * 0.9, x = o.x, by = o.bottom, bh = H * 0.5, open = Math.max(0, Math.sin(now() * 0.7 + s * 20)), lift = open * H * 0.3;
  ctx.fillStyle = hsl(28, 50, 34, fog); ctx.fillRect(x - w, by - bh, w * 2, bh);
  if (open > 0.05) {
    halo(x, by - bh, w * 1.6, 'rgba(255,215,80,1)', 0.6 * open * (1 - fog));
    ctx.fillStyle = hsl(46, 95, 58, fog); ctx.beginPath(); ctx.ellipse(x, by - bh, w * 0.85, H * 0.12 * open + 1, 0, Math.PI, 0); ctx.fill();
  }
  ctx.fillStyle = hsl(28, 50, 42, fog); ctx.beginPath(); ctx.moveTo(x - w * 1.02, by - bh - lift); ctx.lineTo(x - w * 1.02, by - bh - lift - H * 0.12);
  ctx.quadraticCurveTo(x, by - bh - lift - H * 0.5, x + w * 1.02, by - bh - lift - H * 0.12); ctx.lineTo(x + w * 1.02, by - bh - lift); ctx.fill();
  ctx.fillStyle = hsl(45, 60, 50, fog);
  for (const e of [-0.6, 0.6]) { ctx.fillRect(x + e * w - w * 0.08, by - bh, w * 0.16, bh); ctx.fillRect(x + e * w - w * 0.08, by - bh - lift - H * 0.26, w * 0.16, H * 0.26); }
  ctx.fillRect(x - w * 0.13, by - bh * 0.9, w * 0.26, bh * 0.32);
}
function kelp(o, s, fog, rz, l) {
  const H = (o.bottom - o.top) * 2.2, by = o.bottom, t = now();
  ctx.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const bx = o.x + (k - 1.5) * o.hw * 0.4, h = H * (0.6 + hash(rz, l, 40 + k) * 0.4);
    ctx.strokeStyle = hsl(130 + k * 12, 55, 30 + k * 5, fog); ctx.lineWidth = Math.max(1, o.hw * 0.14);
    ctx.beginPath(); ctx.moveTo(bx, by);
    for (let j = 1; j <= 8; j++) { const q = j / 8; ctx.lineTo(bx + Math.sin(t * 1.4 + q * 4 + k) * o.hw * 0.25 * q, by - h * q); }
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}
function wreck(o, s, fog) {   // a sunken ship with a torn flag
  shadowUnder(o, fog, 1.3);
  const w = o.hw * 1.5, H = (o.bottom - o.top) * 1.6, t = now(), wood = hsl(25, 35, 26, fog);
  ctx.save(); ctx.translate(o.x, o.bottom); ctx.rotate(-0.12 + s * 0.08);
  ctx.fillStyle = hsl(28, 35, 30, fog); ctx.fillRect(-w * 0.08, -H * 1.1, w * 0.1, H * 0.7);
  ctx.fillStyle = hsl(220, 15, 15, fog); const fl = Math.sin(t * 1.5 + s * 9) * H * 0.03;
  ctx.beginPath(); ctx.moveTo(w * 0.02, -H * 1.08); ctx.lineTo(w * 0.45, -H * 1.02 + fl); ctx.lineTo(w * 0.36, -H * 0.94 + fl); ctx.lineTo(w * 0.42, -H * 0.86 + fl); ctx.lineTo(w * 0.02, -H * 0.88); ctx.fill();
  ctx.fillStyle = hsl(0, 0, 92, fog); ell(w * 0.2, -H * 0.97 + fl * 0.5, w * 0.06, w * 0.055);
  ctx.fillStyle = wood; ctx.beginPath(); ctx.moveTo(-w, -H * 0.45); ctx.lineTo(w * 0.9, -H * 0.42); ctx.lineTo(w * 1.12, -H * 0.58); ctx.lineTo(w * 0.75, 0); ctx.lineTo(-w * 0.8, 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = hsl(25, 30, 17, fog); ctx.lineWidth = Math.max(1, w * 0.02); ctx.beginPath();
  for (let k = 0; k < 3; k++) { ctx.moveTo(-w * 0.9 + k * w * 0.03, -H * (0.12 + k * 0.1)); ctx.lineTo(w * 0.85 + k * w * 0.05, -H * (0.12 + k * 0.1)); }
  ctx.stroke();
  ctx.fillStyle = hsl(190, 50, 70, fog); for (let k = 0; k < 3; k++) ell(-w * 0.45 + k * w * 0.45, -H * 0.3, w * 0.07, w * 0.07);
  ctx.fillStyle = hsl(200, 40, 12, fog); ctx.beginPath(); ctx.moveTo(-w * 0.3, -H * 0.02); ctx.lineTo(-w * 0.25, -H * 0.18); ctx.lineTo(-w * 0.12, -H * 0.12); ctx.lineTo(-w * 0.02, -H * 0.2); ctx.lineTo(w * 0.05, -H * 0.02); ctx.fill();
  ctx.restore();
}
function fishSchool(rz, z, base, s, dir, t, fog) {
  const x0 = across(s, dir, t, 1.4), y0 = base + 1.2 + s * 2.2, hue = [48, 195, 15, 290][Math.floor(s * 4)];
  for (let k = 0; k < 7; k++) {
    const p = proj(x0 - dir * hash(rz, k, 330) * 2.2, y0 + Math.sin(t * 2 + k * 1.7) * 0.12 + (hash(rz, k, 331) - 0.5) * 0.9, z + (hash(rz, k, 332) - 0.5) * 1.5), u = p[2] * 0.1;
    if (!(u > 0)) continue;
    const wag = Math.sin(t * 12 + k * 2) * u * 0.35, x = p[0], y = p[1];
    ctx.fillStyle = hsl(hue, 85, 60, fog);
    ctx.beginPath(); ctx.moveTo(x - dir * u * 0.8, y); ctx.lineTo(x - dir * u * 1.5, y - u * 0.5 + wag); ctx.lineTo(x - dir * u * 1.5, y + u * 0.5 + wag); ctx.fill();
    ell(x, y, u, u * 0.5);
    ctx.fillStyle = hsl(hue, 40, 95, fog); ell(x - dir * u * 0.1, y, u * 0.18, u * 0.45);
    ctx.fillStyle = hsl(220, 30, 12, fog); ell(x + dir * u * 0.55, y - u * 0.1, u * 0.12, u * 0.12);
  }
}
function jellyfish(rz, z, base, s, dir, t, fog) {
  const ph = t * 1.6 + s * 20, pulse = 0.5 + 0.5 * Math.sin(ph);
  const p = proj(dir * (3.8 + s * 5) + Math.sin(t * 0.3 + s * 9) * 0.6, base + 1.5 + s * 2.5 + Math.sin(ph - 1) * 0.2, z), u = p[2] * 0.35;
  if (!(u > 0)) return;
  const x = p[0], y = p[1], col = hsl(s < 0.5 ? 320 : 270, 80, 76, fog * 0.5), bw = u * (0.8 - pulse * 0.15), bh = u * (0.55 + pulse * 0.12);
  halo(x, y, u * 2, col, 0.35 * (1 - fog));
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, u * 0.06); ctx.globalAlpha = 0.7 * (1 - fog); ctx.beginPath();
  for (let k = 0; k < 5; k++) { const tx = x + (k - 2) * u * 0.28; ctx.moveTo(tx, y); for (let j = 1; j <= 6; j++) ctx.lineTo(tx + Math.sin(ph * 1.3 + j * 0.9 + k) * u * 0.15, y + j * u * 0.22); }
  ctx.stroke();
  ctx.globalAlpha = 0.85 * (1 - fog); ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(x, y, bw, bh, 0, Math.PI, 0); ctx.quadraticCurveTo(x, y + u * 0.14, x - bw, y); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.55 * (1 - fog); ell(x - bw * 0.35, y - bh * 0.55, bw * 0.2, bh * 0.15);
  ctx.globalAlpha = 1;
}
function seaTurtle(rz, z, base, s, dir, t, fog) {
  const p = proj(across(s, dir, t, 1.1), base + 2 + s * 2 + Math.sin(t * 0.8 + s * 9) * 0.2, z + 2), u = p[2] * 0.32, x = p[0], y = p[1];
  if (!(u > 0)) return;
  const paddle = Math.sin(t * 3 + s * 9) * 0.6, skin = hsl(95, 35, 52, fog);
  ctx.fillStyle = skin; ell(x - dir * u * 1, y + u * 0.1, u * 0.35, u * 0.14, -dir * 0.4);
  ctx.save(); ctx.translate(x + dir * u * 0.5, y + u * 0.05); ctx.rotate(dir * (0.5 + paddle)); ell(dir * u * 0.5, u * 0.2, u * 0.65, u * 0.18); ctx.restore();
  ell(x + dir * u * 1.35, y - u * 0.08, u * 0.36, u * 0.28);
  ctx.fillStyle = hsl(50, 40, 72, fog); ctx.fillRect(x - u, y - u * 0.02, u * 2, u * 0.16);
  ctx.fillStyle = hsl(30, 45, 34, fog); ctx.beginPath(); ctx.ellipse(x, y, u * 1.1, u * 0.65, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = hsl(40, 45, 48, fog); for (let k = -1; k <= 1; k++) ell(x + k * u * 0.5, y - u * (0.32 - Math.abs(k) * 0.08), u * 0.2, u * 0.14);
  ctx.fillStyle = hsl(220, 30, 12, fog); ell(x + dir * u * 1.5, y - u * 0.14, u * 0.07, u * 0.07);
}

// ---- dinosaurs ----
function triceratops(o, s, fog, rz, l, dir = 1, walk = 0) {   // trots across, a bit clumsy
  shadowUnder(o, fog, 1.05);
  const u = o.hw / 5, x = o.x, by = o.bottom, bob = Math.abs(Math.sin(walk * 1.4)) * u * 0.5;
  const body = hsl(s < 0.5 ? 88 : 32, 42, 46, fog), dark = hsl(s < 0.5 ? 95 : 25, 35, 30, fog), belly = hsl(48, 45, 76, fog);
  ctx.fillStyle = body; ctx.beginPath(); ctx.moveTo(x - dir * u * 3, by - u * 5 - bob);
  ctx.quadraticCurveTo(x - dir * u * 5.5, by - u * 4.6, x - dir * u * 6.2 + Math.sin(now() * 3 + s * 9) * u * 0.4, by - u * 3.2); ctx.quadraticCurveTo(x - dir * u * 5, by - u * 3.5, x - dir * u * 3, by - u * 3.3 - bob); ctx.fill();
  ctx.lineCap = 'round';
  [-2.6, -1.5, 1.5, 2.6].forEach((lx, k) => {   // thick legs
    const sw = Math.sin(walk * 1.4 + (k % 3 ? Math.PI : 0)) * u * 0.8;
    ctx.strokeStyle = k % 2 ? body : dark; ctx.lineWidth = Math.max(1, u * 1.3);
    ctx.beginPath(); ctx.moveTo(x + lx * u, by - u * 3.6 - bob); ctx.lineTo(x + lx * u + sw, by - u * 0.6); ctx.stroke();
  });
  ctx.lineCap = 'butt';
  ctx.fillStyle = body; ell(x, by - u * 4.4 - bob, u * 3.8, u * 2.2);
  ctx.fillStyle = belly; ell(x + dir * u * 0.2, by - u * 3.2 - bob, u * 2.8, u * 0.85);
  ctx.fillStyle = dark; for (let k = 0; k < 3; k++) ell(x + (k - 1) * u * 1.3, by - u * 5.6 - bob, u * 0.5, u * 0.3);
  const hx = x + dir * u * 4.2, hy = by - u * 4.6 - bob + Math.sin(walk * 0.7) * u * 0.3, fx = hx - dir * u * 0.8, fy = hy - u * 0.8;
  ctx.fillStyle = hsl(s < 0.5 ? 25 : 350, 70, 55, fog); ell(fx, fy, u * 1.9, u * 2.1);   // the frill, with knobs on its edge
  ctx.fillStyle = belly; for (let k = 0; k < 6; k++) { const a = Math.PI + (k + 0.5) * Math.PI / 6; ell(fx + Math.cos(a) * u * 1.75, fy + Math.sin(a) * u * 1.95, u * 0.28, u * 0.28); }
  ctx.fillStyle = body; ell(hx + dir * u * 0.4, hy + u * 0.2, u * 1.6, u * 1.2);
  ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(hx + dir * u * 1.6, hy - u * 0.1); ctx.lineTo(hx + dir * u * 2.5, hy + u * 0.9); ctx.lineTo(hx + dir * u * 1.3, hy + u * 1.1); ctx.fill();
  ctx.fillStyle = hsl(45, 30, 92, fog);   // three horns
  ctx.beginPath(); ctx.moveTo(hx + dir * u * 1.5, hy - u * 0.4); ctx.lineTo(hx + dir * u * 2.1, hy - u * 1.5); ctx.lineTo(hx + dir * u * 1.9, hy - u * 0.3); ctx.fill();
  for (const e of [0, 0.5]) { ctx.beginPath(); ctx.moveTo(hx + dir * u * (0.2 + e), hy - u * 0.8); ctx.lineTo(hx + dir * u * (1.6 + e), hy - u * 2.6); ctx.lineTo(hx + dir * u * (0.7 + e), hy - u * 0.6); ctx.fill(); }
  ctx.fillStyle = hsl(220, 30, 10, fog); ell(hx + dir * u * 0.6, hy - u * 0.05, u * 0.25, u * 0.3);
  ctx.fillStyle = hsl(0, 0, 98, fog); ell(hx + dir * u * 0.66, hy - u * 0.15, u * 0.08, u * 0.09);
}
function fern(o, s, fog, rz, l) {
  shadowUnder(o, fog);
  const H = (o.bottom - o.top) * 1.3, by = o.bottom, t = now(), n = 7;
  for (let k = 0; k < n; k++) {
    const q0 = k / (n - 1) - 0.5, len = H * (0.7 + 0.3 * Math.cos(q0 * 2.4)), droop = q0 * 1.6, pts = [];
    let px = o.x, py = by, a = -Math.PI / 2 + q0 * 2.2 + Math.sin(t * 1.2 + s * 20 + k) * 0.05;
    for (let j = 0; j <= 8; j++) { pts.push([px, py, a]); px += Math.cos(a) * len / 8; py += Math.sin(a) * len / 8; a += droop / 8; }
    ctx.fillStyle = pal(k % 2 ? 'bush' : 'bushHi', -4 + Math.abs(q0) * 8, fog); ctx.beginPath();   // a frond: wide in the middle, with a toothed edge
    pts.forEach(([x, y, aa], j) => { const wd = len * 0.13 * Math.sin(Math.PI * j / 8) * (j % 2 ? 1 : 0.6); ctx.lineTo(x + Math.cos(aa - Math.PI / 2) * wd, y + Math.sin(aa - Math.PI / 2) * wd); });
    for (let j = 8; j >= 0; j--) { const [x, y, aa] = pts[j], wd = len * 0.13 * Math.sin(Math.PI * j / 8) * (j % 2 ? 1 : 0.6); ctx.lineTo(x + Math.cos(aa + Math.PI / 2) * wd, y + Math.sin(aa + Math.PI / 2) * wd); }
    ctx.fill();
  }
}
function dinoEgg(o, s, fog, rz, l) {   // a big speckled egg: now and then its top lifts and a baby looks out
  shadowUnder(o, fog, 0.85);
  const H = (o.bottom - o.top) * 1.15, w = Math.min(o.hw * 0.75, H * 0.42), x = o.x, by = o.bottom - H * 0.04, cy = by - H * 0.45, ry = H * 0.47;
  const cyc = (now() * 0.22 + s) % 1, peek = cyc < 0.4 ? Math.sin(cyc / 0.4 * Math.PI) : 0, crack = cy - ry * 0.2;
  const egg = () => { ctx.beginPath(); ctx.moveTo(x, by); ctx.bezierCurveTo(x + w * 1.35, by, x + w * 0.9, cy - ry * 1.1, x, cy - ry); ctx.bezierCurveTo(x - w * 0.9, cy - ry * 1.1, x - w * 1.35, by, x, by); };
  const zig = (dir) => { for (let k = 0; k <= 6; k++) { const kk = dir > 0 ? k : 6 - k; ctx.lineTo(x - w * 1.2 + kk * w * 0.4, crack + (kk % 2 ? -1 : 1) * ry * 0.07); } };
  const paint = () => {
    const g = ctx.createRadialGradient(x - w * 0.35, cy - ry * 0.4, 0, x, cy, ry * 1.1);
    g.addColorStop(0, hsl(55, 50, 95, fog)); g.addColorStop(1, hsl(42, 35, 70, fog));
    ctx.fillStyle = g; egg(); ctx.fill();
    ctx.fillStyle = hsl(s < 0.5 ? 150 : 20, 40, 55, fog);
    for (let k = 0; k < 7; k++) ell(x + (hash(rz, l, 90 + k) - 0.5) * w * 1.3, cy + (hash(rz, l, 97 + k) - 0.55) * ry * 1.5, w * 0.11, w * 0.08);
  };
  ctx.fillStyle = hsl(40, 50, 42, fog); ell(x, by, w * 1.3, H * 0.1);   // straw under it
  if (peek > 0.02) {   // the baby
    const hy = crack - peek * ry * 0.5, hr = w * 0.55;
    ctx.fillStyle = hsl(110, 50, 55, fog); ell(x, hy, hr, hr * 0.9);
    ctx.fillStyle = hsl(0, 0, 99, fog); for (const e of [-1, 1]) ell(x + e * hr * 0.4, hy - hr * 0.15, hr * 0.26, hr * 0.3);
    ctx.fillStyle = hsl(220, 30, 10, fog); for (const e of [-1, 1]) ell(x + e * hr * 0.38, hy - hr * 0.1, hr * 0.13, hr * 0.16);
    ctx.strokeStyle = hsl(110, 40, 28, fog); ctx.lineWidth = Math.max(1, hr * 0.08); ctx.beginPath(); ctx.arc(x, hy + hr * 0.2, hr * 0.3, 0.4, Math.PI - 0.4); ctx.stroke();
  }
  ctx.save(); ctx.translate(x + w * 0.8, crack - peek * ry * 0.75); ctx.rotate(peek * 0.35); ctx.translate(-x - w * 0.8, -crack);   // the top of the shell
  ctx.beginPath(); ctx.moveTo(x - w * 1.3, cy - ry * 1.3); ctx.lineTo(x + w * 1.3, cy - ry * 1.3); ctx.lineTo(x + w * 1.3, crack); zig(-1); ctx.closePath(); ctx.save(); ctx.clip(); paint(); ctx.restore();
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.moveTo(x - w * 1.3, by + 2); ctx.lineTo(x + w * 1.3, by + 2); ctx.lineTo(x + w * 1.3, crack); zig(-1); ctx.closePath(); ctx.clip(); paint(); ctx.restore();
}
function palm(o, s, fog, rz, l) {
  shadowUnder(o, fog, 0.8);
  const H = (o.bottom - o.top) * (1.9 + s * 0.4), by = o.bottom, t = now(), lean = (s - 0.5) * o.hw, tx = o.x + lean * 2, ty = by - H;
  for (let k = 0; k < 7; k++) {   // the trunk in rings
    const q0 = k / 7, q1 = (k + 1) / 7, x0 = o.x + lean * 2 * q0 * q0, x1 = o.x + lean * 2 * q1 * q1, w0 = o.hw * (0.17 - 0.06 * q0), w1 = o.hw * (0.17 - 0.06 * q1);
    ctx.fillStyle = pal('wood', k % 2 ? 6 : -2, fog); path([[x0 - w0, by - H * q0], [x0 + w0, by - H * q0], [x1 + w1, by - H * q1 - 1], [x1 - w1, by - H * q1 - 1]]); ctx.fill();
  }
  for (let k = 0; k < 7; k++) {   // leaves drooping all round
    const a = -Math.PI / 2 + (k - 3) * 0.55 + Math.sin(t * 1.3 + s * 20 + k) * 0.05, L = H * 0.5, ex = tx + Math.cos(a) * L, ey = ty + Math.sin(a) * L * 0.4 + L * 0.45;
    const cx = tx + Math.cos(a) * L * 0.55, cy = ty + Math.sin(a) * L * 0.6 - L * 0.1, nx = -Math.sin(a) * L * 0.12, ny = Math.cos(a) * L * 0.12;
    ctx.fillStyle = pal(k % 2 ? 'bush' : 'bushHi', 0, fog); ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(cx + nx, cy + ny, ex, ey); ctx.quadraticCurveTo(cx - nx, cy - ny, tx, ty); ctx.fill();
  }
  ctx.fillStyle = hsl(28, 50, 28, fog); for (const e of [-1, 0, 1]) ell(tx + e * o.hw * 0.12, ty + o.hw * 0.12 + Math.abs(e) * o.hw * 0.03, o.hw * 0.1, o.hw * 0.1);
}
function bigBone(o, s, fog, rz, l) {
  shadowUnder(o, fog, 0.8);
  const H = (o.bottom - o.top) * 1.2, w = o.hw, bone = hsl(42, 30, 88, fog);
  ctx.save(); ctx.translate(o.x, o.bottom); ctx.rotate((s - 0.5) * 0.6);
  ctx.fillStyle = bone; ctx.fillRect(-w * 0.17, -H * 0.85, w * 0.34, H * 0.75);
  for (const yy of [-H * 0.88, -H * 0.1]) for (const e of [-1, 1]) ell(e * w * 0.2, yy, w * 0.24, w * 0.22);
  ctx.fillStyle = hsl(40, 25, 72, fog); ctx.fillRect(w * 0.05, -H * 0.8, w * 0.1, H * 0.65);
  ctx.restore();
  ctx.fillStyle = pal('soil', 10, fog); ctx.beginPath(); ctx.ellipse(o.x, o.bottom, w * 0.7, (o.bottom - o.top) * 0.14, 0, Math.PI, 0); ctx.fill();
}
function bronto(o, s, fog, rz, l) {   // a long neck up to a tree top, chewing
  shadowUnder(o, fog, 1.4);
  const u = o.hw / 4, x = o.x, by = o.bottom, t = now(), dir = s < 0.5 ? -1 : 1, body = hsl(s < 0.5 ? 165 : 200, 25, 50, fog), dark = hsl(s < 0.5 ? 165 : 200, 22, 38, fog);
  ctx.fillStyle = body; ctx.beginPath(); ctx.moveTo(x - dir * u * 2.5, by - u * 4.5);
  ctx.quadraticCurveTo(x - dir * u * 6, by - u * 4, x - dir * u * 7.5, by - u * 1.5 + Math.sin(t * 1.2 + s * 9) * u * 0.3); ctx.quadraticCurveTo(x - dir * u * 5.5, by - u * 3, x - dir * u * 2.5, by - u * 2.8); ctx.fill();
  ctx.fillStyle = dark; for (const lx of [-2.4, -1.2, 1.2, 2.4]) ctx.fillRect(x + lx * u - u * 0.6, by - u * 3, u * 1.2, u * 3);
  ctx.fillStyle = body; ell(x, by - u * 4.2, u * 3.8, u * 2.3);
  const hx = x + dir * u * 5.5, hy = by - u * 11.5 + Math.sin(t * 1.5 + s * 9) * u * 0.3;
  ctx.strokeStyle = body; ctx.lineWidth = u * 1.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x + dir * u * 2.5, by - u * 5);
  ctx.quadraticCurveTo(x + dir * u * 4.2, by - u * 8, hx - dir * u * 0.5, hy + u * 0.4); ctx.stroke(); ctx.lineCap = 'butt';
  ell(hx, hy, u * 1.1, u * 0.7);
  ctx.fillStyle = hsl(220, 30, 10, fog); ell(hx + dir * u * 0.2, hy - u * 0.2, u * 0.15, u * 0.18);
  ctx.fillStyle = pal('bush', 6, fog); ell(hx + dir * u * 1.1, hy + u * 0.3, u * 0.55, u * 0.3, 0.4);   // a mouthful of leaves
}
function nest(o, s, fog) {
  const w = o.hw * 1.1, x = o.x, by = o.bottom, t = now();
  ctx.fillStyle = hsl(38, 45, 32, fog); ell(x, by - w * 0.15, w, w * 0.35);
  for (let k = 0; k < 3; k++) {
    const wob = k === 1 && (t + s * 5) % 3 < 0.6 ? Math.sin(t * 25) * 0.18 : 0;   // one of them wobbles: someone in there is about to hatch
    ctx.fillStyle = hsl(50, 40, 90, fog); ell(x + (k - 1) * w * 0.45, by - w * 0.4, w * 0.24, w * 0.32, wob);
    ctx.fillStyle = hsl(150, 35, 55, fog); ell(x + (k - 1) * w * 0.45 + w * 0.05, by - w * 0.45, w * 0.06, w * 0.05);
  }
  ctx.fillStyle = hsl(38, 50, 44, fog); ctx.beginPath(); ctx.ellipse(x, by - w * 0.15, w, w * 0.35, 0, 0, Math.PI); ctx.fill();
}
function ptero(rz, z, base, s, dir, t, fog) {
  const p = proj(across(s, dir, t, 2.2, 60), base + 3.2 + s * 2.5 + Math.sin(t * 1.1 + s * 9) * 0.3, z + 1), u = p[2] * 0.45, x = p[0], y = p[1];
  if (!(u > 0)) return;
  const flap = Math.sin(t * 4 + s * 9), col = hsl(18, 45, 40, fog), mem = hsl(22, 55, 56, fog);
  for (const [e, c] of [[0.15, col], [-0.1, mem]]) {   // the far wing, then the near one
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x + dir * u * 0.4, y); ctx.lineTo(x - dir * u * (0.1 - e), y - u * 1.6 * flap); ctx.lineTo(x - dir * u * 0.5, y + u * 0.1); ctx.fill();
  }
  ctx.fillStyle = col; ell(x, y, u * 0.7, u * 0.2); ell(x + dir * u * 0.85, y - u * 0.15, u * 0.3, u * 0.15);
  ctx.beginPath(); ctx.moveTo(x + dir * u * 1, y - u * 0.2); ctx.lineTo(x + dir * u * 1.7, y - u * 0.05); ctx.lineTo(x + dir * u * 1, y - u * 0.05); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + dir * u * 0.75, y - u * 0.25); ctx.lineTo(x + dir * u * 0.25, y - u * 0.55); ctx.lineTo(x + dir * u * 0.6, y - u * 0.15); ctx.fill();
}
function dragonflies(rz, z, base, s, dir, t, fog) {
  for (let k = 0; k < 2; k++) {
    const h = hash(rz, k, 340), ph = t * (0.6 + h * 0.4) + h * 30;
    const p = proj((h - 0.5) * 7 + Math.sin(ph) * 1.2, base + 0.9 + h * 0.8 + Math.sin(ph * 1.7) * 0.15, z + Math.cos(ph * 0.9) * 0.5), u = p[2] * 0.16;
    if (!(u > 0)) continue;
    const d = Math.cos(ph) > 0 ? 1 : -1, x = p[0], y = p[1], flick = 0.6 + 0.4 * Math.abs(Math.sin(t * 40 + k));
    ctx.fillStyle = `rgba(220,245,255,${0.55 * (1 - fog)})`;
    for (const e of [-1, 1]) for (const wx of [0.2, -0.25]) ell(x + d * u * wx, y + e * u * 0.42 * flick, u * 0.55, u * 0.16, e * d * (wx > 0 ? 0.3 : -0.3));
    ctx.strokeStyle = hsl(h < 0.5 ? 195 : 140, 85, 48, fog); ctx.lineWidth = Math.max(1, u * 0.22); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - d * u * 1.4, y); ctx.lineTo(x + d * u * 0.6, y); ctx.stroke(); ctx.lineCap = 'butt';
    ctx.fillStyle = hsl(h < 0.5 ? 195 : 140, 85, 40, fog); ell(x + d * u * 0.75, y, u * 0.25, u * 0.25);
  }
}

const FLY = {
  farm: [birds, balloon, butterflies, cloudlet, birds, balloon, butterflies],
  autumn: [leaves, birds, cloudlet, leaves, balloon],
  winter: [bullfinches, sleigh, bullfinches],
  // nothing here or on the islands looks like what walks across the road, but for the farm's cow, which grazes
  // well away from it: a fox, a penguin, a ghost, a unicorn, a crab, a triceratops, a rover or a saucer is always
  // the real thing
  spooky: [bats, witch, bats],
  magic: [fairies, butterflies, balloon, fairies, cloudlet],
  sea: [fishSchool, jellyfish, fishSchool, seaTurtle],
  dino: [ptero, dragonflies, ptero, dragonflies, cloudlet],
  tech: [drone, drone, rocketFly, drone],
  alien: [comet, rocketFly, comet],
};
function drawFlyers(rz, fog, th) {
  if (hash(rz, 5, 300) > 0.09 || rz + 0.5 < camZ + 2 || world.ball.fly) return;   // nothing else in the air during a flight: it would be in the way
  const kinds = FLY[th], s = hash(rz, 5, 302);
  kinds[Math.floor(hash(rz, 5, 301) * kinds.length)](rz, rz + 0.5, world.hAt(rz + 0.5), s, hash(rz, 5, 303) < 0.5 ? -1 : 1, now(), fog);
}

const OBSTACLES = {
  farm: [rock, bush, tree, pine, haystack, tree, sunflower, scarecrow, well],
  autumn: [tree, pumpkin, haystack, toadstool, rock, tree, scarecrow, leafPile],
  winter: [snowman, pine, iceBlock, snowman, giftSled, rock, pine, iceBlock],
  spooky: [pumpkin, grave, deadTree, skeleton, zombie, cauldron],
  magic: [tree, lollipop, mushroom, crystal, lollipop, cupcake],
  sea: [coral, coral, clam, anchor, chest, rock, clam],
  dino: [fern, dinoEgg, palm, rock, fern, bigBone, dinoEgg],
  tech: [robot, antenna, battery, robot, cone],
  alien: [crystal, mushroom, meteor],
};

// every biome has everything it needs: a new one that is only half there must fail at once, not half a run in
(function checkBiomes() {
  if (PAL.length !== THEMES.length) throw new Error(`biomes: ${THEMES.length} names in THEMES, ${PAL.length} key frames in PAL`);
  PAL.forEach((f, i) => { for (const k in f) if (!(k in PAL[0])) throw new Error(`biomes: PAL[${i}].${k} is not in PAL[0]`); });
  for (const [name, table] of Object.entries({ MOVERS, SIDE, FLY, OBSTACLES })) {
    for (const th of THEMES) if (!(typeof table[th] === 'function' || table[th]?.length > 0)) throw new Error(`biomes: no ${name}.${th}`);
  }
})();

// ---- pets: a hamster, a kitten, a chick running inside a clear ball ----
// Seen from behind in a run (its feet take turns, its head turns with a lane change and shows an eye), face on at
// home. They draw on `pc`: the game's canvas, or a small one for the icon of a pet just opened.
let pc = ctx;
const PETS = {
  hamster: { glass: [120, 190, 255], fur: ['#ffc98a', '#e8933f', '#c06a22'], pale: '#fff3e2', ear: '#c97434', inner: '#ffb0b5', pad: '#ffb0b5', eye: '#2a1a12' },
  kitten: { glass: [255, 150, 195], fur: ['#e3e7ec', '#aab2bd', '#7c8592'], pale: '#f7f8fa', ear: '#8a93a0', inner: '#ffb3c6', pad: '#ffc0cf', eye: '#22301f', iris: '#8fd16d', stripe: '#6c7480' },
  chick: { glass: [110, 215, 170], fur: ['#fff7a8', '#ffd93a', '#f2aa1c'], pale: '#fff9c8', pad: '#ff9a2e', eye: '#2a2010', beak: '#ff9228' },
};
function oval(x, y, rx, ry, fill, rot = 0) { pc.fillStyle = fill; pc.beginPath(); pc.ellipse(x, y, rx, ry, rot, 0, 7); pc.fill(); }
function furG(k, x, y, r) {   // fur lit from above: light on top, darker underneath
  const g = pc.createRadialGradient(x - r * 0.2, y - r * 0.5, r * 0.1, x, y, r * 1.1);
  g.addColorStop(0, k.fur[0]); g.addColorStop(0.55, k.fur[1]); g.addColorStop(1, k.fur[2]); return g;
}
// the glass ball with the pet inside; in unit coordinates the ball is a circle of radius 1 about (0, 0)
function drawPet(pet, px, py, r, front) {
  const k = PETS[pet], b = world.ball, t = now(), g = k.glass.join(',');
  const air = b.air && !front, run = front ? t * 1.2 : b.z * 2.4, ph = Math.sin(run * Math.PI);
  let gr = pc.createRadialGradient(px, py, r * 0.2, px, py, r);   // the back of the glass: clear, tinted at the rim
  gr.addColorStop(0, `rgba(${g},.05)`); gr.addColorStop(0.72, `rgba(${g},.16)`); gr.addColorStop(1, `rgba(${g},.6)`);
  pc.fillStyle = gr; pc.beginPath(); pc.arc(px, py, r, 0, 7); pc.fill();
  pc.save(); pc.beginPath(); pc.arc(px, py, r * 0.975, 0, 7); pc.clip();
  pc.translate(px, py); pc.scale(r, r);
  oval(0, 0.84, 0.5, 0.1, 'rgba(0,0,0,.16)');   // where it stands on the inside of the ball
  pc.translate(0, 0.84); pc.scale(1.08, 1.08); pc.translate(0, -0.84);   // a little bigger, standing where it stood
  pc.translate(0, front ? 0 : -Math.abs(ph) * 0.035 - (air ? 0.06 : 0));
  pc.lineCap = 'round'; pc.lineJoin = 'round';
  (front ? PET_FRONT : PET_BACK)[pet](k, t, ph, air);
  pc.restore();
  pc.strokeStyle = `rgba(${g},.55)`; pc.lineWidth = Math.max(1, r * 0.045);   // the rim of the glass
  pc.beginPath(); pc.arc(px, py, r * 0.975, 0, 7); pc.stroke();
}
// its hind feet from behind: soles that take turns lifting as it runs, spread in the air
function pet_soles(k, ph, air, y, dx, w, h) {
  for (const e of [-1, 1]) {
    const lift = air ? 0.04 : Math.max(0, e * ph) * 0.11;
    oval(e * dx * (air ? 1.15 : 1), y - lift, w, h, k.pad);
  }
}
// the turned head shows a little of its face on that side: an eye, a nose, whiskers
function pet_peek(k, hx, hy, hr, kind) {
  const s = Math.abs(lean); if (s < 0.12) return;
  const e = Math.sign(lean), a = Math.min(1, (s - 0.12) * 2.5);
  pc.globalAlpha *= a;
  oval(hx + e * hr * 0.86, hy + hr * 0.02, hr * 0.1, hr * 0.13, k.eye);
  if (kind === 'beak') {
    pc.fillStyle = k.beak; pc.beginPath(); pc.moveTo(hx + e * hr * 0.9, hy + hr * 0.2); pc.lineTo(hx + e * hr * 1.22, hy + hr * 0.32); pc.lineTo(hx + e * hr * 0.9, hy + hr * 0.45); pc.fill();
  } else {
    oval(hx + e * hr * 1.0, hy + hr * 0.36, hr * 0.08, hr * 0.07, k.inner);
    pc.strokeStyle = 'rgba(255,255,255,.85)'; pc.lineWidth = 0.018;
    for (const d of [-0.06, 0.06]) { pc.beginPath(); pc.moveTo(hx + e * hr * 0.95, hy + hr * 0.45); pc.lineTo(hx + e * hr * 1.5, hy + hr * (0.45 + d * 4)); pc.stroke(); }
  }
  pc.globalAlpha /= a;
}
const PET_BACK = {
  hamster(k, t, ph, air) {
    const hx = lean * 0.07, ch = 1 + 0.3 * Math.min(1, gulp);   // a star stuffs its cheeks
    pet_soles(k, ph, air, 0.74, 0.2, 0.1, 0.065);
    oval(0, 0.3, 0.54, 0.44, k.pale);                              // pale flanks
    oval(0, 0.22, 0.5, 0.41, furG(k, 0, 0.22, 0.5));               // golden back
    for (const e of [-1, 1]) oval(hx * 0.6 + e * 0.29 * ch, -0.06, 0.17 * ch, 0.15 * ch, k.pale);   // cheek pouches
    oval(hx, -0.2, 0.33, 0.31, furG(k, hx, -0.2, 0.33));
    for (const e of [-1, 1]) { oval(hx + e * 0.22, -0.46, 0.1, 0.1, k.ear); oval(hx + e * 0.22 - 0.02, -0.48, 0.05, 0.04, 'rgba(255,255,255,.25)'); }
    pet_peek(k, hx, -0.2, 0.33);
    oval(0, 0.63, 0.055, 0.045, k.inner);                          // a stub of a tail
  },
  kitten(k, t, ph, air) {
    const hx = lean * 0.07;
    pet_soles(k, ph, air, 0.74, 0.18, 0.09, 0.065);
    oval(0, 0.3, 0.45, 0.43, furG(k, 0, 0.3, 0.45));
    pc.strokeStyle = k.stripe; pc.lineWidth = 0.05;
    for (const y of [0.08, 0.24, 0.4]) { pc.beginPath(); pc.moveTo(-0.24, y - 0.02); pc.quadraticCurveTo(0, y + 0.07, 0.24, y - 0.02); pc.stroke(); }
    oval(hx, -0.22, 0.32, 0.29, furG(k, hx, -0.22, 0.32));
    for (const e of [-1, 1]) {   // pointed ears, seen from the back
      pc.fillStyle = k.ear; pc.beginPath(); pc.moveTo(hx + e * 0.08, -0.4); pc.lineTo(hx + e * 0.27, -0.66); pc.lineTo(hx + e * 0.31, -0.3); pc.fill();
    }
    pc.strokeStyle = k.stripe; pc.lineWidth = 0.035;
    for (const d of [-0.08, 0, 0.08]) { pc.beginPath(); pc.moveTo(hx + d, -0.44); pc.lineTo(hx + d * 1.2, -0.3); pc.stroke(); }
    pet_peek(k, hx, -0.22, 0.32);
    const sw = Math.sin(t * 3) * 0.08;   // the tail stands up and sways
    pc.strokeStyle = k.fur[1]; pc.lineWidth = 0.1;
    pc.beginPath(); pc.moveTo(0.1, 0.66); pc.bezierCurveTo(0.42, 0.74, 0.62 + sw, 0.42, 0.52 + sw, 0.12); pc.quadraticCurveTo(0.48 + sw * 1.4, -0.02, 0.6 + sw * 1.6, -0.08); pc.stroke();
    pc.strokeStyle = k.stripe;
    pc.beginPath(); pc.moveTo(0.5 + sw * 1.3, 0.03); pc.quadraticCurveTo(0.49 + sw * 1.4, -0.03, 0.6 + sw * 1.6, -0.08); pc.stroke();
  },
  chick(k, t, ph, air) {
    const hx = lean * 0.06, fl = air ? 0.9 : 0.25 + Math.abs(ph) * 0.35;
    for (const e of [-1, 1]) {   // three-toed feet
      const lift = air ? 0.04 : Math.max(0, e * ph) * 0.1, x = e * 0.17, y = 0.73 - lift;
      pc.strokeStyle = k.pad; pc.lineWidth = 0.045;
      for (const d of [-0.07, 0, 0.07]) { pc.beginPath(); pc.moveTo(x, y - 0.05); pc.lineTo(x + d, y + 0.04); pc.stroke(); }
    }
    for (const e of [-1, 1]) {   // little wings, flapping as it runs
      pc.save(); pc.translate(e * 0.44, 0.12); pc.rotate(-e * fl); oval(e * 0.08, 0, 0.16, 0.09, k.fur[2]); pc.restore();
    }
    oval(0, 0.12, 0.52, 0.56, furG(k, 0, 0.12, 0.52));
    oval(hx, -0.1, 0.3, 0.26, 'rgba(255,255,255,.18)');
    pc.fillStyle = k.fur[2];   // a tuft of tail feathers
    pc.beginPath(); pc.moveTo(-0.1, 0.55); pc.lineTo(0, 0.7); pc.lineTo(0.1, 0.55); pc.fill();
    pc.strokeStyle = k.fur[2]; pc.lineWidth = 0.05;   // and a tuft on top
    for (const d of [-1, 0, 1]) { pc.beginPath(); pc.moveTo(hx + d * 0.03, -0.42); pc.quadraticCurveTo(hx + d * 0.12, -0.56, hx + d * 0.16 + 0.04, -0.6); pc.stroke(); }
    pet_peek(k, hx, -0.14, 0.42, 'beak');
  },
};
function pet_eyes(k, x, y, s, iris) {
  for (const e of [-1, 1]) {
    if (iris) oval(x + e * s * 1.2, y, s * 1.05, s * 1.2, iris);
    oval(x + e * s * 1.2, y + (iris ? s * 0.1 : 0), s * (iris ? 0.6 : 0.95), s * (iris ? 0.95 : 1), k.eye);
    oval(x + e * s * 1.2 - s * 0.3, y - s * 0.35, s * 0.32, s * 0.32, '#ffffff');
  }
}
function pet_blush(x, y, w) { for (const e of [-1, 1]) oval(x + e * w, y, 0.07, 0.045, 'rgba(255,120,140,.45)'); }
function pet_smile(x, y, s) {
  pc.strokeStyle = 'rgba(70,40,30,.8)'; pc.lineWidth = 0.022;
  pc.beginPath(); pc.moveTo(x - s, y); pc.quadraticCurveTo(x - s / 2, y + s * 0.8, x, y); pc.quadraticCurveTo(x + s / 2, y + s * 0.8, x + s, y); pc.stroke();
}
const PET_FRONT = {
  hamster(k, t) {
    const blink = (t % 3.2) < 0.12;
    for (const e of [-1, 1]) oval(e * 0.2, 0.75, 0.11, 0.06, k.pad);
    oval(0, 0.3, 0.52, 0.44, furG(k, 0, 0.3, 0.52));
    oval(0, 0.36, 0.34, 0.32, k.pale);
    for (const e of [-1, 1]) oval(e * 0.1, 0.12, 0.07, 0.06, k.pad);   // front paws held together
    for (const e of [-1, 1]) { oval(e * 0.22, -0.46, 0.1, 0.1, k.ear); oval(e * 0.22, -0.45, 0.06, 0.06, k.inner); }
    for (const e of [-1, 1]) oval(e * 0.28, -0.06, 0.18, 0.15, k.pale);
    oval(0, -0.2, 0.33, 0.31, furG(k, 0, -0.2, 0.33));
    oval(0, -0.08, 0.22, 0.17, k.pale);
    if (blink) { pc.strokeStyle = k.eye; pc.lineWidth = 0.03; for (const e of [-1, 1]) { pc.beginPath(); pc.moveTo(e * 0.17, -0.22); pc.lineTo(e * 0.07, -0.22); pc.stroke(); } }
    else pet_eyes(k, 0, -0.22, 0.1);
    pet_blush(0, -0.08, 0.22);
    oval(0, -0.12, 0.035, 0.025, '#ff8a9a');
    pet_smile(0, -0.08, 0.045);
  },
  kitten(k, t) {
    const sw = Math.sin(t * 2.5) * 0.06;
    pc.strokeStyle = k.fur[1]; pc.lineWidth = 0.09;   // the tail, over the shoulder
    pc.beginPath(); pc.moveTo(0.3, 0.6); pc.bezierCurveTo(0.6, 0.55, 0.55 + sw, 0.1, 0.42 + sw, -0.02); pc.stroke();
    for (const e of [-1, 1]) oval(e * 0.17, 0.75, 0.1, 0.06, k.pale);
    oval(0, 0.3, 0.44, 0.43, furG(k, 0, 0.3, 0.44));
    oval(0, 0.36, 0.24, 0.3, k.pale);
    for (const e of [-1, 1]) {
      pc.fillStyle = k.ear; pc.beginPath(); pc.moveTo(e * 0.08, -0.4); pc.lineTo(e * 0.27, -0.66); pc.lineTo(e * 0.31, -0.3); pc.fill();
      pc.fillStyle = k.inner; pc.beginPath(); pc.moveTo(e * 0.13, -0.42); pc.lineTo(e * 0.255, -0.59); pc.lineTo(e * 0.27, -0.36); pc.fill();
    }
    oval(0, -0.22, 0.32, 0.29, furG(k, 0, -0.22, 0.32));
    pc.strokeStyle = k.stripe; pc.lineWidth = 0.03;
    for (const d of [-0.07, 0, 0.07]) { pc.beginPath(); pc.moveTo(d, -0.47); pc.lineTo(d * 1.2, -0.37); pc.stroke(); }
    oval(0, -0.1, 0.17, 0.11, k.pale);
    pet_eyes(k, 0, -0.24, 0.085, k.iris);
    pet_blush(0, -0.1, 0.2);
    pc.fillStyle = '#ff8aa6'; pc.beginPath(); pc.moveTo(-0.035, -0.15); pc.lineTo(0.035, -0.15); pc.lineTo(0, -0.11); pc.fill();
    pet_smile(0, -0.1, 0.04);
    pc.strokeStyle = 'rgba(255,255,255,.9)'; pc.lineWidth = 0.014;
    for (const e of [-1, 1]) for (const d of [-0.03, 0.02]) { pc.beginPath(); pc.moveTo(e * 0.12, -0.11 + d); pc.lineTo(e * 0.36, -0.13 + d * 2.2); pc.stroke(); }
  },
  chick(k, t) {
    const fl = 0.3 + Math.max(0, Math.sin(t * 5)) * 0.25;
    for (const e of [-1, 1]) {
      pc.strokeStyle = k.pad; pc.lineWidth = 0.045;
      for (const d of [-0.07, 0, 0.07]) { pc.beginPath(); pc.moveTo(e * 0.17, 0.68); pc.lineTo(e * 0.17 + d, 0.77); pc.stroke(); }
    }
    for (const e of [-1, 1]) { pc.save(); pc.translate(e * 0.44, 0.12); pc.rotate(-e * fl); oval(e * 0.08, 0, 0.16, 0.09, k.fur[2]); pc.restore(); }
    oval(0, 0.12, 0.52, 0.56, furG(k, 0, 0.12, 0.52));
    pc.strokeStyle = k.fur[2]; pc.lineWidth = 0.05;
    for (const d of [-1, 0, 1]) { pc.beginPath(); pc.moveTo(d * 0.03, -0.42); pc.quadraticCurveTo(d * 0.12, -0.56, d * 0.16 + 0.04, -0.6); pc.stroke(); }
    pet_eyes(k, 0, -0.14, 0.1);
    pet_blush(0, 0.0, 0.27);
    pc.fillStyle = k.beak; pc.beginPath(); pc.moveTo(-0.08, -0.02); pc.lineTo(0.08, -0.02); pc.lineTo(0, 0.08); pc.fill();
    pc.fillStyle = '#e0700f'; pc.beginPath(); pc.moveTo(-0.08, -0.02); pc.lineTo(0.08, -0.02); pc.lineTo(0, 0.0); pc.fill();
  },
};

// the pet face on, in its ball, as a picture for the results screen
const petIcons = {};
function petIcon(pet) {
  if (petIcons[pet]) return petIcons[pet];
  const c = document.createElement('canvas'); c.width = c.height = 96;
  pc = c.getContext('2d');
  try { drawPet(pet, 48, 48, 46, true); } finally { pc = ctx; }
  return (petIcons[pet] = c.toDataURL());
}

function drawBall() {
  const b = world.ball, T = theme.ball;
  if (world.state === 'crash' || world.state === 'over') return;
  const bx = b.x + (nudge ? nudge.dir * 0.1 * Math.sin(Math.PI * nudge.t) : 0);
  const g = world.state === 'fall' ? null : world.groundAt(b.x, b.z);
  if (g !== null) {   // the shadow shows where a jump lands
    const s = proj(bx, g, b.z), up = b.y - R - g, c = theme.shadow;
    ctx.fillStyle = `rgba(${c},${0.38 * clamp(1 - up / 3, 0.25, 1)})`;
    ctx.beginPath(); ctx.ellipse(s[0], s[1], R * (1.15 + Math.abs(lean) * 0.12) * s[2], R * 0.45 * s[2], 0, 0, 7); ctx.fill();
  }
  const [px, py0, sc] = proj(bx, b.y, b.z), r = R * sc;
  if (!(sc > 0) || !Number.isFinite(px + py0 + r)) return;   // behind the camera: nothing to draw
  // a landing squashes the ball for a moment: wider, lower, still touching the ground;
  // and a lane change makes it lean: its top lags behind, it stretches a little along the way
  // In a jump it stretches with its speed up or down (round at the top); it swells for a moment as it takes a star.
  const py = py0, yb = py + r, al = Math.abs(lean);   // squashed and stretched about the point it stands on
  const st = b.air && !b.fly ? Math.min(1, Math.abs(b.vy) / 7) * 0.07 : 0, sq = squash - st, gulpK = 1 + 0.06 * Math.min(1, gulp);
  const oy = b.air ? py : yb;   // on the ground about its foot (it never sinks in), in the air about its middle
  ctx.save(); ctx.translate(px, oy); ctx.transform(1, 0, lean * 0.12, 1, 0, 0); ctx.scale(gulpK * (1 + sq * 0.5) * (1 + al * 0.04), gulpK * (1 - sq) * (1 - al * 0.03)); ctx.translate(-px, -oy);
  if (T.glow && P.glow > 0.01) {
    const gl = ctx.createRadialGradient(px, py, r * 0.8, px, py, r * 2.6);
    gl.addColorStop(0, `rgba(${T.glow},${0.55 * P.glow})`); gl.addColorStop(1, `rgba(${T.glow},0)`);
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(px, py, r * 2.6, 0, 7); ctx.fill();
  }
  if (flyShow > 0.05) {   // wings, and a golden glow
    halo(px, py, r * 3, 'rgba(255,225,130,1)', 0.45 * flyShow);
    const flap = Math.sin(now() * 14) * 0.5;
    for (const e of [-1, 1]) wing(px + e * r * 0.75, py - r * 0.15, r * 1.6 * flyShow, e, flap);
  }
  if (world.fx.safe > 0 && world.state === 'run' && !b.fly) ctx.globalAlpha = 0.6 + 0.3 * Math.sin(now() * 30);   // nothing can hit it: it flickers
  if (T.pet) drawPet(T.pet, px, py, r, mode === 'home');
  else {
    const gr = ctx.createRadialGradient(px - r * 0.35, py - r * 0.4, r * 0.1, px, py, r);
    gr.addColorStop(0, T.c[0]); gr.addColorStop(0.7, T.c[1]); gr.addColorStop(1, T.c[2]);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
  }
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
  ctx.globalAlpha = 1;
  if (world.fx.shield > 0 && (world.fx.shield > 2 || Math.sin(now() * 18) > -0.3)) {   // a bubble round the ball; it blinks in its last two seconds
    const t = now(), rb = r * 1.42, g = ctx.createRadialGradient(px, py, rb * 0.55, px, py, rb);
    g.addColorStop(0, 'rgba(120,210,255,0)'); g.addColorStop(0.85, 'rgba(120,210,255,.28)'); g.addColorStop(1, 'rgba(200,240,255,.75)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rb, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = Math.max(1, r * 0.07); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(px, py, rb * 0.82, t * 1.5, t * 1.5 + 0.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(px, py, rb * 0.82, t * 1.5 + 3.3, t * 1.5 + 3.7); ctx.stroke(); ctx.lineCap = 'butt';
  }
  if (world.fx.magnet > 0 && !b.fly) {   // a magnet at work: rings closing in on the ball
    for (let k = 0; k < 2; k++) {
      const ph = (now() * 1.4 + k / 2) % 1;
      ctx.strokeStyle = `rgba(255,110,130,${0.55 * ph})`; ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.beginPath(); ctx.arc(px, py, r * (2.6 - 1.5 * ph), 0, 7); ctx.stroke();
    }
  }
  ctx.restore();
}

// ---- bonuses: what they look like on the track and in the corner of the screen ----
const BONUS_C = { magnet: [255, 90, 115], shield: [80, 190, 255], fly: [255, 210, 80] };
// one wing: e — which side (-1 left, 1 right), flap -0.5..0.5
function wing(x, y, r, e, flap = 0) {
  if (!(r > 0.5)) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(-e * (0.25 + flap * 0.7)); ctx.scale(e, 1);
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = 'rgba(120,160,215,.9)'; ctx.lineWidth = Math.max(1, r * 0.05); ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(0, r * 0.12);
  ctx.quadraticCurveTo(r * 0.35, -r * 0.75, r, -r * 0.62);
  ctx.quadraticCurveTo(r * 0.98, -r * 0.3, r * 0.74, -r * 0.2); ctx.quadraticCurveTo(r * 0.8, r * 0.02, r * 0.5, r * 0.04);
  ctx.quadraticCurveTo(r * 0.52, r * 0.24, r * 0.24, r * 0.2); ctx.quadraticCurveTo(r * 0.12, r * 0.3, 0, r * 0.12);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}
function bonusIcon(kind, x, y, r) {
  if (kind === 'magnet') {
    ctx.strokeStyle = '#e5383b'; ctx.lineWidth = r * 0.42; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(x - r * 0.48, y + r * 0.55); ctx.lineTo(x - r * 0.48, y - r * 0.05); ctx.arc(x, y - r * 0.05, r * 0.48, Math.PI, 0); ctx.lineTo(x + r * 0.48, y + r * 0.55); ctx.stroke();
    ctx.fillStyle = '#f4f4f8'; ctx.fillRect(x - r * 0.69, y + r * 0.32, r * 0.42, r * 0.25); ctx.fillRect(x + r * 0.27, y + r * 0.32, r * 0.42, r * 0.25);
  } else if (kind === 'shield') {
    const sh = () => { ctx.beginPath(); ctx.moveTo(x, y - r * 0.72); ctx.lineTo(x + r * 0.6, y - r * 0.48); ctx.lineTo(x + r * 0.6, y); ctx.quadraticCurveTo(x + r * 0.55, y + r * 0.5, x, y + r * 0.78); ctx.quadraticCurveTo(x - r * 0.55, y + r * 0.5, x - r * 0.6, y); ctx.lineTo(x - r * 0.6, y - r * 0.48); ctx.closePath(); };
    ctx.fillStyle = '#2f8cf0'; sh(); ctx.fill();
    ctx.save(); sh(); ctx.clip(); ctx.fillStyle = '#7cc4ff'; ctx.fillRect(x, y - r, r, 2 * r); ctx.restore();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, r * 0.1); ctx.lineJoin = 'round'; sh(); ctx.stroke();
  } else {
    for (const e of [-1, 1]) wing(x + e * r * 0.08, y + r * 0.22, r * 0.9, e, 0.1);
  }
}
function drawBonus(bo, rz, fog) {
  const zc = rz + 0.5, t = now(), [x, y, sc] = proj(laneX(bo.lane), world.hAt(zc) + R + 0.28 + Math.sin(t * 2.6 + rz) * 0.07, zc);
  if (!(sc > 0)) return;
  const r = 0.33 * sc * (1 + 0.06 * Math.sin(t * 5 + rz)), c = BONUS_C[bo.kind], a = 1 - fog * 0.85;
  if (r < 3) { ctx.globalAlpha = a; ctx.fillStyle = `rgb(${c})`; ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, r), 0, 7); ctx.fill(); ctx.globalAlpha = 1; return; }
  halo(x, y, r * 2.6, `rgba(${c},1)`, 0.55 * a);
  ctx.globalAlpha = a;
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, 'rgba(255,255,255,.85)'); g.addColorStop(0.6, `rgba(${c},.35)`); g.addColorStop(1, `rgba(${c},.6)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(1, r * 0.08); ctx.stroke();
  bonusIcon(bo.kind, x, y, r * 0.78);
  ctx.fillStyle = '#fff';
  for (let k = 0; k < 3; k++) { const an = t * 2.2 + k * 2.094; ctx.beginPath(); ctx.arc(x + Math.cos(an) * r * 1.3, y + Math.sin(an) * r * 1.3 * 0.8, Math.max(1, r * 0.07), 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
}
// what is at work now, under the pause button: an icon in a ring that runs down
function drawEffects() {
  const fx = world.fx, on = [];
  if (world.ball.fly) on.push(['fly', fx.fly / FLY_T]);
  if (fx.magnet > 0) on.push(['magnet', fx.magnet / MAGNET_T]);
  if (fx.shield > 0) on.push(['shield', fx.shield / SHIELD_T]);
  on.forEach(([kind, left], i) => {
    const r = 21 * dpr, x = 36 * dpr + i * 52 * dpr, y = 112 * dpr, c = BONUS_C[kind];
    ctx.fillStyle = 'rgba(20,30,60,.35)'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgb(${c})`; ctx.lineWidth = 3.5 * dpr; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(left, 0.001, 1)); ctx.stroke(); ctx.lineCap = 'butt';
    bonusIcon(kind, x, y, r * 0.72);
  });
}

// ---- the show in the sky during a flight ----
// behind the road: rings of light opening from the horizon like a tunnel, and shooting stars
function drawFlightSky(hue) {
  const k = flyShow, t = flyT, cx = W / 2, cy0 = horY - H * 0.06, R0 = Math.hypot(W, H) * 0.75;
  ctx.save(); ctx.lineCap = 'round';
  for (let n = 0; n < 7; n++) {
    const ph = (t * 0.45 + n / 7) % 1, r = R0 * ph * ph, a = k * 0.5 * Math.sin(ph * Math.PI);
    ctx.strokeStyle = hsl((hue + n * 50 + t * 40) % 360, 90, 72); ctx.globalAlpha = a; ctx.lineWidth = (2 + 16 * ph) * dpr;
    ctx.beginPath(); ctx.arc(cx, cy0, r, 0, 7); ctx.stroke();
  }
  for (let n = 0; n < 5; n++) {   // shooting stars
    const ph = (t * 0.7 + hash(n, 3, 410)) % 1, sx = W * (0.1 + hash(n, 5, 411) * 0.9) - ph * W * 0.5, sy = horY * (0.05 + hash(n, 7, 412) * 0.6) + ph * H * 0.18, len = W * 0.16;
    const g = ctx.createLinearGradient(sx, sy, sx + len, sy - len * 0.36);
    g.addColorStop(0, `rgba(255,255,255,${0.9 * k * Math.sin(ph * Math.PI)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 1; ctx.strokeStyle = g; ctx.lineWidth = 2.5 * dpr; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + len, sy - len * 0.36); ctx.stroke();
  }
  ctx.restore();
}
// level with the ball: clouds (or star dust where there are none) rushing past, well to the sides of the three
// lanes of the air
function drawFlightRow(rz, fog) {
  const b = world.ball, a = flyShow * (1 - fog), zc = rz + 0.5;
  if (rz > b.z + 1 && hash(rz, 7, 400) < 0.45) {
    const side = hash(rz, 7, 401) < 0.5 ? -1 : 1, p = proj(laneX(world.flyLane) + side * (3 + hash(rz, 7, 402) * 3), world.hAt(zc) + R + FLY_H + (hash(rz, 7, 403) - 0.5) * 1.6, zc), u = p[2] * (0.7 + hash(rz, 7, 404) * 0.8);
    if (u > 0) {
      if (P.clouds > 0.4) {
        ctx.globalAlpha = 0.8 * a; ctx.fillStyle = css(P.cloudC);
        for (let k = 0; k < 4; k++) ell(p[0] + (k - 1.5) * u * 0.42, p[1] - (k % 2) * u * 0.16, u * 0.42, u * 0.26);
        ctx.globalAlpha = 1;
      } else {
        for (let k = 0; k < 5; k++) halo(p[0] + (hash(rz, k, 405) - 0.5) * u * 1.6, p[1] + (hash(rz, k, 406) - 0.5) * u * 0.8, u * 0.22, hsl(190 + hash(rz, k, 407) * 140, 90, 80), 0.8 * a);
      }
    }
  }
}

// speed lines at the screen edges once the ball is fast
function drawStreaks() {
  const k = Math.max(clamp((world.v - 13) / 11, 0, 1), flyShow * 0.8, rush * 0.9);   // and all through a flight, and for a moment on a push of speed
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
  const hue = secHue(secOf(camZ + CAM_BACK));
  setPhase(camZ + CAM_BACK);
  theme.sky(hue, horY);
  if (flyShow > 0.01) drawFlightSky(hue);
  ctx.save();
  // shake follows smooth waves rather than a new random spot every frame (that reads as a glitch, not a blow)
  if (shake > 0.01) { const k = shake * shake * 7 * dpr, t = now(); ctx.translate(k * (Math.sin(t * 61) + Math.sin(t * 37 + 2)) * 0.5, k * (Math.sin(t * 53 + 1) + Math.sin(t * 29 + 4)) * 0.5); }
  ctx.translate(kick.x, kick.y);
  if (zoom > 0.002) { const z = 1 + zoom, oy = H * 0.7; ctx.translate(W / 2, oy); ctx.scale(z, z); ctx.translate(-W / 2, -oy); }
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
  for (const g of rings) {   // a ring spreads from the point of impact (flat: along the ground)
    const [px, py, sc] = proj(g.x, g.y, g.z), k = g.t / 0.45, s = g.s || 1, rr = (0.2 + 1.3 * k) * sc * s;
    if (!(sc > 0)) continue;
    ctx.globalAlpha = (1 - k) ** 2; ctx.strokeStyle = g.c || '#fff'; ctx.lineWidth = Math.max(1, (1 - k) * 0.12 * sc * Math.sqrt(s));
    ctx.beginPath(); ctx.ellipse(px, py, rr, g.flat ? rr * 0.3 : rr, 0, 0, 7); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  drawWeather();
  drawStreaks();
  if (tint) {   // the edges of the screen flash in a bonus's colour
    const k = 1 - tint.t / 0.45, g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    g.addColorStop(0, `rgba(${tint.c},0)`); g.addColorStop(1, `rgba(${tint.c},${0.55 * k * k})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  drawHoming();
  if (mode === 'play' || mode === 'count' || mode === 'pause') drawEffects();
  const fl = rings.find((g) => g.w && g.t < 0.12);
  if (fl) { ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - fl.t / 0.12)})`; ctx.fillRect(0, 0, W, H); }
  if (mode === 'count') {   // 3-2-1, each digit shrinks into place
    const n = Math.ceil(count / COUNT_T), k = 1 - (count / COUNT_T - (n - 1));
    bigNumber(n, 0.16 * (1.5 - 0.5 * Math.min(1, k * 4)), Math.min(1, (1 - k) * 3));
  } else if (flash) bigNumber(flash.sec + 1, 0.09 * (1 + 0.6 * Math.max(0, flash.t - 0.8) / 0.2), Math.min(1, flash.t * 1.5));
}

// stars on their way to the counter: up a curve, shrinking to the icon's size, spinning a little
function drawHoming() {
  const to = homing.length && hudStarAt();
  if (!to) return;
  for (const h of homing) {
    const k = clamp(h.t, 0, 1), e = 1 - (1 - k) ** 3, u = 1 - e;
    const cx = (h.x + to.x) / 2 + h.side * W * 0.12, cyy = Math.min(h.y, to.y) + H * 0.05;   // a bend to one side
    const x = u * u * h.x + 2 * u * e * cx + e * e * to.x, y = u * u * h.y + 2 * u * e * cyy + e * e * to.y;
    const r = h.r + (to.r * 0.9 - h.r) * e;
    ctx.save(); ctx.translate(x, y); ctx.rotate(k * 2.4 * (h.side < 0 ? -1 : 1));
    ctx.beginPath(); STAR_PTS.forEach(([a, c], i) => (i ? ctx.lineTo(a * r, c * r) : ctx.moveTo(a * r, c * r))); ctx.closePath();
    ctx.fillStyle = '#ffd84a'; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, r * 0.14); ctx.strokeStyle = '#d99100'; ctx.stroke();
    ctx.restore();
  }
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
// A touch is one swipe and one swipe is one move, however long it is: sideways — the next lane, up — a jump,
// down — out of the air straight to the ground. It counts as soon as the finger has gone SWIPE of the screen's
// shorter side, without waiting for it to lift; the rest of the touch does nothing.
const SWIPE = 0.06, SWIPE_MIN = 18;   // SWIPE: of the shorter side of the screen; SWIPE_MIN: px, the least on any screen
let dragId = null, dragX = 0, dragY = 0, dragDone = false;
// during the 3-2-1 after a pause a swipe already counts: the ball sets off towards the chosen lane or with a jump
const steerable = () => mode === 'play' || mode === 'count';
function act(dx, dy) {   // dx, dy: -1, 0 or 1; up is dy = -1
  if (!steerable()) return;
  if (dx) world.move(dx);
  else if (dy < 0) world.jump();
  else world.drop();
  $hint.hidden = true;
}
addEventListener('pointerdown', (e) => {
  if (dragId !== null || e.target.closest('button, input, .card')) return;
  dragId = e.pointerId; dragX = e.clientX; dragY = e.clientY; dragDone = false;
});
addEventListener('pointermove', (e) => {
  if (e.pointerId !== dragId || dragDone) return;
  const dx = e.clientX - dragX, dy = e.clientY - dragY;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < Math.max(SWIPE_MIN, Math.min(innerWidth, innerHeight) * SWIPE)) return;
  dragDone = true;
  if (Math.abs(dx) >= Math.abs(dy)) act(Math.sign(dx), 0); else act(0, Math.sign(dy));
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
  el.addEventListener('change', () => { persist(); if (key === 'vol') sfx.preview(); });   // released: hear the new level
}
on('hapticSw', () => { save.haptic = !save.haptic; $haptic.setAttribute('aria-checked', String(save.haptic)); persist(); haptic('land'); });

const KEYS = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };
const KEYS_Y = { ArrowUp: -1, KeyW: -1, ArrowDown: 1, KeyS: 1 };
addEventListener('keydown', (e) => {
  if (e.repeat || e.target.closest('input')) return;
  if (KEYS[e.code]) {
    if (mode === 'home') turnSkin(KEYS[e.code]); else act(KEYS[e.code], 0);
  } else if (KEYS_Y[e.code]) {
    act(0, KEYS_Y[e.code]);
  } else if (e.code === 'Space' || e.code === 'Enter') {
    if (e.target.closest('button')) return;   // the focused button gets its click
    if (!$set.hidden) $set.hidden = true;
    else if (steerable()) { if (e.code === 'Space') act(0, -1); }
    else if (mode === 'home' || (mode === 'over' && !$('overActs').classList.contains('wait'))) startGame();
    else if (mode === 'pause') resume();
  } else if (e.code === 'Escape' || e.code === 'KeyP') {
    if (!$set.hidden) $set.hidden = true;
    else if (mode === 'pause') resume(); else pause();
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('pagehide', saveRun);

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
addEventListener('resize', () => { resize(); follow(); hudStar = null; });
resize();
if (!restoreRun()) goHome();
requestAnimationFrame(frame);

// test hooks: __shot jumps the camera to row z of the given seed, driving the bot along the path; the rest let a
// script reach the world and redraw
window.__shot = (seed, z) => {
  world = new World(seed); setMode('shot');
  while (world.state === 'run' && world.ball.z < z) {
    world.auto(); world.step(1 / 60); world.events.length = 0;
  }
  follow();
  $hud.hidden = false; $score.textContent = world.score; $starN.textContent = world.stars; draw();
};
window.__world = () => world;
window.__lean = (v) => { lean = v; draw(); const b = world.ball; return proj(b.x, b.y, b.z).slice(0, 2); };
window.__draw = draw;
window.__follow = follow;
window.__feel = () => ({ homing: homing.length, shown: shownStars, near: nearN, parts: parts.length, kick: { ...kick }, zoom, squash });
