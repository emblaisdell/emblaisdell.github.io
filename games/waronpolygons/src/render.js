'use strict';
/* ------------------------------------------------------------------ *
 * Rendering. The world is gray; color is the enemy.
 * ------------------------------------------------------------------ */

/* Two stacked, *displayed* canvases. The background (ground, path, and the
 * color wash) repaints only when it actually changes; the foreground repaints
 * every frame. Nothing is ever copied between them — blitting a full-screen
 * cache into a GPU-backed canvas each frame is ruinously slow. */
const bgcv = document.getElementById('cvbg');
const bgctx = bgcv.getContext('2d');
const cv  = document.getElementById('cvfg');
const ctx = cv.getContext('2d');
let view = { scale:1, dpr:1, rot:0 };
let bgDirty = true;

/* On a tall, narrow screen a 16:9 map shrinks to a postage stamp. Turning the
 * world a quarter turn — so the shapes march down the screen instead of across
 * it — roughly doubles the usable scale. Only done when it actually wins. */
function resize(){
  const stage = document.getElementById('stage');
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const flat = Math.min(rect.width / WORLD_W, rect.height / WORLD_H);
  const turned = Math.min(rect.width / WORLD_H, rect.height / WORLD_W);
  const rot = turned > flat * 1.15 ? 1 : 0;
  const scale = rot ? turned : flat;

  const w = Math.floor((rot ? WORLD_H : WORLD_W) * scale);
  const h = Math.floor((rot ? WORLD_W : WORLD_H) * scale);
  for (const el of [bgcv, cv]){
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.width = Math.floor(w * dpr); el.height = Math.floor(h * dpr);
  }
  view = { scale, dpr, rot };
  bgDirty = true;
}

/* world -> canvas transform, honouring the quarter turn */
function setWorldTransform(c){
  const s = view.scale * view.dpr;
  if (view.rot) c.setTransform(0, s, -s, 0, WORLD_H * s, 0);   // 90 degrees clockwise
  else          c.setTransform(s, 0, 0, s, 0, 0);
}
/* The stage box changes for reasons no resize event reports — the upgrade
 * sheet opening, mobile browser chrome sliding away, orientation changes. */
function observeStage(){
  if (typeof ResizeObserver === 'undefined') return;
  let w = 0, h = 0;
  new ResizeObserver(entries => {
    const r = entries[0].contentRect;
    if (Math.abs(r.width - w) > 0.5 || Math.abs(r.height - h) > 0.5){
      w = r.width; h = r.height; resize();
    }
  }).observe(document.getElementById('stage'));
}

function toWorld(clientX, clientY){
  const cr = cv.getBoundingClientRect();
  const px = (clientX - cr.left) / view.scale, py = (clientY - cr.top) / view.scale;
  return view.rot ? { x: py, y: WORLD_H - px } : { x: px, y: py };
}

function polyPath(c, x, y, r, sides, rot){
  c.beginPath();
  for (let i = 0; i < sides; i++){
    const a = rot - Math.PI/2 + i*2*Math.PI/sides;
    const px = x + Math.cos(a)*r, py = y + Math.sin(a)*r;
    i ? c.lineTo(px,py) : c.moveTo(px,py);
  }
  c.closePath();
}

/* ------------------------------ layers ---------------------------- */
function drawGround(c){
  c.fillStyle = '#1a1a1e';
  c.fillRect(0,0,WORLD_W,WORLD_H);
  c.strokeStyle = '#212127'; c.lineWidth = 1;
  c.beginPath();
  for (let x = 40; x < WORLD_W; x += 40){ c.moveTo(x+.5,0); c.lineTo(x+.5,WORLD_H); }
  for (let y = 40; y < WORLD_H; y += 40){ c.moveTo(0,y+.5); c.lineTo(WORLD_W,y+.5); }
  c.stroke();
}

function drawPath(c, path){
  c.lineJoin = c.lineCap = 'round';
  c.strokeStyle = '#34343c'; c.lineWidth = PATH_WIDTH + 6;
  tracePath(c, path); c.stroke();
  c.strokeStyle = '#4a4a54'; c.lineWidth = PATH_WIDTH;
  tracePath(c, path); c.stroke();
  c.strokeStyle = 'rgba(140,140,155,.20)'; c.lineWidth = 2;
  c.setLineDash([12,14]); tracePath(c, path); c.stroke(); c.setLineDash([]);

  // entry mouth
  c.fillStyle = '#5a5a66';
  for (let i = 0; i < 3; i++){
    const d = 26 + i*22, p = path.posAt(d);
    c.save(); c.translate(p.x,p.y); c.rotate(Math.atan2(p.dy,p.dx));
    c.globalAlpha = 0.5 - i*0.14;
    c.beginPath(); c.moveTo(-7,-8); c.lineTo(6,0); c.lineTo(-7,8); c.closePath(); c.fill();
    c.restore();
  }
  // the exit: what the shapes are trying to reach
  const e = path.end, back = path.posAt(path.length - 1);
  const ang = Math.atan2(e.y-back.y, e.x-back.x);
  c.save(); c.translate(e.x,e.y); c.rotate(ang);
  c.fillStyle = '#2a2a31'; c.strokeStyle = '#61616e'; c.lineWidth = 3;
  c.beginPath(); c.rect(-30, -PATH_WIDTH/2 - 6, 34, PATH_WIDTH + 12); c.fill(); c.stroke();
  c.fillStyle = '#4b4b56';
  for (let i = -1; i <= 1; i++){ c.fillRect(-24, i*14 - 4, 22, 8); }
  c.restore();
}
function tracePath(c, path){
  c.beginPath();
  c.moveTo(path.pts[0][0], path.pts[0][1]);
  for (let i = 1; i < path.pts.length; i++) c.lineTo(path.pts[i][0], path.pts[i][1]);
}

/* The map bleeds color outward from the exit as lives are lost.
 * `color` compositing keeps the gray artwork's luminosity and only
 * paints hue + saturation over it. */
let _canTint = null;
function canTint(c){
  if (_canTint === null){
    c.save(); c.globalCompositeOperation = 'color';
    _canTint = c.globalCompositeOperation === 'color';
    c.restore();
  }
  return _canTint;
}

function drawCorruption(c){
  const k = corruption();
  if (k <= 0.005 || !canTint(c)) return;
  const e = G.path.end;
  const R = Math.hypot(WORLD_W, WORLD_H) * (0.10 + 1.0*k);

  // once the world is nearly lost the color reaches every corner
  const edge = Math.max(0, (k - 0.7) / 0.3) * 0.9;
  const phase = k * 4.0;
  const hueBase = k * 140;

  c.save();
  c.globalCompositeOperation = 'color';
  for (let i = 0; i < 3; i++){
    const a = phase + i*2.094;
    const spread = G.mode === 'lost' ? 0.5 : 0.16;
    const cx = e.x + Math.cos(a)*R*spread, cy = e.y + Math.sin(a)*R*spread;
    const hue = (hueBase + i*120) % 360;
    const g = c.createRadialGradient(cx,cy,0,cx,cy,R);
    g.addColorStop(0,    'hsla(' + hue + ',95%,55%,' + (0.25 + 0.75*k) + ')');
    g.addColorStop(0.45, 'hsla(' + ((hue+70)%360) + ',92%,55%,' + (0.55*k) + ')');
    g.addColorStop(1,    'hsla(' + ((hue+150)%360) + ',92%,55%,' + edge + ')');
    c.fillStyle = g; c.fillRect(0,0,WORLD_W,WORLD_H);
  }
  c.restore();

  c.save();
  c.globalCompositeOperation = 'overlay';
  const g2 = c.createRadialGradient(e.x,e.y,0,e.x,e.y,R*0.9);
  g2.addColorStop(0, 'rgba(255,255,255,' + (0.16*k + 0.16*edge) + ')');
  g2.addColorStop(1, 'rgba(255,255,255,' + (0.30*edge) + ')');
  c.fillStyle = g2; c.fillRect(0,0,WORLD_W,WORLD_H);
  c.restore();
}

function drawShapes(c){
  for (const s of G.shapes){
    const col = COLORS[s.color];
    c.save();
    c.translate(s.x, s.y);
    c.rotate(s.angle);
    polyPath(c, 0, 0, s.radius, s.sides, 0);
    c.fillStyle = col.hex; c.fill();
    c.lineWidth = 2; c.strokeStyle = 'rgba(0,0,0,.45)'; c.stroke();
    if (s.flash > 0){
      polyPath(c, 0, 0, s.radius, s.sides, 0);
      c.fillStyle = 'rgba(255,255,255,' + (0.7*s.flash) + ')'; c.fill();
    }
    c.restore();
  }
}

function drawTowers(c, t){
  for (const tw of G.towers){
    c.beginPath(); c.arc(tw.x, tw.y, TOWER_RADIUS + 2, 0, 6.2832);
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fill();
    c.beginPath(); c.arc(tw.x, tw.y, TOWER_RADIUS, 0, 6.2832);
    c.fillStyle = '#0b0b0d'; c.fill();
    c.lineWidth = 1.5; c.strokeStyle = '#4e4e5a'; c.stroke();
  }
  // range ring only while hovering or selected — every circle looks the same
  const show = G.hovered || G.selected;
  if (show && G.towers.indexOf(show) >= 0){
    const r = statValue('range', show.lv.range);
    c.beginPath(); c.arc(show.x, show.y, r, 0, 6.2832);
    c.fillStyle = 'rgba(190,190,210,.05)'; c.fill();
    c.setLineDash([6,6]); c.lineDashOffset = -t*14;
    c.lineWidth = 1.5; c.strokeStyle = 'rgba(200,200,220,.45)'; c.stroke();
    c.setLineDash([]); c.lineDashOffset = 0;
  }
}

function drawProjectiles(c){
  c.fillStyle = '#0b0b0d';
  for (const p of G.projs){
    c.beginPath(); c.arc(p.x, p.y, PROJ_RADIUS, 0, 6.2832); c.fill();
  }
  c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2; c.beginPath();
  for (const p of G.projs){
    const m = 0.035;
    c.moveTo(p.x - p.vx*m, p.y - p.vy*m); c.lineTo(p.x, p.y);
  }
  c.stroke();
}

function drawParticles(c){
  for (const p of G.parts){
    c.save();
    c.globalAlpha = Math.max(0, Math.min(1, p.life));
    c.translate(p.x, p.y); c.rotate(p.rot);
    c.fillStyle = p.color;
    c.fillRect(-p.size/2, -p.size/2, p.size, p.size);
    c.restore();
  }
  c.globalAlpha = 1;
}

function drawPlacement(c, t){
  if (!G.placing || !G.mouse) return;
  const { x, y } = G.mouse;
  const ok = canPlace(x,y) && G.gold >= TOWER_COST;
  const r = statValue('range', 1);
  c.beginPath(); c.arc(x,y,r,0,6.2832);
  c.fillStyle = ok ? 'rgba(190,190,210,.05)' : 'rgba(229,52,44,.06)';
  c.fill();
  c.setLineDash([6,6]); c.lineDashOffset = -t*14; c.lineWidth = 1.5;
  c.strokeStyle = ok ? 'rgba(200,200,220,.45)' : 'rgba(229,52,44,.5)';
  c.stroke(); c.setLineDash([]); c.lineDashOffset = 0;

  c.beginPath(); c.arc(x,y,TOWER_RADIUS,0,6.2832);
  c.fillStyle = ok ? 'rgba(11,11,13,.8)' : 'rgba(229,52,44,.35)';
  c.fill();
  c.lineWidth = 1.5; c.strokeStyle = ok ? '#4e4e5a' : '#e5342c'; c.stroke();
}

/* -------------------------------- draw ---------------------------- */
let baseKey = '', tintStep = -1, lostWas = false, tintAt = -1;
const TINT_STEPS = 40;          // how finely the wash tracks damage taken
const TINT_MAX_HZ = 14;         // ...and how often it may be repainted while easing

function render(t){
  // --- background: only when it changes ---
  const key = G.pathIndex + '|' + (G.path ? 1 : 0) + '|' + view.rot;
  const k = G.path ? corruption() : 0;
  const step = Math.round(k * TINT_STEPS);
  const lost = G.mode === 'lost';
  if (key !== baseKey){ bgDirty = true; baseKey = key; tintStep = step; }
  else if (step !== tintStep && (tintAt < 0 || t - tintAt >= 1/TINT_MAX_HZ)){
    bgDirty = true; tintStep = step; tintAt = t;
  }
  if (lost !== lostWas) { lostWas = lost; bgDirty = true; }

  if (bgDirty){
    bgDirty = false;
    setWorldTransform(bgctx);
    bgctx.clearRect(0, 0, WORLD_W, WORLD_H);
    drawGround(bgctx);
    if (G.path){ drawPath(bgctx, G.path); drawCorruption(bgctx); }
  }

  // --- foreground: every frame, cheap ---
  setWorldTransform(ctx);
  ctx.clearRect(0, 0, WORLD_W, WORLD_H);
  drawPlacement(ctx, t);
  drawParticles(ctx);
  if (G.path){ drawProjectiles(ctx); drawShapes(ctx); drawTowers(ctx, t); }
}
