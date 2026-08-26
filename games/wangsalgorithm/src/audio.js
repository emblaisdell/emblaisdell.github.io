/*
 * audio.js — the game's sounds, synthesised on the fly.
 *
 * No asset files and no dependencies: every sound is a couple of oscillators
 * and a gain envelope.  Ported from ../yastupid, which had already worked out
 * the mobile behaviour worth keeping.
 *
 * A browser AudioContext changes state underneath you, and two of those states
 * are why game audio "randomly stops" on a phone:
 *
 *   suspended    backgrounded, or built before any user gesture
 *   interrupted  iOS only — a phone call, an app switch, a screen lock, or the
 *                window being reopened.  Code that only revives 'suspended'
 *                leaves these dead forever, which is the usual cause of sound
 *                never coming back after you rejoin.
 *   closed       iOS tore the context down; the reference is dead and a new
 *                context has to be built.
 *
 * So everything funnels through ctx(), which builds, revives and rebuilds as
 * needed, and the page wakes it again the moment it returns to the foreground.
 */
(function (root) {
  'use strict';

  var KEY = 'wang_muted';
  var actx = null;
  var muted = false;
  try { muted = root.localStorage && root.localStorage.getItem(KEY) === '1'; } catch (e) {}

  function ctx() {
    // Tells iOS/WebKit to keep playing with the ringer/silent switch engaged.
    try { if (root.navigator && root.navigator.audioSession) root.navigator.audioSession.type = 'playback'; } catch (e) {}
    if (!actx || actx.state === 'closed') {
      try { actx = new (root.AudioContext || root.webkitAudioContext)(); } catch (e) { actx = null; }
    }
    // Revive on anything that is not running — not just 'suspended'.
    if (actx && actx.state !== 'running') {
      try { actx.resume()['catch'](function () {}); } catch (e) {}
    }
    return actx;
  }

  // A short bubble blip: a sine swept between two pitches with a pluck envelope.
  // Gains ramp to a hair above zero, never to zero — an exponential ramp cannot
  // reach 0 and will throw if you ask it to.
  function blip(f0, f1, dur, vol) {
    if (muted) return;
    var ac = ctx(); if (!ac) return;
    var t = ac.currentTime;
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // A clean melody note for the win flourish.
  function tone(freq, delay, dur, vol) {
    if (muted) return;
    var ac = ctx(); if (!ac) return;
    var t = ac.currentTime + delay;
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // Splitting a molecule: a light upward pop.
  function pop() { blip(380, 920, 0.09, 0.22); }

  // Annihilation: the reverse of a pop.  Pitch slurps upward and a lowpass
  // opens as the sound swells in, then it snaps off — two halves pulled
  // together rather than blown apart.
  function merge() {
    if (muted) return;
    var ac = ctx(); if (!ac) return;
    var t = ac.currentTime, dur = 0.20;
    var o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(700, t + dur);
    lp.type = 'lowpass'; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(2200, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26, t + dur * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.015);
    o.connect(g).connect(lp).connect(ac.destination);
    o.start(t); o.stop(t + dur + 0.04);
  }

  // Board cleared: a rising major arpeggio capped by a held top note.
  function win() {
    tone(523.25, 0.00, 0.16, 0.20);   // C5
    tone(659.25, 0.11, 0.16, 0.20);   // E5
    tone(783.99, 0.22, 0.16, 0.20);   // G5
    tone(1046.50, 0.34, 0.55, 0.24);  // C6, held — the flourish
    tone(783.99, 0.34, 0.55, 0.10);   // G5 underneath for a fuller chord
  }

  function isMuted() { return muted; }
  function setMuted(on) {
    muted = !!on;
    try { if (root.localStorage) root.localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) {}
  }

  // Wake the context the instant the page comes back, so the next sound is not
  // dropped waiting for a tap.  `pageshow` covers the back/forward cache, where
  // `visibilitychange` may never fire.
  if (root.document) {
    root.document.addEventListener('visibilitychange', function () {
      if (!root.document.hidden) ctx();
    });
  }
  if (root.addEventListener) root.addEventListener('pageshow', function () { ctx(); });

  root.Wang = root.Wang || {};
  root.Wang.audio = {
    unlock: ctx,          // call from a real gesture; browsers require one
    pop: pop, merge: merge, win: win,
    isMuted: isMuted, setMuted: setMuted
  };
})(window);
