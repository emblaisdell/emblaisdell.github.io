// Game entry point: fixed-timestep loop, input, and wiring world<->renderer.

import { DT, CELL, WIN_ENERGY } from './constants.js';
import { emptyLevel } from './level.js';
import { World } from './world.js';
import { Renderer } from './render.js';
import { Sound } from './audio.js';
import { Music } from './music.js';

const canvas = document.getElementById('game');
const loaded = await loadLevel();
const world = new World(loaded.level);
const renderer = new Renderer(canvas, world);
const sound = new Sound();
const music = new Music(sound);

async function loadLevel() {
  // A level handed over from the editor (via localStorage) takes precedence and
  // is available synchronously.
  try {
    const raw = localStorage.getItem('ttt_play_level');
    if (raw) { localStorage.removeItem('ttt_play_level'); return { level: JSON.parse(raw), fromEditor: true }; }
  } catch (e) { /* ignore */ }
  // Otherwise fetch the bundled default map before the world is created, so the
  // correct room is the only thing that ever renders (no placeholder flash).
  // Falls back to an empty level only if the fetch fails.
  try {
    const r = await fetch('levels/test-lab-01.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { level: await r.json(), fromEditor: false };
  } catch (e) {
    console.warn('Could not load default map, starting on an empty level:', e);
    return { level: emptyLevel(), fromEditor: false };
  }
}

function resize() {
  renderer.resize(window.innerWidth, window.innerHeight);
  // Start the canvas HUD just right of the help button's actual position, which
  // is pushed inward by the safe-area inset on notched phones. Keeps the title
  // and energy meter from being covered by the "?" button.
  const hb = document.getElementById('help-btn')?.getBoundingClientRect();
  renderer.hudX = hb ? Math.max(58, hb.right + 12) : 58;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
// iOS Safari shows/hides its toolbar without always firing window 'resize';
// the visual viewport reports those changes so the canvas keeps matching.
window.visualViewport?.addEventListener('resize', resize);
resize();
renderer.snapCamera();   // open centred on Tim rather than panning in from origin

// Restart the level and re-centre the camera on the fresh spawn immediately.
function restart() {
  world.reset();
  renderer.snapCamera();
}

// --- prevent iOS zoom -----------------------------------------------------
// iOS Safari ignores the viewport's user-scalable=no, so rapid taps on the
// controls (and pinch) can zoom the page mid-game. Block the zoom gestures
// directly: pinch (gesturestart) and double-tap (two touchends in quick
// succession). Menu buttons/links are exempt so their taps still register.
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  const inMenu = e.target.closest && e.target.closest('#help-menu, #mute-btn');
  if (now - lastTouchEnd <= 320 && !inMenu) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

// --- input ---------------------------------------------------------------
const input = { left: false, right: false, jumpPressed: false, jumpHeld: false };

const KEYL = new Set(['ArrowLeft', 'a', 'A']);
const KEYR = new Set(['ArrowRight', 'd', 'D']);
const KEYJUMP = new Set(['ArrowUp', 'w', 'W', ' ']); // (space also = time travel below)

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (KEYL.has(e.key)) input.left = true;
  else if (KEYR.has(e.key)) input.right = true;
  else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
    input.jumpPressed = true; input.jumpHeld = true;
  } else if (e.key === ' ') {
    e.preventDefault();
    world.startTimeTravel();   // Space = initiate time travel
  } else if (e.key === 'Tab') {
    e.preventDefault();
    world.cycleFocus();        // Tab = cycle focus through Tims
  } else if (e.key === 'r' || e.key === 'R') {
    restart();
  }
});

window.addEventListener('keyup', (e) => {
  if (KEYL.has(e.key)) input.left = false;
  else if (KEYR.has(e.key)) input.right = false;
  else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') input.jumpHeld = false;
});

// Tap/click the canvas: replay when the round is over, otherwise focus a Tim.
canvas.addEventListener('pointerdown', (e) => {
  if (world.status !== 'play') { restart(); return; }
  const rect = canvas.getBoundingClientRect();
  const wx = (e.clientX - rect.left) / CELL + renderer.cam.x;
  const wy = (e.clientY - rect.top) / CELL + renderer.cam.y;
  world.focusAtPixel(wx, wy);
});

// --- audio: unlock on first gesture, wire the mute + music toggles --------
const unlockAudio = () => { sound.resume(); music.start(); };
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

// Wake audio the instant the page returns to the foreground (app-switch back,
// unlock, reopened tab). iOS suspends/interrupts/closes the context while away,
// so proactively revive it instead of waiting for the next sound. sound.resume()
// rebuilds a closed context, which in turn rebuilds the music graph.
document.addEventListener('visibilitychange', () => { if (!document.hidden) sound.resume(); });
window.addEventListener('pageshow', () => sound.resume());

// The mute button is the master switch -- it silences SFX and music together.
music.setMuted(sound.muted);
const muteBtn = document.getElementById('mute-btn');
const reflectMute = () => {
  muteBtn.classList.toggle('muted', sound.muted);
  muteBtn.setAttribute('aria-label', sound.muted ? 'Unmute sound' : 'Mute sound');
  muteBtn.title = sound.muted ? 'Unmute sound' : 'Mute sound';
};
reflectMute();
muteBtn.addEventListener('click', () => {
  sound.toggle();
  music.setMuted(sound.muted);
  sound.resume();          // a click is a gesture -> also unlocks audio
  music.start();
  reflectMute();
});

// Music can be turned off on its own (SFX kept), from the help panel.
const musicBtn = document.getElementById('music-btn');
const reflectMusic = () => {
  musicBtn.textContent = music.enabled ? 'On' : 'Off';
  musicBtn.classList.toggle('off', !music.enabled);
};
reflectMusic();
musicBtn.addEventListener('click', () => {
  music.setEnabled(!music.enabled);
  music.start();
  sound.resume();
  reflectMusic();
});

// --- help menu (desktop + mobile) ----------------------------------------
const helpBtn = document.getElementById('help-btn');
const helpPanel = document.getElementById('help-panel');
helpBtn.addEventListener('click', () => { helpPanel.hidden = !helpPanel.hidden; });
// Tapping outside the menu closes it.
document.addEventListener('pointerdown', (e) => {
  if (!helpPanel.hidden && !document.getElementById('help-menu').contains(e.target)) {
    helpPanel.hidden = true;
  }
});

// --- on-screen touch controls --------------------------------------------
// Show them on touch-primary devices (phones/tablets), not desktop-with-mouse.
const isTouch = window.matchMedia('(pointer: coarse)').matches
  || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
renderer.isTouch = isTouch;   // restart banner says "Tap" vs "Press R" accordingly

const padToggle = document.querySelector('.tb-toggle');

if (isTouch) {
  document.body.classList.add('is-touch');
  const controls = document.getElementById('touch-controls');
  controls.hidden = false;

  // Restore saved handedness (which side the movement d-pad sits on).
  const handBtn = document.getElementById('hand-btn');
  const applyHand = (side) => {
    controls.classList.toggle('hand-left', side === 'left');
    controls.classList.toggle('hand-right', side !== 'left');
    handBtn.textContent = side === 'left' ? 'Left-handed' : 'Right-handed';
  };
  let hand = localStorage.getItem('ttt_handed') === 'left' ? 'left' : 'right';
  applyHand(hand);
  handBtn.addEventListener('click', () => {
    hand = hand === 'left' ? 'right' : 'left';
    localStorage.setItem('ttt_handed', hand);
    applyHand(hand);
  });

  // Held actions set input flags; discrete actions fire once on press.
  const press = (btn, on) => btn.classList.toggle('pressed', on);
  const start = (act, btn) => {
    if (act === 'left') input.left = true;
    else if (act === 'right') input.right = true;
    else if (act === 'jump') { input.jumpPressed = true; input.jumpHeld = true; }
    else if (act === 'portal') { if (world.status === 'play') world.startTimeTravel(); else restart(); }
    else if (act === 'toggle') world.cycleFocus();
    press(btn, true);
  };
  const end = (act, btn) => {
    if (act === 'left') input.left = false;
    else if (act === 'right') input.right = false;
    else if (act === 'jump') input.jumpHeld = false;
    press(btn, false);
  };

  for (const btn of controls.querySelectorAll('.tbtn')) {
    const act = btn.dataset.act;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      start(act, btn);
    });
    const release = (e) => { e.preventDefault(); end(act, btn); };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    // Contextmenu (long-press) would otherwise pop up on mobile.
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

// --- fixed timestep loop -------------------------------------------------
let acc = 0;
let last = performance.now();

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25; // avoid spiral after tab-out
  acc += dt;
  while (acc >= DT) {
    world.step(DT, input);
    acc -= DT;
  }
  // Fraction into the next sim step, for render interpolation. Pinned to 1 while
  // the sim is paused (game over) so a frozen Tim isn't interpolated backwards.
  renderer.alpha = world.status === 'play' ? acc / DT : 1;
  // Fire sound effects for anything the sim reported this frame.
  if (world.events.length) {
    for (const ev of world.events) sound.play(ev);
    world.events.length = 0;
  }
  // Adapt the music to the run: intensity climbs with banked time energy, the
  // temporal shimmer swells during time travel, and it ducks on death.
  music.setIntensity(world.energy / WIN_ENERGY);
  music.setTemporal(world.timeTravels.length > 0 || world.tims.length > 1);
  music.setDucked(world.status === 'dead');
  renderer.draw(dt);
  // The switch-Tim button only matters once a second Tim exists.
  padToggle.classList.toggle('show', world.tims.length > 1);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
