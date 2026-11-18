// Sound: effects synthesized with Web Audio, the hum of the rolling ball, background music and vibration.
// The page calls sfx.*; nothing here knows about the game. `cfg` is the page's settings object
// ({ vol, music, haptic }, 0..1), read on every sound, so a slider works at once.
//
// iPhone: sound turns on only from a "real" gesture (touch released, click, key), not from pointerdown; after
// minimizing or a phone call the context may report 'running' and stay silent, so it is replaced on the next gesture.
// Web Audio obeys the silent switch on the side. Chrome and other WKWebView browsers on iPhone stay silent until
// the page has played a regular <audio>, so a silent clip is looped there (and sound then ignores the silent switch).
let cfg = { vol: 0.5, music: 0.4, haptic: true };
let actx = null, bus = null, stale = false, stuckAt = 0, resumeBusy = false, resumeTry = 0;
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
  try {   // a compressor: louder on a quiet phone speaker, and overlapping sounds don't distort
    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
    bus = actx.createGain(); bus.connect(comp); comp.connect(actx.destination);
  } catch { bus = null; }
  try {   // an empty clip inside the gesture, or old iOS doesn't open the output
    const src = actx.createBufferSource();
    src.buffer = actx.createBuffer(1, 1, 22050); src.connect(actx.destination); src.start(0);
  } catch { /* */ }
  hum = null; noiseBuf = null;
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
  if (music.gain) { try { music.gain.gain.value = musicVol(); } catch { /* */ } }
  if (!musicOn()) musicPause(); else if (actx && !document.hidden) musicGesture();
  if (!soundOn() && htmlAudio) htmlAudio.pause();
}

// ---- building blocks ----
const out = () => bus || actx.destination;
// a note: attack a, decay until dur; `to` — where the pitch glides; lp — a low-pass filter for softer saws and squares
function note(f, { type = 'sine', vol = 0.2, a = 0.004, dur = 0.2, delay = 0, to = 0, lp = 0, detune = 0 } = {}) {
  if (!canSound()) return;
  const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.detune.value = detune; o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol * gainOf(), t + Math.min(a, dur * 0.9));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let src = o;
  if (lp) { const fl = actx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); src = fl; }
  src.connect(g); g.connect(out());
  o.start(t); o.stop(t + dur + 0.05);
}
let noiseBuf = null;
function noise() {   // two seconds of brownish noise, shared by every burst and the hum
  if (noiseBuf && noiseBuf.ctx === actx) return noiseBuf.buf;
  const n = actx.sampleRate * 2, buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) { last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04; d[i] = last * 6; }
  noiseBuf = { ctx: actx, buf };
  return buf;
}
// a burst of filtered noise: f0 → f1 is the filter sweep
function burst({ type = 'lowpass', f0 = 800, f1 = 0, q = 0.7, vol = 0.3, a = 0.005, dur = 0.2, delay = 0 } = {}) {
  if (!canSound()) return;
  const t = actx.currentTime + delay, s = actx.createBufferSource(), fl = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noise(); s.loop = true;
  fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f0, t);
  if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol * gainOf(), t + Math.min(a, dur * 0.9));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(g); g.connect(out());
  s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
}
const semi = (f, n) => f * Math.pow(2, n / 12);

// ---- the hum of the rolling ball: noise through a low-pass filter, louder and brighter with the speed ----
let hum = null;
export function setHum(speed, onGround) {   // speed 0..1 of the top speed
  if (!canSound() || document.hidden) { if (hum) { try { hum.g.gain.value = 0; } catch { /* */ } } return; }
  if (!hum || hum.ctx !== actx) {
    try {
      const s = actx.createBufferSource(), fl = actx.createBiquadFilter(), g = actx.createGain();
      s.buffer = noise(); s.loop = true; fl.type = 'lowpass'; fl.Q.value = 0.8; g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(out()); s.start();
      hum = { ctx: actx, s, fl, g };
    } catch { hum = null; return; }
  }
  const t = actx.currentTime, k = onGround ? clamp(speed, 0, 1) : 0;
  hum.g.gain.setTargetAtTime(k > 0 ? (0.05 + 0.13 * k) * gainOf() : 0, t, k > 0 ? 0.08 : 0.03);
  hum.fl.frequency.setTargetAtTime(160 + 520 * k, t, 0.1);
}

// ---- effects ----
// Everything sits low (150–800 Hz): high beeps tire on a phone speaker.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];   // a pentatonic ladder for stars taken in a row
let combo = 0, comboAt = 0;
export const sfx = {
  tap() { note(420, { type: 'triangle', vol: 0.12, dur: 0.07, to: 300, lp: 1500 }); },
  star() {
    const now = performance.now();
    combo = now - comboAt < 900 ? Math.min(SCALE.length - 1, combo + 1) : 0;
    comboAt = now;
    const f = semi(330, SCALE[combo]);
    note(f, { type: 'triangle', vol: 0.2, dur: 0.22, lp: 2400 });
    note(f * 2, { vol: 0.07, dur: 0.3, delay: 0.015 });
  },
  move() {   // a lane change: something heavy starts rolling sideways
    burst({ type: 'bandpass', f0: 340, f1: 760, q: 0.9, vol: 0.22, a: 0.025, dur: 0.13 });
    note(110, { vol: 0.07, dur: 0.12, to: 150 });
  },
  settle() {   // and drops into its lane
    note(120, { vol: 0.16, dur: 0.1, to: 70 });
    burst({ f0: 380, f1: 130, vol: 0.14, dur: 0.07 });
  },
  bump() { note(150, { vol: 0.25, dur: 0.1, to: 90 }); },                                          // no lane there
  drop() { burst({ type: 'bandpass', f0: 1000, f1: 300, q: 1, vol: 0.3, a: 0.01, dur: 0.12 }); },   // thrown down out of the air
  bonus() { [0, 4, 7].forEach((n, i) => note(semi(440, n), { type: 'triangle', vol: 0.2, dur: 0.16, delay: i * 0.06, lp: 2600 })); },
  pop() {   // the shield bursts
    burst({ type: 'bandpass', f0: 1800, f1: 500, q: 1.5, vol: 0.5, dur: 0.16 });
    note(520, { type: 'triangle', vol: 0.22, dur: 0.18, to: 180, lp: 2000 });
  },
  fly() {   // off the ground
    burst({ type: 'bandpass', f0: 250, f1: 1600, q: 0.8, vol: 0.5, a: 0.2, dur: 0.7 });
    [0, 4, 7, 12, 16, 19].forEach((n, i) => note(semi(330, n), { type: 'triangle', vol: 0.18, dur: i === 5 ? 0.6 : 0.16, delay: i * 0.07, lp: 2800 }));
  },
  flyEnd() { burst({ type: 'bandpass', f0: 1300, f1: 280, q: 0.8, vol: 0.4, a: 0.05, dur: 0.5 }); },
  jump() {
    burst({ type: 'bandpass', f0: 300, f1: 1100, q: 1.2, vol: 0.5, a: 0.05, dur: 0.32 });
    note(190, { type: 'triangle', vol: 0.16, dur: 0.2, to: 330, lp: 1200 });
  },
  land(k = 0.5) {
    note(120, { vol: 0.35 * (0.5 + k), dur: 0.16, to: 55 });
    burst({ f0: 500, f1: 120, vol: 0.5 * (0.4 + k), dur: 0.14 });
  },
  crash() {
    note(150, { vol: 0.6, dur: 0.35, to: 40 });
    burst({ f0: 2200, f1: 200, vol: 0.9, dur: 0.3 });
    for (let k = 0; k < 4; k++) burst({ type: 'bandpass', f0: 500 + Math.random() * 700, q: 3, vol: 0.3, dur: 0.06, delay: 0.1 + k * 0.07 + Math.random() * 0.03 });
  },
  fall() {
    note(520, { type: 'triangle', vol: 0.22, dur: 0.75, to: 90, lp: 1600 });
    burst({ type: 'bandpass', f0: 900, f1: 200, q: 1, vol: 0.25, a: 0.1, dur: 0.7 });
  },
  section() {
    burst({ type: 'bandpass', f0: 250, f1: 1400, q: 1, vol: 0.35, a: 0.12, dur: 0.4 });
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
const MUSIC_K = 3, MUSIC_SR = 32000;
const music = { buf: null, id: null, src: null, gain: null, ctx: null, t0: 0, off: 0, loading: 0, bad: new Set(), miss: new Set(), retryAt: 0 };
const musicVol = () => Math.min(1, gainOf() * cfg.music * cfg.music * MUSIC_K);   // never past full scale: it bypasses the compressor
const musicOn = () => musicVol() > 0;
function musicGesture() {
  if (!musicOn() || document.hidden || !actx) { musicPause(); return; }
  if (!music.id && !music.loading) musicNext(); else musicPlay();
}
function musicPlay() {
  if (!music.buf || !actx || !musicOn() || document.hidden || (music.src && music.ctx === actx)) return;
  musicPause();
  try {
    const g = actx.createGain(), s = actx.createBufferSource(), off = music.off % music.buf.duration;
    g.gain.value = musicVol(); g.connect(actx.destination);
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
  try { s.onended = null; s.stop(); } catch { /* */ }
  try { music.gain.disconnect(); } catch { /* */ }
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
