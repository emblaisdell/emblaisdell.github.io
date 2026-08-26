// audio.js — synthesized shop-floor sound. No assets: everything is Web Audio,
// so the game stays a single static directory.
//
// The context is built lazily and revived on anything that is not 'running',
// including iOS's 'interrupted', and rebuilt outright when iOS closes it —
// otherwise sound dies for good when the tab is backgrounded and reopened.

const KEY = 'nand-idle-muted';
let actx = null;
let master = null;
let humGain = null;
let muted = false;
try { muted = localStorage.getItem(KEY) === '1'; } catch { /* private mode */ }

function audio() {
  // iOS/WebKit: 'playback' plays through the silent switch.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
  if (!actx || actx.state === 'closed') {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain();
      master.gain.value = 0.26;
      master.connect(actx.destination);
      humGain = null;
    } catch { return null; }
  }
  if (actx && actx.state !== 'running') {
    try { actx.resume().catch(() => {}); } catch { /* ignore */ }
  }
  return actx;
}

export function initAudio(root = document) {
  root.addEventListener('pointerdown', () => audio(), { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) audio(); });
  window.addEventListener('pageshow', () => audio());
}

export function isMuted() { return muted; }
export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch { /* ignore */ }
  if (muted && humGain) humGain.gain.value = 0;
  if (!muted) audio();
}

// --- building blocks ---------------------------------------------------------

function tone(ac, { type = 'square', f0, f1 = f0, t0 = 0, dur = 0.08, vol = 0.3, glide = 'exp' }) {
  const t = ac.currentTime + t0;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) {
    if (glide === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    else o.frequency.linearRampToValueAtTime(f1, t + dur);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.03);
}

function noise(ac, { t0 = 0, dur = 0.06, vol = 0.25, cutoff = 1800, type = 'lowpass' }) {
  const t = ac.currentTime + t0;
  const frames = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = cutoff;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// --- the kit -----------------------------------------------------------------

const VOICES = {
  click: (ac) => { tone(ac, { f0: 820, f1: 560, dur: 0.035, vol: 0.16 }); noise(ac, { dur: 0.02, vol: 0.06, cutoff: 4000, type: 'highpass' }); },
  place: (ac) => { tone(ac, { type: 'square', f0: 190, f1: 88, dur: 0.09, vol: 0.24 }); noise(ac, { dur: 0.05, vol: 0.18, cutoff: 900 }); },
  wire: (ac) => { tone(ac, { type: 'sawtooth', f0: 420, f1: 1180, dur: 0.07, vol: 0.15 }); },
  unwire: (ac) => { tone(ac, { type: 'sawtooth', f0: 900, f1: 300, dur: 0.06, vol: 0.13 }); },
  record: (ac) => { tone(ac, { f0: 214, dur: 0.22, vol: 0.2 }); tone(ac, { f0: 330, dur: 0.22, vol: 0.14 }); noise(ac, { dur: 0.2, vol: 0.05, cutoff: 700 }); },
  done: (ac) => { [523, 659, 880].forEach((f, i) => tone(ac, { type: 'triangle', f0: f, t0: i * 0.055, dur: 0.1, vol: 0.22 })); },
  ship: (ac) => { tone(ac, { f0: 1180, f1: 1560, dur: 0.045, vol: 0.13 }); noise(ac, { t0: 0.02, dur: 0.03, vol: 0.07, cutoff: 5200, type: 'highpass' }); },
  client: (ac) => { [392, 523, 784].forEach((f, i) => tone(ac, { type: 'square', f0: f, t0: i * 0.09, dur: 0.14, vol: 0.16 })); },
  cash: (ac) => { tone(ac, { type: 'triangle', f0: 660, f1: 990, dur: 0.16, vol: 0.22 }); },
  error: (ac) => { tone(ac, { type: 'sawtooth', f0: 150, f1: 84, dur: 0.26, vol: 0.2 }); noise(ac, { dur: 0.12, vol: 0.08, cutoff: 500 }); },
  scrap: (ac) => { tone(ac, { type: 'square', f0: 300, f1: 70, dur: 0.2, vol: 0.18 }); noise(ac, { dur: 0.16, vol: 0.14, cutoff: 1200 }); },
};

const lastAt = new Map();
const MIN_GAP = { ship: 260, click: 40, wire: 40, place: 60 };

export function sfx(name) {
  if (muted) return;
  const voice = VOICES[name];
  if (!voice) return;
  const now = performance.now();
  const gap = MIN_GAP[name] || 90;
  if (now - (lastAt.get(name) || -1e9) < gap) return;
  lastAt.set(name, now);
  const ac = audio();
  if (!ac) return;
  try { voice(ac); } catch { /* a dying context, nothing to do */ }
}

/**
 * The floor hum: a low drone that tracks how much of the shop is running, so a
 * busy schedule sounds busy. Level is 0..1.
 */
export function setHum(level) {
  if (muted || level <= 0) {
    if (humGain) humGain.gain.value = 0;
    if (level <= 0) return;
  }
  const ac = audio();
  if (!ac) return;
  if (!humGain) {
    try {
      const osc = ac.createOscillator();
      const sub = ac.createOscillator();
      const filt = ac.createBiquadFilter();
      const lfo = ac.createOscillator();
      const lfoGain = ac.createGain();
      humGain = ac.createGain();
      osc.type = 'sawtooth'; osc.frequency.value = 55;
      sub.type = 'sine'; sub.frequency.value = 27.5;
      filt.type = 'lowpass'; filt.frequency.value = 260;
      lfo.type = 'sine'; lfo.frequency.value = 0.27;
      lfoGain.gain.value = 40;
      lfo.connect(lfoGain).connect(filt.frequency);
      humGain.gain.value = 0;
      osc.connect(filt); sub.connect(filt);
      filt.connect(humGain).connect(master);
      osc.start(); sub.start(); lfo.start();
    } catch { humGain = null; return; }
  }
  const target = muted ? 0 : Math.min(0.05, 0.05 * level);
  try { humGain.gain.setTargetAtTime(target, ac.currentTime, 0.4); } catch { /* ignore */ }
}
