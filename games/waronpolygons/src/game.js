'use strict';
/* ------------------------------------------------------------------ *
 * Simulation. No rendering, no DOM.
 * ------------------------------------------------------------------ */

/* ------------------------------ geometry -------------------------- */
function buildPath(pts){
  const segs = []; let acc = 0;
  for (let i = 0; i < pts.length - 1; i++){
    const [x1,y1] = pts[i], [x2,y2] = pts[i+1];
    const dx = x2-x1, dy = y2-y1, len = Math.hypot(dx,dy);
    segs.push({ x:x1, y:y1, dx:dx/len, dy:dy/len, len, acc });
    acc += len;
  }
  const last = segs[segs.length-1];
  return {
    pts, segs, length: acc,
    start: { x:pts[0][0], y:pts[0][1] },
    end:   { x:last.x + last.dx*last.len, y:last.y + last.dy*last.len },
    posAt(d){
      if (d <= 0) { const s = segs[0]; return { x:s.x + s.dx*d, y:s.y + s.dy*d, dx:s.dx, dy:s.dy }; }
      for (let i = 0; i < segs.length; i++){
        const s = segs[i];
        if (d <= s.acc + s.len || i === segs.length-1){
          const t = d - s.acc;
          return { x:s.x + s.dx*t, y:s.y + s.dy*t, dx:s.dx, dy:s.dy };
        }
      }
    },
    distanceTo(px,py){
      let best = Infinity;
      for (const s of segs){
        let t = (px-s.x)*s.dx + (py-s.y)*s.dy;
        t = t < 0 ? 0 : (t > s.len ? s.len : t);
        const d = Math.hypot(px - (s.x+s.dx*t), py - (s.y+s.dy*t));
        if (d < best) best = d;
      }
      return best;
    }
  };
}

/* The [enter, exit] fraction of this step during which the moving point is
 * inside the circle, clipped to [0,1]; null if it never is. The *width* of
 * that interval is the contact time the damage rate is metered against. */
function segCircleInterval(x1,y1,x2,y2,cx,cy,r){
  const dx = x2-x1, dy = y2-y1;
  const fx = x1-cx, fy = y1-cy;
  const a = dx*dx + dy*dy;
  if (a === 0) return (fx*fx + fy*fy <= r*r) ? [0,1] : null;
  const b = 2*(fx*dx + fy*dy);
  const c = fx*fx + fy*fy - r*r;
  const disc = b*b - 4*a*c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t0 = (-b - sq) / (2*a), t1 = (-b + sq) / (2*a);
  if (t1 <= 0 || t0 >= 1) return null;
  return [Math.max(0, t0), Math.min(1, t1)];
}

/* ------------------------------- state ---------------------------- */
const G = {
  mode:'menu',                  // menu | playing | won | lost
  path:null, pathIndex:0, diff:DIFFICULTIES[1],
  lives:0, maxLives:0, gold:0, goldAcc:0, time:0, corrupt:0,
  shapes:[], towers:[], projs:[], parts:[],
  waves:[],                     // in-flight waves
  nextWave:0,                   // index of the wave the button will start
  cleared:0,                    // waves fully cleared
  leaked:0, killed:0, dealt:0,
  selected:null, hovered:null, placing:false, mouse:null,
  paused:false, fast:false,
  _id:1
};
const uid = () => G._id++;

/* audio is optional — game.js also runs headless in the balance harness */
const hasSfx = () => typeof SFX !== 'undefined';

function startGame(pathIndex, diff){
  G.mode='playing'; G.pathIndex=pathIndex; G.path=buildPath(PATHS[pathIndex].pts); G.diff=diff;
  G.lives=G.maxLives=diff.lives; G.gold=diff.gold; G.goldAcc=0; G.time=0; G.corrupt=0;
  G.shapes.length=G.towers.length=G.projs.length=G.parts.length=G.waves.length=0;
  G.nextWave=0; G.cleared=0; G.leaked=0; G.killed=0; G.dealt=0;
  G.selected=G.hovered=null; G.placing=false; G.paused=false; G.fast=false;
}

/* Fraction of lives lost — drives how colorful the world gets. The displayed
 * value eases toward the true one so the map blooms rather than snapping. */
function corruptionTarget(){
  if (G.mode === 'lost') return 1;
  if (!G.maxLives) return 0;
  return Math.max(0, Math.min(1, 1 - G.lives / G.maxLives));
}
function corruption(){ return G.corrupt; }

/* ------------------------------- waves ---------------------------- */
function canStartWave(){
  // no gating: waves may be stacked on top of each other, at the player's risk
  return G.mode === 'playing' && G.nextWave < WAVES.length;
}
function startWave(){
  if (!canStartWave()) return;
  const idx = G.nextWave++;
  const queue = [];
  for (const g of WAVES[idx])
    for (let i = 0; i < g.n; i++) queue.push({ t: g.at + i*g.gap, s:g.s, c:g.c });
  queue.sort((a,b) => a.t - b.t);
  G.waves.push({ idx, queue, t:0, alive:0 });
}

/* ------------------------------ shapes ---------------------------- */
function spawnShape(sides, color, dist, wave){
  const s = {
    id:uid(), sides, color, dist, wave,
    x:0, y:0, angle:Math.random()*Math.PI*2,
    speed:SHAPE_SPEED[sides], radius:SHAPE_RADIUS[sides],
    spin:SHAPE_SPIN[sides]*(Math.random()<0.5?-1:1),
    flash:0, dead:false
  };
  const p = G.path.posAt(dist); s.x=p.x; s.y=p.y;
  G.shapes.push(s);
  if (wave) wave.alive++;
  return s;
}

function removeShape(s){
  s.dead = true;
  if (s.wave) s.wave.alive--;
}

/* Apply `amount` hits to a shape and return how much was actually consumed.
 * When the shape splits, whatever of *this frame's* damage is left over is
 * guaranteed to carry into the two children rather than depending on the
 * projectile physically running into them. */
function damageShape(s, amount){
  const take = Math.min(amount, s.color);
  s.color -= take; s.flash = 1;
  if (hasSfx()) SFX.pop(s.sides, s.color + take);
  G.goldAcc += take * GOLD_PER_HIT * G.diff.goldMul;   // fractional income, paid out in whole gold
  const whole = Math.floor(G.goldAcc);
  if (whole > 0){ G.gold += whole; G.goldAcc -= whole; }
  G.dealt += take;
  let used = take;
  if (s.color <= 0){
    removeShape(s);
    G.killed++;
    if (s.sides > 3){
      // a red n-gon splits into two purple (n-1)-gons, one pushed back up the path
      const off = SHAPE_RADIUS[s.sides-1] + 5;
      const front = spawnShape(s.sides-1, 6, Math.min(G.path.length - 1, s.dist + off), s.wave);
      const back  = spawnShape(s.sides-1, 6, Math.max(0, s.dist - off), s.wave);
      burst(s.x, s.y, COLORS[6].hex, 7);
      if (amount - used > 0) used += damageShape(front, amount - used);
      if (amount - used > 0) used += damageShape(back,  amount - used);
    } else {
      burst(s.x, s.y, '#8a8a94', 9);
    }
  }
  return used;
}

function leak(s){
  const dmg = totalHealth(s.color, s.sides);
  G.lives -= dmg;
  G.leaked++;
  if (hasSfx()) SFX.damage(dmg);
  removeShape(s);
  burst(G.path.end.x, G.path.end.y, COLORS[s.color].hex, 22, 3);
  if (G.lives <= 0){ G.lives = 0; G.mode = 'lost'; }
}

/* ------------------------------ circles --------------------------- */
function canPlace(x,y){
  if (x < TOWER_RADIUS || y < TOWER_RADIUS || x > WORLD_W-TOWER_RADIUS || y > WORLD_H-TOWER_RADIUS) return false;
  if (G.path.distanceTo(x,y) < PATH_WIDTH/2 + TOWER_RADIUS) return false;   // just off the path
  for (const t of G.towers) if (Math.hypot(t.x-x, t.y-y) < TOWER_RADIUS*2) return false;
  return true;
}
function placeTower(x,y){
  if (G.gold < TOWER_COST || !canPlace(x,y)) return null;
  G.gold -= TOWER_COST;
  const t = { id:uid(), x, y, lv:{range:1,firerate:1,power:1,speed:1}, cd:0, aim:0, mode:0 };
  G.towers.push(t);
  return t;
}
function upgrade(t, key){
  const lv = t.lv[key];
  const cost = upgradeCost(lv);
  if (G.gold < cost) return false;
  G.gold -= cost; t.lv[key]++;
  return true;
}
function sellTower(t){
  G.gold += Math.ceil(towerSpent(t) * SELL_REFUND);
  const i = G.towers.indexOf(t);
  if (i >= 0) G.towers.splice(i,1);
  if (G.selected === t) G.selected = null;
}

/* Aim straight at where the shape is right now — no leading. The shot takes
 * time to arrive, so a slow projectile lands behind a moving target and misses.
 * That is exactly what makes projectile Speed worth buying. */
function aimAt(s){ return { x:s.x, y:s.y }; }

function updateTower(t, dt){
  t.cd -= dt;
  if (t.cd > 0) return;
  const range = statValue('range', t.lv.range);
  const r2 = range*range;
  const mode = TARGET_MODES[t.mode || 0].key;
  let target = null, best = 0;
  for (const s of G.shapes){
    if (s.dead) continue;
    const dx = s.x-t.x, dy = s.y-t.y, d2 = dx*dx + dy*dy;
    if (d2 > r2) continue;
    let score;
    if (mode === 'first')       score = s.dist;
    else if (mode === 'last')   score = -s.dist;
    else if (mode === 'strong') score = totalHealth(s.color, s.sides) * 1e6 + s.dist;
    else                        score = -d2;                       // 'close'
    if (!target || score > best){ target = s; best = score; }
  }
  if (!target) return;

  const speed = statValue('speed', t.lv.speed);
  const pw = Math.round(statValue('power', t.lv.power));
  const p = aimAt(target);
  const dx = p.x - t.x, dy = p.y - t.y, d = Math.hypot(dx,dy) || 1;
  t.aim = Math.atan2(dy,dx);
  G.projs.push({
    id:uid(),
    x: t.x + dx/d*(TOWER_RADIUS+2), y: t.y + dy/d*(TOWER_RADIUS+2),
    vx: dx/d*speed, vy: dy/d*speed,
    power: pw, rate: pw * POWER_RATE, charge: 0, seen: new Set(), dead:false
  });
  t.cd += 1 / statValue('firerate', t.lv.firerate);
  if (t.cd < 0) t.cd = 0;
  if (hasSfx()) SFX.fire();
}

function updateProjectile(p, dt){
  const nx = p.x + p.vx*dt, ny = p.y + p.vy*dt;

  const touching = [];
  for (const s of G.shapes){
    if (s.dead) continue;
    const iv = segCircleInterval(p.x, p.y, nx, ny, s.x, s.y, s.radius*HITBOX_SCALE + PROJ_RADIUS);
    if (iv) touching.push({ t:iv[0], contact:(iv[1] - iv[0]) * dt, s });
  }
  if (touching.length){
    touching.sort((a,b) => a.t - b.t);          // nearest along the flight first
    for (const h of touching){
      if (p.power <= 0) break;
      if (h.s.dead) continue;
      p.charge += p.rate * h.contact;           // metered, amortised over frames
      let n = Math.floor(p.charge);
      // A shot that connects must always register. Without this a fast or
      // glancing hit can accrue less than one whole hit of charge and sail
      // straight through untouched, which just reads as a broken projectile.
      // The guarantee is once per shape, and it runs the charge into debt, so
      // sustained contact is still metered by the rate.
      if (n <= 0 && !p.seen.has(h.s.id)) n = 1;
      p.seen.add(h.s.id);
      if (n <= 0) continue;
      const used = damageShape(h.s, Math.min(n, p.power));
      p.charge -= used;
      p.power  -= used;
    }
  }

  p.x = nx; p.y = ny;
  if (p.power <= 0) p.dead = true;
  const m = 40;
  if (p.x < -m || p.y < -m || p.x > WORLD_W+m || p.y > WORLD_H+m) p.dead = true;
}

/* ----------------------------- particles -------------------------- */
function burst(x,y,color,n,scale){
  scale = scale || 1;
  for (let i = 0; i < n; i++){
    const a = Math.random()*Math.PI*2, sp = (30 + Math.random()*90)*scale;
    G.parts.push({ x, y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp,
                   life:1, decay:1.4 + Math.random(), color,
                   size:(2 + Math.random()*3)*scale, spin:(Math.random()-0.5)*8, rot:0 });
  }
}
/* drifting color that seeps out of the exit as lives are lost */
function corruptionMotes(dt){
  const c = corruption();
  if (c <= 0.02) return;
  const lost = G.mode === 'lost';
  const rate = lost ? 90 : c * 26;
  if (Math.random() > rate * dt) return;
  const e = G.path.end;
  let px, py;
  if (lost){                                     // the world has fallen: color everywhere
    px = Math.random()*WORLD_W; py = Math.random()*WORLD_H;
  } else {
    const R = 60 + c * 900;
    const a = Math.random()*Math.PI*2, r = Math.sqrt(Math.random())*R;
    px = e.x + Math.cos(a)*r; py = e.y + Math.sin(a)*r;
  }
  G.parts.push({
    x: px, y: py,
    vx:(Math.random()-0.5)*22, vy:-8 - Math.random()*22,
    life:1, decay:0.22 + Math.random()*0.2,
    color: COLORS[1 + (Math.random()*6|0)].hex,
    size:(2 + Math.random()*4) * (lost ? 1.8 : 1), spin:(Math.random()-0.5)*3, rot:Math.random()*6
  });
}

/* ------------------------------- step ----------------------------- */
function step(dt){
  if (G.mode !== 'playing'){
    G.corrupt += (corruptionTarget() - G.corrupt) * (1 - Math.exp(-dt * 2.4));
    if (G.mode === 'lost' && G.path) corruptionMotes(dt);
    stepParticles(dt);
    return;
  }
  G.time += dt;

  // spawns
  for (const w of G.waves){
    w.t += dt;
    while (w.queue.length && w.queue[0].t <= w.t){
      const e = w.queue.shift();
      spawnShape(e.s, e.c, 0, w);
    }
  }

  // shapes
  for (const s of G.shapes){
    if (s.dead) continue;
    s.dist += s.speed*dt;
    s.angle += s.spin*dt;
    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt*6);
    if (s.dist >= G.path.length){ leak(s); continue; }
    const p = G.path.posAt(s.dist); s.x = p.x; s.y = p.y;
  }

  for (const t of G.towers) updateTower(t, dt);
  for (const p of G.projs) if (!p.dead) updateProjectile(p, dt);

  if (G.shapes.some(s => s.dead)) G.shapes = G.shapes.filter(s => !s.dead);
  if (G.projs.some(p => p.dead))  G.projs  = G.projs.filter(p => !p.dead);

  // wave completion
  for (let i = G.waves.length - 1; i >= 0; i--){
    const w = G.waves[i];
    if (w.queue.length === 0 && w.alive <= 0){
      G.gold += waveBonus(w.idx);
      G.cleared++;
      G.waves.splice(i,1);
    }
  }
  if (G.mode === 'playing' && G.nextWave >= WAVES.length && G.waves.length === 0) G.mode = 'won';

  G.corrupt += (corruptionTarget() - G.corrupt) * (1 - Math.exp(-dt * 2.4));
  corruptionMotes(dt);
  stepParticles(dt);
}

function stepParticles(dt){
  for (const p of G.parts){
    p.x += p.vx*dt; p.y += p.vy*dt;
    p.vx *= (1 - 1.4*dt); p.vy *= (1 - 1.4*dt);
    p.rot += p.spin*dt;
    p.life -= p.decay*dt;
  }
  if (G.parts.some(p => p.life <= 0)) G.parts = G.parts.filter(p => p.life > 0);
}
