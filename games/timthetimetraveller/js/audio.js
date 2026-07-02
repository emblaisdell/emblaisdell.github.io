// Procedural sound effects via the Web Audio API -- no audio files, everything
// is synthesized to match the game's hand-drawn feel. The world sim stays pure:
// it only pushes event names into `world.events`, and main.js forwards them here.
//
// Mobile robustness (see the game-audio pattern): the AudioContext's lifecycle
// changes out from under us -- it starts `suspended` (needs a gesture), goes
// `interrupted` on iOS (call / app-switch / lock / reopen), or `closed` (iOS
// tears it down). `ensure()` is the single accessor every sound routes through:
// it lazily builds, revives on ANYTHING that isn't `running` (not just
// `suspended` -- that omission is the classic "sound dies after rejoin" bug),
// rebuilds a fresh context when the old one is `closed`, and sets the iOS audio
// session to `playback` so sound survives the silent/ringer switch.

const STORE_KEY = 'ttt_muted';

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    try { this.muted = localStorage.getItem(STORE_KEY) === '1'; } catch (e) { /* ignore */ }
    this.lastPlay = {};   // name -> last start time, for de-duping bursts
    this.onContext = null; // called after a fresh context is built (Music rebuilds)
  }

  // The accessor: builds / revives / rebuilds, and returns the live context (or
  // null if Web Audio is unavailable). Safe to call from anywhere, any time.
  ensure() {
    // iOS/WebKit: 'playback' keeps sound on even with the silent switch engaged.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
    // Build fresh on first use, or when iOS has torn the context down.
    if (!this.ctx || this.ctx.state === 'closed') {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch (e) { this.ctx = null; return null; }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.lastPlay = {};                  // clock reset -> old de-dupe times stale
      if (this.onContext) this.onContext(); // let Music rebuild its graph on the new ctx
    }
    // Revive on ANYTHING not running: 'suspended' (backgrounded) AND iOS's
    // 'interrupted'. resume() is async and may reject outside a gesture -- swallow it.
    if (this.ctx.state !== 'running') { try { this.ctx.resume().catch(() => {}); } catch (e) { /* ignore */ } }
    return this.ctx;
  }

  // Call on a user gesture / when the page returns to the foreground.
  resume() { this.ensure(); }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem(STORE_KEY, m ? '1' : '0'); } catch (e) { /* ignore */ }
  }
  toggle() { this.setMuted(!this.muted); return this.muted; }

  // --- primitive voices --------------------------------------------------
  // The node a voice should connect into: a stereo panner feeding master when a
  // (nonzero) pan is asked for and supported, else master directly.
  sink(pan = 0) {
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(this.master);
      return p;
    }
    return this.master;
  }

  tone(freq, opts = {}) {
    const { type = 'sine', dur = 0.12, gain = 0.3, attack = 0.005,
      release = 0.06, slideTo = null, delay = 0, detune = 0, pan = 0 } = opts;
    const ctx = this.ctx, t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    if (detune) osc.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);
    osc.connect(g).connect(this.sink(pan));
    osc.start(t0);
    osc.stop(t0 + dur + release + 0.02);
  }

  noise(opts = {}) {
    const { dur = 0.2, gain = 0.3, type = 'lowpass', freq = 1000,
      freqTo = null, q = 1, delay = 0, pan = 0 } = opts;
    const ctx = this.ctx, t0 = ctx.currentTime + delay;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.Q.value = q;
    filt.frequency.setValueAtTime(freq, t0);
    if (freqTo) filt.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(g).connect(this.sink(pan));
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // --- event dispatch ----------------------------------------------------
  // `ev` is an event name, or a `{ name, dist, dx, ... }` object for positional
  // sounds (dist/dx in cells, relative to the focused Tim -- see world.emit).
  play(ev) {
    this.ensure();
    if (!this.ctx || this.muted) return;
    const name = typeof ev === 'string' ? ev : ev.name;
    const pos = typeof ev === 'string' ? null : ev;
    // Collapse identical events that fire in the same instant (e.g. several
    // pistons on one frame) so they don't stack into a loud blast.
    const t = this.ctx.currentTime;
    if (this.lastPlay[name] && t - this.lastPlay[name] < 0.04) return;
    this.lastPlay[name] = t;

    switch (name) {
      case 'jump':
        this.tone(360, { type: 'square', dur: 0.10, gain: 0.16, slideTo: 640 });
        break;
      case 'jump2':   // the airborne double-jump: a higher, lighter chirp
        this.tone(560, { type: 'square', dur: 0.10, gain: 0.14, slideTo: 900 });
        break;
      case 'land':
        this.noise({ dur: 0.09, gain: 0.22, type: 'lowpass', freq: 500, freqTo: 120, q: 0.7 });
        this.tone(120, { type: 'sine', dur: 0.08, gain: 0.10, slideTo: 70 });
        break;
      case 'collect':   // bright rising arpeggio
        this.tone(660, { type: 'triangle', dur: 0.09, gain: 0.20 });
        this.tone(880, { type: 'triangle', dur: 0.10, gain: 0.20, delay: 0.06 });
        this.tone(1320, { type: 'triangle', dur: 0.13, gain: 0.16, delay: 0.12 });
        break;
      case 'win':       // little fanfare (C-E-G-C)
        [523, 659, 784, 1047].forEach((f, i) =>
          this.tone(f, { type: 'triangle', dur: 0.16, gain: 0.22, delay: i * 0.12 }));
        break;
      case 'switch':
        this.tone(500, { type: 'sine', dur: 0.06, gain: 0.13 });
        this.tone(760, { type: 'sine', dur: 0.06, gain: 0.11, delay: 0.04 });
        break;
      case 'button':    // mechanical click
        this.tone(300, { type: 'square', dur: 0.025, gain: 0.12 });
        this.tone(190, { type: 'square', dur: 0.04, gain: 0.10, delay: 0.02 });
        break;
      case 'piston': {  // heavy clunk -- fades + dulls with distance from Tim
        // g: 1 up close, ~0.5 at 8 cells, ~0.2 at 16. pan: full by ~12 cells out.
        let g = 1, pan = 0, freq = 420;
        if (pos && pos.dist != null) {
          g = 1 / (1 + (pos.dist / 8) ** 2);
          pan = Math.max(-1, Math.min(1, pos.dx / 12)) * 0.8;
          freq = 420 * (0.4 + 0.6 * g);   // distant clunks lose their crack
        }
        this.noise({ dur: 0.08, gain: 0.18 * g, type: 'bandpass', freq, q: 1.2, pan });
        this.tone(90, { type: 'square', dur: 0.06, gain: 0.14 * g, slideTo: 55, pan });
        break;
      }
      case 'timeTravel':  // rising portal whoosh
        this.tone(200, { type: 'sine', dur: 0.5, gain: 0.15, slideTo: 820 });
        this.noise({ dur: 0.5, gain: 0.07, type: 'bandpass', freq: 300, freqTo: 2200, q: 2 });
        break;
      case 'spawn':     // shimmering arrival
        this.tone(700, { type: 'triangle', dur: 0.18, gain: 0.15, slideTo: 1400 });
        this.tone(1050, { type: 'sine', dur: 0.14, gain: 0.10, delay: 0.05 });
        break;
      case 'vanish':    // descending departure
        this.tone(1200, { type: 'triangle', dur: 0.22, gain: 0.13, slideTo: 380 });
        break;
      case 'death:red':     // explosion
        this.noise({ dur: 0.5, gain: 0.38, type: 'lowpass', freq: 1400, freqTo: 80, q: 0.8 });
        this.tone(130, { type: 'sawtooth', dur: 0.4, gain: 0.20, slideTo: 40 });
        break;
      case 'death:wire':    // electric zap
        this.tone(820, { type: 'sawtooth', dur: 0.22, gain: 0.18, slideTo: 200 });
        this.tone(840, { type: 'square', dur: 0.2, gain: 0.10, detune: 35, slideTo: 180 });
        this.noise({ dur: 0.22, gain: 0.12, type: 'highpass', freq: 2200, q: 1 });
        break;
      case 'death:piston':  // bone-crush thud
        this.noise({ dur: 0.18, gain: 0.34, type: 'lowpass', freq: 800, freqTo: 90 });
        this.tone(80, { type: 'square', dur: 0.16, gain: 0.22, slideTo: 42 });
        break;
      case 'death:fall':    // descending whistle into the void
        this.tone(900, { type: 'sine', dur: 0.5, gain: 0.17, slideTo: 120 });
        break;
      default:
        if (name.startsWith('death:'))
          this.tone(200, { type: 'sawtooth', dur: 0.3, gain: 0.2, slideTo: 80 });
        break;
    }
  }
}
