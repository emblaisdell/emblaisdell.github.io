// Generative, adaptive background music -- synthesized (no audio files), sharing
// the AudioContext with the SFX synth so the mute button covers it for free.
//
// The bed starts calm and mysterious and grows driving as Tim banks time energy:
// `setIntensity(0..1)` (energy / WIN_ENERGY) raises the tempo, opens the filter,
// densifies the arpeggio and bass, and fades in a kick/hat groove. A "temporal"
// shimmer layer swells while time travel is active or several Tims coexist.
//
// Scheduling uses the standard Web-Audio lookahead pattern: a coarse setInterval
// wakes up and queues the next few 16th-notes precisely on the audio clock.

const STORE_KEY = 'ttt_music';
const STEPS_PER_BAR = 16;
const STEPS = STEPS_PER_BAR * 8;    // 8 bars = 4 chords x 2 bars, then it loops

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// i - VI - III - VII in A minor (Am F C G): wistful when soft, anthemic when
// pushed. Each chord carries a pad voicing, a bass root, and an arpeggio pool.
const CHORDS = [
  { pad: [57, 60, 64], bass: 45, arp: [69, 72, 76, 81] }, // Am
  { pad: [57, 60, 65], bass: 41, arp: [69, 72, 77, 81] }, // F
  { pad: [55, 60, 64], bass: 48, arp: [67, 72, 76, 79] }, // C
  { pad: [59, 62, 67], bass: 43, arp: [71, 74, 79, 83] }, // G
];

export class Music {
  constructor(sound) {
    this.sound = sound;         // shares sound.ctx + sound.master
    this.ctx = null;
    this.started = false;
    this.enabled = true;
    try { this.enabled = localStorage.getItem(STORE_KEY) !== '0'; } catch (e) { /* ignore */ }
    this.muted = false;         // mirrors the global mute button
    this.ducked = false;        // dropped during the death screen
    this.baseVol = 0.32;
    this.targetIntensity = 0;
    this.intensity = 0;
    this.temporal = false;
    this.step = 0;
    this.arpIdx = 0;
  }

  audible() { return this.enabled && !this.muted; }

  start() {
    if (this.started) return;
    const ctx = this.sound.ensure();
    if (!ctx) return;            // no Web Audio -> silently do nothing
    this.started = true;
    // If iOS tears the shared context down and Sound rebuilds it, rebuild our
    // graph onto the new one too (the running scheduler just picks up this.ctx).
    this.sound.onContext = () => this.rebuild();
    this.ctx = ctx;
    this.buildGraph();
    this.timer = setInterval(() => this.schedule(), 25);
  }

  // Re-point at the shared context and rebuild the graph (on start, or after the
  // context was closed and recreated). Old nodes belong to the dead context and
  // are dropped for GC.
  rebuild() {
    if (!this.started || !this.sound.ctx) return;
    this.ctx = this.sound.ctx;
    this.buildGraph();
  }

  // Construct the persistent audio graph on this.ctx, wired into sound.master.
  buildGraph() {
    const ctx = this.ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.out.connect(this.sound.master);

    // Tempo-independent echo send -- gives the sparse arps + shimmer their space.
    this.delay = ctx.createDelay(1.0); this.delay.delayTime.value = 0.30;
    this.fb = ctx.createGain(); this.fb.gain.value = 0.34;
    this.delay.connect(this.fb).connect(this.delay);
    this.delayWet = ctx.createGain(); this.delayWet.gain.value = 0.5;
    this.delay.connect(this.delayWet).connect(this.out);

    // Pad bus through a filter that brightens with intensity.
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 700; this.padFilter.Q.value = 0.6;
    this.padFilter.connect(this.out);

    // Arp bus -> dry + echo.
    this.arpSend = ctx.createGain(); this.arpSend.gain.value = 1;
    this.arpSend.connect(this.out); this.arpSend.connect(this.delay);

    // Persistent detuned "temporal" shimmer, ducked in/out by state.
    this.shimmerGain = ctx.createGain(); this.shimmerGain.gain.value = 0;
    this.shimmerGain.connect(this.out); this.shimmerGain.connect(this.delay);
    this.shimmerOsc = [-7, 7].map((det) => {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.detune.value = det; o.frequency.value = mtof(76);
      o.connect(this.shimmerGain); o.start();
      return o;
    });

    this.applyGain();
    this.nextStepTime = ctx.currentTime + 0.1;
  }

  // --- external controls -------------------------------------------------
  setIntensity(x) { this.targetIntensity = clamp01(x); }
  setMuted(m) { if (m === this.muted) return; this.muted = m; this.applyGain(); }
  setDucked(d) { if (d === this.ducked) return; this.ducked = d; this.applyGain(); }
  setTemporal(on) { if (on === this.temporal) return; this.temporal = on; this.applyGain(); }
  setEnabled(e) {
    this.enabled = e;
    try { localStorage.setItem(STORE_KEY, e ? '1' : '0'); } catch (err) { /* ignore */ }
    this.applyGain();
  }

  applyGain() {
    if (!this.out) return;
    const t = this.ctx.currentTime;
    const g = this.audible() ? this.baseVol * (this.ducked ? 0.2 : 1) : 0;
    this.out.gain.setTargetAtTime(g, t, 0.3);
    const sg = (this.audible() && this.temporal) ? 0.09 : 0.0;
    this.shimmerGain.gain.setTargetAtTime(sg, t, 0.6);
  }

  // --- scheduler ---------------------------------------------------------
  schedule() {
    const ctx = this.ctx;
    // Resync if the tab was backgrounded and the clock ran ahead.
    if (this.nextStepTime < ctx.currentTime) this.nextStepTime = ctx.currentTime + 0.05;
    while (this.nextStepTime < ctx.currentTime + 0.12) {
      this.intensity += (this.targetIntensity - this.intensity) * 0.05; // smooth ramp
      this.playStep(this.step, this.nextStepTime);
      const bpm = lerp(60, 126, this.intensity);
      this.nextStepTime += 60 / bpm / 4;      // one 16th note
      this.step = (this.step + 1) % STEPS;
    }
  }

  playStep(step, t) {
    this.curT = t;              // default start time for voices this step
    const chord = CHORDS[Math.floor(step / 32) % 4];
    const I = this.intensity;
    const sInBar = step % STEPS_PER_BAR;

    // Chord change every 2 bars: (re)voice the pad, retune the shimmer, open the
    // filter to taste. Long release lets successive chords overlap seamlessly.
    if (step % 32 === 0 && this.audible()) {
      const bpm = lerp(60, 126, I), chordDur = (60 / bpm) * 8;   // 2 bars
      this.padFilter.frequency.setTargetAtTime(lerp(650, 2600, I), t, 0.4);
      for (const n of chord.pad) {
        this.tone(mtof(n), { type: 'triangle', dur: chordDur, gain: 0.05,
          attack: 0.8, release: 1.6, dest: this.padFilter });
      }
      const sn = mtof(chord.pad[chord.pad.length - 1] + 12);
      for (const o of this.shimmerOsc) o.frequency.setTargetAtTime(sn, t, 0.3);
    }

    if (!this.audible()) return;   // keep the clock running, but emit no voices

    // Bass: a held root when calm; quarter notes, then off-beats, as it drives.
    const beat = sInBar % 4 === 0, eighth = sInBar % 2 === 0;
    if ((I < 0.4 && sInBar === 0) || (I >= 0.4 && beat) || (I > 0.75 && eighth)) {
      this.tone(mtof(chord.bass), { type: 'triangle', dur: I > 0.6 ? 0.18 : 0.5,
        gain: lerp(0.08, 0.16, I), attack: 0.01, release: 0.16, dest: this.out });
    }

    // Arpeggio / music-box: sparse eighths when calm, filling to 16ths when hot.
    const prob = eighth ? lerp(0.3, 0.85, I) : lerp(0.0, 0.4, I);
    if (Math.random() < prob) {
      const pool = chord.arp;
      const move = [1, 1, -1, 2, 0][Math.floor(Math.random() * 5)];
      this.arpIdx = (this.arpIdx + move + pool.length) % pool.length;
      let note = pool[this.arpIdx];
      if (I > 0.6 && Math.random() < 0.15) note += 12;   // occasional bright leap
      this.tone(mtof(note), { type: 'triangle', dur: 0.22, gain: lerp(0.05, 0.12, I),
        attack: 0.004, release: 0.22, dest: this.arpSend });
    }

    // Groove fades in only in the driving half.
    if (I > 0.4) {
      const kickSteps = I > 0.7 ? [0, 4, 8, 12] : [0, 8];
      if (kickSteps.includes(sInBar)) {
        this.tone(130, { type: 'sine', dur: 0.14, to: 48, gain: lerp(0.25, 0.5, I),
          attack: 0.004, release: 0.05, dest: this.out });
      }
    }
    if (I > 0.55 && sInBar % 2 === 1) this.hat(t, lerp(0.03, 0.08, I));
  }

  // --- voices ------------------------------------------------------------
  tone(freq, o) {
    const ctx = this.ctx, t = o.t ?? this.curT;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + o.dur);
    const a = o.attack ?? 0.01, r = o.release ?? 0.15;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur + r);
    osc.connect(g).connect(o.dest || this.out);
    osc.start(t); osc.stop(t + o.dur + r + 0.02);
  }

  hat(t, gain) {
    const ctx = this.ctx, dur = 0.03;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter(); filt.type = 'highpass'; filt.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(this.out);
    src.start(t); src.stop(t + dur + 0.02);
  }
}
