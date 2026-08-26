'use strict';
/* ------------------------------------------------------------------ *
 * Synthesized audio. No asset files — everything is built from noise
 * buffers and oscillators so the game stays a static drop-in.
 *
 * Mobile lifecycle notes (the two things that break browser-game audio):
 *  - iOS mutes Web Audio with the ringer switch unless the audio session
 *    is declared 'playback'.
 *  - iOS suspends AND sometimes closes the context on app-switch / call /
 *    lock, entering 'interrupted' — a state naive code never revives.
 * Both are handled in audio() below, which every sound routes through.
 * ------------------------------------------------------------------ */

let actx = null, graphCtx = null;
let master = null, verb = null, verbIn = null;
let crumples = null;
let muted = false;
try { muted = localStorage.getItem('wop_muted') === '1'; } catch (_) {}

function audio(){
  // iOS/WebKit: play through the silent/ringer switch.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}
  // Build fresh on first use, or after iOS has torn the context down.
  if (!actx || actx.state === 'closed'){
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (_) { return null; }
    graphCtx = null;
  }
  if (!actx) return null;
  // Revive on anything that isn't running — 'suspended' AND iOS 'interrupted'.
  if (actx.state !== 'running'){ try { actx.resume().catch(() => {}); } catch (_) {} }
  if (graphCtx !== actx) buildGraph();
  return actx;
}

function buildGraph(){
  const ac = actx;
  master = ac.createGain();
  master.gain.value = muted ? 0 : 0.85;
  master.connect(ac.destination);

  // One shared reverb bus: cost is constant no matter how many sounds send to it.
  const conv = ac.createConvolver();
  conv.buffer = makeIR(ac, 1.6, 1.9);
  const wet = ac.createGain(); wet.gain.value = 1.7;
  conv.connect(wet).connect(master);
  verb = conv;
  verbIn = ac.createGain(); verbIn.gain.value = 1; verbIn.connect(conv);

  crumples = [makeCrumple(ac, 1), makeCrumple(ac, 2), makeCrumple(ac, 3), makeCrumple(ac, 4)];
  graphCtx = ac;
}

/* --------------------------- buffer bakery ------------------------ */
function rng(seed){                     // deterministic, so the crumples are stable
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function makeIR(ac, dur, decay){
  const n = Math.max(1, Math.floor(ac.sampleRate * dur));
  const b = ac.createBuffer(2, n, ac.sampleRate);
  for (let c = 0; c < 2; c++){
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random()*2 - 1) * Math.pow(1 - i/n, decay);
  }
  return b;
}
/* A crumple: dense random grains, so it reads as splintering wood and rope
 * rather than as plain hiss. */
function makeCrumple(ac, seed){
  const dur = 0.28, n = Math.floor(ac.sampleRate * dur);
  const b = ac.createBuffer(1, n, ac.sampleRate);
  const d = b.getChannelData(0);
  const rnd = rng(seed * 9781 + 17);
  let i = 0;
  while (i < n){
    const glen = Math.max(2, Math.floor((0.0015 + rnd()*0.009) * ac.sampleRate));
    const amp  = Math.pow(rnd(), 1.5);
    for (let j = 0; j < glen && i < n; j++, i++)
      d[i] = (rnd()*2 - 1) * Math.sin(Math.PI * j/glen) * amp;
    i += Math.floor(rnd() * 0.0035 * ac.sampleRate);
  }
  for (let k = 0; k < n; k++) d[k] *= Math.pow(1 - k/n, 1.6);
  return b;
}

/* ---------------------------- voice budget ------------------------ */
/* Ten upgraded circles can fire ~30 shots/sec and a piercing shot can pop
 * ten shapes at once. Without a cap that is mud, and expensive mud. */
const budget = {};
function take(kind, maxIn, win){
  const now = performance.now() / 1000;
  const b = budget[kind] || (budget[kind] = []);
  while (b.length && now - b[0] > win) b.shift();
  if (b.length >= maxIn) return false;
  b.push(now);
  return true;
}
function env(g, t, peak, attack, dur){
  g.gain.setValueAtTime(0.0001, t);                        // exp ramps can't touch 0
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}
function send(ac, node, amount){
  const s = ac.createGain(); s.gain.value = amount;
  node.connect(s); s.connect(verbIn);
}

/* ------------------------------ sounds ---------------------------- */
const SFX = {

  /* A shape takes a hit: a short, dry pop. Bigger polygons pop lower. */
  pop(sides, color){
    if (muted) return;
    const ac = audio(); if (!ac) return;
    if (!take('pop', 6, 0.11)) return;
    const t = ac.currentTime;
    const f0 = (940 - (sides - 3) * 135) * (0.9 + Math.random()*0.22);

    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.38, t + 0.055);
    const g = ac.createGain();
    env(g, t, 0.20, 0.003, 0.075);
    o.connect(g).connect(master);
    send(ac, g, 0.10);
    o.start(t); o.stop(t + 0.1);

    // the little transient that makes it a "p"
    const src = ac.createBufferSource();
    src.buffer = crumples[(sides + color) % crumples.length];
    src.playbackRate.value = 2.6;
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const cg = ac.createGain();
    env(cg, t, 0.075, 0.002, 0.03);
    src.connect(hp).connect(cg).connect(master);
    src.start(t); src.stop(t + 0.05);
  },

  /* A circle looses a shot: a crumply, reverberant catapult release. */
  fire(){
    if (muted) return;
    const ac = audio(); if (!ac) return;
    if (!take('fire', 4, 0.16)) return;
    const t = ac.currentTime;

    // the arm and rope: grainy, splintery, wide
    const src = ac.createBufferSource();
    src.buffer = crumples[(Math.random() * crumples.length) | 0];
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1500 + Math.random()*500, t);
    bp.frequency.exponentialRampToValueAtTime(520, t + 0.22);
    bp.Q.value = 0.8;
    const g = ac.createGain();
    env(g, t, 0.26, 0.005, 0.26);
    src.connect(bp).connect(g).connect(master);
    send(ac, g, 0.85);                       // heavy send — this is the reverby part
    src.start(t); src.stop(t + 0.32);

    // the thump of the arm hitting the stop
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.14);
    const og = ac.createGain();
    env(og, t, 0.20, 0.006, 0.17);
    o.connect(og).connect(master);
    send(ac, og, 0.3);
    o.start(t); o.stop(t + 0.22);
  },

  /* Something reached the exit: a dark sparkle — low detuned drone under a
   * scatter of high bells, which is the color getting in. */
  damage(amount){
    if (muted) return;
    const ac = audio(); if (!ac) return;
    if (!take('damage', 3, 0.6)) return;
    const t = ac.currentTime;
    const mag = Math.min(1, (amount || 1) / 60);

    // the dark half
    for (let i = 0; i < 2; i++){
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 55 * (i ? 1.006 : 1);
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1100, t);
      lp.frequency.exponentialRampToValueAtTime(140, t + 0.9);
      const g = ac.createGain();
      env(g, t, 0.10 + 0.09*mag, 0.02, 0.95);
      o.connect(lp).connect(g).connect(master);
      send(ac, g, 0.35);
      o.start(t); o.stop(t + 1.0);
    }

    // the sparkle half: a minor-ish cluster, scattered in time
    const ratios = [1, 1.189, 1.335, 1.498, 1.782, 2, 2.378, 2.67];
    const base = 1245;
    const n = 5 + Math.round(mag * 3);
    for (let i = 0; i < n; i++){
      const at = t + i * 0.042 + Math.random() * 0.05;
      const o = ac.createOscillator(); o.type = 'sine';
      o.frequency.value = base * ratios[(Math.random()*ratios.length)|0];
      const g = ac.createGain();
      env(g, at, 0.055, 0.004, 0.34);
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 5200;   // keeps it dark, not glassy
      o.connect(lp).connect(g).connect(master);
      send(ac, g, 0.8);
      o.start(at); o.stop(at + 0.4);
    }
  },

  /* End of the game. Gray and hollow if you held; a bloom of color if not. */
  end(won){
    if (muted) return;
    const ac = audio(); if (!ac) return;
    const t = ac.currentTime;
    if (won){
      [196, 233.1, 293.7].forEach((f, i) => {          // hollow, unresolved
        const o = ac.createOscillator(); o.type = 'triangle';
        o.frequency.value = f;
        const g = ac.createGain();
        env(g, t + i*0.10, 0.14, 0.05, 1.9);
        o.connect(g).connect(master);
        send(ac, g, 0.6);
        o.start(t + i*0.10); o.stop(t + i*0.10 + 2.0);
      });
    } else {
      SFX.damage(60);
      for (let i = 0; i < 14; i++){
        const at = t + 0.1 + i * 0.06 + Math.random()*0.05;
        const o = ac.createOscillator(); o.type = 'sine';
        o.frequency.value = 700 + Math.random() * 2200;
        const g = ac.createGain();
        env(g, at, 0.05, 0.005, 0.5);
        o.connect(g).connect(master);
        send(ac, g, 0.9);
        o.start(at); o.stop(at + 0.6);
      }
    }
  },

  isMuted(){ return muted; },
  toggleMute(){
    muted = !muted;
    try { localStorage.setItem('wop_muted', muted ? '1' : '0'); } catch (_) {}
    if (master) master.gain.value = muted ? 0 : 0.85;
    if (!muted) audio();
    return muted;
  },
  /* called from the first real user gesture */
  wake(){ audio(); }
};

/* The three revival hooks. */
document.addEventListener('visibilitychange', () => { if (!document.hidden) audio(); });
window.addEventListener('pageshow', () => audio());
window.addEventListener('pointerdown', () => audio(), { passive: true });
