"use strict";

/* =========================================================================
 * Shape Turret — audio.
 * Everything is synthesized live with the Web Audio API: no asset files, so
 * the game stays fully static. An evolving ambient pad provides the calm,
 * ethereal music; short enveloped tones provide reactive sound effects.
 *
 * Browsers block audio until a user gesture, so the engine "unlocks" itself
 * on the first pointer / key / touch and starts the music then. Press M to
 * mute. Exposes a global `Sound`.
 * ========================================================================= */

const Sound = (function () {
  let ctx = null;
  let master, musicGain, sfxGain;
  let started = false;
  let muted = false;

  // Open, consonant pads (octaves + fifths) — slow and airy.
  const CHORDS = [
    [196.00, 293.66, 392.00, 587.33], // G
    [220.00, 329.63, 440.00, 659.25], // A
    [164.81, 246.94, 329.63, 493.88], // E
    [174.61, 261.63, 349.23, 523.25], // F
  ];
  let voices = [];
  let chordIndex = 0;

  // Reactive music state, driven by the game's upgrade shapes (default = start).
  let greenSides = 3;   // more green => faster chord changes
  let cyanSides = 3;    // more cyan  => deeper (lower) pad

  // Lower the pad by up to ~an octave as cyan grows.
  function transposeFactor() {
    const up = Math.max(0, cyanSides - 3);
    const semitones = Math.min(up, 12);
    return Math.pow(2, -semitones / 12);
  }

  // Shorten the time between chord changes as green grows (floored so it never
  // gets frantic).
  function chordIntervalMs() {
    const up = Math.max(0, greenSides - 3);
    return Math.max(3.0, 15 / (1 + up * 0.28)) * 1000;
  }

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    musicGain = ctx.createGain();
    musicGain.gain.value = 0.0;
    musicGain.connect(master);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.9;
    sfxGain.connect(master);
  }

  function now() { return ctx.currentTime; }

  // One short, enveloped oscillator note.
  function blip(freq, opts = {}) {
    if (!ctx || muted) return;
    const {
      type = "sine", dur = 0.15, gain = 0.2,
      attack = 0.006, glide = null, when = 0, dest = null,
    } = opts;
    const t = now() + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(1, glide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || sfxGain);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  /* ---- Ambient music ---- */

  // Each pad voice: which chord note it plays (`note`), an octave multiplier
  // (`mult`, 0.5 = a sub-octave below for depth), its full level, and the rate
  // of its own slow tremolo so the voices never pulse in lockstep.
  const VOICE_SPECS = [
    { note: 0, mult: 0.5, level: 0.13, rate: 0.050 },  // sub-octave warmth
    { note: 0, mult: 1.0, level: 0.13, rate: 0.071 },
    { note: 1, mult: 1.0, level: 0.12, rate: 0.084 },
    { note: 2, mult: 1.0, level: 0.11, rate: 0.061 },
    { note: 3, mult: 1.0, level: 0.10, rate: 0.093 },
  ];

  let padFilter = null;
  let melodyBus = null;

  function buildVoice(spec, dest) {
    // Sine + detuned triangle gives a warmer timbre than a bare sine.
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = "sine";
    o2.type = "triangle";
    o2.detune.value = 6 + spec.note;

    const env = ctx.createGain();   // chord fade in/out lives here
    env.gain.value = 0.0;
    const trem = ctx.createGain();  // independent slow amplitude wobble
    trem.gain.value = 1.0;

    o1.connect(env);
    o2.connect(env);
    env.connect(trem);
    trem.connect(dest);

    const tl = ctx.createOscillator();
    const tg = ctx.createGain();
    tl.frequency.value = spec.rate;
    tg.gain.value = 0.12;           // ±0.12 around 1.0
    tl.connect(tg);
    tg.connect(trem.gain);

    o1.start();
    o2.start();
    tl.start();
    return { o1, o2, g: env, note: spec.note, mult: spec.mult, level: spec.level };
  }

  function startMusic() {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    lp.Q.value = 0.4;
    lp.connect(musicGain);
    padFilter = lp;

    // Slow filter sweep gives the pad gentle movement.
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.05;
    lfoGain.gain.value = 350;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lfo.start();

    // The melody sits above the dark pad filter so it stays clear.
    melodyBus = ctx.createGain();
    melodyBus.gain.value = 1.0;
    melodyBus.connect(musicGain);

    for (const spec of VOICE_SPECS) voices.push(buildVoice(spec, lp));

    musicGain.gain.setTargetAtTime(0.16, now(), 2.5);
    applyChord(0);
    scheduleNextChord();
    scheduleMelody();
    window.setInterval(sparkle, 6000);
  }

  // Self-rescheduling so the interval can shrink as green grows.
  function scheduleNextChord() {
    window.setTimeout(() => {
      nextChord();
      scheduleNextChord();
    }, chordIntervalMs());
  }

  function voiceFreq(v, chord) {
    return chord[v.note] * v.mult * transposeFactor();
  }

  function applyChord(idx) {
    chordIndex = idx;
    const chord = CHORDS[idx];
    const base = now();
    // Stagger each voice so the pad evolves voice-by-voice instead of pumping
    // all at once. Each voice eases down a little, retunes while quiet (so the
    // new note swells in rather than sliding), then eases back to its level.
    voices.forEach((v, i) => {
      const f = voiceFreq(v, chord);
      const t = base + i * 0.6;
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setTargetAtTime(v.level * 0.18, t, 0.55);
      v.o1.frequency.setTargetAtTime(f, t + 0.9, 0.5);
      v.o2.frequency.setTargetAtTime(f, t + 0.9, 0.5);
      v.g.gain.setTargetAtTime(v.level, t + 0.9, 1.15);
    });
  }

  /* ---- Subtle melody ---- */

  // Major-pentatonic ratios above the chord root (consonant in any chord).
  const MEL_RATIOS = [1, 1.125, 1.25, 1.5, 1.6667, 2, 2.25, 2.5];
  let melIndex = 2;

  function melodyNote(freq, when, gain, dur) {
    if (!ctx || muted) return;
    const t = now() + when;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    o1.type = "sine";
    o2.type = "triangle";
    o2.detune.value = 4;
    o1.frequency.value = freq;
    o2.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.09);   // soft eased attack
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);  // long eased release
    o1.connect(g);
    o2.connect(g);
    g.connect(melodyBus);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  function playMelody() {
    if (ctx && !muted && Math.random() > 0.28) {       // sometimes rest
      const root = CHORDS[chordIndex][0] * 2 * transposeFactor();
      // Mostly stepwise motion for a singable contour.
      melIndex = clamp(melIndex + (Math.floor(Math.random() * 3) - 1), 0, MEL_RATIOS.length - 1);
      const gain = 0.13 + Math.random() * 0.05;
      melodyNote(root * MEL_RATIOS[melIndex], 0, gain, 1.5);
      if (Math.random() < 0.5) {                        // gentle two-note phrase
        const j = clamp(melIndex + (Math.random() < 0.5 ? 1 : 2), 0, MEL_RATIOS.length - 1);
        melodyNote(root * MEL_RATIOS[j], 0.5, gain * 0.85, 1.3);
      }
    }
    scheduleMelody();
  }

  function scheduleMelody() {
    window.setTimeout(playMelody, 3000 + Math.random() * 3500);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function nextChord() {
    if (!ctx || muted) return;
    applyChord((chordIndex + 1) % CHORDS.length);
  }

  // Occasional faint high note for sparkle.
  function sparkle() {
    if (!ctx || muted || Math.random() < 0.45) return;
    const notes = [587.33, 659.25, 783.99, 880.0, 987.77];
    const f = notes[Math.floor(Math.random() * notes.length)];
    blip(f, { type: "sine", dur: 1.4, gain: 0.05, attack: 0.4, dest: musicGain });
  }

  /* ---- Sound effects ---- */

  function shoot(sides) {
    const f = 460 + Math.min(sides, 22) * 11;
    blip(f, { type: "triangle", dur: 0.06, gain: 0.035, glide: f * 0.6 });
  }

  function kill(sides) {
    const f = Math.max(170, 720 - sides * 13);   // bigger enemies ring lower
    blip(f, { type: "sine", dur: 0.32, gain: 0.12 });
    blip(f * 1.5, { type: "sine", dur: 0.4, gain: 0.05, when: 0.02 });
  }

  function upgrade(isGreen) {
    const notes = isGreen ? [392.0, 493.88, 587.33] : [523.25, 659.25, 783.99];
    notes.forEach((f, i) =>
      blip(f, { type: "triangle", dur: 0.26, gain: 0.13, when: i * 0.07 }));
  }

  function fizzle() {
    blip(170, { type: "sine", dur: 0.18, gain: 0.07, glide: 110 });
  }

  function playerHit() {
    blip(150, { type: "triangle", dur: 0.5, gain: 0.2, glide: 70 });
    blip(90, { type: "sine", dur: 0.55, gain: 0.16, glide: 55, when: 0.02 });
  }

  function win() {
    if (musicGain) musicGain.gain.setTargetAtTime(0.22, now(), 1.0);
    [392.0, 493.88, 587.33, 783.99].forEach((f, i) =>
      blip(f, { type: "sine", dur: 1.8, gain: 0.1, attack: 0.05, when: i * 0.12 }));
  }

  function lose() {
    if (musicGain) musicGain.gain.setTargetAtTime(0.04, now(), 1.5);
    [294.0, 246.94, 196.0, 146.83].forEach((f, i) =>
      blip(f, { type: "triangle", dur: 0.7, gain: 0.16, when: i * 0.16 }));
  }

  /* ---- Control ---- */

  // iOS routes Web Audio through the "ambient" session by default, which the
  // physical mute switch silences. Playing a looping (silent) HTMLAudioElement
  // promotes the page to the "playback" session, so our synthesized audio keeps
  // sounding even with the ringer switched off. Must be kicked off from a user
  // gesture, which unlock() always is.
  let silenceEl = null;
  function buildSilentWavUrl() {
    const rate = 8000, samples = rate;            // ~1s of 16-bit mono silence
    const buf = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buf);
    const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    str(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); str(8, "WAVE");
    str(12, "fmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, "data"); view.setUint32(40, samples * 2, true);   // samples stay zero
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }
  function enableSilentModePlayback() {
    if (silenceEl) { silenceEl.play().catch(() => {}); return; }
    try {
      const el = new Audio();
      el.src = buildSilentWavUrl();
      el.loop = true;
      el.setAttribute("playsinline", "");
      el.playsInline = true;
      el.play().catch(() => {});
      silenceEl = el;
    } catch (e) { /* no HTMLAudio available — ignore */ }
  }

  function unlock() {
    ensure();
    enableSilentModePlayback();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    if (!started) { started = true; startMusic(); }
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0.0 : 0.9, now(), 0.05);
  }
  function toggleMute() { setMuted(!muted); return muted; }
  function isMuted() { return muted; }

  // The game reports the current upgrade-shape side counts. Cyan deepens the
  // pad; green speeds up chord changes (picked up at the next reschedule).
  function setProgress(green, cyan) {
    greenSides = green;
    cyanSides = cyan;
    if (!ctx || !voices.length) return;
    // Glide the live voices to the new tuning so the deepening is heard now.
    const t = now();
    const chord = CHORDS[chordIndex];
    voices.forEach((v) => {
      const f = voiceFreq(v, chord);
      v.o1.frequency.setTargetAtTime(f, t, 0.8);
      v.o2.frequency.setTargetAtTime(f, t, 0.8);
    });
  }

  // Self-unlock on the first user interaction.
  const kick = () => unlock();
  window.addEventListener("pointerdown", kick);
  window.addEventListener("keydown", kick);
  window.addEventListener("touchstart", kick, { passive: true });

  return { unlock, shoot, kill, upgrade, fizzle, playerHit, win, lose, setProgress, toggleMute, isMuted };
})();
