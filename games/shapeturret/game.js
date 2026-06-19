"use strict";

/* =========================================================================
 * Shape Turret — a calming, ethereal polygon defense game.
 * Sides (not shape) determine lives and power for every polygon.
 * All balance lives in CONFIG so the math is easy to retune.
 * ========================================================================= */

const CONFIG = {
  player: {
    startSides: 35,        // 35-gon => 33 "lives" (lives = sides - 2)
    radiusFactor: 2,       // player radius = 2x the base polygon radius
  },
  baseRadius: 17,          // radius of ordinary polygons (enemies)

  enemy: {
    spawnRate: 2.0,        // mean spawns per second (Poisson process), constant
    speed: 52,             // px/s, drifts toward the turret
    minSides: 3,
    // max sides an enemy can spawn with grows LINEARLY with time:
    sidesGrowthPerSec: 0.10,   // maxSides = minSides + t * this
  },

  projectile: {
    speed: 560,
    startSides: 3,         // first projectiles are triangles
    radius: 7,
  },

  // Shots per second = (cyan shape's sides) * this factor.
  fireRateFactor: 0.5,

  sideShape: {
    startSides: 3,         // green & cyan shapes both start as triangles
    radius: 22,
    edgeMargin: 16,        // gap from the screen's left/right edge (px)
    baseSpin: 0.5,         // rad/s
    boostSpin: 5.0,        // rad/s while "spinning faster for a bit"
    boostTime: 1.4,        // seconds the boost lasts
  },

  // Bars & XP are measured as fractions of the canvas width.
  // Tuned so the first upgrade costs ~5 kills and a full win takes ~460 kills,
  // with ~10 upgrades per side. Each kill is worth LESS than the starting bar,
  // so XP feels earned instead of overflowing. Deliberately lean: paired with
  // the 2/sec spawn rate it's a close game that a sharp shooter just edges out.
  bars: {
    startLen: 0.05,        // initial neon green / cyan bar length
    inc: 0.045,            // a bar grows by this much per upgrade (~10 upgrades/side)
    xpPerKill: 0.011,      // each kill adds this to the white (XP) bars
  },

  // Visual thickness of the top bars (px).
  barHeight: 11,
  whiteBarHeight: 8,
};

/* ----------------------------------------------------------------------- */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const helpEl = document.getElementById("help");
const helpHint = document.getElementById("help-hint");

let W = 0, H = 0, DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resize);
resize();

/* ----------------------------------------------------------------------- */
/* Game state */

let state;        // "playing" | "won" | "lost"
let time;         // seconds elapsed
let player;       // { x, y, r, sides }
let greenShape, cyanShape;
let greenLen, cyanLen;   // neon bar lengths (px)
let xp;                  // white bar length, shared (px)
let projectileSides;     // sides of projectiles fired now
let enemies, projectiles, motes;
let spawnTimer;
let fireAcc;
let aim;          // { x, y }
let firing;       // true only while the mouse button / touch is held

function reset() {
  state = "playing";
  time = 0;
  const pr = CONFIG.baseRadius * CONFIG.player.radiusFactor;
  player = { x: W / 2, y: H - pr - 24, r: pr, sides: CONFIG.player.startSides };

  // Upgrade shapes sit near the far left / right edges of the screen.
  const edge = CONFIG.sideShape.radius + CONFIG.sideShape.edgeMargin;
  greenShape = makeSideShape(edge, player.y, "#5dffa0");
  cyanShape = makeSideShape(W - edge, player.y, "#5de8ff");

  greenLen = CONFIG.bars.startLen * W;
  cyanLen = CONFIG.bars.startLen * W;
  xp = 0;
  projectileSides = CONFIG.projectile.startSides;

  enemies = [];
  projectiles = [];
  spawnTimer = nextSpawnDelay();
  fireAcc = 0;
  aim = { x: W / 2, y: 0 };           // aim straight up by default
  firing = false;

  Sound.setProgress(greenShape.sides, cyanShape.sides);   // reset music reactivity

  initMotes();
}

function makeSideShape(x, y, color) {
  return {
    x, y, color,
    sides: CONFIG.sideShape.startSides,
    r: CONFIG.sideShape.radius,
    rot: 0,
    spinBoost: 0,
  };
}

// Poisson process: exponentially distributed inter-arrival times.
function nextSpawnDelay() {
  return -Math.log(1 - Math.random()) / CONFIG.enemy.spawnRate;
}

function currentMaxSides() {
  return CONFIG.enemy.minSides + time * CONFIG.enemy.sidesGrowthPerSec;
}

function fireRate() {
  // Cyan n-gon => n shots/second, scaled by a global tuning factor.
  return cyanShape.sides * CONFIG.fireRateFactor;
}

/* ----------------------------------------------------------------------- */
/* Ethereal background motes */

function initMotes() {
  motes = [];
  const n = Math.round((W * H) / 26000);
  for (let i = 0; i < n; i++) {
    motes.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 0.6 + Math.random() * 1.8,
      vy: -(4 + Math.random() * 12),
      vx: (Math.random() - 0.5) * 6,
      a: 0.05 + Math.random() * 0.22,
    });
  }
}

function updateMotes(dt) {
  for (const m of motes) {
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (m.y < -5) { m.y = H + 5; m.x = Math.random() * W; }
    if (m.x < -5) m.x = W + 5;
    else if (m.x > W + 5) m.x = -5;
  }
}

/* ----------------------------------------------------------------------- */
/* Input */

function setAim(clientX, clientY) {
  aim.x = clientX;
  aim.y = clientY;
}
function startFiring() {
  firing = true;
  fireAcc = 1 / fireRate();           // fire one shot immediately
}

window.addEventListener("mousemove", (e) => setAim(e.clientX, e.clientY));
window.addEventListener("mousedown", (e) => {
  setAim(e.clientX, e.clientY);
  startFiring();
});
window.addEventListener("mouseup", () => { firing = false; });
window.addEventListener("mouseleave", () => { firing = false; });

window.addEventListener("touchstart", (e) => {
  if (e.touches[0]) { setAim(e.touches[0].clientX, e.touches[0].clientY); startFiring(); }
}, { passive: true });
window.addEventListener("touchmove", (e) => {
  if (e.touches[0]) setAim(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });
window.addEventListener("touchend", () => { firing = false; });
window.addEventListener("touchcancel", () => { firing = false; });

function toggleHelp(show) {
  const visible = (show === undefined) ? !helpEl.classList.contains("show") : show;
  helpEl.classList.toggle("show", visible);
}
helpHint.addEventListener("click", () => toggleHelp(true));
helpEl.addEventListener("click", () => toggleHelp(false));
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "h") toggleHelp();
  else if (k === "escape") toggleHelp(false);
  else if (k === "m") Sound.toggleMute();
  else if (k === "r" && state !== "playing") reset();
});
// Restart on click when the game is over.
window.addEventListener("mousedown", () => { if (state !== "playing") reset(); });
window.addEventListener("touchend", () => { if (state !== "playing") reset(); });

/* ----------------------------------------------------------------------- */
/* Spawning & firing */

function spawnEnemy() {
  const maxS = currentMaxSides();
  const sides = CONFIG.enemy.minSides +
    Math.floor(Math.random() * (maxS - CONFIG.enemy.minSides + 1));
  enemies.push({
    x: Math.random() * W,
    y: -CONFIG.baseRadius,
    r: CONFIG.baseRadius,
    sides: Math.max(CONFIG.enemy.minSides, sides),
    rot: Math.random() * Math.PI * 2,
  });
}

function fireProjectile() {
  let dx = aim.x - player.x;
  let dy = aim.y - player.y;
  let len = Math.hypot(dx, dy);
  if (len < 1) { dx = 0; dy = -1; len = 1; }
  dx /= len; dy /= len;
  const spd = CONFIG.projectile.speed;
  projectiles.push({
    x: player.x + dx * (player.r + 4),
    y: player.y + dy * (player.r + 4),
    vx: dx * spd,
    vy: dy * spd,
    sides: projectileSides,
    r: CONFIG.projectile.radius,
    rot: 0,
  });
  Sound.shoot(projectileSides);
}

/* ----------------------------------------------------------------------- */
/* Collisions & upgrades */

function power(sides) { return sides - 2; }   // damage / lives a polygon carries

// Returns true if the projectile should be removed.
function projectileHitsEnemy(p, e) {
  const ep = power(e.sides);          // enemy's effective health
  const pp = power(p.sides);          // projectile's power

  if (e.sides < p.sides) {
    // Enemy has fewer sides than the projectile: it dies, projectile pierces,
    // losing (m - 2) sides where m = enemy sides.
    killEnemy(e);
    p.sides -= ep;
    return p.sides < 3;               // projectile dies if reduced below a triangle
  }

  // Otherwise the projectile is consumed; it strips (n - 2) sides off the enemy.
  e.sides -= pp;
  if (e.sides < 3) killEnemy(e);
  return true;
}

function killEnemy(e) {
  e.dead = true;
  xp += CONFIG.bars.xpPerKill * W;
  Sound.kill(e.sides);
}

// Projectile hits a side (upgrade) shape. Always consumes the projectile.
function projectileHitsSideShape(shape, isGreen) {
  const barLen = isGreen ? greenLen : cyanLen;
  if (xp > barLen) {
    xp -= barLen;
    if (isGreen) {
      greenLen += CONFIG.bars.inc * W;
      greenShape.sides += 1;
      projectileSides += 1;           // projectiles gain a side going forward
    } else {
      cyanLen += CONFIG.bars.inc * W;
      cyanShape.sides += 1;           // fire rate = cyan sides
    }
    shape.spinBoost = CONFIG.sideShape.boostTime;
    Sound.upgrade(isGreen);
    Sound.setProgress(greenShape.sides, cyanShape.sides);
  } else {
    // If xp was too short, the projectile still vanishes but nothing happens.
    Sound.fizzle();
  }
}

/* ----------------------------------------------------------------------- */
/* Update */

function update(dt) {
  time += dt;

  // Spawn enemies (Poisson).
  spawnTimer -= dt;
  while (spawnTimer <= 0) {
    spawnEnemy();
    spawnTimer += nextSpawnDelay();
  }

  // Fire only while the mouse button / touch is held.
  if (firing) {
    fireAcc += dt;
    const interval = 1 / fireRate();
    while (fireAcc >= interval) {
      fireProjectile();
      fireAcc -= interval;
    }
  } else {
    fireAcc = 0;
  }

  // Side shapes spin (faster for a bit after a successful upgrade).
  for (const s of [greenShape, cyanShape]) {
    let spin = CONFIG.sideShape.baseSpin;
    if (s.spinBoost > 0) {
      spin = CONFIG.sideShape.boostSpin;
      s.spinBoost -= dt;
    }
    s.rot += spin * dt;
  }

  // Move enemies toward the turret.
  for (const e of enemies) {
    let dx = player.x - e.x, dy = player.y - e.y;
    const len = Math.hypot(dx, dy) || 1;
    e.x += (dx / len) * CONFIG.enemy.speed * dt;
    e.y += (dy / len) * CONFIG.enemy.speed * dt;
    e.rot += 0.6 * dt;
    // Reached the turret? Hit when the bounding circles touch.
    if (len < e.r + player.r) {
      player.sides -= power(e.sides);      // lose n - 2 sides
      e.dead = true;
      Sound.playerHit();
      if (player.sides < 3) { state = "lost"; Sound.lose(); return; }
    }
  }

  // Move projectiles & resolve collisions.
  for (const p of projectiles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += 8 * dt;

    if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) {
      p.dead = true;
      continue;
    }

    // Side shapes.
    if (!p.dead && hits(p, greenShape)) { projectileHitsSideShape(greenShape, true); p.dead = true; }
    if (!p.dead && hits(p, cyanShape)) { projectileHitsSideShape(cyanShape, false); p.dead = true; }

    // Enemies (allow piercing through several in one step).
    if (!p.dead) {
      for (const e of enemies) {
        if (e.dead) continue;
        if (hits(p, e)) {
          if (projectileHitsEnemy(p, e)) { p.dead = true; break; }
        }
      }
    }
  }

  enemies = enemies.filter((e) => !e.dead);
  projectiles = projectiles.filter((p) => !p.dead);

  // Win when the green and cyan bars touch across the screen.
  if (greenLen + cyanLen >= W) { state = "won"; Sound.win(); }
}

function hits(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r;
}

/* ----------------------------------------------------------------------- */
/* Rendering */

function polygonPath(x, y, r, sides, rot) {
  ctx.beginPath();
  for (let i = 0; i <= sides; i++) {
    const ang = rot + (i / sides) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(ang) * r;
    const py = y + Math.sin(ang) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
}

function drawPolygon(x, y, r, sides, rot, color, opts = {}) {
  const { fill = null, lineWidth = 2, glow = 12 } = opts;
  polygonPath(x, y, r, Math.max(3, Math.round(sides)), rot);
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

function drawBars() {
  const bh = CONFIG.barHeight;
  const wbh = CONFIG.whiteBarHeight;

  // Neon bars (top row): green grows from left, cyan grows from right.
  ctx.save();
  ctx.shadowBlur = 14;
  ctx.shadowColor = "#5dffa0";
  ctx.fillStyle = "#5dffa0";
  ctx.fillRect(0, 0, greenLen, bh);
  ctx.shadowColor = "#5de8ff";
  ctx.fillStyle = "#5de8ff";
  ctx.fillRect(W - cyanLen, 0, cyanLen, bh);
  ctx.restore();

  // White XP bars (row below). Same shared length on each side; they visually
  // merge when xp exceeds half the screen, but stay their true length.
  ctx.save();
  ctx.shadowBlur = 8;
  ctx.shadowColor = "#ffffff";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillRect(0, bh, xp, wbh);
  ctx.fillRect(W - xp, bh, xp, wbh);
  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, W, H);

  // Background motes.
  for (const m of motes) {
    ctx.globalAlpha = m.a;
    ctx.fillStyle = "#bfe9ff";
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Side shapes.
  drawPolygon(greenShape.x, greenShape.y, greenShape.r, greenShape.sides, greenShape.rot, "#5dffa0", { glow: 16 });
  drawPolygon(cyanShape.x, cyanShape.y, cyanShape.r, cyanShape.sides, cyanShape.rot, "#5de8ff", { glow: 16 });

  // Player.
  drawPolygon(player.x, player.y, player.r, player.sides, 0, "#6ba8ff",
    { fill: "rgba(80,130,220,0.10)", glow: 18, lineWidth: 2.5 });

  // Enemies.
  for (const e of enemies) {
    drawPolygon(e.x, e.y, e.r, e.sides, e.rot, "#ff6b6b",
      { fill: "rgba(200,60,60,0.10)", glow: 10 });
  }

  // Projectiles.
  for (const p of projectiles) {
    drawPolygon(p.x, p.y, p.r, p.sides, p.rot, "#5dff8a", { glow: 8, lineWidth: 1.6 });
  }

  // Bars render last so they sit on top of enemies.
  drawBars();

  if (state !== "playing") drawEndScreen();
}

function drawEndScreen() {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const msg = state === "won"
    ? "You did it!  Those near-circles never stood a chance."
    : "You ran out of sides.";
  const color = state === "won" ? "#5dffa0" : "#ff6b6b";

  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  ctx.font = '300 ' + Math.max(20, Math.min(40, W * 0.032)) + 'px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(msg, W / 2, H / 2 - 10);

  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = '300 16px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText("click or press R to play again", W / 2, H / 2 + 34);
  ctx.restore();
}

/* ----------------------------------------------------------------------- */
/* Main loop */

let last = null;
function frame(now) {
  if (last === null) last = now;
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05);            // clamp to avoid huge steps after tab switch

  if (state === "playing" && !helpEl.classList.contains("show")) {
    update(dt);
  }
  updateMotes(dt);
  render();
  requestAnimationFrame(frame);
}

reset();
requestAnimationFrame(frame);
