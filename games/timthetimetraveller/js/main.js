// Game entry point: fixed-timestep loop, input, and wiring world<->renderer.

import { DT, CELL, WIN_ENERGY } from './constants.js';
import { emptyLevel } from './level.js';
import { World } from './world.js';
import { Renderer } from './render.js';
import { Sound } from './audio.js';
import { Music } from './music.js';

// Playtesting a level from the editor is a different thing from playing the
// game, and index.html?playtest=1 is how the two are told apart. A playtest may
// zoom out to survey the room, reloads keep the level the editor handed over,
// and -- most importantly -- it saves to its own checkpoint slot, so trying out
// a half-built room can't clobber the run someone has going on the real map.
//
// The flag alone isn't enough to grant any of that, though: a playtest is only
// real if a level actually came from the editor. Published builds ship without
// the editor, so nobody there can park a level to test -- and appending
// ?playtest=1 to the live game gets an ordinary run, not a free look around the
// map the zoom is deliberately withheld from.
const WANTS_PLAYTEST = new URLSearchParams(location.search).has('playtest');

// The map the game ships with.
const DEFAULT_LEVEL = 'levels/test-lab-02.json';

const canvas = document.getElementById('game');
const loaded = await loadLevel();
const IS_PLAYTEST = loaded.fromEditor;
const world = new World(loaded.level);
const renderer = new Renderer(canvas, world);
const sound = new Sound();
const music = new Music(sound);

// --- checkpoints ---------------------------------------------------------
// With checkpointing on (the default), every green orb banks a full snapshot of
// the run into localStorage. Dying rewinds to that instant instead of the
// spawn, and reopening the page picks the run back up where it left off. The
// snapshot is tagged with a fingerprint of the level it came from, so editing
// the map (or playtesting a different one) never resurrects a stale run.
const CKPT_KEY = IS_PLAYTEST ? 'ttt_checkpoint_playtest' : 'ttt_checkpoint';
const CKPT_OPT_KEY = 'ttt_checkpoints';
const CKPT_VERSION = 2;   // bumped when the snapshot grew the full circuit state

// Cheap content fingerprint (djb2-xor) -- enough to tell two levels apart.
function levelFingerprint(lv) {
  const s = JSON.stringify(lv);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return s.length.toString(36) + '.' + h.toString(36);
}
const levelId = levelFingerprint(loaded.level);

let checkpointsOn = true;
try { checkpointsOn = localStorage.getItem(CKPT_OPT_KEY) !== 'off'; } catch (e) { /* ignore */ }

function loadCheckpoint() {
  try {
    const raw = localStorage.getItem(CKPT_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (rec?.v !== CKPT_VERSION || rec.level !== levelId) return null;
    return rec.state;
  } catch (e) { return null; }
}

let checkpoint = loadCheckpoint();

function saveCheckpoint() {
  if (!checkpointsOn || world.status !== 'play') return;
  checkpoint = world.snapshot();
  try {
    localStorage.setItem(CKPT_KEY, JSON.stringify({
      v: CKPT_VERSION, level: levelId, state: checkpoint,
    }));
  } catch (e) { /* quota / private mode: keep the in-memory checkpoint */ }
  reflectCheckpointState();
}

// A green orb ARMS a checkpoint rather than banking one on the spot. Snapshotting
// at the moment of pickup can park the run mid-jump -- and if that jump was over
// a pit, every resume drops you straight back into the fall that killed you. So
// the save waits for the first safe spot: the frame the Tim you're controlling is
// back on solid ground. If he never lands, the orb simply isn't banked and the
// previous checkpoint stands, which is the honest outcome -- he never made it
// anywhere safe.
let checkpointArmed = false;

function bankArmedCheckpoint() {
  if (!checkpointArmed || !checkpointsOn || world.status !== 'play') return;
  if (!world.focused?.onGround) return;
  checkpointArmed = false;
  saveCheckpoint();
  renderer.ckptFlash = 2.2;      // brief "CHECKPOINT" note in the HUD
}

function clearCheckpoint() {
  checkpoint = null;
  try { localStorage.removeItem(CKPT_KEY); } catch (e) { /* ignore */ }
  reflectCheckpointState();
}

// The death banner promises a resume only when there's actually one to give.
function reflectCheckpointState() {
  renderer.resumesFromCheckpoint = !!(checkpointsOn && checkpoint);
}

// Pick the run back up if there's a checkpoint for this level.
if (checkpointsOn && checkpoint) {
  try { world.restore(checkpoint); }
  catch (e) { console.warn('Discarding unreadable checkpoint:', e); clearCheckpoint(); }
}
reflectCheckpointState();

async function loadLevel() {
  // Only a playtest picks up the level the editor parked in localStorage, and it
  // leaves the key in place so refreshing keeps testing the same room. Playing
  // the game proper always gets the bundled map, so a level left behind by an
  // old editing session can never leak into a real run.
  if (WANTS_PLAYTEST) {
    try {
      const raw = localStorage.getItem('ttt_play_level');
      if (raw) return { level: JSON.parse(raw), fromEditor: true };
    } catch (e) { console.warn('Could not read the level to playtest:', e); }
  }
  // Otherwise fetch the bundled default map before the world is created, so the
  // correct room is the only thing that ever renders (no placeholder flash).
  // Falls back to an empty level only if the fetch fails.
  try {
    const r = await fetch(DEFAULT_LEVEL);
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

// Start the round over: from the last banked green orb when checkpointing is
// on, otherwise from the level's spawn. Either way the camera cuts straight to
// wherever Tim reappears rather than panning across the map.
function restart() {
  cancelPendingResume();
  checkpointArmed = false;
  if (checkpointsOn && checkpoint) {
    try { world.restore(checkpoint); }
    catch (e) { console.warn('Discarding unreadable checkpoint:', e); clearCheckpoint(); world.reset(); }
  } else {
    world.reset();
  }
  renderer.snapCamera();
}

// Wipe the saved run and start from the very beginning.
function newGame() {
  cancelPendingResume();
  checkpointArmed = false;
  clearCheckpoint();
  world.reset();
  renderer.snapCamera();
}

// --- the end-of-round screen ---------------------------------------------
// One tap resumes from the checkpoint; two throw the run away and start the
// game over. That means the first tap can't commit immediately -- it has to
// wait out the double-tap window to see whether a second one is coming. The
// wait only exists when the two would actually differ: with no checkpoint to
// resume from, a tap restarts instantly, exactly as it always did.
//
// While waiting, the banner says so and spells out what a second tap does, so
// nobody drums impatiently on a dead screen and wipes a long run by accident.
const DOUBLE_TAP_MS = 280;
let pendingResume = 0;

function cancelPendingResume() {
  if (pendingResume) { clearTimeout(pendingResume); pendingResume = 0; }
  renderer.resumePending = false;
}

function endScreenTap() {
  if (!(checkpointsOn && checkpoint)) { restart(); return; }  // nothing to choose between
  if (pendingResume) { cancelPendingResume(); newGame(); return; }
  renderer.resumePending = true;
  pendingResume = setTimeout(() => {
    pendingResume = 0;
    renderer.resumePending = false;
    restart();
  }, DOUBLE_TAP_MS);
}

// --- playtest zoom --------------------------------------------------------
// Surveying a room you're building needs a wider view than the game itself
// should ever grant, so this is unlocked only for editor playtests. The camera
// is snapped after each change: the framing shifts a long way when the zoom
// moves, and gliding there looks like a bug rather than a choice.
const ZOOM_MIN = 0.25, ZOOM_MAX = 2, ZOOM_STEP = 1.15;
const ZOOM_KEY = 'ttt_playtest_zoom';

function setZoom(z, remember = true) {
  renderer.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  renderer.snapCamera();
  const pct = Math.round(renderer.zoom * 100);
  const label = document.getElementById('zoom-level');
  if (label) label.textContent = pct + '%';
  const out = document.getElementById('zoom-out'), inn = document.getElementById('zoom-in');
  if (out) out.disabled = renderer.zoom <= ZOOM_MIN + 1e-6;
  if (inn) inn.disabled = renderer.zoom >= ZOOM_MAX - 1e-6;
  if (remember) { try { localStorage.setItem(ZOOM_KEY, String(renderer.zoom)); } catch (e) { /* ignore */ } }
}

if (IS_PLAYTEST) {
  document.getElementById('playtest-bar').hidden = false;
  document.getElementById('zoom-out').addEventListener('click', () => setZoom(renderer.zoom / ZOOM_STEP));
  document.getElementById('zoom-in').addEventListener('click', () => setZoom(renderer.zoom * ZOOM_STEP));
  document.getElementById('zoom-reset').addEventListener('click', () => setZoom(1));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(renderer.zoom * (e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP));
  }, { passive: false });
  // Restore the zoom the last playtest was left at.
  let saved = 1;
  try { saved = parseFloat(localStorage.getItem(ZOOM_KEY)) || 1; } catch (e) { /* ignore */ }
  setZoom(saved, false);
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
  const inMenu = e.target.closest && e.target.closest('#help-menu, #mute-btn, #playtest-bar');
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
  } else if (IS_PLAYTEST && (e.key === '-' || e.key === '_')) {
    setZoom(renderer.zoom / ZOOM_STEP);
  } else if (IS_PLAYTEST && (e.key === '=' || e.key === '+')) {
    setZoom(renderer.zoom * ZOOM_STEP);
  } else if (IS_PLAYTEST && e.key === '0') {
    setZoom(1);
  }
});

window.addEventListener('keyup', (e) => {
  if (KEYL.has(e.key)) input.left = false;
  else if (KEYR.has(e.key)) input.right = false;
  else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') input.jumpHeld = false;
});

// Tap/click the canvas: replay when the round is over, otherwise focus a Tim.
canvas.addEventListener('pointerdown', (e) => {
  if (world.status !== 'play') { endScreenTap(); return; }
  const rect = canvas.getBoundingClientRect();
  const scale = CELL * renderer.zoom;
  const wx = (e.clientX - rect.left) / scale + renderer.cam.x;
  const wy = (e.clientY - rect.top) / scale + renderer.cam.y;
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

// Checkpointing can be turned off for a purist "one life per run" game. The
// toggle only gates saving/resuming -- it never throws an existing save away,
// so flipping it back on picks the same run up again. "New game" is the one
// button that discards progress, and it asks first.
const ckptBtn = document.getElementById('ckpt-btn');
const ckptNote = document.getElementById('ckpt-note');
const reflectCkpt = () => {
  ckptBtn.textContent = checkpointsOn ? 'On' : 'Off';
  ckptBtn.classList.toggle('off', !checkpointsOn);
  ckptNote.textContent = checkpointsOn
    ? 'Each green orb saves your run; dying rewinds you there.'
    : 'Off: every death sends you back to the start of the level.';
};
reflectCkpt();
ckptBtn.addEventListener('click', () => {
  checkpointsOn = !checkpointsOn;
  if (!checkpointsOn) checkpointArmed = false;
  try { localStorage.setItem(CKPT_OPT_KEY, checkpointsOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
  reflectCheckpointState();
  reflectCkpt();
});

// Two-tap confirm: a stray tap here would otherwise wipe a long run.
const newGameBtn = document.getElementById('newgame-btn');
let confirmTimer = 0;
const resetNewGameBtn = () => {
  clearTimeout(confirmTimer); confirmTimer = 0;
  newGameBtn.textContent = 'New game';
  newGameBtn.classList.remove('armed');
};
newGameBtn.addEventListener('click', () => {
  if (!confirmTimer) {
    newGameBtn.textContent = 'Erase progress?';
    newGameBtn.classList.add('armed');
    confirmTimer = setTimeout(resetNewGameBtn, 4000);
    return;
  }
  resetNewGameBtn();
  newGame();
  helpPanel.hidden = true;
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
    else if (act === 'portal') { if (world.status === 'play') world.startTimeTravel(); else endScreenTap(); }
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
    for (const ev of world.events) {
      sound.play(ev);
      // Each green orb arms a checkpoint, banked below once Tim is somewhere
      // safe; winning retires the save so the next tap starts a clean game
      // rather than replaying the last orb.
      const name = typeof ev === 'string' ? ev : ev.name;
      if (name === 'collect') checkpointArmed = checkpointsOn;
      else if (name === 'win') { checkpointArmed = false; clearCheckpoint(); }
    }
    world.events.length = 0;
  }
  bankArmedCheckpoint();
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
