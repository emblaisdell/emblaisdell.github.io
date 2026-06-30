/* ===========================================================================
   Ya Stupid — a tiny physics game about (deliberately) bad arithmetic.
   9 + 10 = 21.  Vanilla JS, no dependencies.

   World space is centred on (0,0); a camera scales it to fit the screen and
   gently zooms out when the balls need more room than is available.
   =========================================================================== */
'use strict';

/* ----------------------------- rulesets ---------------------------------- */
const RULESETS = {
  classic:  { name: 'Classic',  falseSums: [{ a: 9, b: 10, c: 21 }] },
  advanced: { name: 'Advanced' },
};

/* ------------------------- arithmetic of the lie -------------------------- */
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }
function rulesetStats(fs) {
  let H = 0, g = 0;
  for (const f of fs) { H = Math.max(H, f.a + f.b, f.c); g = gcd(g, Math.abs((f.a + f.b) - f.c)); }
  return { H, M: H + 1, g: g || 1 };
}
function splitValue(v, fs) {
  for (const f of fs) if (f.c === v) return [f.a, f.b];
  if (v <= 1) return null;
  return [Math.floor(v / 2), Math.ceil(v / 2)];
}
function mergeValue(x, y, fs) {
  for (const f of fs) if ((f.a === x && f.b === y) || (f.a === y && f.b === x)) return f.c;
  return x + y;
}
function isFalseRHS(v, fs) { return fs.some(f => f.c === v); }

function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
function generateLevel(fs) {
  const st = rulesetStats(fs), lo = st.M, hi = 99;
  const maxSteps = Math.floor((hi - lo) / st.g);
  const s = randInt(lo, hi - ((hi - lo) % st.g));
  let steps = randInt(1, Math.max(1, Math.min(maxSteps, 16)));
  let dir = Math.random() < 0.5 ? -1 : 1;
  let t = s + dir * steps * st.g;
  if (t < lo || t > hi) t = s - dir * steps * st.g;
  if (t < lo || t > hi || t === s) t = (s + st.g <= hi) ? s + st.g : s - st.g;
  return { s, t };
}

/* ------------------------------ visuals ----------------------------------- */
function valueHue(v) { return (v * 47) % 360; }   // same number -> same colour
// balls are all about the same size, with a gentle bump for bigger numbers
function radiusFor(v) { return 26 + 1.7 * Math.sqrt(v); }   // ~28 (v=1) .. ~43 (v=99)
const BALL_R = 30;                                // nominal size (camera default)

/* ------------------------------- state ------------------------------------ */
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
let W = 0, VH = 0, DPR = 1;
const TOP_MARGIN = 146;
let BOT_MARGIN = 58;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  W = window.innerWidth; VH = window.innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(VH * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

let nextId = 1;
let balls = [];
let beams = [];
let config = null;
let moves = 0, won = false, tNow = 0;

// camera: world (centred at 0,0) -> screen
let zoom = 1, camX = 0, camY = 0;
function toScreenX(x) { return camX + x * zoom; }
function toScreenY(y) { return camY + y * zoom; }
function toWorld(sx, sy) { return { x: (sx - camX) / zoom, y: (sy - camY) / zoom }; }

function makeBall(value, x, y, vx = 0, vy = 0) {
  return { id: nextId++, value, x, y, vx, vy, r: radiusFor(value), pulse: 1 };
}
function ballById(id) { return balls.find(b => b.id === id); }
let mode = localStorage.getItem('yastupid_mode') || 'classic';

// Advanced mode always starts with two random false equalities; editable at runtime (add/remove).
function randomSums(n) {
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < 50) { const f = randomFalseSum(out); if (f) out.push(f); }
  return out;
}
let advancedSums = randomSums(2);
function currentSums() { return mode === 'classic' ? RULESETS.classic.falseSums : advancedSums; }

function startLevel(s, t) {
  const fs = currentSums();
  config = { fs, stats: rulesetStats(fs), s, t, mode };
  balls = []; beams = []; moves = 0; won = false; nextId = 1;
  zoom = 1;
  BOT_MARGIN = (mode === 'advanced') ? 104 : 58;
  balls.push(makeBall(s, 0, 0));
  updateHud(); renderLegend(); hideMenu(); hide('win');
}
function newRandomLevel() { const { s, t } = generateLevel(currentSums()); startLevel(s, t); }

/* ------------------------------- physics ---------------------------------- */
const GRAV = 0.9;        // gentle drift toward the centre (keeps them loosely gathered)
const BEAM_SPEED = 760;  // px/s a beam reels its two balls together (position-based, reliable)
const DAMP = 0.85;
const SEP_GAP = 5;       // keep this much space between rims

function inAnyBeam(id) { return beams.some(b => b.a === id || b.b === id); }
function beamedTogether(a, b) { return beams.some(x => (x.a === a && x.b === b) || (x.a === b && x.b === a)); }

function step(dt) {
  // gentle centre gravity
  for (const b of balls) { b.vx += -b.x * GRAV * dt; b.vy += -b.y * GRAV * dt; }
  // integrate free motion
  for (const b of balls) {
    b.vx *= DAMP; b.vy *= DAMP;
    const sp = Math.hypot(b.vx, b.vy); if (sp > 1400) { b.vx *= 1400 / sp; b.vy *= 1400 / sp; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.pulse > 1) b.pulse = Math.max(1, b.pulse - dt * 3);
  }
  // beams reel their pair together directly, so damping/gravity can't stall them
  for (const beam of beams) {
    const A = ballById(beam.a), B = ballById(beam.b); if (!A || !B) continue;
    let dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 0.001;
    const nx = dx / d, ny = dy / d;
    const close = Math.min(d, Math.max(BEAM_SPEED * dt, d * 0.30));
    A.x += nx * close * 0.5; A.y += ny * close * 0.5;
    B.x -= nx * close * 0.5; B.y -= ny * close * 0.5;
    A.vx += nx * 60; A.vy += ny * 60; B.vx -= nx * 60; B.vy -= ny * 60;   // a little oomph for feel
  }
  // hard separation so balls never overlap (a few relaxation passes)
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < balls.length; i++)
      for (let j = i + 1; j < balls.length; j++) {
        const A = balls[i], B = balls[j];
        if (beamedTogether(A.id, B.id)) continue;       // let a fusing pair touch
        let dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 0.001;
        const min = A.r + B.r + SEP_GAP;
        if (d >= min) continue;
        const nx = dx / d, ny = dy / d, overlap = min - d;
        // beamed balls barge through: the non-beamed neighbour yields most
        const ba = inAnyBeam(A.id), bb = inAnyBeam(B.id);
        let wA = 0.5, wB = 0.5;
        if (ba && !bb) { wA = 0.12; wB = 0.88; }
        else if (bb && !ba) { wA = 0.88; wB = 0.12; }
        A.x -= nx * overlap * wA; A.y -= ny * overlap * wA;
        B.x += nx * overlap * wB; B.y += ny * overlap * wB;
        A.vx -= nx * 4; A.vy -= ny * 4; B.vx += nx * 4; B.vy += ny * 4;
      }
  }
  // fuse on contact
  for (const beam of beams.slice()) {
    const A = ballById(beam.a), B = ballById(beam.b);
    if (!A || !B) { beams = beams.filter(x => x !== beam); continue; }
    if (Math.hypot(B.x - A.x, B.y - A.y) <= A.r + B.r - 2) fuse(A, B);
  }
}

function updateCamera(dt) {
  let hw = BALL_R, hh = BALL_R;
  for (const b of balls) { hw = Math.max(hw, Math.abs(b.x) + b.r); hh = Math.max(hh, Math.abs(b.y) + b.r); }
  const margin = 16;
  const availW = W / 2 - margin;
  const availH = (VH - TOP_MARGIN - BOT_MARGIN) / 2;
  let target = Math.min(1, availW / hw, availH / hh);
  target = Math.max(0.16, target);
  zoom += (target - zoom) * Math.min(1, dt * 3.5);
  camX = W / 2;
  camY = TOP_MARGIN + (VH - TOP_MARGIN - BOT_MARGIN) / 2;
}

/* -------------------------------- sound ----------------------------------- */
// Bubbly blips synthesised on the fly — no asset files, no dependencies.
let actx = null;
let muted = localStorage.getItem('yastupid_muted') === '1';
function audio() {
  // 'playback' tells iOS/WebKit to keep playing even with the ringer/silent switch off.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
// a short bubble blip: a sine swept between two pitches with a fast pluck envelope
function blip(f0, f1, dur, vol) {
  if (muted) return;
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function popSound()   { blip(380, 920, 0.09, 0.22); }   // split: light upward "pop"
// fuse: a "reverse pop" / suction — pitch slurps upward as the sound swells in, then snaps off
function mergeSound() {
  if (muted) return;
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime, dur = 0.20;
  const o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
  o.type = 'sine';
  o.frequency.setValueAtTime(180, t);
  o.frequency.exponentialRampToValueAtTime(700, t + dur);              // upward slurp (pulled together)
  lp.type = 'lowpass'; lp.Q.value = 0.7;
  lp.frequency.setValueAtTime(400, t);
  lp.frequency.exponentialRampToValueAtTime(2200, t + dur);            // filter opens — the "schlooop"
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.26, t + dur * 0.9);            // swell in — reverse of a pop
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.015);        // then snap off
  o.connect(g).connect(lp).connect(ac.destination);
  o.start(t); o.stop(t + dur + 0.04);
}
// a clean melody note (warm triangle, soft attack/decay) at a time offset, for the win fanfare
function tone(freq, delay, dur, vol) {
  if (muted) return;
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
// win: a short triumphant rising major arpeggio (C-E-G-C) capped by a held top note
function winSound() {
  tone(523.25, 0.00, 0.16, 0.20);  // C5
  tone(659.25, 0.11, 0.16, 0.20);  // E5
  tone(783.99, 0.22, 0.16, 0.20);  // G5
  tone(1046.50, 0.34, 0.55, 0.24); // C6 — held, the flourish
  tone(783.99, 0.34, 0.55, 0.10);  // G5 under it for a fuller chord
}

/* ------------------------------ operations -------------------------------- */
function split(ball) {
  if (won) return;
  const kids = splitValue(ball.value, config.fs);
  if (!kids) { ball.pulse = 1.5; ball.vx += (Math.random() - .5) * 80; toast("A 1 can't split!"); return; }
  popSound();
  const idx = balls.indexOf(ball); if (idx >= 0) balls.splice(idx, 1);
  const ang = Math.random() * Math.PI * 2;
  for (let k = 0; k < kids.length; k++) {
    const a = ang + (k ? Math.PI : 0);
    const nb = makeBall(kids[k], ball.x + Math.cos(a) * 12, ball.y + Math.sin(a) * 12,
      Math.cos(a) * 220, Math.sin(a) * 220);
    nb.pulse = 1.35; balls.push(nb);
  }
  moves++; afterChange();
}
function fuse(A, B) {
  mergeSound();
  const value = mergeValue(A.value, B.value, config.fs);
  const x = (A.x + B.x) / 2, y = (A.y + B.y) / 2;
  balls = balls.filter(b => b !== A && b !== B);
  beams = beams.filter(bm => ![A.id, B.id].includes(bm.a) && ![A.id, B.id].includes(bm.b));
  const nb = makeBall(value, x, y, (A.vx + B.vx) / 2, (A.vy + B.vy) / 2);
  nb.pulse = 1.5; balls.push(nb);
  moves++; afterChange();
}
function afterChange() {
  updateHud();
  if (balls.length === 1 && balls[0].value === config.t && !won) { won = true; setTimeout(showWin, 480); }
}

/* --------------------------------- beams ---------------------------------- */
function isBeamed(a, b) { return beams.some(x => (x.a === a && x.b === b) || (x.a === b && x.b === a)); }
function addBeam(a, b) {
  if (a === b || isBeamed(a, b)) return;
  beams.push({ a, b });
  const A = ballById(a), B = ballById(b); if (A) A.pulse = 1.3; if (B) B.pulse = 1.3;
}

/* ------------------------------- rendering -------------------------------- */
function draw() {
  ctx.clearRect(0, 0, W, VH);
  for (const beam of beams) {
    const A = ballById(beam.a), B = ballById(beam.b);
    if (A && B) drawBeam(A.x, A.y, A.value, B.x, B.y, B.value, false);
  }
  if (drag && drag.moved) {
    const A = ballById(drag.id);
    if (A) drawBeam(A.x, A.y, A.value, drag.x, drag.y, A.value, true);
  }
  for (const b of balls) drawBall(b);
}

function drawBeam(ax, ay, av, bx, by, bv, aiming) {
  const x1 = toScreenX(ax), y1 = toScreenY(ay), x2 = toScreenX(bx), y2 = toScreenY(by);
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 0.001;
  const px = -dy / len, py = dx / len;
  const wob = Math.sin(tNow * 11) * Math.min(15, len * 0.08);
  const cx = (x1 + x2) / 2 + px * wob, cy = (y1 + y2) / 2 + py * wob;
  const grad = ctx.createLinearGradient(x1, y1, x2, y2);
  grad.addColorStop(0, `hsl(${valueHue(av)},90%,62%)`);
  grad.addColorStop(.5, '#fff');
  grad.addColorStop(1, `hsl(${valueHue(bv)},90%,62%)`);
  const stroke = w => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.lineWidth = w; ctx.stroke(); };
  const s = zoom;
  ctx.save(); ctx.lineCap = 'round'; ctx.globalCompositeOperation = 'lighter';
  // wide soft energy halo
  ctx.strokeStyle = grad; ctx.globalAlpha = .35; stroke((aiming ? 16 : 22) * s + 4);
  // bright coloured beam
  ctx.globalAlpha = .9; stroke((aiming ? 8 : 11) * s + 2);
  // white-hot core
  ctx.strokeStyle = 'rgba(255,252,240,1)'; ctx.globalAlpha = 1; stroke((aiming ? 3 : 4) * s + 1.2);
  // travelling energy beads (always — sells the "proton beam")
  const beads = Math.max(3, Math.floor(len / 24));
  for (let i = 0; i < beads; i++) {
    const p = ((i / beads) + tNow * 0.9) % 1, mt = 1 - p;
    const x = mt * mt * x1 + 2 * mt * p * cx + p * p * x2;
    const y = mt * mt * y1 + 2 * mt * p * cy + p * p * y2;
    ctx.fillStyle = '#fffbe9'; ctx.beginPath(); ctx.arc(x, y, 3 * s + 1, 0, 7); ctx.fill();
  }
  ctx.restore();
}

function drawBall(b) {
  const hue = valueHue(b.value), r = b.r * zoom * b.pulse;
  const x = toScreenX(b.x), y = toScreenY(b.y);
  ctx.save();
  ctx.shadowColor = 'rgba(40,28,6,.40)'; ctx.shadowBlur = 9; ctx.shadowOffsetY = 5;
  const g = ctx.createRadialGradient(x - r * .34, y - r * .4, r * .12, x, y, r);
  g.addColorStop(0, `hsl(${hue},92%,84%)`); g.addColorStop(.5, `hsl(${hue},78%,60%)`); g.addColorStop(1, `hsl(${hue},66%,42%)`);
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = g; ctx.fill();
  ctx.restore();
  ctx.lineWidth = Math.max(2, r * .07); ctx.strokeStyle = `hsl(${hue},55%,28%)`;
  ctx.beginPath(); ctx.arc(x, y, r - ctx.lineWidth / 2, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(x - r * .33, y - r * .4, r * .3, r * .18, -0.5, 0, 7);
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fill();
  ctx.font = `900 ${Math.max(12, r * .82)}px ui-rounded,"Trebuchet MS",system-ui,sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,.65)';
  ctx.strokeText(String(b.value), x, y + 1);
  ctx.fillStyle = '#22150a'; ctx.fillText(String(b.value), x, y + 1);
}

/* --------------------------------- loop ----------------------------------- */
let lastT = performance.now();
requestAnimationFrame(function frame(now) {
  let dt = Math.min((now - lastT) / 1000, 0.033); lastT = now; tNow += dt;
  if (config) { step(dt); updateCamera(dt); draw(); }
  requestAnimationFrame(frame);
});

/* --------------------------------- input ---------------------------------- */
let drag = null;
const TAP_MOVE = 14;
function pos(e) { const r = canvas.getBoundingClientRect(); return toWorld(e.clientX - r.left, e.clientY - r.top); }
function pointAt(wx, wy) {
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i]; if (Math.hypot(wx - b.x, wy - b.y) <= b.r + 8 / zoom) return b;
  }
  return null;
}
canvas.addEventListener('pointerdown', e => {
  audio();   // resume the audio context on the user gesture (browsers require this)
  if (!config || won) return;
  const { x, y } = pos(e); const b = pointAt(x, y); if (!b) return;
  drag = { id: b.id, sx: x, sy: y, x, y, moved: false };
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const { x, y } = pos(e); drag.x = x; drag.y = y;
  if (Math.hypot(x - drag.sx, y - drag.sy) * zoom > TAP_MOVE) drag.moved = true;
  e.preventDefault();
});
canvas.addEventListener('pointerup', e => {
  if (!drag) return;
  const { x, y } = pos(e), src = ballById(drag.id), tgt = pointAt(x, y);
  if (src) {
    if (drag.moved && tgt && tgt.id !== src.id) addBeam(src.id, tgt.id);
    else if (!drag.moved) split(src);
  }
  drag = null; e.preventDefault();
});
canvas.addEventListener('pointercancel', () => { drag = null; });

/* --------------------------------- HUD ------------------------------------ */
const el = id => document.getElementById(id);
function updateHud() {
  el('targetVal').textContent = config ? config.t : '—';
  el('moveVal').textContent = moves;
}
let toastTimer = null;
function toast(msg) {
  const t = el('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ------------------------------- popovers --------------------------------- */
function show(id) { el(id).classList.remove('hidden'); }
function hide(id) { el(id).classList.add('hidden'); }
function classicHelp() {
  return `<p><b>Goal.</b> Fuse and split until a you have a single ball with the target value.</p>
    <p><b>Tap</b> a ball to split it in half (odd numbers split into the two nearest halves).</p>
    <p><b>Drag</b> one ball to another to fuse them into their sum.</p>
    <p>If this seems impossible, remember the Vine Fallacy: <b>9+10=21</b>.</p>`;
}
function advancedHelp() {
  return `<p><b>Goal.</b> Reach a single ball of the target, but now with dubious equalities at once.</p>
    <p>Along the bottom there are several false sums (<i>a + b = c</i>). Tapping a
       <b>c</b> splits it into its pair <b>a, b</b>; dragging <b>a</b> onto <b>b</b> fuses to <b>c</b>
       (not a+b). Ordinary tap-to-halve and drag-to-add still apply to all other numbers.</p>
    <p>Tap <b>+</b> in the legend to add a random dubious equality, or <b>×</b> to remove one. Each change re-deals a
       fresh puzzle.</p>`;
}
function openMenu() {
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  el('helpBody').innerHTML = mode === 'classic' ? classicHelp() : advancedHelp();
  show('menu');
}
function hideMenu() { hide('menu'); }

/* ----------------------- Advanced false-sum legend ------------------------ */
function miniBall(v) {
  const b = document.createElement('span'); b.className = 'lg-ball'; b.textContent = v;
  const h = valueHue(v);
  b.style.background = `radial-gradient(circle at 34% 30%, hsl(${h},92%,82%), hsl(${h},72%,46%))`;
  b.style.borderColor = `hsl(${h},55%,30%)`;
  return b;
}
function sym(s) { const e = document.createElement('span'); e.className = 'lg-sym'; e.textContent = s; return e; }

function renderLegend() {
  const wrap = el('legend');
  if (mode !== 'advanced') { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  wrap.innerHTML = '';
  advancedSums.forEach((f, i) => {
    const chip = document.createElement('div'); chip.className = 'lg-chip';
    chip.append(miniBall(f.a), sym('+'), miniBall(f.b), sym('='), miniBall(f.c));
    const rm = document.createElement('button'); rm.className = 'lg-x'; rm.textContent = '×';
    rm.title = 'remove this false sum'; rm.disabled = advancedSums.length <= 1;
    rm.onclick = () => removeSum(i);
    chip.append(rm);
    wrap.append(chip);
  });
  const add = document.createElement('button'); add.className = 'lg-add'; add.textContent = '+';
  add.title = 'add a random false sum'; add.disabled = advancedSums.length >= 6;
  add.onclick = addRandomSum;
  wrap.append(add);
}

function randomFalseSum(existing) {
  const usedC = new Set(existing.map(f => f.c));
  const pk = f => [Math.min(f.a, f.b), Math.max(f.a, f.b)].join(',');
  const usedP = new Set(existing.map(pk));
  for (let k = 0; k < 300; k++) {
    const a = randInt(1, 12), b = randInt(1, 12);
    const off = (Math.random() < 0.5 ? -1 : 1) * randInt(1, 9);
    const c = a + b + off;
    if (off === 0 || c < 1) continue;
    if (usedC.has(c)) continue;
    if (usedP.has(pk({ a, b }))) continue;
    return { a, b, c };
  }
  return null;
}
function addRandomSum() {
  if (advancedSums.length >= 6) return;
  const f = randomFalseSum(advancedSums);
  if (!f) { toast('No fresh false sum found — remove one first.'); return; }
  advancedSums.push(f);
  newRandomLevel();            // any change generates a new level
}
function removeSum(i) {
  if (advancedSums.length <= 1) return;
  advancedSums.splice(i, 1);
  newRandomLevel();
}
function showWin() {
  el('winLine').textContent = `${config.s} → ${config.t} in ${moves} move${moves === 1 ? '' : 's'}.`;
  show('win');
  winSound();
}

/* ------------------------------ UI wiring --------------------------------- */
el('menuBtn').onclick = openMenu;
el('closeMenu').onclick = hideMenu;
el('menu').addEventListener('pointerdown', e => { if (e.target === el('menu')) hideMenu(); });
// Same speaker body in both states; only the right-hand glyph (waves vs. slash) differs.
const SPK_BODY = '<path d="M3 9.5v5h3.2L11 18.5V5.5L6.2 9.5z" fill="currentColor"/>';
const SPK_WAVES = '<path d="M14 9.2a4 4 0 0 1 0 5.6M16.6 7a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
const SPK_SLASH = '<path d="M14.5 9.5l5 5M19.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
function speakerIcon(off) {
  return `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${SPK_BODY}${off ? SPK_SLASH : SPK_WAVES}</svg>`;
}
function renderMute() {
  const b = el('muteBtn');
  b.innerHTML = speakerIcon(muted);
  b.classList.toggle('muted', muted);
  b.setAttribute('aria-pressed', String(muted));
  b.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
}
el('muteBtn').onclick = () => {
  muted = !muted;
  localStorage.setItem('yastupid_muted', muted ? '1' : '0');
  renderMute();
  if (!muted) popSound();   // little confirmation blip when turning sound back on
};
renderMute();
el('newBtn').onclick = newRandomLevel;
el('newMenuBtn').onclick = newRandomLevel;
el('againBtn').onclick = newRandomLevel;
el('restartBtn').onclick = () => startLevel(config.s, config.t);
document.querySelectorAll('.seg-btn').forEach(btn => {
  btn.onclick = () => {
    if (mode !== btn.dataset.mode) {
      mode = btn.dataset.mode; localStorage.setItem('yastupid_mode', mode);
      newRandomLevel();            // deal a fresh puzzle in the new mode...
    }
    openMenu();                    // ...but keep the help open and refresh it
  };
});

/* ------------------------------- boot ------------------------------------- */
newRandomLevel();
