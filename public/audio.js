// Sound: effects synthesized with Web Audio, the hum of the rolling ball, background music and vibration.
// The page calls sfx.*; nothing here knows about the game. `cfg` is the page's settings object
// ({ vol, music, haptic }, 0..1), read on every sound, so a slider works at once.
//
// iPhone: sound turns on only from a "real" gesture (touch released, click, key), not from pointerdown; after
// minimizing or a phone call the context may report 'running' and stay silent, so it is replaced on the next gesture.
// Web Audio obeys the silent switch on the side. Chrome and other WKWebView browsers on iPhone stay silent until
// the page has played a regular <audio>, so a silent clip is looped there (and sound then ignores the silent switch).
let cfg = { vol: 0.5, music: 0.4, haptic: true };
let actx = null, bus = null, master = null, stale = false, stuckAt = 0, resumeBusy = false, resumeTry = 0;
const UA = navigator.userAgent || '';
const IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IOS_WEBVIEW = /iPhone|iPad|iPod/.test(UA) && (/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|GSA\//.test(UA) || !/Safari\//.test(UA));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const soundOn = () => cfg.vol > 0;
const canSound = () => soundOn() && actx && (actx.state === 'running' || resumeBusy);
const gainOf = () => cfg.vol * cfg.vol;   // squared: the slider feels more even

function newAudio() {
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; return; }
  const ctx = actx; let ran = ctx.state === 'running';
  ctx.onstatechange = () => {
    if (ctx.state === 'running') ran = true;
    else if (ran && ctx === actx && ctx.state !== 'closed') stale = true;
  };
  try {   // a last guard for everything, the music too: whatever piles up never goes past full scale (that crackles)
    master = actx.createDynamicsCompressor();
    master.threshold.value = -3; master.knee.value = 0; master.ratio.value = 20; master.attack.value = 0.001; master.release.value = 0.1;
    master.connect(actx.destination);
  } catch { master = null; }
  try {   // a compressor: louder on a quiet phone speaker, and overlapping sounds don't distort
    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
    bus = actx.createGain(); bus.connect(comp); comp.connect(master || actx.destination);
  } catch { bus = null; }
  try {   // an empty clip inside the gesture, or old iOS doesn't open the output
    const src = actx.createBufferSource();
    src.buffer = actx.createBuffer(1, 1, 22050); src.connect(actx.destination); src.start(0);
  } catch { /* */ }
  hum = null; noiseBuf = null; muffle = null;
}

let htmlAudio = null;
function silentWav() {   // 0.25 s of silence, 8 kHz, 8 bit
  const n = 2000, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true); b.fill(128, 44);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
function unlockHtmlAudio() {
  if (!IOS_WEBVIEW || document.hidden) return;
  if (!soundOn()) { if (htmlAudio) htmlAudio.pause(); return; }   // sound is off: don't mute other apps' music
  if (!htmlAudio) {
    try {
      htmlAudio = document.createElement('audio');
      htmlAudio.setAttribute('x-webkit-airplay', 'deny'); htmlAudio.setAttribute('playsinline', '');
      htmlAudio.loop = true; htmlAudio.preload = 'auto'; htmlAudio.src = silentWav();
    } catch { htmlAudio = null; return; }
  }
  if (htmlAudio.paused) { const p = htmlAudio.play(); if (p && p.catch) p.catch(() => {}); }
}
function wake() {
  if (!actx || actx.state === 'running' || resumeBusy) return;
  // an interrupted iOS context may never answer resume(): wait a second at most, or gestures stop helping
  const n = ++resumeTry, done = () => { if (n === resumeTry) resumeBusy = false; };
  resumeBusy = true; setTimeout(done, 1000);
  try { Promise.resolve(actx.resume()).catch(() => {}).finally(done); } catch { done(); }
}
function replaceAudio() {   // only from a gesture: iOS keeps no more than about four contexts, so the old one is closed
  const old = actx; actx = null;
  if (old) { try { Promise.resolve(old.close()).catch(() => {}); } catch { /* */ } }
  newAudio(); stuckAt = 0; stale = false; resumeTry++; resumeBusy = false;
}
function ensure() {   // only from gestures
  unlockHtmlAudio();
  if (!soundOn()) return;
  if (!actx || (stale && !document.hidden)) replaceAudio();
  if (!actx || actx.state === 'running') { stuckAt = 0; return; }
  const now = performance.now();
  if (!stuckAt) stuckAt = now;
  else if (!resumeBusy && now - stuckAt > 1500) replaceAudio();   // resume() answered, yet gestures don't wake it
  wake();
}

export function initAudio(settings) {
  cfg = settings;
  for (const ev of ['pointerup', 'touchend', 'click', 'keydown'])
    window.addEventListener(ev, () => { ensure(); musicGesture(); }, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (htmlAudio) htmlAudio.pause();
      musicPause(); setHum(0, 0);
      if (actx && IOS) stale = true;
    } else { wake(); musicPlay(); }
  });
  window.addEventListener('online', () => { music.miss.clear(); music.retryAt = 0; });
}
// a setting changed: the volume of what is already sounding follows
export function applyVolume() {
  if (music.gain) {   // glides to the new level (a jump of the gain clicks, and would cut a fade-in short)
    try { const p = music.gain.gain, t = music.ctx.currentTime; p.cancelScheduledValues(t); p.setTargetAtTime(musicVol(), t, 0.03); } catch { /* */ }
  }
  if (!musicOn()) musicPause(); else if (actx && !document.hidden) musicGesture();
  if (!soundOn() && htmlAudio) htmlAudio.pause();
}

// ---- building blocks ----
const out = () => bus || actx.destination;
// a note: attack a, decay until dur; `to` — where the pitch glides; lp — a low-pass filter for softer saws and squares
// pan: -1 left … 1 right, where the thing happens
function panned(node, pan) {
  if (!pan || !actx.createStereoPanner) { node.connect(out()); return null; }
  const p = actx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); node.connect(p); p.connect(out());
  return p;
}
// A sound that has played out is taken out of the graph at once. Left connected, every one of them stayed there until
// the garbage collector got to it, and a run makes thousands (Safari is known to keep such nodes around).
function unplug(src, ...nodes) {
  src.onended = () => { for (const n of [src, ...nodes]) if (n) try { n.disconnect(); } catch { /* */ } };
}
function note(f, { type = 'sine', vol = 0.2, a = 0.004, dur = 0.2, delay = 0, to = 0, lp = 0, detune = 0, pan = 0 } = {}) {
  if (!canSound()) return;
  const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.detune.value = detune; o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol * gainOf(), t + Math.min(a, dur * 0.9));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let src = o, fl = null;
  if (lp) { fl = actx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); src = fl; }
  src.connect(g); unplug(o, fl, g, panned(g, pan));
  o.start(t); o.stop(t + dur + 0.05);
}
let noiseBuf = null;
function noise() {   // two seconds of brownish noise, shared by every burst and the hum
  if (noiseBuf && noiseBuf.ctx === actx) return noiseBuf.buf;
  const n = actx.sampleRate * 2, m = Math.floor(actx.sampleRate * 0.05), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
  const raw = new Float32Array(n + m);
  let last = 0;
  for (let i = 0; i < n + m; i++) { last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04; raw[i] = last * 6; }
  // it loops: its first 50 ms fade over from what comes after its end, so the end runs on into the start with no step
  for (let i = 0; i < n; i++) d[i] = i < m ? raw[i] * (i / m) + raw[n + i] * (1 - i / m) : raw[i];
  noiseBuf = { ctx: actx, buf };
  return buf;
}
// a burst of filtered noise: f0 → f1 is the filter sweep
function burst({ type = 'lowpass', f0 = 800, f1 = 0, q = 0.7, vol = 0.3, a = 0.005, dur = 0.2, delay = 0, pan = 0 } = {}) {
  if (!canSound()) return;
  const t = actx.currentTime + delay, s = actx.createBufferSource(), fl = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noise(); s.loop = true;
  fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f0, t);
  if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol * gainOf(), t + Math.min(a, dur * 0.9));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(g); unplug(s, fl, g, panned(g, pan));
  s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
}
const semi = (f, n) => f * Math.pow(2, n / 12);
// the same sound a little different every time: a repeated identical sample reads as a machine
const vary = (k = 0.05) => 1 + (Math.random() * 2 - 1) * k;
// A knock that a phone speaker can actually play. Most of them give almost nothing below 200–300 Hz, so a low
// thud alone is felt on headphones only: on the speaker the weight comes from a short click (the moment of contact)
// and a body of 180–400 Hz falling in pitch.
function knock(k, { f = 260, pan = 0, delay = 0 } = {}) {
  const m = vary(0.06);
  burst({ type: 'highpass', f0: 2500, q: 0.5, vol: 0.35 * k, a: 0.001, dur: 0.025, delay, pan });
  note(f * m, { type: 'triangle', vol: 0.3 * k, a: 0.002, dur: 0.09, to: f * 0.45 * m, lp: 1400, delay, pan });
}

// ---- the hum of the rolling ball: noise through a low-pass filter, louder and brighter with the speed ----
let hum = null;
export function setHum(speed, onGround) {   // speed 0..1 of the top speed
  if (!canSound() || document.hidden) { if (hum) { try { hum.g.gain.value = 0; } catch { /* */ } hum.k = -1; } return; }
  if (!hum || hum.ctx !== actx) {
    try {
      const s = actx.createBufferSource(), fl = actx.createBiquadFilter(), g = actx.createGain();
      s.buffer = noise(); s.loop = true; fl.type = 'lowpass'; fl.Q.value = 0.8; g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(out()); s.start();
      hum = { ctx: actx, s, fl, g, k: -1, vol: -1 };
    } catch { hum = null; return; }
  }
  // called every frame, but the sound is only told when it should really change: every call added two events to
  // the parameters' timelines, a hundred and twenty a second for the whole run
  const t = actx.currentTime, k = onGround ? clamp(speed, 0, 1) : 0;
  const vol = gainOf();
  if (Math.abs(k - hum.k) < 0.02 && (k > 0) === (hum.k > 0) && vol === hum.vol) return;
  hum.k = k; hum.vol = vol;
  hum.g.gain.setTargetAtTime(k > 0 ? (0.05 + 0.13 * k) * vol : 0, t, k > 0 ? 0.08 : 0.03);
  hum.fl.frequency.setTargetAtTime(160 + 520 * k, t, 0.1);
}

// ---- effects ----
// Everything sits low (150–800 Hz): high beeps tire on a phone speaker.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];   // a pentatonic ladder for stars taken in a row
let combo = 0, run = 0, comboAt = 0;
export const sfx = {
  tap() { note(420, { type: 'triangle', vol: 0.12, dur: 0.07, to: 300, lp: 1500 }); },
  // Stars taken in a row climb a pentatonic ladder; every fifth in a row adds a glint on top. Returns how many in a
  // row this one makes, so the picture can follow.
  star(pan = 0) {
    const now = performance.now();
    run = now - comboAt < 900 ? run + 1 : 1;
    combo = Math.min(SCALE.length - 1, run - 1);
    comboAt = now;
    const f = semi(330, SCALE[combo]);
    note(f, { type: 'triangle', vol: 0.2, dur: 0.22, lp: 2400, pan: pan * 0.5 });
    note(f * 2, { vol: 0.07, dur: 0.3, delay: 0.015, pan: pan * 0.5 });
    if (run % 5 === 0) [12, 19, 24].forEach((n, i) => note(semi(330, SCALE[combo] + n), { vol: 0.06, dur: 0.25, delay: 0.05 + i * 0.045 }));
    return run;
  },
  preview() { note(330, { type: 'triangle', vol: 0.2, dur: 0.22, lp: 2400 }); note(660, { vol: 0.07, dur: 0.3, delay: 0.015 }); },   // the volume slider: the first star's note
  move(dir = 0) {   // a lane change: something heavy starts rolling sideways, heard on the side it goes to
    const m = vary();
    burst({ type: 'bandpass', f0: 340 * m, f1: 760 * m, q: 0.9, vol: 0.22, a: 0.025, dur: 0.13, pan: dir * 0.45 });
    note(110 * m, { vol: 0.07, dur: 0.12, to: 150 * m });
  },
  settle(dir = 0) {   // and drops into its lane
    note(120 * vary(), { vol: 0.16, dur: 0.1, to: 70 });
    burst({ f0: 380 * vary(), f1: 130, vol: 0.14, dur: 0.07, pan: dir * 0.4 });
    knock(0.35, { f: 230, pan: dir * 0.4 });
  },
  bump(dir = 0) {   // no lane there: a dull knock against the edge
    note(150, { vol: 0.25, dur: 0.1, to: 90 });
    knock(0.7, { f: 200, pan: dir * 0.7 });
  },
  drop() { burst({ type: 'bandpass', f0: 1000, f1: 300, q: 1, vol: 0.3, a: 0.01, dur: 0.12 }); },   // thrown down out of the air
  // something rushed past close by: air torn on that side, from far to near
  whoosh(pan = 0, k = 1) {
    const m = vary(0.1);
    burst({ type: 'bandpass', f0: 500 * m, f1: 2200 * m, q: 1.6, vol: 0.28 * k, a: 0.05, dur: 0.16, pan });
    burst({ type: 'bandpass', f0: 2000 * m, f1: 600 * m, q: 1.4, vol: 0.22 * k, a: 0.01, dur: 0.14, delay: 0.12, pan });
  },
  bonus() {
    [0, 4, 7].forEach((n, i) => note(semi(440, n), { type: 'triangle', vol: 0.2, dur: 0.16, delay: i * 0.06, lp: 2600 }));
    burst({ type: 'bandpass', f0: 600, f1: 3000, q: 1, vol: 0.25, a: 0.02, dur: 0.25 });
    note(semi(440, 12), { vol: 0.08, dur: 0.5, delay: 0.18 });
  },
  pop() {   // the shield bursts
    burst({ type: 'bandpass', f0: 1800, f1: 500, q: 1.5, vol: 0.5, dur: 0.16 });
    note(520, { type: 'triangle', vol: 0.22, dur: 0.18, to: 180, lp: 2000 });
    knock(0.8, { f: 300 });
  },
  fly() {   // off the ground
    burst({ type: 'bandpass', f0: 250, f1: 1600, q: 0.8, vol: 0.5, a: 0.2, dur: 0.7 });
    [0, 4, 7, 12, 16, 19].forEach((n, i) => note(semi(330, n), { type: 'triangle', vol: 0.18, dur: i === 5 ? 0.6 : 0.16, delay: i * 0.07, lp: 2800 }));
  },
  flyEnd() { burst({ type: 'bandpass', f0: 1300, f1: 280, q: 0.8, vol: 0.4, a: 0.05, dur: 0.5 }); },
  jump() {
    const m = vary();
    burst({ type: 'bandpass', f0: 300 * m, f1: 1100 * m, q: 1.2, vol: 0.5, a: 0.05, dur: 0.32 });
    note(190 * m, { type: 'triangle', vol: 0.16, dur: 0.2, to: 330 * m, lp: 1200 });
    knock(0.3, { f: 280 });   // the push off the ground
  },
  land(k = 0.5) {
    note(120 * vary(), { vol: 0.35 * (0.5 + k), dur: 0.16, to: 55 });
    burst({ f0: 500 * vary(), f1: 120, vol: 0.5 * (0.4 + k), dur: 0.14 });
    knock(0.4 + 0.6 * k, { f: 300 - 90 * k });   // the harder, the lower
  },
  crash() {
    note(150, { vol: 0.6, dur: 0.35, to: 40 });
    knock(1, { f: 240 }); knock(0.6, { f: 170, delay: 0.06 });
    burst({ f0: 2200, f1: 200, vol: 0.9, dur: 0.3 });
    for (let k = 0; k < 4; k++) burst({ type: 'bandpass', f0: 500 + Math.random() * 700, q: 3, vol: 0.3, dur: 0.06, delay: 0.1 + k * 0.07 + Math.random() * 0.03 });
  },
  fall() {
    note(520, { type: 'triangle', vol: 0.22, dur: 0.75, to: 90, lp: 1600 });
    burst({ type: 'bandpass', f0: 900, f1: 200, q: 1, vol: 0.25, a: 0.1, dur: 0.7 });
  },
  section() {
    burst({ type: 'bandpass', f0: 250, f1: 1400, q: 1, vol: 0.35, a: 0.12, dur: 0.4 });
    knock(0.5, { f: 330, delay: 0.1 });
    note(392, { type: 'triangle', vol: 0.16, dur: 0.18, lp: 2000 });
    note(587, { type: 'triangle', vol: 0.16, dur: 0.3, delay: 0.1, lp: 2400 });
  },
  count(last) { note(last ? 587 : 392, { type: 'triangle', vol: 0.2, dur: last ? 0.3 : 0.12, lp: 2200 }); },
  best() { [0, 4, 7, 12, 16].forEach((n, i) => note(semi(330, n), { type: 'triangle', vol: 0.2, dur: i === 4 ? 0.6 : 0.2, delay: i * 0.09, lp: 2600 })); },
  unlock() { [0, 7, 12].forEach((n, i) => note(semi(294, n), { type: 'triangle', vol: 0.18, dur: 0.35, delay: 0.5 + i * 0.12, lp: 2400 })); },
  over() { note(294, { type: 'triangle', vol: 0.14, dur: 0.25, to: 220, lp: 1500 }); },
};

// ---- vibration: Android only, the web cannot vibrate an iPhone ----
const CAN_VIBRATE = !IOS && typeof navigator.vibrate === 'function';
const HAPTIC = { tick: 6, land: 10, section: 14, crash: [60, 40, 120], fall: [20, 60, 80], best: [12, 50, 12, 50, 50] };
export const canHaptic = () => CAN_VIBRATE && matchMedia('(pointer: coarse)').matches;
export function haptic(kind) {
  if (!canHaptic() || !cfg.haptic || document.hidden) return;
  try { navigator.vibrate(HAPTIC[kind]); } catch { /* */ }
}

// ---- background music ----
// MP3 recordings (CC0, sources in the README). A track is fetched whole, decoded into an AudioBuffer and played by an
// AudioBufferSourceNode: with no <audio> element, phones show no "now playing" card on the lock screen and the silent
// switch is obeyed. Only one track is kept decoded; when it ends, another one starts. Fetched files stay in the
// service worker's cache, so they keep playing offline.
export const MUSIC = ['run', 'adventure', 'chase', 'sport', 'space'];
const MUSIC_K = 3, MUSIC_SR = 32000, MUSIC_FADE = 0.1;
const music = { buf: null, id: null, src: null, gain: null, ctx: null, t0: 0, off: 0, loading: 0, bad: new Set(), miss: new Set(), retryAt: 0 };
const musicVol = () => Math.min(1, gainOf() * cfg.music * cfg.music * MUSIC_K);   // never past full scale: it bypasses the compressor
const musicOn = () => musicVol() > 0;
// The music goes through a low-pass filter: after a crash it sounds as if from behind a wall, which makes the blow
// feel heavier than any noise could; the next run opens it again.
let muffle = null, muffled = false;
function musicOut() {
  if (muffle && muffle.ctx === actx) return muffle.fl;
  try {
    const fl = actx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 0.7; fl.frequency.value = muffled ? 450 : 20000;
    fl.connect(master || actx.destination); muffle = { ctx: actx, fl };
    return fl;
  } catch { return actx.destination; }
}
export function muffleMusic(on) {
  muffled = on;
  if (!muffle || muffle.ctx !== actx) return;
  try {
    const t = actx.currentTime, p = muffle.fl.frequency;
    p.cancelScheduledValues(t); p.setValueAtTime(p.value, t);
    p.exponentialRampToValueAtTime(on ? 450 : 20000, t + (on ? 0.35 : 0.6));
  } catch { /* */ }
}
function musicGesture() {
  if (!musicOn() || document.hidden || !actx) { musicPause(); return; }
  if (!music.id && !music.loading) musicNext(); else musicPlay();
}
function musicPlay() {
  if (!music.buf || !actx || !musicOn() || document.hidden || (music.src && music.ctx === actx)) return;
  musicPause();
  try {
    const g = actx.createGain(), s = actx.createBufferSource(), off = music.off % music.buf.duration, t = actx.currentTime;
    // it comes in over a tenth of a second: started at full level in the middle of the waveform it clicked
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(musicVol(), t + MUSIC_FADE); g.connect(musicOut());
    s.buffer = music.buf; s.connect(g);
    s.onended = () => { if (s === music.src) musicEnded(); };
    s.start(0, off);
    Object.assign(music, { src: s, gain: g, ctx: actx, t0: actx.currentTime - off });
  } catch { music.src = null; }
}
function musicPause() {
  const s = music.src;
  if (!s) return;
  music.src = null;
  let at = 0;
  try { at = music.ctx.currentTime - music.t0; } catch { /* */ }
  // fades out instead of stopping dead in the middle of the waveform (that clicked), then leaves the graph
  const g = music.gain;
  try {
    const t = music.ctx.currentTime;
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + MUSIC_FADE);
    s.onended = () => { try { g.disconnect(); } catch { /* */ } };
    s.stop(t + MUSIC_FADE + 0.02);
  } catch { try { s.onended = null; s.stop(); g.disconnect(); } catch { /* */ } }
  music.gain = null;
  if (at >= music.buf.duration - 0.05) musicEnded(); else music.off = at;
}
function musicEnded() {
  music.src = null; music.buf = null; music.off = 0;
  musicNext();
}
function musicNext() {
  if (!musicOn() || performance.now() < music.retryAt) return;
  const ok = MUSIC.filter((id) => !music.bad.has(id) && !music.miss.has(id) && id !== music.id);
  if (!ok.length) {   // nothing could be fetched: start over in half a minute, on a gesture
    music.id = null; music.miss.clear(); music.retryAt = performance.now() + 30000;
    return;
  }
  musicLoad(ok[Math.floor(Math.random() * ok.length)]);
}
const decodeWith = (c, ab) => new Promise((ok, no) => { const p = c.decodeAudioData(ab, ok, no); if (p && p.catch) p.catch(no); });
let musicDec = null;
function decodeMusic(ab) {   // at the file's 32 kHz when the browser can: two thirds of the memory
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  try { if (!musicDec && OAC) musicDec = new OAC(2, 1, MUSIC_SR); } catch { musicDec = null; }
  const viaCtx = () => (actx ? decodeWith(actx, ab) : Promise.reject(new Error('no context')));
  if (!musicDec) return viaCtx();
  let first;
  try { first = decodeWith(musicDec, ab.slice(0)); } catch (e) { first = Promise.reject(e); }
  return first.catch(viaCtx);
}
function musicLoad(id) {
  const n = ++music.loading;
  const fail = (set) => {
    if (n !== music.loading) return;
    music.loading = 0; set.add(id);
    if (set === music.bad) musicNext(); else music.id = null;   // no network: try again on a later gesture
  };
  fetch(`music/${id}.mp3`).then((r) => (r.ok ? r.arrayBuffer().catch(() => Promise.reject('net')) : Promise.reject(r.status)), () => Promise.reject('net'))
    .then((ab) => {
      if (n !== music.loading) return null;
      musicPause(); music.buf = null;
      return decodeMusic(ab).catch(() => Promise.reject('decode'));
    })
    .then((b) => {
      if (!b || n !== music.loading) return;
      music.loading = 0;
      Object.assign(music, { buf: b, id, off: 0 });
      musicPlay();
    }, (why) => fail(why === 'decode' ? music.bad : music.miss));   // a server error may pass; a broken file won't
}
